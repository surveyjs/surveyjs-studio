import type { SurveyResponse } from "../domain/types.js";
import { isAfterResponse } from "./ordering.js";
import type { ResponsePage, ResponsePageQuery, ResponsePosition } from "./types.js";

/**
 * Runs (ADR 0038 point 2): one client's rows in submission order fold into runs of one or more
 * partial rows followed by the next complete row, if any. A complete row with no partial row
 * before it is a run of its own; rows without a client id are never folded. A run reads as one
 * response and takes its place in the list from its first row.
 */

/** What folding needs of a row. */
export interface PlacedRow {
  readonly id: string;
  readonly submittedAt: string;
  readonly clientId?: string;
  readonly partial: boolean;
}

/** Runs of rows given in submission order, ordered by their first row (ADR 0038 point 2). */
export function foldRuns<T extends PlacedRow>(rows: readonly T[]): T[][] {
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
export interface HeldRun<T extends PlacedRow> {
  /** Every row of the run, in submission order. */
  readonly run: T[];
  /**
   * Whether the run's client has a later run among the rows given. Its completion marker then
   * describes that later run and stays when this one is deleted (`ResultStore.deleteResponse`).
   */
  readonly laterRun: boolean;
}

/**
 * The run of `rows` (given in submission order) that holds the row `id`, compared
 * case-insensitively; null when no row has that id. Any row of the run finds it: callers hold the
 * ids of first, middle or last saves (ADR 0040 point 3, `deleteResponse`).
 */
export function runHolding<T extends PlacedRow>(rows: readonly T[], id: string): HeldRun<T> | null {
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

/** The response a run reads as. */
export function responseOfRun(run: readonly SurveyResponse[]): SurveyResponse {
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
    // A copy: the stores hand the response to callers, who must not reach the stored rows.
    data: structuredClone(data),
    ...(first.clientId === undefined ? {} : { clientId: first.clientId }),
    ...(respondentIp === undefined ? {} : { respondentIp }),
    partial: last.partial,
  };
}

/** The times a page's responses are placed within (ResponsePageQuery `from` and `till`). */
export type ResponseWindow = Pick<ResponsePageQuery, "from" | "till">;

/**
 * Whether a row placed at `submittedAt` is inside the window: strictly after `from` and strictly
 * before `till`, compared as instants (so a bound written with an offset or without milliseconds
 * still matches).
 */
export function isInWindow(submittedAt: string, window: ResponseWindow): boolean {
  const at = Date.parse(submittedAt);
  if (window.from !== undefined && !(at > Date.parse(window.from))) return false;
  return window.till === undefined || at < Date.parse(window.till);
}

/** Rows a page of runs reads from (the SQL store; memory and Azure fold all rows directly). */
export interface RunRows {
  /**
   * Rows strictly after `after` and inside `window`, in submission order, at most `limit`: the
   * read starts at the later of `after` and `from` and stops before `till`.
   */
  rowsAfter(
    after: ResponsePosition | undefined,
    limit: number,
    window: ResponseWindow,
  ): Promise<SurveyResponse[]>;
  /** Every row of those of `clientIds` that have at least one partial row, in submission order. */
  partialClientRows(clientIds: readonly string[]): Promise<SurveyResponse[]>;
}

const positionOf = (row: PlacedRow): ResponsePosition => ({
  submittedAt: row.submittedAt,
  id: row.id,
});

/** Whether the run has a complete row (its last row is the only one that can be complete). */
const isComplete = (run: readonly PlacedRow[]): boolean => run.at(-1)?.partial === false;

/**
 * A page of responses, each a run placed at its first row: runs that start after `after` and
 * inside `from`–`till`, with `completedOnly` applied, at most `limit`. Reads rows in chunks of
 * `limit + 1` and each read client's whole history once per call; a row that continues a run is
 * skipped, since the run's response was taken at its first row (on an earlier page, or before
 * `from`, which leaves the run out).
 */
export async function pageOfRuns(source: RunRows, query: ResponsePageQuery): Promise<ResponsePage> {
  const { after, limit, completedOnly = false, from, till } = query;
  const window: ResponseWindow = {
    ...(from !== undefined && { from }),
    ...(till !== undefined && { till }),
  };
  const chunk = limit + 1;
  const found: SurveyResponse[] = [];
  /** Clients asked for; each with its runs by first-row id, or null when it has no partial row. */
  const clients = new Map<string, Map<string, SurveyResponse[]> | null>();
  /** Every row id of the clients' histories as read, to spot a row stored after the read. */
  const known = new Set<string>();

  const askFor = async (clientIds: string[]): Promise<void> => {
    if (clientIds.length === 0) return;
    const rows = await source.partialClientRows(clientIds);
    const byClient = new Map<string, SurveyResponse[]>();
    for (const row of rows) {
      if (row.clientId === undefined) continue;
      known.add(row.id);
      const list = byClient.get(row.clientId);
      if (list) list.push(row);
      else byClient.set(row.clientId, [row]);
    }
    for (const clientId of clientIds) {
      const history = byClient.get(clientId);
      clients.set(
        clientId,
        history ? new Map(foldRuns(history).map((run) => [run[0]!.id, run])) : null,
      );
    }
  };

  let cursor = after;
  while (found.length < chunk) {
    const rows = await source.rowsAfter(cursor, chunk, window);
    if (rows.length === 0) break;
    const fresh = new Set<string>();
    for (const row of rows) {
      if (row.clientId === undefined) continue;
      const runs = clients.get(row.clientId);
      // Not asked for yet, or a row stored after the client's history was read: ask (again).
      if (runs === undefined || (runs !== null && !known.has(row.id))) fresh.add(row.clientId);
    }
    await askFor([...fresh]);
    for (const row of rows) {
      const runs = row.clientId === undefined ? null : (clients.get(row.clientId) ?? null);
      const run = runs ? runs.get(row.id) : [row];
      // Without a run starting at the row, the row continues a run taken already.
      if (!run || (completedOnly && !isComplete(run))) continue;
      found.push(responseOfRun(run));
      if (found.length === chunk) break;
    }
    if (rows.length < chunk) break;
    cursor = positionOf(rows.at(-1)!);
  }

  const items = found.slice(0, limit);
  const last = items.at(-1);
  return { items, next: found.length > limit && last ? positionOf(last) : null };
}

/**
 * Pages already-folded runs (memory; Azure on positions before reading full rows): runs whose
 * first row is after `after` and inside `from`–`till`, `completedOnly` applied, at most `limit`;
 * `next` as in ResponsePage.
 */
export function pageOfFoldedRuns<T extends PlacedRow>(
  runs: readonly T[][],
  query: ResponsePageQuery,
): { runs: T[][]; next: ResponsePosition | null } {
  const { after, limit, completedOnly = false } = query;
  const matching = runs.filter((run) => {
    const first = run[0];
    if (!first) return false;
    if (after && !isAfterResponse(first, after)) return false;
    if (!isInWindow(first.submittedAt, query)) return false;
    return !completedOnly || isComplete(run);
  });
  const page = matching.slice(0, limit);
  const last = page.at(-1)?.[0];
  return { runs: page, next: matching.length > page.length && last ? positionOf(last) : null };
}
