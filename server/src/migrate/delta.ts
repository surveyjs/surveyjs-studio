/**
 * `delta`: what changed in the source since the high-water marks, into the target, without
 * listing the large stores. How each part's changes are found:
 * - SQL tables (people, surveys, projects, members): by their change time (a row with none is
 *   read every time, and noted);
 * - layouts, permissions, published snapshots, users' views and Studio's own files: their
 *   containers are small, so they are listed and filtered by last-modified time (a published
 *   snapshot is named by its survey's publish id);
 * - the history of a changed survey: listed under that survey's prefix only, never the whole
 *   container;
 * - responses, completion markers and deletion copies of every migrated survey: each survey's
 *   tables queried by change time, in parallel;
 * - events: by change time; legacy files: those the changed records newly link.
 * A survey the target lacks (new since the marks, or newly in the sample) is copied whole, and
 * its saved views, Studio's own files and, in a sample, its events are taken whatever their
 * time: what predates the marks was not the copy's when the survey was not copied.
 * A person written again whose source row holds no access key any more loses the stored one.
 * A changed survey is copied again through `copy`'s own per-survey functions (the mapping and the
 * privacy rule exist once). At the end the marks move forward to those taken at the start; a run
 * that stops keeps the old marks, and the next one reads the same changes again (upserts).
 */
import type { SurveyFileRecord } from "../domain/types.js";
import { fileRecordFromBlob } from "../providers/azure-legacy/mapping.js";
import {
  BATCH,
  batcher,
  CHECKPOINT,
  createSurveyCopier,
  dumper,
  eventRec,
  inParallel,
  type SurveyCheckpoint,
  type SurveyTexts,
  type WrittenDocuments,
} from "./copy.js";
import type { DumpWriter } from "./dump.js";
import { createReport, phaseTimer, type Report } from "./map/report.js";
import { mapSurvey } from "./map/surveys.js";
import { mapView } from "./map/views.js";
import { isCompleteMarks, markOf, takeMarks, type HighWaterMarks } from "./marks.js";
import { collectNamed } from "./named.js";
import type { EventRec, ViewRec } from "./records.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import type { SourceFingerprint } from "./source/fingerprint.js";
import { guardSource, requireCompleteCopy, requireSameSample } from "./state.js";
import type { MigrationTarget } from "./target.js";

export interface DeltaOptions {
  /** Only these accounts' closure (`--sample`, `--include`); default everything. */
  sample?: SampleSet;
  report: Report;
  dump?: DumpWriter;
  /** Surveys whose tables are read at once; default 16. */
  concurrency?: number;
  /** Rows per write; default 500. */
  batchSize?: number;
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

/**
 * State key `reconcile`: the marks `reconcile` reads deletions and changed surveys from. The
 * first `delta` keeps the copy's marks there before it moves its own, so a `reconcile` after any
 * number of deltas still sees everything since it last ran.
 */
export interface ReconcileState {
  since: HighWaterMarks;
  at?: string;
}
export const RECONCILE = "reconcile";

export const CONCURRENCY = 16;
/** The event the old app writes after deleting every response of a survey. */
export const DELETE_ALL_EVENT = "SURVEY_DELETEALLRESULTS";

/** The stored marks; an error when there are none (no copy yet) or they are of an older run. */
export async function storedMarks(target: MigrationTarget): Promise<HighWaterMarks> {
  const marks = await target.state.get<unknown>("marks");
  if (marks === null) throw new Error("No high-water marks in the target: run copy first");
  if (!isCompleteMarks(marks)) {
    throw new Error("The target's high-water marks are of an older run: wipe it and copy again");
  }
  return marks;
}

export async function runDelta(
  source: LegacySource,
  target: MigrationTarget,
  options: DeltaOptions,
): Promise<void> {
  const { report, sample, dump } = options;
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const size = options.batchSize ?? BATCH;
  const progress = options.progress ?? (() => undefined);
  const phase = phaseTimer(report, progress);
  const write = dumper(dump);
  const { state } = target;
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);

  await requireCompleteCopy(state);
  await requireSameSample(state, sample);
  await guardSource(state, options.fingerprint, at(), progress);
  const marks = await storedMarks(target);
  // Taken before anything is read: whatever changes while this run reads is read again next time.
  const next = await takeMarks(source, now, {
    report,
    ...(options.marginMs !== undefined && { marginMs: options.marginMs }),
  });
  const run = await state.get<{ startedAt: string }>("run");
  const tablesSince = markOf(marks, "tables");
  const blobsSince = markOf(marks, "blobs");
  /** A row with no change time is read by every delta; noted, as it should be rare. */
  const noChangeTime = (table: string, id: string) =>
    report.note("change_time_missing", { table, id: id.toLowerCase() });

