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
