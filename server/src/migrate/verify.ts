/**
 * `verify`: the go/no-go evidence for the cutover (design, Decisions: "What go means"). It compares
 * the target with the source as of the high-water marks, through both providers' domain reads, the
 * source's reads with the mapping's decisions applied (compare.ts). A source record changed after
 * the marks is listed as pending, never as a difference; so is a target item the source lacks
 * when a dated trace of its deletion comes after the marks (the survey-delete or delete-all event,
 * a deletion copy, by their storage times as the marks), and, in a full verify after a
 * `reconcile` that ran after the marks, one of a kind the old app deletes without a trace (a
 * layout or permissions blob, a member, a project, a saved view or file, a person no longer
 * named). Any difference makes the run red.
 *
 * - **Full** (`--full`, the day before the window): every survey's record, definition, theme,
 *   history, layouts, private questions and responses (the source's rows streamed and counted,
 *   complete and all, against the target's `results.stats` and row count, exact on the rows that
 *   existed before the marks); per survey the completion markers and deleted-response copies
 *   (one per response id), and per table the events, users' views, Studio's own survey files and
 *   the linked legacy files, counted; the projects, members, people, identities and keys (each
 *   source key looked up by its hash); and `deepSample` random surveys (every survey of a
 *   `--sample` run) read in depth through both providers: the record, definition, theme,
 *   history, every response (up to `deepMaxResponses`) and the unfolded rows of each, layouts
 *   and the legacy files they link. It forgets the last green full verify when it starts, and
 *   becomes the incremental verify's baseline when it ends with no difference.
 * - **Incremental** (in the window, after the final `delta` and `reconcile`): what changed since
 *   the last full verify: the changed surveys in full (their responses by the new rows, their
 *   private questions with the checkpoint's answer names), every survey's new responses and
 *   deletions, the responses and markers of a survey whose responses were all deleted since
 *   (the old app's event), the markers of one with a deletion copy since, and the small tables
 *   (surveys, projects, members, people, keys) in full. A `delta` with no `reconcile` after it
 *   is a difference. A full recount of every response is not part of it, nor is the history of
 *   a survey that did not change: the authors it names are read from the target's history.
 *
 * Surveys, people and projects are compared `concurrency` at a time (default 16). An account the
 * target holds that the migration did not seed (an administrator, one made at sign-in) is noted,
 * not a difference; of a seeded person somebody has used since, only what the migration owns is
 * compared. Both modes flag the stores the copy does not take: rows of the app's own token table
 * and users' editor files of no survey. The report holds ids and counts, never content (rule 6).
 */
import { legacyFileRecord } from "../domain/legacy-file.js";
import type { FileKind, LayoutKind, SurveyRecord, SurveyResponse } from "../domain/types.js";
import {
  fileRecordFromBlob,
  UPLOADS_PREFIX,
  userFromLegacy,
} from "../providers/azure-legacy/mapping.js";
import { foldRuns } from "../providers/runs.js";
import type { ProviderSet } from "../providers/types.js";
import {
  bytesChecksum,
  checksum,
  expectedHistory,
  expectedIdentities,
  expectedKey,
  expectedProject,
  expectedRecord,
  expectedResponse,
  expectedUser,
  historyKey,
  mappedMemberKeys,
  memberKeys,
  sameJson,
  sameNames,
  storedJson,
} from "./compare.js";
import { CHECKPOINT, eventRec, inParallel, PERMISSIONS, type SurveyCheckpoint } from "./copy.js";
import { CONCURRENCY, DELETE_ALL_EVENT, RECONCILE, type ReconcileState } from "./delta.js";
import { fileLinks } from "./map/files.js";
import { mapPeople } from "./map/people.js";
import { createReport, phaseTimer, type Report } from "./map/report.js";
import { HISTORY_KEEP, mapDeleted, mapHistory, mapResponse } from "./map/results.js";
import { mapView } from "./map/views.js";
import { mapSurvey } from "./map/surveys.js";
import { changedAfterMarks, markOf, type HighWaterMarks, type SourceStore } from "./marks.js";
import { collectNamed } from "./named.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import { deletedTableOf, responseTableOf } from "./source/tables.js";
import type { SourceFingerprint } from "./source/fingerprint.js";
import { guardSource, requireSameSample } from "./state.js";
import type { CountedTable, MigrationTarget } from "./target.js";

export interface VerifyOptions {
  /** `--full`; otherwise incremental, since the last full verify. */
  full: boolean;
  /** `--sample`: only these accounts' closure, every survey of it compared in depth. */
  sample?: SampleSet;
  /** How many random surveys a full verify compares in depth. */
  deepSample: number;
  /**
   * A survey compared in depth with more responses than this gets its counts and checksums but no
   * response-by-response walk (noted `deep_skipped_size`); default 50,000.
   */
  deepMaxResponses?: number;
  /** Surveys (and people, projects) compared at once; default 16. */
  concurrency?: number;
  report: Report;
  /** A line at the end of each phase, with its duration. */
  progress?: (line: string) => void;
  /**
   * The source the command line opened (names only): recorded at the first run, and a run on
   * another source is refused (`guardSource`). Undefined: not checked (tests).
   */
  fingerprint?: SourceFingerprint;
}

/**
 * What `verify` reads through the source provider: the domain reads it compares, nothing else
 * (the people come from the source's rows, mapped as the provider maps them).
 */
export interface VerifySourceReads {
  readonly surveys: Pick<
    ProviderSet["surveys"],
    "getSurvey" | "getDefinition" | "getTheme" | "listHistory" | "getHistorySnapshot"
  >;
  readonly projects: Pick<ProviderSet["projects"], "getProject">;
  readonly views: Pick<ProviderSet["views"], "getLayout">;
  readonly files: Pick<ProviderSet["files"], "getFileByLegacyName">;
  readonly results: Pick<ProviderSet["results"], "listResponsePage">;
}

/**
 * State key of the last green full verify: when, the marks it compared as of, and whether it
 * covered a sample only. A full verify removes it when it starts and writes it when it ends
 * green (pending items allowed), so the incremental verify never builds on a red one.
 */
const FULL_VERIFY = "verify:full";
/** The event the old app writes after deleting a survey (best effort, as the delete-all's). */
const SURVEY_DELETE_EVENT = "SURVEY_DELETE";
interface FullVerifyState {
  at: string;
  marks: HighWaterMarks;
  sample: boolean;
}

const LAYOUT_KINDS: readonly LayoutKind[] = ["table", "summary", "columns"];

