/**
 * `reconcile`: removes from the target what the source no longer has (design, Commands).
 * - Surveys, projects, members and people: the full key sets, compared (the SQL tables are
 *   small). A survey removed takes its rows and Studio's own files with it; legacy files are
 *   never removed (other records may link them, and the old shares keep the bytes).
 * - Users' saved views and Studio's own files: the small containers' names, compared.
 * - Responses: the deletion copies since the last reconcile (`deleteResponses`); the surveys whose
 *   responses were all deleted (the old app's event) compared id by id, markers too; and the
 *   surveys changed since the last reconcile (every survey with `--full`) a count compare and,
 *   where counts differ, an id compare. Inside the window a survey above `maxCountResponses` is
 *   not counted (the old store cannot count rows without reading them all); noted.
 * Responses the source has and the target misses are `delta`'s to copy; they are noted only.
 */
import { fileRecordFromBlob, isGuid } from "../providers/azure-legacy/mapping.js";
import { CONCURRENCY, DELETE_ALL_EVENT, inParallel, RECONCILE, storedMarks } from "./delta.js";
import type { ReconcileState } from "./delta.js";
import { mapPeople } from "./map/people.js";
import { createReport, type Report } from "./map/report.js";
import { mapResponse } from "./map/results.js";
import { mapSurvey } from "./map/surveys.js";
import { markOf, takeMarks } from "./marks.js";
import { collectNamed } from "./named.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import type { MigrationTarget } from "./target.js";

export interface ReconcileOptions {
  sample?: SampleSet;
  /** `--full`: every survey's responses counted (never inside the window). */
  full: boolean;
  report: Report;
  /** Surveys compared at once; default 16. */
  concurrency?: number;
  /** Without `--full`, surveys holding more responses are not counted; default 50,000. */
  maxCountResponses?: number;
  now?: () => Date;
  progress?: (line: string) => void;
  /** Tests only: the new marks' safety margin (default `MARKS_MARGIN_MS`). */
  marginMs?: number;
}

export const MAX_COUNT_RESPONSES = 50_000;

