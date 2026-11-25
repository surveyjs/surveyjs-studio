import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import type {
  DeletedRec,
  EventRec,
  FileRec,
  HistoryRec,
  KeyRec,
  LayoutRec,
  MarkerRec,
  MemberRec,
  PersonRec,
  ProjectRec,
  ResponseRec,
  SurveyRec,
  ViewRec,
} from "./records.js";

/** The records by kind, as `--dump` names them. */
export interface DumpRecords {
  survey: SurveyRec;
  history: HistoryRec;
  response: ResponseRec;
  marker: MarkerRec;
  layout: LayoutRec;
  view: ViewRec;
  project: ProjectRec;
  member: MemberRec;
  person: PersonRec;
  key: KeyRec;
  file: FileRec;
  event: EventRec;
  deleted: DeletedRec;
}
export type DumpKind = keyof DumpRecords;

/**
 * Where `--dump` writes: one JSON line per record the copy writes, `{ kind, id, record }`. The
 * records are complete (answers, definitions, emails, file bytes in base64), so a dump of
 * production data is private and goes only where `--dump` points.
 */
export interface DumpWriter {
  write<K extends DumpKind>(kind: K, record: DumpRecords[K]): Promise<void>;
  close(): Promise<void>;
}

/** The id of a record within its kind (its primary key, parts joined by `/`). */
export function dumpIdOf<K extends DumpKind>(kind: K, record: DumpRecords[K]): string {
  const r = record as DumpRecords[DumpKind];
  switch (kind) {
    case "survey":
      return (r as SurveyRec).record.id;
    case "history":
      return `${(r as HistoryRec).surveyId}/${(r as HistoryRec).id}`;
    case "response":
      return `${(r as ResponseRec).surveyId}/${(r as ResponseRec).response.id}`;
    case "marker":
      return `${(r as MarkerRec).surveyId}/${(r as MarkerRec).clientId}`;
    case "layout":
      return `${(r as LayoutRec).surveyId}/${(r as LayoutRec).kind}`;
    case "view": {
      const view = r as ViewRec;
      return `${view.surveyId}/${view.userId}/${view.view}`;
    }
    case "member":
      return `${(r as MemberRec).projectId}/${(r as MemberRec).userId}`;
    case "key":
      return (r as KeyRec).userId;
    case "file":
      return (r as FileRec).record.id;
    case "deleted":
      return `${(r as DeletedRec).surveyId}/${(r as DeletedRec).responseId}`;
    default:
      return (r as ProjectRec | PersonRec | EventRec).id;
  }
}

/** The JSON form of a record: file bytes as base64. */
function jsonOf(kind: DumpKind, record: unknown): unknown {
  if (kind !== "file") return record;
  const file = record as FileRec;
  return { ...file, content: file.content.toString("base64") };
}

/** A dump appended to `records.ndjson` in `dir` (made when missing), so a resumed run adds to it. */
export function openDumpWriter(dir: string): DumpWriter {
  mkdirSync(dir, { recursive: true });
  const out = createWriteStream(join(dir, "records.ndjson"), { flags: "a", encoding: "utf8" });
  let failed: unknown = null;
  out.on("error", (error) => {
    failed = error;
  });
  return {
    async write(kind, record) {
      if (failed !== null) throw failed;
      const line = JSON.stringify({
        kind,
        id: dumpIdOf(kind, record),
        record: jsonOf(kind, record),
      });
      if (!out.write(`${line}\n`)) await once(out, "drain");
    },
    async close() {
      out.end();
      await once(out, "finish");
      if (failed !== null) throw failed;
    },
  };
}