/** How `verify` counts a table's rows (`countRowsOf`). */
interface CountOptions {
  /** Keys a deletion after the marks took from the source: left out on both sides, pending. */
  excused?: Iterable<string>;
  /** A key the source holds twice counts once. */
  distinct?: boolean;
  /** Keys the target holds that the source lacks are left out, pending (trace-less deletions). */
  extraPending?: boolean;
  /** The whole count is pending when it differs (every response deleted after the marks). */
  changed?: boolean;
}
const PAGE = 1000;
const DEEP_MAX_RESPONSES = 50_000;

interface Texts {
  definition: string | null;
  permissions: string | null;
  columns: string | null;
}
const NO_TEXTS: Texts = { definition: null, permissions: null, columns: null };

export async function runVerify(
  source: LegacySource,
  sourceProviders: VerifySourceReads,
  targetProviders: ProviderSet,
  target: MigrationTarget,
  options: VerifyOptions,
): Promise<{ ok: boolean }> {
  const { report, sample } = options;
  const { state } = target;
  const concurrency = options.concurrency ?? CONCURRENCY;
  const phase = phaseTimer(report, options.progress ?? (() => undefined));
  await requireSameSample(state, sample);
  await guardSource(state, options.fingerprint, new Date().toISOString(), options.progress);
  // A full verify that turns red must not leave an older green one as the incremental's baseline.
  if (options.full) await state.delete(FULL_VERIFY);
  // The mappers note what they decide; the copy reported that, so a re-read notes it nowhere.
  const quiet = () => createReport();
  let ok = true;
  const differ = (check: string, ids: Record<string, string>, counts?: Record<string, number>) => {
    ok = false;
    report.difference(check, ids, counts);
  };
  const pendingSeen = new Set<string>();
  const pending = (check: string, ids: Record<string, string>) => {
    const key = `${check}:${JSON.stringify(ids)}`;
    if (pendingSeen.has(key)) return;
    pendingSeen.add(key);
    report.pending(check, ids);
  };
  /** A compared item: nothing when equal; pending when its source changed after the marks. */
  const judge = (
    check: string,
    ids: Record<string, string>,
    equal: boolean,
    changed: boolean,
    counts?: Record<string, number>,
  ) => {
    report.checked(check, 1);
    if (equal) return;
    if (changed) pending(check, ids);
    else differ(check, ids, counts);
  };

  const storedMarks = await state.get<HighWaterMarks>("marks");
  if (storedMarks === null) {
    differ("marks", {});
    return { ok };
  }
  const marks: HighWaterMarks = storedMarks;
  const after = (store: SourceStore, at: Date | string | null | undefined) =>
    changedAfterMarks(marks, store, at);
  /** Incremental: the marks the last full verify compared as of. */
  let since: HighWaterMarks | null = null;
  if (!options.full) {
    const last = await state.get<FullVerifyState>(FULL_VERIFY);
    if (last === null) {
      differ("full_verify", {});
      return { ok };
    }
    if (last.sample && !sample) {
      // Everything but the sample was never compared in full.
      differ("full_verify", { reason: "last full verify was a sample" });
      return { ok };
    }
    since = last.marks;
  }
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);

  // Whether `reconcile` ran after the last `delta`: its own marks are no older than the stored
  // ones (the first `delta` keeps the copy's marks for it, so a `delta` after it shows here).
  const reconciled = await state.get<ReconcileState>(RECONCILE);
  const reconciledAfterMarks =
    reconciled !== null && Date.parse(reconciled.since.takenAt) >= Date.parse(marks.takenAt);
  // The window's verify follows the final `delta` and `reconcile`: deletions since the last
  // `reconcile` are not applied without it.
  if (since !== null && reconciled !== null && !reconciledAfterMarks) differ("reconcile", {});
  /**
   * The day before the window (full, the old service live, after a `reconcile` that ran after
   * the marks): a target item of a kind the old app deletes without a trace (a layout or
   * permissions blob, a member, a project, a saved view or file, so also a person no longer
   * named) that the source lacks was there when that `reconcile` looked, so it was deleted
   * since: pending. Never in the incremental verify: in the window the source is frozen before
   * the final `reconcile`, so such an item is one `reconcile` missed, a difference.
   */
  const traceless = options.full && reconciledAfterMarks;

  // ---- Stores the copy does not take: any row is a difference the operator must see ----
  const partitions: Record<string, number> = {};
  for await (const { partition } of source.ownTokenRows()) {
    partitions[partition] = (partitions[partition] ?? 0) + 1;
  }
  const tokenRows = Object.values(partitions).reduce((n, c) => n + c, 0);
  report.checked("not_copied_api_tokens", tokenRows);
  if (tokenRows > 0) differ("not_copied_api_tokens", {}, partitions);
  let userFiles = 0;
  for await (const blob of source.appFiles()) {
    if (blob.blobName.toLowerCase().startsWith(UPLOADS_PREFIX)) userFiles += 1;
  }
  report.checked("not_copied_user_files", userFiles);
  if (userFiles > 0) differ("not_copied_user_files", {}, { files: userFiles });

  // What changed in the layouts and permissions after the marks, and since the last full verify
  // (the published snapshots too, named by publish id).
  const blobsChangedAfter = async (
    container: "layouts" | "permissions" | "published",
    from: Date,
  ) => {
    const names = new Set<string>();
    for await (const name of source.changedBlobs(container, from)) names.add(name.toLowerCase());
    return names;
  };
  const layoutsAfterMarks = await blobsChangedAfter("layouts", markOf(marks, "blobs"));
  const permissionsAfterMarks = await blobsChangedAfter("permissions", markOf(marks, "blobs"));
  const changedSince =
    since === null
      ? null
      : new Set([
          ...(await blobsChangedAfter("layouts", markOf(since, "blobs"))),
          ...(await blobsChangedAfter("permissions", markOf(since, "blobs"))),
        ]);
  const publishedSince =
    since === null ? null : await blobsChangedAfter("published", markOf(since, "blobs"));
  /**
   * Incremental: whether the survey's row, layouts, permissions or published snapshot changed
   * since the full verify.
   */
  const changedSinceFull = (
    surveyId: string,
    row: { timestamp: Date | null; publishid: string | null },
  ) =>
    since !== null &&
    (changedAfterMarks(since, "surveys", row.timestamp) ||
      changedSince!.has(surveyId) ||
      (row.publishid !== null && publishedSince!.has(row.publishid.toLowerCase())));
  /** The results account's tables, listed once: a survey without them has nothing to query. */
  const resultTables = await source.resultTables();

  // The dated traces of deletions, by the events' storage times as the marks: a survey deleted,
  // or every response of one deleted, after the marks (what the target still holds of it is
  // pending); incremental: the delete-alls since the last full verify and before the marks,
  // whose surveys' responses and markers are counted.
  const surveysDeletedLate = new Set<string>();
  const deletedAllLate = new Set<string>();
  const deletedAllSince = new Set<string>();
  for await (const event of source.events(markOf(since ?? marks, "tables"))) {
    const surveyId = event.surveyId.toLowerCase();
    const late = after("tables", event.timestamp);
    if (event.type === SURVEY_DELETE_EVENT && late) surveysDeletedLate.add(surveyId);
    if (event.type !== DELETE_ALL_EVENT) continue;
    if (late) deletedAllLate.add(surveyId);
    else if (since !== null) deletedAllSince.add(surveyId);
  }
  // Trace-less deletions of layouts and permissions (`traceless`): what the target holds that
  // the source's listings lack (`{surveyId}/{kind}`, and survey ids).
  const layoutsGone = new Set<string>();
  const permissionsGone = new Set<string>();
  if (traceless) {
    const layoutsInSource = new Set<string>();
    for (const kind of LAYOUT_KINDS) {
      for await (const name of source.layoutNames(kind)) {
        layoutsInSource.add(`${name.toLowerCase()}/${kind}`);
      }
    }
    for (const key of await target.keysOf("survey_layouts")) {
      if (!layoutsInSource.has(key)) layoutsGone.add(key);
    }
    const permissionsInSource = new Set<string>();
    for await (const name of source.changedBlobs("permissions", new Date(0))) {
      permissionsInSource.add(name.toLowerCase());
    }
    for (const key of await state.keys(PERMISSIONS)) {
      const surveyId = key.slice(PERMISSIONS.length);
      if (!permissionsInSource.has(surveyId)) permissionsGone.add(surveyId);
    }
  }
  phase("stores", "stores the copy does not take, the changed blobs and the deletions: read");

  // ---- People and keys, projects and members, in full in both modes ----
  const run = await state.get<{ startedAt: string }>("run");
  const runStart = run?.startedAt ?? marks.takenAt;
  // Full: every survey's history names its authors. Incremental: only a changed survey's history
  // is listed; the others' authors are the target's history's, which the full verify compared.
  const named = await collectNamed(source, {
    ...(sample && { sample }),
    report: quiet(),
    runStart,
    readsHistory: since === null ? () => true : (surveyId, row) => changedSinceFull(surveyId, row),
  });
  const mapped =
    since === null
      ? named
      : mapPeople(
          named.users,
          new Set([...named.named, ...(await target.historyAuthors())]),
          runStart,
          quiet(),
        );
  const userRows = new Map(named.users.map((row) => [row.id.toLowerCase(), row]));
  const people = new Map(mapped.people.map((person) => [person.id, person]));
  const keys = new Map(mapped.keys.map((key) => [key.userId, key]));
  const seeded = new Set(await target.seededPeople());
  /** Named people the copy could not write (the target holds their email or identity). */
  const heldElsewhere = new Set<string>();
  await inParallel(mapped.people, concurrency, async (person) => {
    const ids = { userId: person.id };
    const row = userRows.get(person.id)!;
    const changed = after("users", row.timestamp);
    const [stored, identities, storedKey] = await Promise.all([
      targetProviders.users.getUser(person.id),
      target.identitiesOf(person.id),
      targetProviders.credentials.legacyKeyOf(person.id),
    ]);
    if (stored === null && (await target.heldElsewhere(person)) !== null) {
      // The target already holds the email or the identity: the copy skipped the person and
      // reported it; nothing of theirs is expected.
      heldElsewhere.add(person.id);
      report.checked("people", 1);
      report.note("person_held_elsewhere", ids);
      return;
    }
    const key = expectedKey(keys.get(person.id));
    // The source's key itself, looked up by its hash as the target's credentials do when it
    // signs a request: the same last four could be another key.
    const sourceKey = keys.has(person.id) ? row.accesskey : null;
    const found =
      sourceKey === null ? null : await targetProviders.credentials.findLegacyKey(sourceKey);
    const holds = sourceKey === null ? storedKey === null : found?.userId === person.id;
    judge("people", ids, sameJson(stored, expectedUser(userFromLegacy(row), person)), changed);
    if (stored === null || seeded.has(person.id)) {
      judge("identities", ids, sameJson(identities, expectedIdentities(person)), changed);
      judge("keys", ids, holds && sameJson(storedKey, key), changed);
      return;
    }
    // Somebody has used the profile (signed in, or linked another sign-in): only what the
    // migration owns is compared, its own identity and the key; the rest is noted.
    const own = identities.filter((i) => i.provider === "surveyjs" && i.subject === person.id);
    judge("identities", ids, sameJson(own, expectedIdentities(person)), changed);
    judge("keys", ids, holds, changed);
    report.note("person_used", ids);
  });
  for (const id of await target.idsOf("users")) {
    if (people.has(id)) continue;
    // Only a profile the migration seeded and nobody used should be gone (reconcile removes
    // those); any other account (an administrator, one made at sign-in) stays, noted.
    if (seeded.has(id)) judge("people", { userId: id }, false, traceless, { inSource: 0 });
    else report.note("person_kept_unseeded", { userId: id });
  }
  phase("people", `people: ${people.size} compared`);

  // The people with a profile, as the copy wrote them: the target lists only those members, and
  // only they can take a survey of a missing project.
  const profiles = new Set([...people.keys()].filter((id) => !heldElsewhere.has(id)));
  const projectIds = new Set(named.projects.map(({ project }) => project.id));
  await inParallel(named.projects, concurrency, async ({ project, members }) => {
    const ids = { projectId: project.id };
    // By the rows' change times: the project's own and its members'.
    const times = named.projectTimes.get(project.id);
    const changed =
      after("organizations", times?.project) ||
      (times?.members ?? []).some((at) => after("organizationUsers", at));
    const [read, stored, storedMembers] = await Promise.all([
      sourceProviders.projects.getProject(project.id),
      targetProviders.projects.getProject(project.id),
      targetProviders.projects.listMembers(project.id),
    ]);
    const want = mappedMemberKeys(members, profiles);
    const have = memberKeys(storedMembers);
    // A member removed leaves no change time (the project's member count changes with it): only
    // extra members the target holds are that.
    const removed = traceless && want.every((member) => have.includes(member));
    judge(
      "projects",
      ids,
      read !== null && sameJson(stored, expectedProject(read, members)),
      changed || removed,
    );
    judge("members", ids, sameJson(have, want), changed || removed, {
      source: members.length,
      target: storedMembers.length,
    });
  });
  for (const projectId of named.projectsWithoutMembers) {
    // Left without members by trace-less removals, it is one `reconcile` has yet to remove.
    judge(
      "projects",
      { projectId },
      (await targetProviders.projects.getProject(projectId)) === null,
      traceless,
    );
  }
  for (const id of await target.idsOf("projects")) {
    if (projectIds.has(id)) continue;
    judge("projects", { projectId: id }, false, traceless, { inSource: 0 });
  }
  phase("projects", `projects: ${projectIds.size} compared`);

  // ---- Survey by survey ----
  const ctx = {
    projects: projectIds,
    projectsWithoutMembers: named.projectsWithoutMembers,
    people: profiles,
    legacyUsers: named.legacyUsers,
  };

  const targetSurveys = await target.idsOf("surveys");
  /** The surveys the target holds as it should (their views, events and files are counted). */
  const copied = new Set<string>();
  /** Full: the legacy files the copied records link (`{kind}/{name}`), and those of later rows. */
  const linked = new Set<string>();
  const lateLinked = new Set<string>();
  const link = (into: Set<string>, json: unknown) => {
    for (const { kind, name } of fileLinks(json)) into.add(`${kind}/${name}`);
  };
  const deep = new Set(
    sample
      ? targetSurveys
      : options.full
        ? randomPick(
            targetSurveys.filter((id) => wanted(id)),
            options.deepSample,
          )
        : [],
  );

  async function* none(): AsyncGenerator<never> {}
  /** The survey's response rows (changed after `from`); none without a table. */
  const responsesOf = (postId: string, from?: Date) =>
    resultTables.has(responseTableOf(postId)) ? source.responses(postId, from) : none();
  /** The survey's deletion copies (made after `from`); none without a table. */
  const deletedOf = (postId: string, from?: Date) =>
    resultTables.has(deletedTableOf(postId)) ? source.deletedCopies(postId, from) : none();

  /**
   * The source's response rows changed after the marks (pending), and its deletions after them:
   * the copies stored after the marks, judged by their storage time as the marks are (the time a
   * copy holds is its writer's), with the client ids whose completion marker went with them.
   */
  async function afterMarksOf(surveyId: string, postId: string) {
    const rows: { id: string }[] = [];
    for await (const row of responsesOf(postId, markOf(marks, "tables"))) {
      if (!after("tables", row.timestamp)) continue;
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped !== null) rows.push({ id: mapped.response.id });
    }
    const deleted: { id: string }[] = [];
    const clients = new Set<string>();
    for await (const copy of deletedOf(postId, markOf(marks, "tables"))) {
      if (!after("tables", copy.timestamp)) continue;
      deleted.push({ id: copy.responseId.toLowerCase() });
      if (copy.entity.clientid !== undefined) clients.add(copy.entity.clientid);
    }
    for (const { id } of [...rows, ...deleted]) pending("responses", { surveyId, responseId: id });
    return { rows, deleted, clients };
  }
  type AfterMarks = Awaited<ReturnType<typeof afterMarksOf>>;

  const seen = new Set<string>();
  async function* wantedRows() {
    for await (const row of source.surveys()) {
      if (wanted(row.id.toLowerCase())) yield row;
    }
  }
  await inParallel(wantedRows(), concurrency, async (row) => {
    const surveyId = row.id.toLowerCase();
    seen.add(surveyId);
    const ids = { surveyId };
    const rowChanged = after("surveys", row.timestamp);
    const stored = await targetProviders.surveys.getSurvey(surveyId);
    // Whether the copy skips the survey does not depend on its documents.
    const base = mapSurvey(row, null, null, null, { ...ctx, report: quiet() });
    if (base === null || stored === null) {
      // Skipped by the copy (reported there): the target must not hold it; else it must.
      judge("surveys", ids, base === null && stored === null, rowChanged);
      return;
    }
    copied.add(surveyId);
    const { postId } = base.record;
    /** What changed after the marks, read once (the counts and the deep walk need it). */
    let lateRead: Promise<AfterMarks> | null = null;
    const lateOf = () => (lateRead ??= afterMarksOf(surveyId, postId));
    // Every response deleted after the marks (the old app's event): what the target still holds
    // of them is pending.
    const allDeletedLate = deletedAllLate.has(surveyId);
    // Changed by a trace-less deletion since a `reconcile` after the marks: the owner's project
    // gone (or left without members), a layout or the permissions blob gone.
    const ownerGone = stored.owner.kind === "project" && !projectIds.has(stored.owner.projectId);
    const surveyTraceless =
      traceless &&
      (ownerGone ||
        permissionsGone.has(surveyId) ||
        LAYOUT_KINDS.some((kind) => layoutsGone.has(`${surveyId}/${kind}`)));

    // Incremental: the responses and deletions since the last full verify, by count.
    const fresh =
      since === null
        ? null
        : await compareNewResponses(surveyId, postId, stored, markOf(since, "tables"));
    if (fresh !== null) {
      // A delete-all since the last full verify: its rows and markers counted (no copies tell
      // which went); after the marks, pending. A deletion copy since: its markers counted.
      if (deletedAllSince.has(surveyId)) await countResponses(surveyId, postId, stored, lateOf);
      if (allDeletedLate) pending("response_counts", ids);
      if (deletedAllSince.has(surveyId) || fresh.deletions) await countMarkers();
    }
    // A survey changed since the last full verify is compared in full: its documents when they
    // changed, its settings and private questions also when new responses came in.
    const documentsChanged = changedSinceFull(surveyId, row);
    const documents = options.full || deep.has(surveyId) || documentsChanged;
    const settings = documents || (fresh !== null && fresh.rows > 0);
    const texts: Texts = settings
      ? {
          definition: await source.definitionText(surveyId),
          permissions: await source.permissionsText(surveyId),
          columns: await source.layoutText(surveyId, "columns"),
        }
      : NO_TEXTS;
    const rec = settings
      ? (mapSurvey(row, texts.definition, texts.permissions, texts.columns, {
          ...ctx,
          report: quiet(),
        }) ?? base)
      : base;
    // An unchanged survey's public results were compared by the last full verify.
    const expected = settings
      ? rec.record
      : {
          ...rec.record,
          settings: { ...rec.record.settings, publicResults: stored.settings.publicResults },
        };
    judge("surveys", ids, sameJson(stored, expected), rowChanged || surveyTraceless);
    if (!settings) return;

    const settingsChanged =
      rowChanged ||
      surveyTraceless ||
      layoutsAfterMarks.has(surveyId) ||
      permissionsAfterMarks.has(surveyId);
    if (documents) await compareDocuments(surveyId, rec, texts, rowChanged);

    // Responses: counted (full), or the new ones (incremental); then the private questions.
    const storedNames = await targetProviders.views.getPrivateQuestions(surveyId);
    let answerNames: Iterable<string>;
    let pendingNames: boolean;
    let size: number | null = null;
    if (fresh === null) {
      const counted = await countResponses(surveyId, postId, stored, lateOf);
      answerNames = counted.answerNames;
      pendingNames = counted.pendingNames;
      size = counted.rows;
    } else {
      // The answer names the copy and every delta read (the checkpoint's), with the new rows'
      // keys: never the target's own list, which would only confirm itself.
      const checkpoint = await state.get<SurveyCheckpoint>(`${CHECKPOINT}${surveyId}`);
      answerNames = [...(checkpoint?.answerNames ?? []), ...fresh.names];
      pendingNames = fresh.late;
    }
    const withResponses = mapSurvey(row, texts.definition, texts.permissions, texts.columns, {
      ...ctx,
      extraAnswerNames: answerNames,
      report: quiet(),
    });
    judge(
      "private_questions",
      ids,
      withResponses !== null &&
        (sameNames(storedNames, withResponses.privateQuestions) ||
          (await supersetOfDeletedNames(surveyId, storedNames, withResponses.privateQuestions))),
      settingsChanged || pendingNames,
      {
        source: withResponses?.privateQuestions.length ?? 0,
        target: storedNames.length,
      },
    );

    if (options.full) {
      await countMarkers();
      // One response deleted twice (a retried delete) has two copies; the target keeps one.
      await countSurveyRows(
        "deleted_responses",
        surveyId,
        "deleted_responses",
        mapAsync(deletedOf(postId), (copy) =>
          mapDeleted(surveyId, copy, quiet()) === null
            ? null
            : { key: copy.responseId.toLowerCase(), late: after("tables", copy.timestamp) },
        ),
        { distinct: true },
      );
    }
    if (deep.has(surveyId)) {
      size ??= (await targetProviders.results.stats(stored)).count;
      await compareInDepth(surveyId, rec, stored, size, await lateOf());
    }

    /**
     * The completion markers, counted: those the source lacks whose client a deletion after the
     * marks names went with that response (pending); after a delete-all after the marks, all.
     */
    async function countMarkers() {
      const { clients } = await lateOf();
      await countSurveyRows(
        "markers",
        surveyId,
        "completion_markers",
        mapAsync(source.markers(surveyId), (marker) => ({
          key: marker.clientId,
          late: after("tables", marker.timestamp),
        })),
        { excused: clients, changed: allDeletedLate },
      );
    }
  });
  for (const id of targetSurveys) {
    // Deleted after the marks (its event): pending; any other one is a difference.
    if (seen.has(id)) continue;
    judge("surveys", { surveyId: id }, false, surveysDeletedLate.has(id), { inSource: 0 });
  }
  phase("surveys", `surveys: ${seen.size} compared`);

  // ---- Whole tables, counted as of the marks (full) ----
  if (options.full) {
    await countTableRows(
      "events",
      "survey_events",
      {},
      mapAsync(source.events(), (event) => {
        if (sample && !copied.has(event.surveyId.toLowerCase())) return null;
        // The events the copy writes (`eventRec` skips the unmappable ones).
        if (eventRec(event, quiet()) === null) return null;
        return { key: event.id.toLowerCase(), late: after("tables", event.timestamp) };
      }),
    );
    // A deleted survey's views and files (its event after the marks) are pending; so is any the
    // source lacks the day before the window (`traceless`).
    const ofDeletedSurveys = async (table: "saved_views" | "files") =>
      (await Promise.all([...surveysDeletedLate].map((id) => target.keysOf(table, id)))).flat();
    await countTableRows(
      "views",
      "saved_views",
      { excused: await ofDeletedSurveys("saved_views"), extraPending: traceless },
      mapAsync(source.views(), (view) => {
        if (!copied.has(view.surveyId.toLowerCase())) return null;
        const blobName = `${view.surveyId}/${view.userId}/${view.view}`;
        const rec = mapView(blobName, view.text, view.lastModified, quiet());
        if (rec === null) return null;
        return {
          key: `${rec.surveyId}/${rec.userId}/${rec.view}`,
          late: after("blobs", view.lastModified),
        };
      }),
    );
    await countTableRows(
      "own_files",
      "files",
      { excused: await ofDeletedSurveys("files"), extraPending: traceless },
      mapAsync(source.appFiles(), (blob) => {
        const record = fileRecordFromBlob(blob.blobName, blob.properties, blob.metadata);
        if (record === null || record.surveyId === null || !copied.has(record.surveyId)) {
          return null;
        }
        return { key: record.id, late: after("blobs", blob.properties.lastModified) };
      }),
    );
    await countLegacyFiles();
    phase("tables", "events, views and files: counted");
  }

  if (options.full && ok) {
    const at = new Date().toISOString();
    await state.set(
      FULL_VERIFY,
      { at, marks, sample: sample !== undefined } satisfies FullVerifyState,
      at,
    );
  }
  return { ok };

  // ---- Counts ----

  /**
   * The source's rows of a table as of the marks (`late`: changed after them, pending) against
   * the target's: those it holds of the late keys are left out of its count, so the rows that
   * existed before the marks compare exactly. Left out the same way: the `excused` keys (rows a
   * deletion after the marks took from the source), and with `extraPending` every key the
   * target holds that the source lacks (trace-less deletions); with `distinct`, a key the source
   * holds twice counts once (the target holds one row per key).
   */
  async function countRowsOf(
    rows: AsyncIterable<{ key: string; late: boolean } | null>,
    table: CountedTable,
    surveyId: string | undefined,
    options: CountOptions,
  ) {
    const excused = new Set(options.excused ?? []);
    const keys = options.distinct || options.extraPending ? new Set<string>() : null;
    let before = 0;
    const late = new Set<string>();
    for await (const row of rows) {
      if (row === null) continue;
      if (row.late || excused.has(row.key)) late.add(row.key);
      else if (keys === null) before += 1;
      else keys.add(row.key);
    }
    const sourceLate = late.size;
    if (keys !== null) {
      for (const key of late) keys.delete(key);
      before = keys.size;
    }
    for (const key of excused) late.add(key);
    if (options.extraPending) {
      for (const key of await target.keysOf(table, surveyId)) {
        if (!keys!.has(key)) late.add(key);
      }
    }
    const [total, lateHeld] = await Promise.all([
      target.countRows(table, surveyId),
      target.existingKeys(table, [...late], surveyId),
    ]);
    return {
      counts: { source: before, target: total - lateHeld.length },
      pending: sourceLate > 0 || lateHeld.length > 0,
    };
  }

  async function countSurveyRows(
    check: string,
    surveyId: string,
    table: CountedTable,
    rows: AsyncIterable<{ key: string; late: boolean } | null>,
    options: CountOptions = {},
  ) {
    const { counts, pending: late } = await countRowsOf(rows, table, surveyId, options);
    // Rows changed after the marks are left out on both sides; listed, never with their keys.
    if (late) pending(check, { surveyId });
    judge(check, { surveyId }, counts.source === counts.target, options.changed ?? false, counts);
  }

  async function countTableRows(
    check: string,
    table: CountedTable,
    options: CountOptions,
    rows: AsyncIterable<{ key: string; late: boolean } | null>,
  ) {
    const { counts, pending: late } = await countRowsOf(rows, table, undefined, options);
    if (late) pending(check, {});
    judge(check, {}, counts.source === counts.target, false, counts);
  }

  /**
   * The legacy files: every one a copied record links (before the marks) is in the target, or
   * missing from the old shares too. Files the target holds that nothing links any more (a
   * response deleted, an image dropped from a definition) are no difference: the copy keeps them
   * and the old shares keep the bytes; they are noted, by count.
   */
  async function countLegacyFiles() {
    const wantedKeys = [...linked];
    const present = new Set(await target.existingKeys("legacy_files", wantedKeys));
    let missing = 0;
    for (const key of wantedKeys) {
      if (present.has(key)) continue;
      const slash = key.indexOf("/");
      const kind = key.slice(0, slash) as FileKind;
      const name = key.slice(slash + 1);
      const content = await source.shareFile(kind === "asset" ? "surveyfiles" : "files", name);
      if (content !== null) missing += 1;
    }
    judge("legacy_file_count", {}, missing === 0, false, { linked: wantedKeys.length, missing });
    const lateOnly = [...lateLinked].filter((key) => !linked.has(key));
    const lateHeld = (await target.existingKeys("legacy_files", lateOnly)).length;
    const unlinked = (await target.countRows("legacy_files")) - present.size - lateHeld;
    if (unlinked > 0) report.note("legacy_files_unlinked", { files: String(unlinked) });
  }

  // ---- The checks of one survey ----

  /**
   * Whether the stored private questions are the computed ones plus names that only responses
   * since deleted used: a checkpoint's answer names only grow (a deleted response's key stays), so
   * the stored list keeps such a name private, which never makes anything more public; noted.
   * Never the other way: a computed name the stored list lacks is a difference.
   */
  async function supersetOfDeletedNames(
    surveyId: string,
    stored: readonly string[],
    computed: readonly string[],
  ): Promise<boolean> {
    const storedSet = new Set(stored);
    if (!computed.every((name) => storedSet.has(name))) return false;
    const computedSet = new Set(computed);
    const extra = stored.filter((name) => !computedSet.has(name));
    if (extra.length === 0) return false;
    const checkpoint = await state.get<SurveyCheckpoint>(`${CHECKPOINT}${surveyId}`);
    const known = new Set(checkpoint?.answerNames ?? []);
    if (!extra.every((name) => known.has(name))) return false;
    report.note("private_questions_superset", { surveyId });
    return true;
  }

  /** The definition, theme, history and layouts, by checksum, the source side mapped as copied. */
  async function compareDocuments(
    surveyId: string,
    rec: NonNullable<ReturnType<typeof mapSurvey>>,
    texts: Texts,
    rowChanged: boolean,
  ) {
    const ids = { surveyId };
    const [definition, theme] = await Promise.all([
      targetProviders.surveys.getDefinition(surveyId),
      targetProviders.surveys.getTheme(surveyId),
    ]);
    judge(
      "definitions",
      ids,
      checksum(definition?.content) === checksum(rec.definition),
      rowChanged,
    );
    judge("themes", ids, checksum(theme?.content) === checksum(rec.theme), rowChanged);

    const history = mapHistory(
      surveyId,
      await source.historyNewest(surveyId, HISTORY_KEEP, rec.record.legacyPublishId),
      quiet(),
    );
    if (options.full) {
      // A document changed after the marks may link files the copy has not taken yet.
      const into = rowChanged ? lateLinked : linked;
      link(into, rec.definition);
      link(into, rec.theme);
      for (const entry of history) {
        link(after("blobs", entry.at) ? lateLinked : into, entry.snapshot);
      }
    }
    const storedHistory = await storedHistoryOf(surveyId);
    judge(
      "history",
      ids,
      sameJson(history.map(historyKey), storedHistory.map(historyKey)),
      rowChanged || history.some((entry) => after("blobs", entry.at)),
      { source: history.length, target: storedHistory.length },
    );

    for (const kind of LAYOUT_KINDS) {
      const text = kind === "columns" ? texts.columns : await source.layoutText(surveyId, kind);
      const storedText = await targetProviders.views.getLayout(surveyId, kind);
      judge(
        "layouts",
        { surveyId, kind },
        checksum(text === "" ? null : text) === checksum(storedText),
        layoutsAfterMarks.has(surveyId) || layoutsGone.has(`${surveyId}/${kind}`),
      );
    }
  }

  /** The target's history, newest first, with each snapshot. */
  async function storedHistoryOf(surveyId: string) {
    // One more than kept: a target holding more than the 20 newest differs too.
    const page = await targetProviders.surveys.listHistory({ surveyId, limit: HISTORY_KEEP + 1 });
    const entries = [];
    for (const entry of page.items) {
      const snapshot = await targetProviders.surveys.getHistorySnapshot(surveyId, entry.id);
      entries.push({ ...entry, snapshot });
    }
    return entries;
  }

  /**
   * Full: the source's rows streamed (never all in memory) and counted as of the marks, exactly
   * against the target's: the complete ones against `stats`, and every row (partial ones too)
   * against the target's row count. Rows changed after the marks, and responses deleted after
   * them, are pending: they are left out on both sides (the target's counts lose those of them it
   * holds, the complete count by its own rows' partial flags), so every row that existed before
   * the marks and still exists is counted on both.
   */
  async function countResponses(
    surveyId: string,
    postId: string,
    stored: SurveyRecord,
    lateOf: () => Promise<AfterMarks>,
  ) {
    const answerNames = new Set<string>();
    let rows = 0;
    let complete = 0;
    let first: string | null = null;
    let last: string | null = null;
    const late: { id: string; names: string[] }[] = [];
    for await (const row of responsesOf(postId)) {
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped === null) continue;
      const { response } = mapped;
      rows += 1;
      if (after("tables", row.timestamp)) {
        late.push({ id: response.id, names: Object.keys(response.data) });
        link(lateLinked, response.data);
        continue;
      }
      link(linked, response.data);
      for (const name of Object.keys(response.data)) answerNames.add(name);
      if (response.partial) continue;
      complete += 1;
      if (first === null || response.submittedAt < first) first = response.submittedAt;
      if (last === null || response.submittedAt > last) last = response.submittedAt;
    }
    const { deleted } = await lateOf();
    const leftOut = [...late, ...deleted].map(({ id }) => id);
    for (const id of leftOut) pending("responses", { surveyId, responseId: id });
    const [states, stats, held] = await Promise.all([
      target.responseStates(surveyId, leftOut),
      targetProviders.results.stats(stored),
      target.countRows("survey_responses", surveyId),
    ]);
    const heldComplete = [...states.values()].filter((partial) => !partial).length;
    const before = stats.count - heldComplete;
    const sourceRows = rows - late.length;
    const targetRows = held - states.size;
    judge(
      "response_counts",
      { surveyId },
      before === complete &&
        targetRows === sourceRows &&
        // The first and last times hold only when no later row is among the target's.
        (heldComplete > 0 || (stats.firstSubmittedAt === first && stats.lastSubmittedAt === last)),
      // Every response deleted after the marks: the target keeps them until `reconcile` runs.
      deletedAllLate.has(surveyId),
      { source: complete, target: before, sourceRows, targetRows },
    );
    const pendingNames = late.some(({ names }) => names.some((name) => !answerNames.has(name)));
    return { answerNames, pendingNames, rows };
  }

  /**
   * Incremental: every source row changed since the last full verify and before the marks is in
   * the target, and every response deleted in that time is gone; later ones are pending.
   */
  async function compareNewResponses(
    surveyId: string,
    postId: string,
    stored: SurveyRecord,
    from: Date,
  ) {
    let fresh = 0;
    let missing = 0;
    let late = false;
    const names = new Set<string>();
    for await (const row of responsesOf(postId, from)) {
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped === null) continue;
      if (after("tables", row.timestamp)) {
        pending("responses", { surveyId, responseId: mapped.response.id });
        late = true;
        continue;
      }
      fresh += 1;
      for (const name of Object.keys(mapped.response.data)) names.add(name);
      if (!(await targetProviders.results.hasResponse(stored, mapped.response.id))) missing += 1;
    }
    judge("new_responses", { surveyId }, missing === 0, false, { source: fresh, missing });
    let deletions = 0;
    let kept = 0;
    let anyCopy = false;
    for await (const copy of deletedOf(postId, from)) {
      anyCopy = true;
      const responseId = copy.responseId.toLowerCase();
      // By the copy's storage time, the clock of the marks (and of `from`).
      if (after("tables", copy.timestamp)) {
        pending("responses", { surveyId, responseId });
        continue;
      }
      deletions += 1;
      if (await targetProviders.results.hasResponse(stored, responseId)) kept += 1;
    }
    judge("deletions", { surveyId }, kept === 0, false, { source: deletions, kept });
    return { rows: fresh, names, late, deletions: anyCopy };
  }

  /** The source's rows of the survey, each as the copy maps it, placed and checksummed. */
  async function sourceRowsOf(surveyId: string, postId: string): Promise<PlacedSum[]> {
    const rows: PlacedSum[] = [];
    for await (const row of responsesOf(postId)) {
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped !== null) rows.push(placedSum(expectedResponse(mapped.response)));
    }
    return rows;
  }

  /** The target's stored rows of the survey, unfolded, placed and checksummed. */
  async function targetRowsOf(survey: SurveyRecord): Promise<PlacedSum[]> {
    const rows: PlacedSum[] = [];
    let position: { submittedAt: string; id: string } | undefined;
    for (;;) {
      const page = await target.responseRowPage(survey.id, position, PAGE);
      rows.push(...page.map(placedSum));
      const last = page.at(-1);
      if (page.length < PAGE || last === undefined) return rows;
      position = { submittedAt: last.submittedAt, id: last.id };
    }
  }

  /**
   * In depth, through both providers (checks `deep_…`, `responses`, `legacy_files`): the record,
   * definition, theme, history page and snapshots, every response, the layouts and the legacy
   * files the survey's records link. A survey of more than `deepMaxResponses` responses (`size`)
   * is not walked response by response (noted); its counts are compared all the same.
   */
  async function compareInDepth(
    surveyId: string,
    rec: NonNullable<ReturnType<typeof mapSurvey>>,
    stored: SurveyRecord,
    size: number,
    late: AfterMarks,
  ) {
    const ids = { surveyId };
    const read = await sourceProviders.surveys.getSurvey(surveyId);
    if (read === null) {
      differ("deep_surveys", ids, { inSource: 0 });
      return;
    }
    const changed = after("surveys", read.updatedAt);
    judge("deep_surveys", ids, sameJson(stored, expectedRecord(read, rec.record)), changed);

    // The legacy files the records link: the same bytes, or missing on both sides; each once,
    // compared as they come (a page of responses at a time), never all collected first.
    const done = new Set<string>();
    let links: { kind: FileKind; name: string }[] = [];
    const compareLinks = async () => {
      const batch = links;
      links = [];
      for (const { kind, name } of batch) {
        const key = `${kind}/${name}`;
        if (done.has(key)) continue;
        done.add(key);
        const [mineFile, theirFile] = await Promise.all([
          fileBytes(sourceProviders, kind, name),
          fileBytes(targetProviders, kind, name),
        ]);
        judge(
          "legacy_files",
          { surveyId, fileId: legacyFileRecord(kind, name, 0).id },
          mineFile === theirFile,
          false,
        );
      }
    };
    const pairs = [
      ["deep_definitions", "getDefinition"],
      ["deep_themes", "getTheme"],
    ] as const;
    for (const [check, method] of pairs) {
      const [mine, theirs] = await Promise.all([
        sourceProviders.surveys[method](surveyId),
        targetProviders.surveys[method](surveyId),
      ]);
      const value = storedJson(mine?.content ?? null);
      links.push(...fileLinks(value));
      judge(check, ids, sameJson(theirs?.content ?? null, value), changed);
    }

    const page = await sourceProviders.surveys.listHistory({ surveyId, limit: HISTORY_KEEP });
    const entries: Parameters<typeof expectedHistory>[1][number][] = [];
    for (const entry of page.items) {
      const snapshot = await sourceProviders.surveys.getHistorySnapshot(surveyId, entry.id);
      entries.push({ entry, snapshot });
    }
    // The app does not read the published snapshot: the source's own read, as the copy takes it.
    const published = await source.publishedSnapshot(rec.record.legacyPublishId);
    if (published && !entries.some(({ entry }) => entry.id === published.entry.id)) {
      entries.push(published);
    }
    const history = expectedHistory(surveyId, entries);
    for (const entry of history) links.push(...fileLinks(entry.snapshot));
    const storedHistory = await storedHistoryOf(surveyId);
    judge(
      "deep_history",
      ids,
      sameJson(history.map(historyKey), storedHistory.map(historyKey)),
      changed || history.some((entry) => after("blobs", entry.at)),
      { source: history.length, target: storedHistory.length },
    );

    for (const kind of LAYOUT_KINDS) {
      const [mine, theirs] = await Promise.all([
        sourceProviders.views.getLayout(surveyId, kind),
        targetProviders.views.getLayout(surveyId, kind),
      ]);
      judge(
        "deep_layouts",
        { surveyId, kind },
        checksum(mine) === checksum(theirs),
        layoutsAfterMarks.has(surveyId) || layoutsGone.has(`${surveyId}/${kind}`),
      );
    }

    await compareLinks();

    // Every response, both walks in submission order, merged.
    const cap = options.deepMaxResponses ?? DEEP_MAX_RESPONSES;
    if (size > cap) {
      report.note("deep_skipped_size", { surveyId });
      return;
    }
    const lateIds = new Set(late.rows.map((row) => row.id));
    const deletedLate = new Set(late.deleted.map((row) => row.id));
    // Both sides' rows unfolded, folded into runs as the app reads them: each run's rows by
    // checksum (a partial save's value a later save overwrites never shows in the folded
    // response), and the runs a change after the marks touched (by their first row), pending:
    // a source run holding a row changed after the marks, a target run holding a row deleted
    // after them. Never a client's other runs.
    const pendingRuns = new Set<string>();
    const sourceRuns = runChecksums(
      await sourceRowsOf(surveyId, read.postId),
      lateIds,
      pendingRuns,
    );
    const targetRuns = runChecksums(await targetRowsOf(stored), deletedLate, pendingRuns);
    const mine = walk(sourceProviders, read);
    const theirs = walk(targetProviders, stored);
    let a = await mine.next();
    let b = await theirs.next();
    const counts = { differing: 0, missing: 0, extra: 0, rowsDiffering: 0 };
    let compared = 0;
    while (!a.done || !b.done) {
      if (!a.done && lateIds.has(a.value.id)) {
        if (!b.done && b.value.id === a.value.id) b = await theirs.next();
        a = await mine.next();
        continue;
      }
      const order = a.done ? 1 : b.done ? -1 : positionOrder(a.value, b.value);
      if (order === 0 && !a.done && !b.done) {
        compared += 1;
        const expected = expectedResponse(a.value);
        links.push(...fileLinks(expected.data));
        if (compared % PAGE === 0) await compareLinks();
        const runId = a.value.id;
        const rowsSame = sourceRuns.get(runId) === targetRuns.get(runId);
        if (!sameJson(b.value, expected) || !rowsSame) {
          if (pendingRuns.has(runId)) pending("responses", { surveyId, responseId: runId });
          else if (!rowsSame && sameJson(b.value, expected)) counts.rowsDiffering += 1;
          else counts.differing += 1;
        }
        a = await mine.next();
        b = await theirs.next();
      } else if (order < 0 && !a.done) {
        counts.missing += 1;
        a = await mine.next();
      } else if (!b.done) {
        if (!pendingRuns.has(b.value.id)) counts.extra += 1;
        b = await theirs.next();
      }
    }
    const total = counts.differing + counts.missing + counts.extra + counts.rowsDiffering;
    judge("responses", ids, total === 0, deletedAllLate.has(surveyId), { ...counts, compared });
    await compareLinks();
  }
}

