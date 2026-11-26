/**
 * `reconcile`: removes from the target what the source no longer has (design, Commands).
 * - Surveys, projects, members and people: the full key sets, compared (the SQL tables are
 *   small). A survey removed takes its rows, Studio's own files and its checkpoint with it (so a
 *   survey that comes back is copied again); legacy files are never removed (other records may link them, and the old shares keep the bytes). Only people
 *   the migration pre-created and nobody used are removed; any other account is kept, noted.
 * - A survey whose owner the current source maps differently (its project gone or left without
 *   members), or whose layout or permissions blob is gone, is mapped and written again through
 *   `copy`'s per-survey functions (such deletions leave no change time for `delta`).
 * - Users' saved views and Studio's own files: the small containers' names, compared.
 * - Responses: the deletion copies since the last reconcile, each id read in the source first: one
 *   the result table holds again (posted again under the same id) stays, and is copied again if
 *   the target lacks it; the others go (`deleteResponses`). The surveys whose responses were all
 *   deleted (the old app's event) and the surveys changed since the last reconcile (every survey
 *   with `--full`): the counts compared first and, where they differ (always after a
 *   delete-all), the ids, streamed through a temporary table of the target (never every id in
 *   memory). Inside the window a survey above `maxCountResponses` is not counted (the old store
 *   cannot count rows without reading them all); noted.
 * - Completion markers (deleted with their response, leaving no change time): their keys compared
 *   with the source's for every survey with a deletion copy or a delete-all since the last
 *   reconcile (every survey with `--full`); those the source lacks go.
 * Other responses the source has and the target misses are `delta`'s to copy; noted only.
 */
import { fileRecordFromBlob, isGuid } from "../providers/azure-legacy/mapping.js";
import type { LayoutKind, SurveyOwner } from "../domain/types.js";
import {
  BATCH,
  CHECKPOINT,
  createSurveyCopier,
  inParallel,
  PERMISSIONS,
  type SurveyCheckpoint,
  type SurveyTexts,
} from "./copy.js";
import { CONCURRENCY, DELETE_ALL_EVENT, RECONCILE, storedMarks } from "./delta.js";
import type { ReconcileState } from "./delta.js";
import { mapPeople } from "./map/people.js";
import { createReport, phaseTimer, type Report } from "./map/report.js";
import { mapResponse } from "./map/results.js";
import { mapSurvey } from "./map/surveys.js";
import { markOf, takeMarks } from "./marks.js";
import { collectNamed } from "./named.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import type { SourceFingerprint } from "./source/fingerprint.js";
import type { ResultRow } from "./source/tables.js";
import { guardSource, requireCompleteCopy, requireSameSample } from "./state.js";
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
  /** A line at the end of each phase, with its duration. */
  progress?: (line: string) => void;
  /** Tests only: the new marks' safety margin (default `MARKS_MARGIN_MS`). */
  marginMs?: number;
  /**
   * The source the command line opened (names only): recorded at the first run, and a run on
   * another source is refused (`guardSource`). Undefined: not checked (tests).
   */
  fingerprint?: SourceFingerprint;
}

export const MAX_COUNT_RESPONSES = 50_000;
const LAYOUT_KINDS: readonly LayoutKind[] = ["table", "summary", "columns"];
const ownerKey = (owner: SurveyOwner) =>
  owner.kind === "personal" ? `user:${owner.userId}` : `project:${owner.projectId}`;

