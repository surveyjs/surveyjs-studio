/**
 * `copy`: everything (or a sample) from the legacy stores into the target, survey by survey (a
 * few at once), each survey checkpointed once complete, so a run that stops resumes where it
 * stopped. This module orders the work; the mappers (map/) decide what each record is, the target
 * writes it. The per-survey work (`createSurveyCopier`) is also what `delta` copies a changed
 * survey with.
 */
import { randomUUID } from "node:crypto";
import { isUploadLegacyName, legacyFileRecord } from "../domain/legacy-file.js";
import type { FileKind, LayoutKind, SurveyFileRecord } from "../domain/types.js";
import { fileRecordFromBlob, isGuid } from "../providers/azure-legacy/mapping.js";
import type { DumpKind, DumpRecords, DumpWriter } from "./dump.js";
import { fileLinks } from "./map/files.js";
import { mapPeople } from "./map/people.js";
import { createReport, phaseTimer, type Report } from "./map/report.js";
import { HISTORY_KEEP, mapDeleted, mapHistory, mapMarker, mapResponse } from "./map/results.js";
import { mapSurvey } from "./map/surveys.js";
import { mapView } from "./map/views.js";
import { takeMarks } from "./marks.js";
import { collectNamed } from "./named.js";
import type {
  DeletedRec,
  EventRec,
  LayoutRec,
  MarkerRec,
  ResponseRec,
  SurveyRec,
  ViewRec,
} from "./records.js";
import { sampleMismatch, storedSampleOf, type SampleSet, type StoredSample } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import type { SourceFingerprint } from "./source/fingerprint.js";
import { COPY_COMPLETE, guardSource, Refused, SAMPLE, type MigrationState } from "./state.js";
import type { MigrationTarget } from "./target.js";

export interface CopyOptions {
  /** Only these accounts' closure (`--sample`, `--include`); default everything. */
  sample?: SampleSet;
  report: Report;
  /** Every record written, as NDJSON (`--dump`). */
  dump?: DumpWriter;
  /** `--full`: copy the surveys that have a checkpoint again. */
  full?: boolean;
  /** Tests only: throws after this many batches of responses (a run killed mid-survey). */
  failAfter?: number;
  /** Responses (and markers, deletion copies, events, views) per write; default 500. */
  batchSize?: number;
  /** Surveys copied at once; default 8. */
  concurrency?: number;
  /** The clock; default the system's. */
  now?: () => Date;
  /** A line now and then for a long run, and one at the end of each phase with its duration. */
  progress?: (line: string) => void;
  /** Tests only: the high-water marks' safety margin (default `MARKS_MARGIN_MS`). */
  marginMs?: number;
  /**
   * The source the command line opened (names only): recorded at the first run, and a run on
   * another source is refused (`guardSource`). Undefined: not checked (tests).
   */
  fingerprint?: SourceFingerprint;
}

/** State key `run`: the first copy's start, the creation time of the people and keys it copies. */
interface RunState {
  id: string;
  startedAt: string;
  command: "copy";
}

/**
 * State key `survey:{id}`: the survey is copied whole. `answerNames` are the keys its responses
 * use (answer names the definition may not have), which `delta` keeps up to date, so the privacy
 * rule never needs every response read again.
 */
export interface SurveyCheckpoint {
  copiedAt: string;
  answerNames?: string[];
}
export const CHECKPOINT = "survey:";
/** State key `permissions:{id}`: the survey's copied documents included a permissions blob. */
export const PERMISSIONS = "permissions:";

export const BATCH = 500;
export const COPY_CONCURRENCY = 8;
const PROGRESS_EVERY = 100;
const LAYOUT_KINDS: readonly LayoutKind[] = ["table", "summary", "columns"];

type SurveyRow = Parameters<typeof mapSurvey>[0];
/** What the mapping of a survey depends on beyond its row and documents. */
export type SurveyContext = Omit<Parameters<typeof mapSurvey>[4], "extraAnswerNames">;
type Link = { kind: FileKind; name: string };