  // ---- What changed: SQL rows by change time, the small containers by listing ----
  const changedUsers = new Set<string>();
  for await (const row of source.users(markOf(marks, "users"))) {
    if (row.timestamp.getTime() === 0) noChangeTime("users", row.id);
    changedUsers.add(row.id.toLowerCase());
  }
  const changedProjects = new Set<string>();
  for await (const row of source.organizations(markOf(marks, "organizations"))) {
    if (row.timestamp === null) noChangeTime("organizations", row.id);
    changedProjects.add(row.id.toLowerCase());
  }
  for await (const row of source.organizationUsers(markOf(marks, "organizationUsers"))) {
    if (row.timestamp === null) noChangeTime("organizationUsers", row.id);
    changedProjects.add(row.organizationid.toLowerCase());
  }
  /** Surveys whose row, permissions or layouts changed: their documents are copied again. */
  const changedSurveys = new Set<string>();
  for await (const row of source.surveys(markOf(marks, "surveys"))) {
    if (row.timestamp === null) noChangeTime("surveys", row.id);
    changedSurveys.add(row.id.toLowerCase());
  }
  for (const container of ["layouts", "permissions"] as const) {
    for await (const name of source.changedBlobs(container, blobsSince)) {
      changedSurveys.add(name.toLowerCase());
    }
  }
  /** Publish ids whose published snapshot changed: their surveys' documents are copied again. */
  const changedPublished = new Set<string>();
  for await (const name of source.changedBlobs("published", blobsSince)) {
    changedPublished.add(name.toLowerCase());
  }
  /** Whether the survey's row, layouts, permissions or published snapshot changed. */
  const changed = (row: { id: string; publishid: string | null }) =>
    changedSurveys.has(row.id.toLowerCase()) ||
    (row.publishid !== null && changedPublished.has(row.publishid.toLowerCase()));
  phase(
    "changes",
    `changed: ${changedSurveys.size} surveys, ${changedPublished.size} published snapshots, ` +
      `${changedProjects.size} projects`,
  );

  // ---- People and projects: the changed ones, and those the target does not hold yet ----
  // Only the history of a changed survey, or of one the target lacks, can name new authors.
  const targetSurveys = new Set(await target.idsOf("surveys"));
  const named = await collectNamed(source, {
    ...(sample && { sample }),
    report,
    runStart: run?.startedAt ?? marks.takenAt,
    readsHistory: (surveyId, row) =>
      changed({ id: surveyId, publishid: row.publishid }) || !targetSurveys.has(surveyId),
  });
  const targetUsers = new Set(await target.idsOf("users"));
  const people = named.people.filter((p) => changedUsers.has(p.id) || !targetUsers.has(p.id));
  const { skipped } = await target.upsertPeople(people);
  const skippedIds = new Set(skipped.map(({ id }) => id));
  for (const { id, reason } of skipped) report.skip("person", { userId: id }, reason);
  const written = new Set(people.filter((p) => !skippedIds.has(p.id)).map((p) => p.id));
  const keys = named.keys.filter((key) => written.has(key.userId));
  await write(
    "person",
    people.filter((p) => written.has(p.id)),
  );
  await target.upsertKeys(keys);
  await write("key", keys);
  // A key the site cleared: the person's row holds none, so its stored key goes too.
  const keyed = new Set(keys.map((key) => key.userId));
  const keyless = [...written].filter((id) => !keyed.has(id));
  if (keyless.length > 0) await target.deleteKeys(keyless);
  const targetProjects = new Set(await target.idsOf("projects"));
  let projectsWritten = 0;
  for (const { project, members } of named.projects) {
    if (!changedProjects.has(project.id) && targetProjects.has(project.id)) continue;
    await target.upsertProject(project, members);
    await write("project", [project]);
    await write("member", members);
    projectsWritten += 1;
  }
  phase("people", `people: ${written.size}, projects: ${projectsWritten}`);

  // ---- Survey by survey, in parallel ----
  const ctx = {
    projects: new Set(named.projects.map(({ project }) => project.id)),
    projectsWithoutMembers: named.projectsWithoutMembers,
    people: new Set(named.people.filter((p) => !skippedIds.has(p.id)).map((p) => p.id)),
    legacyUsers: named.legacyUsers,
    report,
  };
  const copier = createSurveyCopier(source, target, {
    ctx,
    ...(dump && { dump }),
    batchSize: size,
    now,
  });
  /** The surveys the target holds after this run (their events, views and files follow). */
  const migrated = new Set<string>();
  /** The surveys this run copied whole: their views, files and (sample) events of any time. */
  const whole = new Set<string>();
  const counts = { added: 0, documents: 0, rows: 0 };
  /** For a mapping already reported by the copy. */
  const quiet = createReport();

