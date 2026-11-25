/**
 * What a run skipped or noted, by ids only: never names, emails or content (rule 6). The caller
 * (the command layer) writes `toJSON()` where `--report` points.
 */
export interface Report {
  /** A row left out of the copy. */
  skip(entity: string, ids: Record<string, string>, reason: string): void;
  /** Something the owners should know that did not stop a row. */
  note(kind: string, ids: Record<string, string>): void;
  /** `verify`: the check compared `compared` more items (a check with no difference passes). */
  checked(check: string, compared: number): void;
  /** `verify`: the target differs from the source as of the marks; `counts` are numbers only. */
  difference(check: string, ids: Record<string, string>, counts?: Record<string, number>): void;
  /** `verify`: changed in the source after the marks, so not compared; never a failure. */
  pending(check: string, ids: Record<string, string>): void;
  /** Counts by `skipped:{entity}`, by note kind, and by `difference:` and `pending:{check}`. */
  counts(): Record<string, number>;
  toJSON(): unknown;
}

interface Finding {
  check: string;
  ids: Record<string, string>;
  counts?: Record<string, number>;
}

export function createReport(): Report {
  const skipped: { entity: string; ids: Record<string, string>; reason: string }[] = [];
  const notes: { kind: string; ids: Record<string, string> }[] = [];
  const checks = new Map<string, { compared: number; differences: number; pending: number }>();
  const differences: Finding[] = [];
  const pending: Finding[] = [];
  const checkOf = (check: string) => {
    let found = checks.get(check);
    if (!found) checks.set(check, (found = { compared: 0, differences: 0, pending: 0 }));
    return found;
  };
  const counts = (): Record<string, number> => {
    const result: Record<string, number> = {};
    const add = (key: string) => (result[key] = (result[key] ?? 0) + 1);
    for (const { entity } of skipped) add(`skipped:${entity}`);
    for (const { kind } of notes) add(kind);
    for (const { check } of differences) add(`difference:${check}`);
    for (const { check } of pending) add(`pending:${check}`);
    return result;
  };
  return {
    skip: (entity, ids, reason) => void skipped.push({ entity, ids: { ...ids }, reason }),
    note: (kind, ids) => void notes.push({ kind, ids: { ...ids } }),
    checked: (check, compared) => void (checkOf(check).compared += compared),
    difference(check, ids, numbers) {
      checkOf(check).differences += 1;
      differences.push({ check, ids: { ...ids }, ...(numbers && { counts: { ...numbers } }) });
    },
    pending(check, ids) {
      checkOf(check).pending += 1;
      pending.push({ check, ids: { ...ids } });
    },
    counts,
    toJSON: () => ({
      counts: counts(),
      skipped,
      notes,
      ...(checks.size > 0 && {
        checks: Object.fromEntries(
          [...checks].map(([check, c]) => [check, { ...c, pass: c.differences === 0 }]),
        ),
        differences,
        pending,
      }),
    }),
  };
}
