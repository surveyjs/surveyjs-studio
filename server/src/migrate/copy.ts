/**
 * `copy`: everything (or a sample) from the legacy stores into the target, survey by survey, each
 * survey checkpointed once complete, so a run that stops resumes where it stopped. This module
 * orders the work; the mappers (map/) decide what each record is, the target writes it.
 */
import { randomUUID } from "node:crypto";
import { isUploadLegacyName, legacyFileRecord } from "../domain/legacy-file.js";
import type { FileKind, LayoutKind, SurveyFileRecord } from "../domain/types.js";
import { fileRecordFromBlob, isGuid } from "../providers/azure-legacy/mapping.js";
import type { DumpKind, DumpRecords, DumpWriter } from "./dump.js";
import { fileLinks } from "./map/files.js";
import { createReport, type Report } from "./map/report.js";
import { HISTORY_KEEP, mapDeleted, mapHistory, mapResponse } from "./map/results.js";
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
import type { SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
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
  /** The clock; default the system's. */
  now?: () => Date;
  /** A line now and then for a long run. */
  progress?: (line: string) => void;
}

/** State key `run`: the first copy's start, the creation time of the people and keys it copies. */
interface RunState {
  id: string;
  startedAt: string;
  command: "copy";
}

const BATCH = 500;
const PROGRESS_EVERY = 100;
const LAYOUT_KINDS: readonly LayoutKind[] = ["table", "summary", "columns"];
const CHECKPOINT = "survey:";