export async function runReconcile(
  source: LegacySource,
  target: MigrationTarget,
  options: ReconcileOptions,
): Promise<void> {
  const { report, sample } = options;
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const progress = options.progress ?? (() => undefined);
  const { state } = target;
  const quiet = createReport();
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);
  const removed = (entity: string, ids: Record<string, string>) =>
    report.note(`reconcile_removed_${entity}`, ids);

  const marks = await storedMarks(target);
  const since = (await state.get<ReconcileState>(RECONCILE))?.since ?? marks;
  const next = await takeMarks(source, now, options.marginMs);
  const run = await state.get<{ startedAt: string }>("run");
  const runStart = run?.startedAt ?? marks.takenAt;

  // No history is listed: the authors the target's history names stay named.
  const named = await collectNamed(source, {
    ...(sample && { sample }),
    report: quiet,
    runStart,
    readsHistory: () => false,
  });
  const targetUsers = new Set(await target.idsOf("users"));
  const ctx = {
    projects: new Set(named.projects.map(({ project }) => project.id)),
    projectsWithoutMembers: named.projectsWithoutMembers,
    people: new Set(named.people.filter((p) => targetUsers.has(p.id)).map((p) => p.id)),
    legacyUsers: named.legacyUsers,
    report: quiet,
  };

  // ---- Surveys ----
  const expected = new Map<string, string>(); // survey id → post id
  const changed = new Set<string>();
  const surveysSince = markOf(since, "surveys");
  for await (const row of source.surveys()) {
    const surveyId = row.id.toLowerCase();
    if (!wanted(surveyId)) continue;
    // Whether a survey is copied does not depend on its documents.
    const base = mapSurvey(row, null, null, null, ctx);
    if (base === null) continue;
    expected.set(surveyId, base.record.postId);
    if (row.timestamp === null || row.timestamp.getTime() > surveysSince.getTime()) {
      changed.add(surveyId);
    }
  }
  const migrated: string[] = [];
  for (const surveyId of await target.idsOf("surveys")) {
    if (expected.has(surveyId)) {
      migrated.push(surveyId);
    } else if (await target.deleteSurvey(surveyId)) {
      removed("survey", { surveyId });
    }
  }

  // ---- Projects and their members ----
  const storedMembers = new Map<string, string[]>();
  for (const { projectId, userId, role } of await target.projectMembers()) {
    const list = storedMembers.get(projectId) ?? [];
    list.push(`${userId}:${role}`);
    storedMembers.set(projectId, list);
  }
  const targetProjects = new Set(await target.idsOf("projects"));
  for (const projectId of targetProjects) {
    if (ctx.projects.has(projectId)) continue;
    if (await target.deleteProject(projectId)) removed("project", { projectId });
  }
  for (const { project, members } of named.projects) {
    if (!targetProjects.has(project.id)) continue;
    const want = [...new Set(members.map((m) => `${m.userId}:${m.role}`))].sort();
    const have = (storedMembers.get(project.id) ?? []).sort();
    if (want.join(",") === have.join(",")) continue;
    await target.upsertProject(project, members);
    report.note("reconcile_members_replaced", { projectId: project.id });
  }

  // ---- People: those the source data (or the target's copied history) no longer names ----
  const names = new Set([...named.named, ...(await target.historyAuthors())]);
  const keep = new Set(mapPeople(named.users, names, runStart, quiet).people.map((p) => p.id));
  const gone = [...targetUsers].filter((id) => !keep.has(id));
  if (gone.length > 0) await target.deletePeople(gone);
  for (const userId of gone) removed("person", { userId });

  // ---- Users' saved views and Studio's own files (small containers, listed by name) ----
  const views = new Set<string>();
  for await (const name of source.changedBlobs("views", new Date(0))) {
    const [surveyId, userId, view, ...rest] = name.split("/");
    if (!surveyId || !userId || rest.length > 0) continue;
    if (view !== "summary" && view !== "table") continue;
    views.add(`${surveyId.toLowerCase()}/${userId.toLowerCase()}/${view}`);
  }
  const staleViews = (await target.keysOf("saved_views")).filter((key) => !views.has(key));
  if (staleViews.length > 0) await target.deleteViews(staleViews);
  for (const key of staleViews) {
    const [surveyId = "", userId = "", view = ""] = key.split("/");
    removed("view", { surveyId, userId, view });
  }
  const files = new Set<string>();
  for await (const blob of source.appFiles()) {
    const record = fileRecordFromBlob(blob.blobName, blob.properties, blob.metadata);
    if (record !== null) files.add(record.id);
  }
  // Studio's own files only: the legacy files (the zero survey) are never among these keys.
  const staleFiles = (await target.keysOf("files")).filter((id) => !files.has(id));
  if (staleFiles.length > 0) await target.deleteFiles(staleFiles);
  for (const fileId of staleFiles) removed("file", { fileId });
  progress(
    `removed: ${report.counts().reconcile_removed_survey ?? 0} surveys, ${gone.length} people, ` +
      `${staleViews.length} views, ${staleFiles.length} files`,
  );

  // ---- Responses ----
  const tablesSince = markOf(since, "tables");
  const deletedAll = new Set<string>();
  for await (const event of source.events(tablesSince)) {
    if (event.type === DELETE_ALL_EVENT) deletedAll.add(event.surveyId.toLowerCase());
  }
  const cap = options.maxCountResponses ?? MAX_COUNT_RESPONSES;
  let responsesRemoved = 0;

  await inParallel(migrated, options.concurrency ?? CONCURRENCY, async (surveyId) => {
    const postId = expected.get(surveyId)!;
    // Deleted since the last reconcile, by their copies.
    const copies: string[] = [];
    for await (const copy of source.deletedCopies(postId, tablesSince)) {
      if (isGuid(copy.responseId)) copies.push(copy.responseId.toLowerCase());
    }
    if (copies.length > 0) responsesRemoved += await target.deleteResponses(surveyId, copies);

    const allDeleted = deletedAll.has(surveyId);
    if (!options.full && !allDeleted && !changed.has(surveyId)) return;
    const held = await target.countRows("survey_responses", surveyId);
    if (!options.full && !allDeleted && held > cap) {
      report.note("reconcile_count_skipped_size", { surveyId });
      return;
    }
    const ids = new Set<string>();
    for await (const row of source.responses(postId)) {
      const mapped = mapResponse(surveyId, row, quiet);
      if (mapped !== null) ids.add(mapped.response.id);
    }
    if (ids.size !== held || allDeleted) {
      const stored = await target.keysOf("survey_responses", surveyId);
      const extra = stored.filter((id) => !ids.has(id));
      if (extra.length > 0) {
        responsesRemoved += await target.deleteResponses(surveyId, extra);
        report.note("reconcile_removed_responses", { surveyId });
      }
      if (stored.length - extra.length < ids.size) {
        report.note("reconcile_missing_responses", { surveyId });
      }
    }
    if (allDeleted) {
      const clients = new Set<string>();
      for await (const marker of source.markers(surveyId)) clients.add(marker.clientId);
      const stale = (await target.keysOf("completion_markers", surveyId)).filter(
        (clientId) => !clients.has(clientId),
      );
      if (stale.length > 0) await target.deleteMarkers(surveyId, stale);
    }
  });
  progress(`responses removed: ${responsesRemoved}`);

  await state.set(RECONCILE, { since: next, at: at() } satisfies ReconcileState, at());
  progress("done");
}
