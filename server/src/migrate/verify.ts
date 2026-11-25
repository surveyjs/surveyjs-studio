/**
 * `verify`: the go/no-go evidence for the cutover (design, Decisions: "What go means"). It compares
 * the target with the source as of the high-water marks, through both providers' domain reads, the
 * source's reads with the mapping's decisions applied (compare.ts). A source record changed after
 * the marks is listed as pending, never as a difference. Any difference makes the run red.
 *
 * - **Full** (`--full`, the day before the window): every survey's record, definition, theme,
 *   history, layouts, private questions and response count (the source's rows streamed, the
 *   target's `results.stats`); the projects, members, people and keys; and `deepSample` random
 *   surveys (every survey of a `--sample` run) read in depth through both providers: the record,
 *   definition, theme, history, every response, layouts and the legacy files they link.
 * - **Incremental** (in the window, after the final `delta`): what changed since the last full
 *   verify: the changed surveys in full (their responses by the new rows), every survey's new
 *   responses and deletions, and the small tables (surveys, projects, members, people, keys) in
 *   full. A full recount of every response is not part of it.
 *
 * Both modes flag the stores the copy does not take: rows of the app's own token table and users'
 * editor files of no survey. The report holds ids and counts, never content (rule 6).
 */
import { legacyFileRecord } from "../domain/legacy-file.js";
import type { FileKind, LayoutKind, SurveyRecord, SurveyResponse } from "../domain/types.js";
import { UPLOADS_PREFIX } from "../providers/azure-legacy/mapping.js";
import type { ProviderSet } from "../providers/types.js";
import {
  bytesChecksum,
  checksum,
  expectedHistory,
  expectedKey,
  expectedProject,
  expectedRecord,
  expectedResponse,
  expectedUser,
  historyKey,
  memberKeys,
  sameJson,
  sameNames,
  storedJson,
} from "./compare.js";
import { fileLinks } from "./map/files.js";
import { createReport, type Report } from "./map/report.js";
import { HISTORY_KEEP, mapHistory, mapResponse } from "./map/results.js";
import { mapSurvey } from "./map/surveys.js";
import { changedAfterMarks, markOf, type HighWaterMarks, type SourceStore } from "./marks.js";
import { collectNamed } from "./named.js";
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import type { MigrationTarget } from "./target.js";

export interface VerifyOptions {
  /** `--full`; otherwise incremental, since the last full verify. */
  full: boolean;
  /** `--sample`: only these accounts' closure, every survey of it compared in depth. */
  sample?: SampleSet;
  /** How many random surveys a full verify compares in depth. */
  deepSample: number;
  report: Report;
}

/** State key of the last green full verify: when, and the marks it compared as of. */
const FULL_VERIFY = "verify:full";
interface FullVerifyState {
  at: string;
  marks: HighWaterMarks;
}

const LAYOUT_KINDS: readonly LayoutKind[] = ["table", "summary", "columns"];
const PAGE = 1000;

interface Texts {
  definition: string | null;
  permissions: string | null;
  columns: string | null;
}
const NO_TEXTS: Texts = { definition: null, permissions: null, columns: null };