/** The texts a survey's mapping reads (null: no such blob). */
export interface SurveyTexts {
  definition: string | null;
  permissions: string | null;
  columns: string | null;
}

/** What `documents` wrote of a survey, for the rest of its copy. */
export interface WrittenDocuments {
  surveyId: string;
  /** The survey mapped without its responses' keys. */
  rec: SurveyRec;
  texts: SurveyTexts;
  /** The private questions stored until the responses are read. */
  interim: string[];
  /** The legacy files the definition, theme and copied history link. */
  links: Link[];
  /** The people the copied history names (lower-case ids, each once). */
  authors: string[];
}

/**
 * How `rows` keeps a survey's answers private while it writes them: before a batch of responses
 * brings answer names the stored list was not computed with, the layout's rule is applied to them
 * and the stored list grows by the names it makes private (never shrinks), so no response-only
 * answer is public, even for a moment, under a layout that hides new columns.
 */
export interface PrivacyGuard {
  row: SurveyRow;
  /** The survey's texts (read once, when a batch first needs them). */
  texts: () => Promise<SurveyTexts>;
  /** The answer names the stored list already covers (a checkpoint's). */
  known: Iterable<string>;
  /** The stored private questions (read once, when a batch first needs them). */
  stored: () => Promise<string[]>;
}

export interface SurveyCopier {
  /** The whole survey: documents, every row, the final private questions, files, checkpoint. */
  copySurvey(row: SurveyRow): Promise<boolean>;
  /**
   * The survey row with its definition, theme and publish id (the private questions as the
   * union with what is stored, never weaker mid-way), the newest history entries (the rest
   * pruned) and the layouts. Null when the row maps to no survey (reported).
   */
  documents(
    row: SurveyRow,
    options?: { keepCheckpoint?: boolean },
  ): Promise<WrittenDocuments | null>;
  /**
   * The survey's responses, markers and deletion copies, all or those changed after `since`.
   * `privateQuestions`: the stored list as the guard left it (null: it wrote none).
   */
  rows(
    surveyId: string,
    postId: string,
    since?: Date,
    guard?: PrivacyGuard,
  ): Promise<{ answerNames: Set<string>; links: Link[]; privateQuestions: string[] | null }>;
  texts(surveyId: string): Promise<SurveyTexts>;
  /** The private questions with every answer name, stored when they differ from `stored`. */
  finish(
    row: SurveyRow,
    texts: SurveyTexts,
    answerNames: Iterable<string>,
    stored: readonly string[],
  ): Promise<void>;
  /** The legacy files the records link, each once per run (and, `skipStored`, once at all). */
  linkedFiles(surveyId: string, links: Link[], options?: { skipStored?: boolean }): Promise<void>;
  checkpoint(surveyId: string, answerNames: Iterable<string>): Promise<void>;
  /** One of Studio's own files (`my-surveys-files`): the bytes, then the row. */
  appFile(blobName: string, record: SurveyFileRecord): Promise<void>;
}

/** A batch of records, written by `write` whenever it holds `size`, and at `flush`. */
export function batcher<T>(size: number, write: (items: T[]) => Promise<void>) {
  let items: T[] = [];
  const flush = async () => {
    if (items.length === 0) return;
    const full = items;
    items = [];
    await write(full);
  };
  return {
    async add(item: T) {
      items.push(item);
      if (items.length >= size) await flush();
    },
    flush,
  };
}

/** Writes the records to the dump, when there is one. */
export function dumper(dump: DumpWriter | undefined) {
  return async <K extends DumpKind>(kind: K, records: readonly DumpRecords[K][]) => {
    if (dump) for (const record of records) await dump.write(kind, record);
  };
}

/** Payload properties that hold ids: lower-cased (N1). Others are kept as stored. */
const EVENT_GUIDS = new Set(["postid", "resultid", "userid", "creatorid"]);
/** Payload properties dropped: the pre-port respondent address (personal data, no reader). */
const EVENT_DROPPED = new Set(["ipaddress"]);

/**
 * A legacy event row as the target's event, keyed by its row key as the app writes it; null
 * (reported) when an id is not a GUID or the time is not a date. An `id` property that differs
 * from the key is noted.
 */