/** A batch of records, written by `write` whenever it holds `size`, and at `flush`. */
function batcher<T>(size: number, write: (items: T[]) => Promise<void>) {
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
  const { state } = target;
  const write = async <K extends DumpKind>(kind: K, records: readonly DumpRecords[K][]) => {
    if (dump) for (const record of records) await dump.write(kind, record);
  };

  // The run keeps its start across resumed runs; the marks are the first run's, so a later
  // `delta` reads everything that changed since any part of the copy was read.
  const stored = await state.get<RunState>("run");
  const run: RunState =
    stored?.command === "copy" ? stored : { id: randomUUID(), startedAt: at(), command: "copy" };
  if (stored !== run) await state.set("run", run, at());
  if ((await state.get("marks")) === null)
    await state.set("marks", await takeMarks(source, now), at());
  if (sample) {
    await state.set(
      "sample",
      {
        accounts: [...sample.accounts].sort(),
        surveys: [...sample.surveys].sort(),
        projects: [...sample.projects].sort(),
      },
      at(),
    );
  }
  const checkpoints = new Set(
    (await state.keys(CHECKPOINT)).map((key) => key.slice(CHECKPOINT.length)),
  );
  const toCopy = (surveyId: string) => options.full === true || !checkpoints.has(surveyId);
  const wanted = (surveyId: string) => !sample || sample.surveys.has(surveyId);

  // ---- The people the copied data names, and the projects ----
  // A checkpointed survey's history authors were named by the run that copied it.
  const { legacyUsers, projects, projectsWithoutMembers, ...mapped } = await collectNamed(source, {
    ...(sample && { sample }),
    report,
    runStart: run.startedAt,
    readsHistory: toCopy,
  });
  const projectIds = new Set(projects.map(({ project }) => project.id));
  const { skipped } = await target.upsertPeople(mapped.people);
  const skippedIds = new Set(skipped.map(({ id }) => id));
  for (const { id, reason } of skipped) report.skip("person", { userId: id }, reason);
  const people = mapped.people.filter((person) => !skippedIds.has(person.id));
  const keys = mapped.keys.filter((key) => !skippedIds.has(key.userId));
  await write("person", people);
  await target.upsertKeys(keys);
  await write("key", keys);
  const peopleIds = new Set(people.map((person) => person.id));
  progress(`people: ${people.length}, keys: ${keys.length}`);

  for (const { project, members } of projects) {
    await target.upsertProject(project, members);
    await write("project", [project]);
    await write("member", members);
  }
  progress(`projects: ${projects.length}`);

  // ---- Survey by survey ----
  const ctx = {
    projects: projectIds,
    projectsWithoutMembers,
    people: peopleIds,
    legacyUsers,
    report,
  };
  const copied = new Set<string>();
  const linked = new Set<string>();
  let responseBatches = 0;

  /** The legacy files the records link, each once per run: bytes first, then the row. */
  async function copyLinkedFiles(surveyId: string, links: { kind: FileKind; name: string }[]) {
    for (const { kind, name } of links) {
      const key = `${kind}/${name}`;
      if (linked.has(key)) continue;
      linked.add(key);
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

  async function copySurvey(row: Parameters<typeof mapSurvey>[0]): Promise<boolean> {
    const surveyId = row.id.toLowerCase();
    const [definitionText, permissionsText, columnsText] = await Promise.all([
      source.definitionText(surveyId),
      source.permissionsText(surveyId),
      source.layoutText(surveyId, "columns"),
    ]);
    const rec: SurveyRec | null = mapSurvey(row, definitionText, permissionsText, columnsText, ctx);
    if (rec === null) return false;
    // Rewriting a survey: its checkpoint goes first, so a run stopped inside it copies it again.
    if (checkpoints.has(surveyId)) await state.delete(`${CHECKPOINT}${surveyId}`);
    // Until the responses are read, the list also keeps what is stored (a re-copy never makes
    // a survey's answers more public mid-way); after them, the full list replaces it.
    const stored = await target.privateQuestionsOf(surveyId);
    const interim = [...new Set([...rec.privateQuestions, ...stored])];
    await target.upsertSurvey({ ...rec, privateQuestions: interim });
    const links = [...fileLinks(rec.definition), ...fileLinks(rec.theme)];

    const history = mapHistory(
      surveyId,
      await source.historyNewest(surveyId, HISTORY_KEEP),
      report,
    );
    await target.upsertHistory(history);
    await target.pruneHistory(surveyId, HISTORY_KEEP);
    await write("history", history);
    for (const entry of history) links.push(...fileLinks(entry.snapshot));

    const layouts: LayoutRec[] = [];
    for (const kind of LAYOUT_KINDS) {
      const text = kind === "columns" ? columnsText : await source.layoutText(surveyId, kind);
      if (text !== null) layouts.push({ surveyId, kind, text });
    }
    await target.upsertLayouts(layouts);
    await write("layout", layouts);

    // Responses in batches; their keys are answer names the privacy rule must cover too.
    const answerNames = new Set<string>();
    const responses = batcher<ResponseRec>(size, async (batch) => {
      await target.upsertResponses(batch);
      await write("response", batch);
      responseBatches += 1;
      if (options.failAfter !== undefined && responseBatches >= options.failAfter) {
        throw new Error(`Stopped after ${responseBatches} batches of responses (failAfter)`);
      }
    });
    for await (const entity of source.responses(rec.record.postId)) {
      const response = mapResponse(surveyId, entity, report);
      if (response === null) continue;
      for (const name of Object.keys(response.response.data)) answerNames.add(name);
      links.push(...fileLinks(response.response.data));
      await responses.add(response);
    }
    await responses.flush();

    const markers = batcher<MarkerRec>(size, async (batch) => {
      await target.upsertMarkers(batch);
      await write("marker", batch);
    });
    for await (const marker of source.markers(surveyId)) {
      await markers.add({ surveyId, clientId: marker.clientId, partial: marker.partial });
    }
    await markers.flush();

    const deleted = batcher<DeletedRec>(size, async (batch) => {
      await target.upsertDeleted(batch);
      await write("deleted", batch);
    });
    for await (const copy of source.deletedCopies(rec.record.postId)) {
      const mappedCopy = mapDeleted(surveyId, copy, report);
      if (mappedCopy !== null) await deleted.add(mappedCopy);
    }
    await deleted.flush();

    // The private questions again with the response keys (notes were made the first time).
    const final =
      mapSurvey(row, definitionText, permissionsText, columnsText, {
        ...ctx,
        extraAnswerNames: answerNames,
        report: createReport(),
      }) ?? rec;
    // Exactly the computed list, in its order, so a resumed survey stores what a whole run does.
    if (!sameList(final.privateQuestions, interim)) await target.upsertSurvey(final);
    await write("survey", [final]);

    await copyLinkedFiles(surveyId, links);
    await state.set(`${CHECKPOINT}${surveyId}`, { copiedAt: at() }, at());
    return true;
  }

  let done = 0;
  for await (const row of source.surveys()) {
    const surveyId = row.id.toLowerCase();
    if (!wanted(surveyId)) continue;
    if (!toCopy(surveyId)) {
      copied.add(surveyId);
      continue;
    }
    if (await copySurvey(row)) copied.add(surveyId);
    done += 1;
    if (done % PROGRESS_EVERY === 0) progress(`surveys: ${done}`);
  }
  progress(`surveys: ${done} copied, ${copied.size - done} from earlier runs`);

  // ---- Events, users' views, the app's own files ----
  const events = batcher<EventRec>(size, async (batch) => {
    await target.upsertEvents(batch);
    await write("event", batch);
  });
  for await (const event of source.events()) {
    const surveyId = event.surveyId.toLowerCase();
    if (sample && !copied.has(surveyId)) continue;
    if (!isGuid(event.id) || !isGuid(event.surveyId)) {
      report.skip("event", { eventId: event.id.toLowerCase(), surveyId }, "an id is not a GUID");
      continue;
    }
    await events.add({
      id: event.id.toLowerCase(),
      surveyId,
      type: event.type,
      at: event.at.toISOString(),
      payload: Object.keys(event.rest).length > 0 ? JSON.stringify(event.rest) : null,
    });
  }
  await events.flush();

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
    const content = await source.appFile(blob.blobName);
    if (content === null) continue;
    const file = {
      kind: record.kind,
      legacyName: null,
      record: { ...record, size: content.length } as SurveyFileRecord,
      content,
    };
    await target.upsertFile(file);
    await write("file", [file]);
  }
  progress("done");
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((name, i) => name === b[i]);
