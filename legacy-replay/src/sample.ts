// The replay's input (ADR 0041 point 3): a sample of the old service's requests as a neutral
// RFC 4180 CSV with the columns `time,method,path,query,status` in any order, `query` without its
// `?`. The query that makes it is kept in the private location; this code knows no other names.
// Errors name a line or a column, never a field's content (a query can hold a key).

export interface SampleRow {
  /** When the old service answered it, as recorded (ISO 8601 for `--since`). */
  time: string;
  /** As recorded; `classify` reads it in any letter case. */
  method: string;
  path: string;
  /** The query string without `?`; `""` for none. */
  query: string;
  /** The old service's recorded status. */
  status: number;
}

/** A sample the command cannot read: a usage error. */
export class SampleError extends Error {}

const COLUMNS = ["time", "method", "path", "query", "status"] as const;

/** The records of an RFC 4180 text, each with the line it starts on. */
function records(text: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = () => {
    fields.push(field);
    // A blank line (or the end after a final line end) is no record.
    if (!(fields.length === 1 && fields[0] === "")) out.push({ line: start, fields });
    fields = [];
    field = "";
  };
  while (i < text.length) {
    const char = text[i];
    if (char === '"' && field === "") {
      // A quoted field: up to the quote not followed by another.
      i += 1;
      for (;;) {
        if (i >= text.length) throw new SampleError("the sample ends inside a quoted field");
        const inner = text[i];
        if (inner === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        if (inner === "\n") line += 1;
        field += inner;
        i += 1;
      }
    } else if (char === ",") {
      fields.push(field);
      field = "";
      i += 1;
    } else if (char === "\r" && text[i + 1] === "\n") {
      endRecord();
      i += 2;
      line += 1;
      start = line;
    } else if (char === "\n") {
      endRecord();
      i += 1;
      line += 1;
      start = line;
    } else {
      field += char;
      i += 1;
    }
  }
  if (field !== "" || fields.length > 0) endRecord();
  return out;
}

/** The sample's rows, in order. Throws a `SampleError` for a missing or unknown column or a bad row. */
export function readSample(csv: string): SampleRow[] {
  const [header, ...rows] = records(csv.startsWith("\uFEFF") ? csv.slice(1) : csv);
  const names = header?.fields ?? [];
  names.forEach((name, at) => {
    if (!(COLUMNS as readonly string[]).includes(name)) {
      // A headerless sample's first line is a record: its field is never echoed unless it looks like a name.
      const shown = /^[a-z_]{1,20}$/i.test(name) ? `"${name}"` : "that is not a column name";
      throw new SampleError(`the sample has a column ${shown} (want ${COLUMNS.join(",")})`);
    }
    if (names.indexOf(name) !== at) throw new SampleError(`the sample has two "${name}" columns`);
  });
  const index = {} as Record<(typeof COLUMNS)[number], number>;
  for (const column of COLUMNS) {
    const at = names.indexOf(column);
    if (at < 0) throw new SampleError(`the sample has no "${column}" column`);
    index[column] = at;
  }
  return rows.map(({ line, fields }) => {
    if (fields.length !== names.length) {
      throw new SampleError(`line ${line} has ${fields.length} fields, the header ${names.length}`);
    }
    const field = (column: (typeof COLUMNS)[number]) => fields[index[column]] ?? "";
    const status = field("status");
    if (!/^\d+$/.test(status)) throw new SampleError(`line ${line}: status is not a number`);
    return {
      time: field("time"),
      method: field("method"),
      path: field("path"),
      query: field("query"),
      status: Number(status),
    };
  });
}
