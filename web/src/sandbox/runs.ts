// Mirrors foldRuns, runHolding and responseOfRun of server/src/providers/runs.ts (ADR 0038 point 2): the
// sandbox does not import server/src. Keep the two in step.
import type { SandboxResponse } from "./seed-types";

/**
 * Runs of rows given in submission order: one client's partial rows followed by the next complete
 * row, if any. A complete row with no partial row before it is a run of its own; rows without a
 * client id are never folded. Ordered by the run's first row.
 */
export function foldRuns<T extends Pick<SandboxResponse, "clientId" | "partial">>(
  rows: readonly T[],
): T[][] {
  const runs: T[][] = [];
  /** Each client's run that has no complete row yet. */
  const open = new Map<string, T[]>();
  for (const row of rows) {
    if (row.clientId === undefined) {
      runs.push([row]);
      continue;
    }
    let run = open.get(row.clientId);
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push(row);
    if (row.partial) open.set(row.clientId, run);
    else open.delete(row.clientId);
  }
  return runs;
}

/** The run `runHolding` found. */
export interface HeldRun<T> {
  /** Every row of the run, in submission order. */
  readonly run: T[];
  /** Whether the run's client has a later run among the rows given (its marker then stays). */
  readonly laterRun: boolean;
}

/**
 * The run of `rows` (given in submission order) that holds the row `id`, compared
 * case-insensitively; null when no row has that id. Any row of the run finds it (ADR 0040 point 3).
 */
export function runHolding<T extends Pick<SandboxResponse, "id" | "clientId" | "partial">>(
  rows: readonly T[],
  id: string,
): HeldRun<T> | null {
  const key = id.toLowerCase();
  const runs = foldRuns(rows);
  const index = runs.findIndex((run) => run.some((row) => row.id.toLowerCase() === key));
  const run = runs[index];
  if (!run) return null;
  const clientId = run[0]?.clientId;
  const laterRun =
    clientId !== undefined &&
    runs.slice(index + 1).some((other) => other[0]?.clientId === clientId);
  return { run, laterRun };
}

/** The response a run reads as: the first row's id and time, the rows' data merged in order. */
export function responseOfRun(run: readonly SandboxResponse[]): SandboxResponse {
  const first = run[0];
  const last = run.at(-1);
  if (!first || !last) throw new Error("A run has at least one row.");
  let data: Record<string, unknown> = {};
  let respondentIp: string | undefined;
  for (const row of run) {
    data = { ...data, ...row.data };
    if (row.respondentIp !== undefined) respondentIp = row.respondentIp;
  }
  return {
    id: first.id,
    submittedAt: first.submittedAt,
    data: structuredClone(data),
    ...(first.clientId === undefined ? {} : { clientId: first.clientId }),
    ...(respondentIp === undefined ? {} : { respondentIp }),
    partial: last.partial,
  };
}
