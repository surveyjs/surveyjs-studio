import type { Report } from "./map/report.js";
import type { LegacySource } from "./source/index.js";
import type { SqlTable } from "./source/sql.js";

/**
 * Where `delta` starts reading: per part of the source, the time from which a change counts as
 * new. Each part is judged by its own clock, never by the tool's: the SQL tables by their
 * `[timestamp]` column (written by the old app, so the latest one stands for its clock), the
 * Azure tables and blobs by their storage service's clock (which stamps their change times).
 * Every mark is taken a safety margin back, so a write in flight when the marks were taken, or a
 * clock a little behind, is read again rather than missed.
 */
export interface HighWaterMarks {
  /** The tool's clock when the marks were taken (for the operator; nothing is judged by it). */
  takenAt: string;
  sql: { users: string; surveys: string; organizations: string; organizationUsers: string };
  tables: string;
  blobs: string;
}

/** How far back of the source's clocks the marks are taken. */
export const MARKS_MARGIN_MS = 5 * 60_000;

const EPOCH = new Date(0).toISOString();

/**
 * The marks of the source now: each SQL table's latest change time, but never later than the SQL
 * server's own clock (a row stamped in the future would otherwise hold the mark ahead and hide
 * every real change; noted), and the storage services' clocks (the tool's own when a service
 * gives none or is ahead of it), all minus the margin. An empty table starts at the epoch.
 * `marginMs` other than the default is for tests.
 */
export async function takeMarks(
  source: LegacySource,
  now: () => Date,
  options: { marginMs?: number; report?: Report } = {},
): Promise<HighWaterMarks> {
  const marginMs = options.marginMs ?? MARKS_MARGIN_MS;
  const takenAt = now();
  const [latest, tablesClock, blobsClock] = await Promise.all([
    source.latestChanges(),
    source.tablesClock(),
    source.blobsClock(),
  ]);
  const back = (at: Date) => new Date(at.getTime() - marginMs).toISOString();
  const sqlMark = (table: SqlTable) => {
    const at = latest[table];
    if (at === null) return EPOCH;
    if (at.getTime() <= latest.now.getTime()) return back(at);
    options.report?.note("future_change_time", { table });
    return back(latest.now);
  };
  const clockMark = (service: Date | null) =>
    back(service !== null && service.getTime() < takenAt.getTime() ? service : takenAt);
  return {
    takenAt: takenAt.toISOString(),
    sql: {
      users: sqlMark("users"),
      surveys: sqlMark("surveys"),
      organizations: sqlMark("organizations"),
      organizationUsers: sqlMark("organizationUsers"),
    },
    tables: clockMark(tablesClock),
    blobs: clockMark(blobsClock),
  };
}

/** Whether a stored value holds every part of the marks (an earlier run kept the time only). */
export function isCompleteMarks(value: unknown): value is HighWaterMarks {
  if (typeof value !== "object" || value === null) return false;
  const marks = value as Partial<HighWaterMarks>;
  const sql = marks.sql;
  return (
    typeof marks.tables === "string" &&
    typeof marks.blobs === "string" &&
    typeof sql === "object" &&
    sql !== null &&
    ["users", "surveys", "organizations", "organizationUsers"].every(
      (table) => typeof (sql as Record<string, unknown>)[table] === "string",
    )
  );
}

/** Which part of the source a change time comes from: one SQL table, the tables or the blobs. */
export type SourceStore = keyof HighWaterMarks["sql"] | "tables" | "blobs";

/**
 * Whether a source change at `at` came after the marks, so `verify` lists it as pending rather
 * than a difference (and `delta` reads it). A missing time is no change after the marks.
 */
export function changedAfterMarks(
  marks: HighWaterMarks,
  store: SourceStore,
  at: Date | string | null | undefined,
): boolean {
  if (at === null || at === undefined) return false;
  const time = typeof at === "string" ? Date.parse(at) : at.getTime();
  return Number.isFinite(time) && time > markOf(marks, store).getTime();
}

/**
 * The time a store's changes count from: after it is after the marks, and what `delta` passes
 * to the source's `since` filters. Inclusive at the mark: for tables, the millisecond before it;
 * for blobs, the last millisecond before the mark's second (blob times are whole seconds, so a
 * blob of that second may be newer than the mark). SQL rows compare to the mark itself: their
 * times are the old app's, and the margin covers a row stamped just before the marks.
 */
export function markOf(marks: HighWaterMarks, store: SourceStore): Date {
  if (store === "tables") return new Date(Date.parse(marks.tables) - 1);
  if (store === "blobs") return new Date(Math.floor(Date.parse(marks.blobs) / 1000) * 1000 - 1);
  return new Date(Date.parse(marks.sql[store]));
}