export function eventRec(
  event: {
    id: string;
    idProperty?: string;
    surveyId: string;
    type: string;
    at: Date | null;
    rest: Record<string, unknown>;
  },
  report: Report,
): EventRec | null {
  const ids = { eventId: event.id.toLowerCase(), surveyId: event.surveyId.toLowerCase() };
  if (!isGuid(event.id) || !isGuid(event.surveyId)) {
    report.skip("event", ids, "an id is not a GUID");
    return null;
  }
  if (event.at === null) {
    report.skip("event", ids, "the time is not a date");
    return null;
  }
  if (event.idProperty !== undefined && event.idProperty.toLowerCase() !== ids.eventId) {
    report.note("event_id_differs", ids);
  }
  const payload = Object.fromEntries(
    Object.entries(event.rest)
      .filter(([key]) => !EVENT_DROPPED.has(key))
      .map(([key, value]) => [
        key,
        EVENT_GUIDS.has(key) && typeof value === "string" && isGuid(value)
          ? value.toLowerCase()
          : value,
      ]),
  );
  return {
    id: ids.eventId,
    surveyId: ids.surveyId,
    type: event.type,
    at: event.at.toISOString(),
    payload: Object.keys(payload).length > 0 ? JSON.stringify(payload) : null,
  };
}

/** Runs the calls one after another (a later one starts when the earlier one has settled). */
export function serially<A extends unknown[]>(
  work: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let last: Promise<void> = Promise.resolve();
  return (...args) => {
    const next = last.then(() => work(...args));
    last = next.catch(() => undefined);
    return next;
  };
}

