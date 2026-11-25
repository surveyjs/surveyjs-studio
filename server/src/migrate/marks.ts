import type { LegacySource } from "./source/index.js";

/**
 * Where `delta` starts reading: the source's latest change times when `copy` started. Until the
 * marks are built (hosted Step 9, Task 7) only `takenAt` is filled; the other parts are optional
 * here and become required with them.
 */
export interface HighWaterMarks {
  takenAt: string;
  sql?: { users: string; surveys: string; organizations: string; organizationUsers: string };
  tables?: string;
  blobs?: string;
}

/** The marks of the source now. Stub: the time only (Task 7 reads the source's change times). */
export function takeMarks(_source: LegacySource, now: () => Date): Promise<HighWaterMarks> {
  return Promise.resolve({ takenAt: now().toISOString() });
}

/** Which part of the source a change time comes from: its SQL rows, tables or blobs. */
export type SourceStore = "sql" | "tables" | "blobs";

/**
 * Whether a source change at `at` came after the marks, so `verify` lists it as pending rather
 * than a difference. Until the marks hold each store's own change time (Task 7) every store is
 * judged by `takenAt`. Blob times are whole seconds, so a blob changed in the second of the marks
 * counts as after them. A missing time is no change after the marks.
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
 * The time a store's changes count from: after it is after the marks. For blobs, the last
 * millisecond before the marks' second (blob times are whole seconds); `changedBlobs` takes it.
 */
export function markOf(marks: HighWaterMarks, store: SourceStore): Date {
  const taken = Date.parse(marks.takenAt);
  return new Date(store === "blobs" ? Math.floor(taken / 1000) * 1000 - 1 : taken);
}
