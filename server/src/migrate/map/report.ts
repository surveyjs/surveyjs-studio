/**
 * What a run skipped or noted, by ids only: never names, emails or content (rule 6). The caller
 * (the command layer) writes `toJSON()` where `--report` points.
 */
export interface Report {
  /** A row left out of the copy. */
  skip(entity: string, ids: Record<string, string>, reason: string): void;
  /** Something the owners should know that did not stop a row. */
  note(kind: string, ids: Record<string, string>): void;
  /** Counts by `skipped:{entity}` and by note kind. */
  counts(): Record<string, number>;
  toJSON(): unknown;
}

export function createReport(): Report {
  const skipped: { entity: string; ids: Record<string, string>; reason: string }[] = [];
  const notes: { kind: string; ids: Record<string, string> }[] = [];
  const counts = (): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const { entity } of skipped) {
      result[`skipped:${entity}`] = (result[`skipped:${entity}`] ?? 0) + 1;
    }
    for (const { kind } of notes) result[kind] = (result[kind] ?? 0) + 1;
    return result;
  };
  return {
    skip: (entity, ids, reason) => void skipped.push({ entity, ids: { ...ids }, reason }),
    note: (kind, ids) => void notes.push({ kind, ids: { ...ids } }),
    counts,
    toJSON: () => ({ counts: counts(), skipped, notes }),
  };
}