export function createSurveyCopier(
  source: LegacySource,
  target: MigrationTarget,
  options: {
    ctx: SurveyContext;
    dump?: DumpWriter;
    batchSize: number;
    now: () => Date;
    failAfter?: number;
    /**
     * `copy`: profiles for the people a survey's copied history names, written before its
     * checkpoint (a resumed run never copies a checkpointed survey's history again).
     */
    nameAuthors?: (authors: readonly string[]) => Promise<void>;
  },
): SurveyCopier {
  const { ctx, batchSize: size } = options;
  const { report } = ctx;
  const at = () => options.now().toISOString();
  const write = dumper(options.dump);
  const { state } = target;
  /**
   * The legacy files handled in this run (`{kind}/{name}`), each with its copy: a survey that
   * links a file another survey's task is still writing waits for it before its checkpoint.
   */
  const linked = new Map<string, Promise<void>>();
  let responseBatches = 0;

  const texts = async (surveyId: string): Promise<SurveyTexts> => {
    const [definition, permissions, columns] = await Promise.all([
      source.definitionText(surveyId),
      source.permissionsText(surveyId),
      source.layoutText(surveyId, "columns"),
    ]);
    return { definition, permissions, columns };
  };

  async function documents(
    row: SurveyRow,
    { keepCheckpoint = false }: { keepCheckpoint?: boolean } = {},
  ): Promise<WrittenDocuments | null> {
    const surveyId = row.id.toLowerCase();
    const read = await texts(surveyId);
    const rec = mapSurvey(row, read.definition, read.permissions, read.columns, ctx);
    if (rec === null) return null;
    // Rewriting a survey: its checkpoint goes first, so a run stopped inside it copies it again.
    if (!keepCheckpoint) await state.delete(`${CHECKPOINT}${surveyId}`);
    // Until the responses are read, the list also keeps what is stored (a re-copy never makes
    // a survey's answers more public mid-way); after them, the full list replaces it.
    const stored = await target.privateQuestionsOf(surveyId);
    const interim = [...new Set([...rec.privateQuestions, ...stored])];
    await target.upsertSurvey({ ...rec, privateQuestions: interim });
    const links = [...fileLinks(rec.definition), ...fileLinks(rec.theme)];

    const history = mapHistory(
      surveyId,
      await source.historyNewest(surveyId, HISTORY_KEEP, rec.record.legacyPublishId),
      report,
    );
    await target.upsertHistory(history);
    await target.pruneHistory(surveyId, HISTORY_KEEP);
    await write("history", history);
    for (const entry of history) links.push(...fileLinks(entry.snapshot));
    const authors = [
      ...new Set(history.flatMap((entry) => (entry.userId === null ? [] : [entry.userId]))),
    ];

    const layouts: LayoutRec[] = [];
    for (const kind of LAYOUT_KINDS) {
      const text = kind === "columns" ? read.columns : await source.layoutText(surveyId, kind);
      if (text !== null) layouts.push({ surveyId, kind, text });
    }
    await target.upsertLayouts(layouts);
    // A layout the source no longer has goes from the target too.
    const present = new Set(layouts.map(({ kind }) => kind));
    await target.deleteLayouts(
      surveyId,
      LAYOUT_KINDS.filter((kind) => !present.has(kind)),
    );
    await write("layout", layouts);
    // Whether the private questions came from a permissions blob: `reconcile` notices it gone.
    if (read.permissions === null) await state.delete(`${PERMISSIONS}${surveyId}`);
    else await state.set(`${PERMISSIONS}${surveyId}`, true, at());
    return { surveyId, rec, texts: read, interim, links, authors };
  }

  async function rows(surveyId: string, postId: string, since?: Date, guard?: PrivacyGuard) {
    // Responses in batches; their keys are answer names the privacy rule must cover too.
    const answerNames = new Set<string>();
    /** The legacy files the responses link, each once. */
    const links = new Map<string, Link>();
    /** The answer names the stored private questions were computed with. */
    const covered = new Set(guard?.known ?? []);
    let guardTexts: SurveyTexts | null = null;
    let privateQuestions: string[] | null = null;
    const protect = async (batch: readonly ResponseRec[]) => {
      if (!guard) return;
      let fresh = false;
      for (const { response } of batch) {
        for (const name of Object.keys(response.data)) {
          if (covered.has(name)) continue;
          covered.add(name);
          fresh = true;
        }
      }
      if (!fresh) return;
      guardTexts ??= await guard.texts();
      const mapped = mapSurvey(
        guard.row,
        guardTexts.definition,
        guardTexts.permissions,
        guardTexts.columns,
        { ...ctx, extraAnswerNames: covered, report: createReport() },
      );
      if (mapped === null) return;
      privateQuestions ??= await guard.stored();
      const have = new Set(privateQuestions);
      const added = mapped.privateQuestions.filter((name) => !have.has(name));
      if (added.length === 0) return;
      privateQuestions = [...privateQuestions, ...added];
      await target.setPrivateQuestions(surveyId, privateQuestions);
    };
    const responses = batcher<ResponseRec>(size, async (batch) => {
      // The names private before the answers that carry them are readable.
      await protect(batch);
      await target.upsertResponses(batch);
      await write("response", batch);
      responseBatches += 1;
      if (options.failAfter !== undefined && responseBatches >= options.failAfter) {
        throw new Error(`Stopped after ${responseBatches} batches of responses (failAfter)`);
      }
    });
    for await (const entity of source.responses(postId, since)) {
      const response = mapResponse(surveyId, entity, report);
      if (response === null) continue;
      for (const name of Object.keys(response.response.data)) answerNames.add(name);
      for (const link of fileLinks(response.response.data)) {
        links.set(`${link.kind}/${link.name}`, link);
      }
      await responses.add(response);
    }
    await responses.flush();

    const markers = batcher<MarkerRec>(size, async (batch) => {
      await target.upsertMarkers(batch);
      await write("marker", batch);
    });
    for await (const marker of source.markers(surveyId, since)) {
      await markers.add(mapMarker(surveyId, marker, report));
    }
    await markers.flush();

    const deleted = batcher<DeletedRec>(size, async (batch) => {
      await target.upsertDeleted(batch);
      await write("deleted", batch);
    });
    for await (const copy of source.deletedCopies(postId, since)) {
      const mappedCopy = mapDeleted(surveyId, copy, report);
      if (mappedCopy !== null) await deleted.add(mappedCopy);
    }
    await deleted.flush();
    return { answerNames, links: [...links.values()], privateQuestions };
  }

  async function finish(
    row: SurveyRow,
    read: SurveyTexts,
    answerNames: Iterable<string>,
    stored: readonly string[],
  ) {
    // The private questions again with the response keys (notes were made the first time).
    const final = mapSurvey(row, read.definition, read.permissions, read.columns, {
      ...ctx,
      extraAnswerNames: answerNames,
      report: createReport(),
    });
    if (final === null) return;
    // Exactly the computed list, in its order, so a resumed survey stores what a whole run does.
    if (!sameList(final.privateQuestions, stored)) await target.upsertSurvey(final);
    await write("survey", [final]);
  }

  async function linkedFiles(
    surveyId: string,
    links: Link[],
    { skipStored = false }: { skipStored?: boolean } = {},
  ) {
    const fresh = new Map<string, Link>();
    const elsewhere = new Set<Promise<void>>();
    for (const link of links) {
      const key = `${link.kind}/${link.name}`;
      const running = linked.get(key);
      if (running) elsewhere.add(running);
      else fresh.set(key, link);
    }
    // Claimed before anything is awaited, so no other survey starts the same file.
    const own = copyFiles(surveyId, [...fresh.values()], skipStored).catch((error: unknown) => {
      // A failed file is copied again by the next survey that links it.
      for (const key of fresh.keys()) linked.delete(key);
      throw error;
    });
    for (const key of fresh.keys()) linked.set(key, own);
    await Promise.all([own, ...elsewhere]);
  }

  /** The files' bytes, then their rows (`skipStored`: not those the target holds already). */
  async function copyFiles(surveyId: string, links: Link[], skipStored: boolean) {
    let fresh = links;
    if (skipStored && fresh.length > 0) {
      const stored = new Set(
        await target.existingKeys(
          "legacy_files",
          fresh.map(({ kind, name }) => `${kind}/${name}`),
        ),
      );
      fresh = fresh.filter(({ kind, name }) => !stored.has(`${kind}/${name}`));
    }
    // Bytes first, then the row.
    for (const { kind, name } of fresh) {
      const content = await source.shareFile(kind === "asset" ? "surveyfiles" : "files", name);
      if (content === null) {
        report.note(
          kind === "asset" && isUploadLegacyName(name)
            ? "linked_user_file_not_copied"
            : "linked_file_missing",
          { surveyId, kind, file: name },
        );
        continue;
      }
      const file = {
        kind,
        legacyName: name,
        record: legacyFileRecord(kind, name, content.length),
        content,
      };
      await target.upsertFile(file);
      await write("file", [file]);
    }
  }

  async function checkpoint(surveyId: string, answerNames: Iterable<string>) {
    const value: SurveyCheckpoint = {
      copiedAt: at(),
      answerNames: [...new Set(answerNames)].sort(),
    };
    await state.set(`${CHECKPOINT}${surveyId}`, value, at());
  }

  return {
    async copySurvey(row) {
      const written = await documents(row);
      if (written === null) return false;
      const { surveyId } = written;
      const copied = await rows(surveyId, written.rec.record.postId, undefined, {
        row,
        texts: () => Promise.resolve(written.texts),
        known: [],
        stored: () => Promise.resolve(written.interim),
      });
      await finish(
        row,
        written.texts,
        copied.answerNames,
        copied.privateQuestions ?? written.interim,
      );
      await linkedFiles(surveyId, [...written.links, ...copied.links]);
      await options.nameAuthors?.(written.authors);
      await checkpoint(surveyId, copied.answerNames);
      return true;
    },
    documents,
    rows,
    texts,
    finish,
    linkedFiles,
    checkpoint,
    async appFile(blobName, record) {
      const content = await source.appFile(blobName);
      if (content === null) return;
      const file = {
        kind: record.kind,
        legacyName: null,
        record: { ...record, size: content.length } as SurveyFileRecord,
        content,
      };
      await target.upsertFile(file);
      await write("file", [file]);
    },
  };
}

