// The CSV of `exportSurveyResults` (reference behaviour: ADR 0040): every column of the old result
// calculation (columns.ts), whatever its visibility, under its title; one line per response,
// newest first; values in the old server's en-US texts; UTF-8 with a BOM, and the header only when
// there is a response. One deliberate difference (ADR 0040 point 1): a cell holding a comma, a
// quote or a line break is quoted, where the old export only doubled its quotes.
import {
  dotnetDouble,
  JsonNumber,
  oldJson,
  parseOldDate,
  type OldDateTime,
} from "./dotnet-format.js";

/** A column of the old calculation: the answer it shows and its title. */
export interface CsvColumn {
  readonly Name: string;
  readonly DisplayName: string | null;
}

/** A response as Studio's `listResults` gives it, its answers parsed by `parseStudioJson`. */
export interface CsvRow {
  readonly submittedAt: string;
  readonly data: Record<string, unknown>;
  readonly clientId?: string;
  readonly respondentIp?: string;
}

const BOM = "\uFEFF";
/** The old server's line end (a Windows host). */
const NEWLINE = "\r\n";

/** A cell or title as written: quoted when it holds `,`, `"` or a line break, its quotes doubled. */
export function csvField(text: string | null): string {
  if (text === null || text === "") return "";
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A time as the old server's en-US text: `M/d/yyyy h:mm:ss AM`, the fraction dropped. */
function usDateTime(date: OldDateTime): string {
  const at = new Date(date.ms);
  const hour = at.getUTCHours();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${at.getUTCMonth() + 1}/${at.getUTCDate()}/${String(at.getUTCFullYear()).padStart(4, "0")} ` +
    `${hour % 12 === 0 ? 12 : hour % 12}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} ` +
    (hour < 12 ? "AM" : "PM")
  );
}

/** A number's text as the old server wrote it: integers as read, doubles shortest, no `.0`. */
function numberText(text: string): string {
  if (/[.eE]/.test(text)) return dotnetDouble(Number(text));
  return text === "-0" ? "0" : text;
}

/**
 * A value (parsed by `parseStudioJson`) as the old export wrote a cell: nothing for none; a
 * date-like text as the en-US date it was read as; `True`/`False`; numbers in the old forms; any
 * other text as it is; lists and objects as compact JSON.
 */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const date = parseOldDate(value);
    return date === null ? value : usDateTime(date);
  }
  if (typeof value === "boolean") return value ? "True" : "False";
  if (value instanceof JsonNumber) return numberText(value.text);
  if (typeof value === "number")
    return Number.isInteger(value) ? String(value) : dotnetDouble(value);
  return oldJson(value);
}

/** The time a response was submitted, as the old export wrote it: en-US, with the zero offset. */
export function submittedText(submittedAt: string): string {
  const date = parseOldDate(submittedAt);
  if (date === null) throw new Error("Studio sent a time the bridge cannot read");
  return `${usDateTime(date)} +00:00`;
}

/** The old row's value for a column: Studio's own fields, then the answer by name or in lower case. */
function valueOf(row: CsvRow, name: string): unknown {
  switch (name) {
    case "HappendAt":
      return submittedText(row.submittedAt);
    case "IPAddress":
      return row.respondentIp;
    case "ClientId":
      return row.clientId;
    default:
      for (const key of [name, name.toLowerCase()])
        if (Object.hasOwn(row.data, key)) return row.data[key];
      return undefined;
  }
}

/** The CSV file: a BOM, then (with responses) the header and one line per response, in order. */
export function csvExport(columns: readonly CsvColumn[], rows: readonly CsvRow[]): Buffer {
  const lines: string[] = [];
  if (rows.length > 0) {
    lines.push(columns.map((column) => csvField(column.DisplayName)).join(","));
    for (const row of rows) {
      lines.push(columns.map((column) => csvField(cellText(valueOf(row, column.Name)))).join(","));
    }
  }
  const text = lines.map((line) => `${line}${NEWLINE}`).join("");
  return Buffer.from(`${BOM}${text}`, "utf8");
}