/** A row as folding places it, with the checksum of the whole row. */
interface PlacedSum {
  id: string;
  submittedAt: string;
  clientId?: string;
  partial: boolean;
  sum: string;
}

const placedSum = (row: SurveyResponse): PlacedSum => ({
  id: row.id,
  submittedAt: row.submittedAt,
  ...(row.clientId !== undefined && { clientId: row.clientId }),
  partial: row.partial,
  sum: checksum(row),
});

/**
 * The rows folded into runs as the app folds them (ADR 0038): each run's checksum (of its rows'
 * checksums, in order) by its first row's id. A run holding one of `touched` goes into
 * `pendingRuns`.
 */
function runChecksums(
  rows: PlacedSum[],
  touched: ReadonlySet<string>,
  pendingRuns: Set<string>,
): Map<string, string> {
  const sums = new Map<string, string>();
  for (const run of foldRuns([...rows].sort(positionOrder))) {
    const first = run[0]!.id;
    if (run.some((row) => touched.has(row.id))) pendingRuns.add(first);
    sums.set(first, checksum(run.map((row) => row.sum)));
  }
  return sums;
}

/** The items mapped as they come; a null result is passed on for the caller to skip. */
async function* mapAsync<T, R>(
  items: AsyncIterable<T>,
  map: (item: T) => R | null,
): AsyncGenerator<R | null> {
  for await (const item of items) yield map(item);
}