/**
 * Refuses a copy whose sample differs from the one the target already holds (a full copy is the
 * null sample). Another copy would rewrite the stored sample, and a later `reconcile --sample`
 * would then delete everything outside it. A copy records its sample before its first write of
 * any kind, so a target holds (part of) a copy exactly when the record is there, the stored null
 * of a full copy included. Only `wipe` starts the target afresh.
 */
async function requireCopyFits(
  state: MigrationState,
  sample: SampleSet | undefined,
): Promise<boolean> {
  if (!(await state.keys(SAMPLE)).includes(SAMPLE)) return false;
  const why = sampleMismatch(await state.get<StoredSample>(SAMPLE), sample);
  if (why !== null) throw new Refused(`${why}, or wipe the target to copy something else`);
  return true;
}

export async function runCopy(
  source: LegacySource,
  target: MigrationTarget,
  options: CopyOptions,
): Promise<void> {
  const { report, sample, dump } = options;
  const now = options.now ?? (() => new Date());
  const at = () => now().toISOString();
  const size = options.batchSize ?? BATCH;
  const progress = options.progress ?? (() => undefined);
  const phase = phaseTimer(report, progress);
  const { state } = target;
  const held = await requireCopyFits(state, sample);
  // Another source's copy is refused too; a new copy records its source with its sample.
  await guardSource(state, options.fingerprint, at(), held ? progress : undefined);
  // What this copy covers, for the commands after it (the sample, or null for everything): the
  // first write, so a run stopped anywhere leaves a target only the same sample may copy into.
  await state.set(SAMPLE, storedSampleOf(sample), at());
  const write = dumper(dump);

  // The run keeps its start across resumed runs; the marks are the first run's, so a later
  // `delta` reads everything that changed since any part of the copy was read.
  const stored = await state.get<RunState>("run");
  const run: RunState =
    stored?.command === "copy" ? stored : { id: randomUUID(), startedAt: at(), command: "copy" };
  if (stored !== run) await state.set("run", run, at());
  if ((await state.get("marks")) === null)
    await state.set(
      "marks",
      await takeMarks(source, now, {
        report,
        ...(options.marginMs !== undefined && { marginMs: options.marginMs }),
      }),
      at(),
    );
  const checkpoints = new Set(
    (await state.keys(CHECKPOINT)).map((key) => key.slice(CHECKPOINT.length)),
  );
  const toCopy = (surveyId: string) => options.full === true || !checkpoints.has(surveyId);
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);
  phase("marks", "marks taken");

  // ---- The people the copied data names, and the projects ----
  // The history authors are named as each survey's history is copied (below), not by listing
  // every survey's history first.
  const named = await collectNamed(source, {
    ...(sample && { sample }),
    report,
    runStart: run.startedAt,
    readsHistory: () => false,
  });
  const { legacyUsers, projects, projectsWithoutMembers } = named;
  const projectIds = new Set(projects.map(({ project }) => project.id));
  /** The people this run has decided on (written, skipped or excluded by the mapping). */
  const considered = new Set(named.named);
  const peopleIds = new Set<string>();
  const writePeople = async (mapped: ReturnType<typeof mapPeople>) => {
    const { skipped } = await target.upsertPeople(mapped.people);
    const skippedIds = new Set(skipped.map(({ id }) => id));
    for (const { id, reason } of skipped) report.skip("person", { userId: id }, reason);
    const people = mapped.people.filter((person) => !skippedIds.has(person.id));
    const keys = mapped.keys.filter((key) => !skippedIds.has(key.userId));
    await write("person", people);
    await target.upsertKeys(keys);
    await write("key", keys);
    for (const person of people) peopleIds.add(person.id);
    return { people: people.length, keys: keys.length };
  };
  const written = await writePeople(named);
  phase("people", `people: ${written.people}, keys: ${written.keys}`);

  for (const { project, members } of projects) {
    await target.upsertProject(project, members);
    await write("project", [project]);
    await write("member", members);
  }
  phase("projects", `projects: ${projects.length}`);

  // ---- Survey by survey, a few at once ----
  // History authors no earlier part named get their profiles before the survey's checkpoint;
  // one call at a time, so two surveys never decide on one person at once.
  const nameAuthors = serially(async (authors: readonly string[]) => {
    const fresh = new Set(authors.filter((id) => !considered.has(id)));
    if (fresh.size === 0) return;
    for (const id of fresh) considered.add(id);
    await writePeople(mapPeople(named.users, fresh, run.startedAt, report));
  });
  const copier = createSurveyCopier(source, target, {
    ctx: { projects: projectIds, projectsWithoutMembers, people: peopleIds, legacyUsers, report },
    ...(dump && { dump }),
    batchSize: size,
    now,
    ...(options.failAfter !== undefined && { failAfter: options.failAfter }),
    nameAuthors,
  });
  const copied = new Set<string>();
  let done = 0;
  async function* wantedRows() {
    for await (const row of source.surveys()) {
      const surveyId = row.id.toLowerCase();
      if (!wanted(surveyId)) continue;
      if (!toCopy(surveyId)) {
        copied.add(surveyId);
        continue;
      }
      yield row;
    }
  }
  const earlier = () => copied.size - done;
  await inParallel(wantedRows(), options.concurrency ?? COPY_CONCURRENCY, async (row) => {
    if (await copier.copySurvey(row)) copied.add(row.id.toLowerCase());
    done += 1;
    if (done % PROGRESS_EVERY === 0) progress(`surveys: ${done}`);
  });
  phase("surveys", `surveys: ${done} copied, ${earlier()} from earlier runs`);

  // ---- Events, users' views, the app's own files ----
  const events = batcher<EventRec>(size, async (batch) => {
    await target.upsertEvents(batch);
    await write("event", batch);
  });
  for await (const event of source.events()) {
    if (sample && !copied.has(event.surveyId.toLowerCase())) continue;
    const rec = eventRec(event, report);
    if (rec !== null) await events.add(rec);
  }
  await events.flush();
  phase("events");

  const views = batcher<ViewRec>(size, async (batch) => {
    await target.upsertViews(batch);
    await write("view", batch);
  });
  for await (const view of source.views()) {
    if (!copied.has(view.surveyId.toLowerCase())) continue;
    const blobName = `${view.surveyId}/${view.userId}/${view.view}`;
    const rec = mapView(blobName, view.text, view.lastModified, report);
    if (rec !== null) await views.add(rec);
  }
  await views.flush();
  phase("views");

  for await (const blob of source.appFiles()) {
    const record = fileRecordFromBlob(blob.blobName, blob.properties, blob.metadata);
    if (record === null) {
      report.skip("file", { blob: blob.blobName.toLowerCase() }, "the blob is no file of the app");
      continue;
    }
    if (record.surveyId === null) {
      // A user's editor file of no survey: the target holds survey files only (reported).
      report.skip("file", { fileId: record.id }, "a user's file of no survey");
      continue;
    }
    if (!copied.has(record.surveyId)) {
      if (!sample) {
        report.skip(
          "file",
          { fileId: record.id, surveyId: record.surveyId },
          "its survey is not copied",
        );
      }
      continue;
    }
    await copier.appFile(blob.blobName, record as SurveyFileRecord);
  }
  phase("files", "own files");
  // A whole pass is done: `delta` and `reconcile` may follow.
  await state.set(COPY_COMPLETE, { at: at() }, at());
  progress("done");
}

export const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);

/** Runs `work` for every item, at most `limit` at once; the first failure stops it and throws. */
export async function inParallel<T>(
  items: AsyncIterable<T> | Iterable<T>,
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const running = new Set<Promise<void>>();
  let failed = false;
  let failure: unknown;
  for await (const item of items) {
    if (failed) break;
    const task: Promise<void> = work(item)
      .catch((error: unknown) => {
        if (!failed) [failed, failure] = [true, error];
      })
      .finally(() => running.delete(task));
    running.add(task);
    if (running.size >= Math.max(1, limit)) await Promise.race(running);
  }
  await Promise.all(running);
  if (failed) throw failure;
}