  async function deltaSurvey(row: Parameters<typeof mapSurvey>[0]): Promise<void> {
    const surveyId = row.id.toLowerCase();
    if (!targetSurveys.has(surveyId)) {
      // New since the marks (or not copied before): copied whole.
      if (await copier.copySurvey(row)) {
        migrated.add(surveyId);
        whole.add(surveyId);
        counts.added += 1;
        report.note("delta_new_survey", { surveyId });
      }
      return;
    }
    // The responses' keys so far; a checkpoint of an earlier version has none: all rows again.
    // No checkpoint at all: a copy stopped inside the survey, so its documents are written too.
    const checkpoint = await state.get<SurveyCheckpoint>(`${CHECKPOINT}${surveyId}`);
    const known = checkpoint?.answerNames ? new Set(checkpoint.answerNames) : null;
    // A survey of a project whose members changed may move to its creator: mapped again.
    const owner = row.userid?.toLowerCase() ?? "";
    let documents: WrittenDocuments | null = null;
    if (changed(row) || changedProjects.has(owner) || checkpoint === null) {
      // The checkpoint stays: it keeps the survey's answer names, and a stopped delta repeats.
      // Its answer names make the interim private list cover the responses' own keys too.
      documents = await copier.documents(row, {
        keepCheckpoint: true,
        ...(known !== null && { answerNames: known }),
      });
      // A row that maps to no survey any more: `reconcile` removes it.
      if (documents === null) return;
      counts.documents += 1;
    }
    const base = documents?.rec ?? mapSurvey(row, null, null, null, { ...ctx, report: quiet });
    if (base === null) return;
    migrated.add(surveyId);

    // The survey's texts, read at most once (the documents read them already).
    let texts: SurveyTexts | null = documents?.texts ?? null;
    const textsOf = async () => (texts ??= await copier.texts(surveyId));
    const rows = await copier.rows(
      surveyId,
      base.record.postId,
      known === null ? undefined : tablesSince,
      {
        row,
        texts: textsOf,
        known: known ?? [],
        stored: async () => documents?.interim ?? (await target.privateQuestionsOf(surveyId)),
      },
    );
    const grew = known === null || [...rows.answerNames].some((name) => !known.has(name));
    const answerNames = new Set([...(known ?? []), ...rows.answerNames]);
    if (documents !== null || grew) {
      // The privacy rule with every answer name: new documents, or a response with a new key.
      await copier.finish(
        row,
        await textsOf(),
        answerNames,
        rows.privateQuestions ?? documents?.interim ?? (await target.privateQuestionsOf(surveyId)),
      );
      await copier.checkpoint(surveyId, answerNames);
    }
    await copier.linkedFiles(surveyId, [...(documents?.links ?? []), ...rows.links], {
      skipStored: true,
    });
    counts.rows += 1;
  }

  await inParallel(
    (async function* () {
      for await (const row of source.surveys()) {
        if (wanted(row.id.toLowerCase())) yield row;
      }
    })(),
    options.concurrency ?? CONCURRENCY,
    deltaSurvey,
  );
  phase(
    "surveys",
    `surveys: ${counts.added} new, ${counts.documents} changed, ${counts.rows} read for rows`,
  );

  // ---- Events, users' views, Studio's own files ----
  const events = batcher<EventRec>(size, async (batch) => {
    await target.upsertEvents(batch);
    await write("event", batch);
  });
  // A sample's copy took only its surveys' events: a survey new to it needs its earlier ones,
  // so the table is read whole once (a full copy took every survey's events).
  const earlierEvents = sample !== undefined && whole.size > 0;
  for await (const event of source.events(earlierEvents ? undefined : tablesSince)) {
    const surveyId = event.surveyId.toLowerCase();
    // Read whole: another survey's event only when it changed after the marks.
    const before = event.timestamp.getTime() <= tablesSince.getTime();
    if (earlierEvents && before && !whole.has(surveyId)) continue;
    if (sample && !migrated.has(surveyId)) continue;
    const rec = eventRec(event, report);
    if (rec !== null) await events.add(rec);
  }
  await events.flush();
  phase("events");

  const views = batcher<ViewRec>(size, async (batch) => {
    await target.upsertViews(batch);
    await write("view", batch);
  });
  for await (const name of source.changedBlobs("views", blobsSince)) {
    const surveyId = name.split("/")[0]!.toLowerCase();
    if (!migrated.has(surveyId) || whole.has(surveyId)) continue;
    const blob = await source.viewBlob(name);
    if (blob === null) continue;
    const rec = mapView(name, blob.text, blob.lastModified, report);
    if (rec !== null) await views.add(rec);
  }
  // A survey copied whole: every view of it, listed by its prefix.
  for (const surveyId of whole) {
    for await (const view of source.views(surveyId)) {
      const blobName = `${view.surveyId}/${view.userId}/${view.view}`;
      const rec = mapView(blobName, view.text, view.lastModified, report);
      if (rec !== null) await views.add(rec);
    }
  }
  await views.flush();
  phase("views");

  for await (const blob of source.appFiles()) {
    const record = fileRecordFromBlob(blob.blobName, blob.properties, blob.metadata);
    // Not the app's, of no survey or of no migrated survey: `copy` reported those.
    if (record === null || record.surveyId === null || !migrated.has(record.surveyId)) continue;
    // Changed after the marks, or of a survey copied whole (then of any time).
    const changedSince = blob.properties.lastModified.getTime() > blobsSince.getTime();
    if (!changedSince && !whole.has(record.surveyId)) continue;
    await copier.appFile(blob.blobName, record as SurveyFileRecord);
  }
  phase("files", "own files");

  // ---- The marks move forward; `reconcile` keeps the copy's until it runs ----
  if ((await state.get(RECONCILE)) === null) {
    await state.set(RECONCILE, { since: marks } satisfies ReconcileState, at());
  }
  await state.set("marks", next, at());
  progress("done");
}