export async function runReconcile(
  source: LegacySource,
  target: MigrationTarget,
  options: ReconcileOptions,
): Promise<void> {
  const { report, sample } = options;
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const progress = options.progress ?? (() => undefined);
  const phase = phaseTimer(report, progress);
  const { state } = target;
  const quiet = createReport();
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);
  const removed = (entity: string, ids: Record<string, string>) =>
    report.note(`reconcile_removed_${entity}`, ids);

  await requireCompleteCopy(state);
  await requireSameSample(state, sample);
  await guardSource(state, options.fingerprint, at(), progress);
  const marks = await storedMarks(target);
  const since = (await state.get<ReconcileState>(RECONCILE))?.since ?? marks;
  const next = await takeMarks(source, now, {
    report,
    ...(options.marginMs !== undefined && { marginMs: options.marginMs }),
  });
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
  // What the target holds that a deletion in the source could leave stale: owners, the layout
  // kinds, and the surveys whose private questions came from a permissions blob.
  const storedOwners = await target.surveyOwners();
  const layoutsHeld = new Set(await target.keysOf("survey_layouts"));
  const layoutsInSource = new Set<string>();
  for (const kind of LAYOUT_KINDS) {
    for await (const name of source.layoutNames(kind)) {
      layoutsInSource.add(`${name.toLowerCase()}/${kind}`);
    }
  }
  const permissionsHeld = new Set(
    (await state.keys(PERMISSIONS)).map((key) => key.slice(PERMISSIONS.length)),
  );
  const permissionsInSource = new Set<string>();
  for await (const name of source.changedBlobs("permissions", new Date(0))) {
    permissionsInSource.add(name.toLowerCase());
  }
  const expected = new Map<string, string>(); // survey id → post id
  const changed = new Set<string>();
  const remap: Parameters<typeof mapSurvey>[0][] = [];
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
    const stored = storedOwners.get(surveyId);
    if (stored === undefined) continue;
    const layoutGone = LAYOUT_KINDS.some(
      (kind) =>
        layoutsHeld.has(`${surveyId}/${kind}`) && !layoutsInSource.has(`${surveyId}/${kind}`),
    );
    const permissionsGone = permissionsHeld.has(surveyId) && !permissionsInSource.has(surveyId);
    if (ownerKey(stored) !== ownerKey(base.record.owner) || layoutGone || permissionsGone) {
      remap.push(row);
    }
  }
  const migrated: string[] = [];
  for (const surveyId of await target.idsOf("surveys")) {
    if (expected.has(surveyId)) {
      migrated.push(surveyId);
      continue;
    }
    if (await target.deleteSurvey(surveyId)) removed("survey", { surveyId });
    // Its checkpoint too: a survey that comes back is then copied again, not skipped as copied.
    await state.delete(`${CHECKPOINT}${surveyId}`);
    await state.delete(`${PERMISSIONS}${surveyId}`);
  }

  phase("surveys", `surveys: ${migrated.length} kept`);

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

  phase("projects");

  // ---- Surveys mapped again: owner, layouts or permissions changed by a deletion ----
  const copier = createSurveyCopier(source, target, { ctx, batchSize: BATCH, now });
  for (const row of remap) {
    const surveyId = row.id.toLowerCase();
    const checkpoint = await state.get<SurveyCheckpoint>(`${CHECKPOINT}${surveyId}`);
    // The responses' keys make the interim private list cover them under the new mapping too.
    const written = await copier.documents(row, {
      keepCheckpoint: true,
      ...(checkpoint?.answerNames && { answerNames: checkpoint.answerNames }),
    });
    if (written === null) continue;
    if (checkpoint?.answerNames) {
      await copier.finish(row, written.texts, checkpoint.answerNames, written.interim);
    } else {
      // Without the responses' keys the interim list (a superset, never weaker) stays.
      report.note("reconcile_private_questions_kept", { surveyId });
    }
    await copier.linkedFiles(surveyId, written.links, { skipStored: true });
    report.note("reconcile_remapped_survey", { surveyId });
  }

  phase("remap", `surveys mapped again: ${remap.length}`);

  // ---- People the source data (or the target's copied history) no longer names ----
  // Only accounts the migration pre-created and nobody used; an admin, an account created at
  // sign-in or one somebody has used is never removed by the tool.
  const names = new Set([...named.named, ...(await target.historyAuthors())]);
  const keep = new Set(mapPeople(named.users, names, runStart, quiet).people.map((p) => p.id));
  const seeded = new Set(await target.seededPeople());
  const unnamed = [...targetUsers].filter((id) => !keep.has(id));
  const gone = unnamed.filter((id) => seeded.has(id));
  if (gone.length > 0) await target.deletePeople(gone);
  for (const userId of gone) removed("person", { userId });
  for (const userId of unnamed) {
    if (!seeded.has(userId)) report.note("person_kept_unseeded", { userId });
  }

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
  phase(
    "people_views_files",
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
  /** Responses a deletion copy names that the source holds again and the target lacks. */
  const copyAgain = new Map<string, ResultRow[]>();

  await inParallel(migrated, options.concurrency ?? CONCURRENCY, async (surveyId) => {
    const postId = expected.get(surveyId)!;
    // Deleted since the last reconcile, by their copies (ids as stored).
    const copies = new Set<string>();
    let anyCopy = false;
    for await (const copy of source.deletedCopies(postId, tablesSince)) {
      anyCopy = true;
      if (isGuid(copy.responseId)) copies.add(copy.responseId);
    }
    // An id the result table holds again (posted again after the deletion) is not deleted.
    const gone: string[] = [];
    const back: ResultRow[] = [];
    for (const id of copies) {
      const row = await source.response(postId, id);
      if (row === null) gone.push(id.toLowerCase());
      else back.push(row);
    }
    if (gone.length > 0) responsesRemoved += await target.deleteResponses(surveyId, gone);
    if (back.length > 0) {
      const held = new Set(
        await target.existingKeys(
          "survey_responses",
          back.map((row) => row.id.toLowerCase()),
          surveyId,
        ),
      );
      const lacking = back.filter((row) => !held.has(row.id.toLowerCase()));
      if (lacking.length > 0) copyAgain.set(surveyId, lacking);
    }

    const allDeleted = deletedAll.has(surveyId);
    // The old app deletes a response's completion marker with it, leaving no change time.
    if (options.full || allDeleted || anyCopy) {
      const clients = new Set<string>();
      for await (const marker of source.markers(surveyId)) clients.add(marker.clientId);
      const stale = (await target.keysOf("completion_markers", surveyId)).filter(
        (clientId) => !clients.has(clientId),
      );
      if (stale.length > 0) await target.deleteMarkers(surveyId, stale);
    }

    if (!options.full && !allDeleted && !changed.has(surveyId)) return;
    const held = await target.countRows("survey_responses", surveyId);
    if (!options.full && !allDeleted && held > cap) {
      report.note("reconcile_count_skipped_size", { surveyId });
      return;
    }
    // The source's ids, as the copy maps them, streamed (twice at most, never kept).
    const sourceIds = async function* () {
      for await (const row of source.responses(postId)) {
        const mapped = mapResponse(surveyId, row, quiet);
        if (mapped !== null) yield mapped.response.id;
      }
    };
    // The counts first; the ids only when they differ (or every response was deleted, where the
    // same count could hide other rows).
    let count = 0;
    if (!allDeleted) {
      for await (const id of sourceIds()) if (id !== "") count += 1;
    }
    if (allDeleted || count !== held) {
      const { removed: removedExtra, missing } = await target.removeResponsesNotIn(
        surveyId,
        sourceIds(),
      );
      if (removedExtra > 0) {
        responsesRemoved += removedExtra;
        report.note("reconcile_removed_responses", { surveyId });
      }
      if (missing > 0) report.note("reconcile_missing_responses", { surveyId });
    }
  });

  // ---- Responses posted again after their deletion, which the target lacks ----
  // Through `copy`'s own path (the privacy guard first); the survey rows are read again, once,
  // rather than all kept in memory for what is rare.
  if (copyAgain.size > 0) {
    for await (const row of source.surveys()) {
      const surveyId = row.id.toLowerCase();
      const rows = copyAgain.get(surveyId);
      if (rows === undefined) continue;
      const checkpoint = await state.get<SurveyCheckpoint>(`${CHECKPOINT}${surveyId}`);
      const known = checkpoint?.answerNames ?? null;
      let texts: SurveyTexts | null = null;
      const textsOf = async () => (texts ??= await copier.texts(surveyId));
      const stored = await target.privateQuestionsOf(surveyId);
      const copied = await copier.responses(surveyId, rows, {
        row,
        texts: textsOf,
        known: known ?? [],
        stored: () => Promise.resolve(stored),
      });
      // A new key: the final private list and the checkpoint's names, as `delta` keeps them.
      // Without the checkpoint's names the guard's list (a superset, never weaker) stays.
      if (known !== null && [...copied.answerNames].some((name) => !known.includes(name))) {
        const names = new Set([...known, ...copied.answerNames]);
        await copier.finish(row, await textsOf(), names, copied.privateQuestions ?? stored);
        await copier.checkpoint(surveyId, names);
      }
      await copier.linkedFiles(surveyId, copied.links, { skipStored: true });
      for (const { id } of rows) {
        report.note("reconcile_response_copied_again", { surveyId, responseId: id.toLowerCase() });
      }
    }
  }
  phase("responses", `responses removed: ${responsesRemoved}`);

  await state.set(RECONCILE, { since: next, at: at() } satisfies ReconcileState, at());
  progress("done");
}