/** Every response of the survey through the provider, page by page, in submission order. */
async function* walk(
  providers: { readonly results: Pick<ProviderSet["results"], "listResponsePage"> },
  survey: SurveyRecord,
): AsyncGenerator<SurveyResponse, void> {
  let after: { submittedAt: string; id: string } | undefined;
  for (;;) {
    const page = await providers.results.listResponsePage(survey, {
      limit: PAGE,
      ...(after && { after }),
    });
    yield* page.items;
    if (page.next === null) return;
    after = page.next;
  }
}

/** Submission order: the time as an instant, then the id. */
function positionOrder(
  a: { submittedAt: string; id: string },
  b: { submittedAt: string; id: string },
): number {
  const time = Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The checksum of a legacy file's bytes through the provider; null when it has none. */
async function fileBytes(
  providers: { readonly files: Pick<ProviderSet["files"], "getFileByLegacyName"> },
  kind: FileKind,
  name: string,
): Promise<string | null> {
  const found = await providers.files.getFileByLegacyName(kind, name);
  if (found === null) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of found.content) chunks.push(Buffer.from(chunk as Buffer));
  return bytesChecksum(Buffer.concat(chunks));
}

/** Up to `count` of the ids, chosen at random. */
function randomPick(ids: readonly string[], count: number): string[] {
  const pool = [...ids];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(0, count));
}
