// The caller log (ADR 0041 point 5): the bridge writes one line per request (`msg: "request"`,
// the action, and the caller's key only as a hash prefix); `bridge-callers` (cli/callers.ts) sums
// such lines into one row per day, key prefix and action, so the callers still using an action
// can be found without a metric label per key.
import { createHash } from "node:crypto";

/**
 * The first 16 hex digits of the key's hash as Studio stores it (`hashCredential`): SHA-256 of an
 * `sjs_` API token as sent, of any other (legacy) key lower-cased.
 */
export function keyHashPrefix(key: string): string {
  const exact = key.startsWith("sjs_") ? key : key.toLowerCase();
  return createHash("sha256").update(exact).digest("hex").slice(0, 16);
}

export interface CallerRow {
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
  /** The key's hash prefix; `""` for requests without a key. */
  key: string;
  action: string;
  count: number;
  /** The first and the last request's time, ISO 8601. */
  first: string;
  last: string;
}

/** A request line's fields `summarizeCallers` reads; `undefined` for any other line. */
function requestLine(text: string): { time: number; key: string; action: string } | undefined {
  let entry: unknown;
  try {
    entry = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof entry !== "object" || entry === null) return undefined;
  const { msg, time, action, key } = entry as Record<string, unknown>;
  if (msg !== "request" || typeof action !== "string") return undefined;
  // A Date holds up to 8.64e15 ms either side of 1970.
  if (typeof time !== "number" || !(Math.abs(time) <= 8.64e15)) return undefined;
  if (key !== undefined && typeof key !== "string") return undefined;
  return { time, key: key ?? "", action };
}

export interface CallerSummary {
  /** Counts one log line; a line that is not a request line is skipped. */
  add(text: string): void;
  /** The rows so far, sorted by day, key and action. */
  rows(): CallerRow[];
}

/**
 * Sums the bridge's request lines (pino's JSON, its `time` in milliseconds) one at a time into one
 * row per UTC day, key prefix and action, so a long log is never held in memory.
 */
export function createCallerSummary(): CallerSummary {
  const rows = new Map<string, CallerRow>();
  return {
    add(text) {
      const line = requestLine(text);
      if (line === undefined) return;
      // ISO 8601 times in UTC compare as strings.
      const at = new Date(line.time).toISOString();
      const day = at.slice(0, 10);
      const id = JSON.stringify([day, line.key, line.action]);
      const row = rows.get(id);
      if (row === undefined) {
        rows.set(id, { day, key: line.key, action: line.action, count: 1, first: at, last: at });
        return;
      }
      row.count += 1;
      if (at < row.first) row.first = at;
      if (at > row.last) row.last = at;
    },
    rows() {
      const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
      return [...rows.values()]
        .map((row) => ({ ...row }))
        .sort(
          (a, b) => compare(a.day, b.day) || compare(a.key, b.key) || compare(a.action, b.action),
        );
    },
  };
}

/**
 * One row per UTC day, key prefix and action of the bridge's request lines, sorted by day, key and
 * action. Other lines are skipped.
 */
export function summarizeCallers(lines: Iterable<string>): CallerRow[] {
  const summary = createCallerSummary();
  for (const text of lines) summary.add(text);
  return summary.rows();
}

/** A CSV field: quoted when it holds a comma, a quote or a line break. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The rows as CSV, header `day,key,action,count,first,last`, each line ending in `\n`. */
export function toCsv(rows: readonly CallerRow[]): string {
  const lines = [["day", "key", "action", "count", "first", "last"].join(",")];
  for (const row of rows) {
    lines.push(
      [row.day, row.key, row.action, row.count, row.first, row.last].map(csvField).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