export async function runVerify(
  source: LegacySource,
  sourceProviders: ProviderSet,
  targetProviders: ProviderSet,
  target: MigrationTarget,
  options: VerifyOptions,
): Promise<{ ok: boolean }> {
  const { report, sample } = options;
  const { state } = target;
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
    since = last.marks;
  }
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);

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

  // ---- People and keys, projects and members, in full in both modes ----
  const run = await state.get<{ startedAt: string }>("run");
  const named = await collectNamed(source, {
    ...(sample && { sample }),
    report: quiet(),
    runStart: run?.startedAt ?? marks.takenAt,
    readsHistory: () => true,
  });
  const userChanged = new Map(
    named.users.map((row) => [row.id.toLowerCase(), after("sql", row.timestamp)]),
  );
  const people = new Map(named.people.map((person) => [person.id, person]));
  const keyHolders = new Set(named.keys.map((key) => key.userId));
  for (const person of named.people) {
    const ids = { userId: person.id };
    const changed = userChanged.get(person.id) ?? false;
    const [read, stored] = await Promise.all([
      sourceProviders.users.getUser(person.id),
      targetProviders.users.getUser(person.id),
    ]);
    judge("people", ids, read !== null && sameJson(stored, expectedUser(read, person)), changed);
    const [sourceKey, storedKey] = await Promise.all([
      sourceProviders.credentials.legacyKeyOf(person.id),
      targetProviders.credentials.legacyKeyOf(person.id),
    ]);
    judge(
      "keys",
      ids,
      sameJson(storedKey, expectedKey(sourceKey, keyHolders.has(person.id))),
      changed,
    );
  }
  for (const id of await target.idsOf("users")) {
    if (!people.has(id)) differ("people", { userId: id }, { inSource: 0 });
  }

  // The target lists only members with a profile.
  const profiles = new Set(people.keys());
  const projectIds = new Set<string>();
  for (const { project, members } of named.projects) {
    projectIds.add(project.id);
    const ids = { projectId: project.id };
    const changed =
      after("sql", project.createdAt) || members.some((member) => after("sql", member.updatedAt));
    const [read, stored, readMembers, storedMembers] = await Promise.all([
      sourceProviders.projects.getProject(project.id),
      targetProviders.projects.getProject(project.id),
      sourceProviders.projects.listMembers(project.id),
      targetProviders.projects.listMembers(project.id),
    ]);
    judge(
      "projects",
      ids,
      read !== null && sameJson(stored, expectedProject(read, members)),
      changed,
    );
    judge(
      "members",
      ids,
      sameJson(memberKeys(storedMembers), memberKeys(readMembers, profiles)),
      changed,
      { source: members.length, target: storedMembers.length },
    );
  }
  for (const projectId of named.projectsWithoutMembers) {
    judge(
      "projects",
      { projectId },
      (await targetProviders.projects.getProject(projectId)) === null,
      false,
    );
  }
  for (const id of await target.idsOf("projects")) {
    if (!projectIds.has(id)) differ("projects", { projectId: id }, { inSource: 0 });
  }

  // ---- Survey by survey ----
  const ctx = {
    projects: projectIds,
    projectsWithoutMembers: named.projectsWithoutMembers,
    people: profiles,
    legacyUsers: named.legacyUsers,
  };
  const blobsChangedAfter = async (container: "layouts" | "permissions", from: Date) => {
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

  const targetSurveys = await target.idsOf("surveys");
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

  /** The source's response rows changed after the marks (pending), and its deletions after them. */
  async function afterMarksOf(surveyId: string, postId: string) {
    const rows: { id: string; clientId: string | null; partial: boolean }[] = [];
    for await (const row of source.responses(postId, markOf(marks, "tables"))) {
      if (!after("tables", row.timestamp)) continue;
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped === null) continue;
      const { id, clientId, partial } = mapped.response;
      rows.push({ id, clientId: clientId ?? null, partial });
    }
    const deleted: { id: string; partial: boolean }[] = [];
    for await (const copy of source.deletedCopies(postId, markOf(marks, "tables"))) {
      if (!after("tables", copy.deletedAt)) continue;
      const id = copy.responseId.toLowerCase();
      deleted.push({ id, partial: copy.entity.ispartialcompleted === true });
    }
    for (const { id } of [...rows, ...deleted]) pending("responses", { surveyId, responseId: id });
    return { rows, deleted };
  }

  const seen = new Set<string>();
  for await (const row of source.surveys()) {
    const surveyId = row.id.toLowerCase();
    if (!wanted(surveyId)) continue;
    seen.add(surveyId);
    const ids = { surveyId };
    const rowChanged = after("sql", row.timestamp);
    const stored = await targetProviders.surveys.getSurvey(surveyId);
    // Whether the copy skips the survey does not depend on its documents.
    const base = mapSurvey(row, null, null, null, { ...ctx, report: quiet() });
    if (base === null || stored === null) {
      // Skipped by the copy (reported there): the target must not hold it; else it must.
      judge("surveys", ids, base === null && stored === null, rowChanged);
      continue;
    }

    // Incremental: the responses and deletions since the last full verify, by count.
    const fresh =
      since === null
        ? null
        : await compareNewResponses(surveyId, base.record.postId, stored, markOf(since, "tables"));
    // A survey changed since the last full verify is compared in full: its documents when they
    // changed, its settings and private questions also when new responses came in.
    const documentsChanged =
      since !== null &&
      (changedAfterMarks(since, "sql", row.timestamp) || changedSince!.has(surveyId));
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
    judge("surveys", ids, sameJson(stored, expected), rowChanged);
    if (!settings) continue;

    const settingsChanged =
      rowChanged || layoutsAfterMarks.has(surveyId) || permissionsAfterMarks.has(surveyId);
    if (documents) await compareDocuments(surveyId, rec, texts, rowChanged);

    // Responses: counted (full), or the new ones (incremental); then the private questions.
    const storedNames = await targetProviders.views.getPrivateQuestions(surveyId);
    let answerNames: Iterable<string>;
    let pendingNames: boolean;
    if (fresh === null) {
      const counted = await countResponses(surveyId, rec.record.postId, stored);
      answerNames = counted.answerNames;
      pendingNames = counted.pendingNames;
    } else {
      // Every name the target lists is taken as an answer name, with the new rows' keys: a
      // response-only name then follows the layout's rule as the copy applied it.
      answerNames = [...storedNames, ...fresh.names];
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
      withResponses !== null && sameNames(storedNames, withResponses.privateQuestions),
      settingsChanged || pendingNames,
      {
        source: withResponses?.privateQuestions.length ?? 0,
        target: storedNames.length,
      },
    );

    if (deep.has(surveyId)) await compareInDepth(surveyId, rec, stored);
  }
  for (const id of targetSurveys) {
    if (!seen.has(id)) differ("surveys", { surveyId: id }, { inSource: 0 });
  }

  if (options.full && ok) {
    const at = new Date().toISOString();
    await state.set(FULL_VERIFY, { at, marks } satisfies FullVerifyState, at);
  }
  return { ok };

  // ---- The checks of one survey ----

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
      await source.historyNewest(surveyId, HISTORY_KEEP),
      quiet(),
    );
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
        layoutsAfterMarks.has(surveyId),
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
   * Full: the source's rows streamed (never all in memory) and counted as of the marks against
   * the target's `stats` (complete rows). Rows after the marks are pending; the target may hold
   * them already (the copy read later than the marks), and may still hold rows deleted after them.
   */
  async function countResponses(surveyId: string, postId: string, stored: SurveyRecord) {
    const answerNames = new Set<string>();
    let complete = 0;
    let first: string | null = null;
    let last: string | null = null;
    const late: { id: string; partial: boolean; names: string[] }[] = [];
    for await (const row of source.responses(postId)) {
      const mapped = mapResponse(surveyId, row, quiet());
      if (mapped === null) continue;
      const { response } = mapped;
      if (after("tables", row.timestamp)) {
        late.push({
          id: response.id,
          partial: response.partial,
          names: Object.keys(response.data),
        });
        continue;
      }
      for (const name of Object.keys(response.data)) answerNames.add(name);
      if (response.partial) continue;
      complete += 1;
      if (first === null || response.submittedAt < first) first = response.submittedAt;
      if (last === null || response.submittedAt > last) last = response.submittedAt;
    }
    const { deleted } = await afterMarksOf(surveyId, postId);
    let expected = complete;
    for (const { id, partial } of [...late, ...deleted]) {
      pending("responses", { surveyId, responseId: id });
      if (!partial && (await targetProviders.results.hasResponse(stored, id))) expected += 1;
    }
    const stats = await targetProviders.results.stats(stored);
    const adjusted = late.length > 0 || deleted.length > 0;
    judge(
      "response_counts",
      { surveyId },
      stats.count === expected &&
        (adjusted || (stats.firstSubmittedAt === first && stats.lastSubmittedAt === last)),
      // A row rewritten after the marks (a partial run completed) moves the count too.
      adjusted,
      { source: complete, target: stats.count },
    );
    const pendingNames = late.some(({ names }) => names.some((name) => !answerNames.has(name)));
    return { answerNames, pendingNames };
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
    for await (const row of source.responses(postId, from)) {
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
    for await (const copy of source.deletedCopies(postId, from)) {
      const responseId = copy.responseId.toLowerCase();
      if (after("tables", copy.deletedAt)) {
        pending("responses", { surveyId, responseId });
        continue;
      }
      deletions += 1;
      if (await targetProviders.results.hasResponse(stored, responseId)) kept += 1;
    }
    judge("deletions", { surveyId }, kept === 0, false, { source: deletions, kept });
    return { rows: fresh, names, late };
  }

  /**
   * In depth, through both providers (checks `deep_…`, `responses`, `legacy_files`): the record,
   * definition, theme, history page and snapshots, every response, the layouts and the legacy
   * files the survey's records link.
   */
  async function compareInDepth(
    surveyId: string,
    rec: NonNullable<ReturnType<typeof mapSurvey>>,
    stored: SurveyRecord,
  ) {
    const ids = { surveyId };
    const read = await sourceProviders.surveys.getSurvey(surveyId);
    if (read === null) {
      differ("deep_surveys", ids, { inSource: 0 });
      return;
    }
    const changed = after("sql", read.updatedAt);
    judge("deep_surveys", ids, sameJson(stored, expectedRecord(read, rec.record)), changed);

    const links: { kind: FileKind; name: string }[] = [];
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
    const entries = [];
    for (const entry of page.items) {
      const snapshot = await sourceProviders.surveys.getHistorySnapshot(surveyId, entry.id);
      entries.push({ entry, snapshot });
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
        layoutsAfterMarks.has(surveyId),
      );
    }

    // Every response, both walks in submission order, merged.
    const late = await afterMarksOf(surveyId, read.postId);
    const lateIds = new Set(late.rows.map((row) => row.id));
    const lateClients = new Set(late.rows.flatMap((row) => (row.clientId ? [row.clientId] : [])));
    const deletedLate = new Set(late.deleted.map((row) => row.id));
    const mine = walk(sourceProviders, read);
    const theirs = walk(targetProviders, stored);
    let a = await mine.next();
    let b = await theirs.next();
    const counts = { differing: 0, missing: 0, extra: 0 };
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
        if (!sameJson(b.value, expected)) {
          if (a.value.clientId !== undefined && lateClients.has(a.value.clientId)) {
            pending("responses", { surveyId, responseId: a.value.id });
          } else counts.differing += 1;
        }
        a = await mine.next();
        b = await theirs.next();
      } else if (order < 0 && !a.done) {
        counts.missing += 1;
        a = await mine.next();
      } else if (!b.done) {
        if (!deletedLate.has(b.value.id)) counts.extra += 1;
        b = await theirs.next();
      }
    }
    judge("responses", ids, counts.differing + counts.missing + counts.extra === 0, false, {
      ...counts,
      compared,
    });

    // The legacy files those records link: the same bytes, or missing on both sides.
    const done = new Set<string>();
    for (const { kind, name } of links) {
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
  }
}

/** Every response of the survey through the provider, page by page, in submission order. */
async function* walk(
  providers: ProviderSet,
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
function positionOrder(a: SurveyResponse, b: SurveyResponse): number {
  const time = Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
  if (time !== 0) return time;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The checksum of a legacy file's bytes through the provider; null when it has none. */
async function fileBytes(
  providers: ProviderSet,
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
