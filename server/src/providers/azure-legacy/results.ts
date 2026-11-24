import { odata, type TableClient, type TableEntityResult } from "@azure/data-tables";
import type { SurveyRecord, SurveyResponse } from "../../domain/types.js";
import { responseOrder } from "../ordering.js";
import { foldRuns, pageOfFoldedRuns, responseOfRun, runHolding, type PlacedRow } from "../runs.js";
import type { ResponsePosition, ResultStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import { UnmappableLegacyRowError, isGuid, responseFromLegacy } from "./mapping.js";
import type { LegacyResultEntity } from "./rows.js";
import {
  writeResponse,
  writeResponseDeletion,
  writeResultsDeletion,
  type DeletedResultRow,
  type LegacyWriteTargets,
} from "./writes.js";

/**
 * Results in the results account (layout sections 3.6 and 3.7): rows of `post{postId}` and
 * completion markers of `SurveyCompletion{surveyId}`, each name without dashes and in lower case.
 * A table that does not exist yet (before the first response) holds nothing.
 *
 * Reads only here (the folder is read-only by lint); appending calls writes.ts. Errors name the
 * operation and the driver's code only, never answers or client ids.
 */
export interface AzureResultStoreOptions {
  readonly targets: LegacyWriteTargets;
  /** `Surveys.publishid` of the survey, lower case; null when it has none or the row is gone. */
  readonly publishIdOf: (surveyId: string) => Promise<string | null>;
  /** Clock for the delete-all audit row. */
  readonly now: () => number;
  /** Maps each row; one the domain cannot represent is skipped and reported by its ids. */
  readonly mapRows: <R, T>(rows: readonly R[], map: (row: R) => T) => T[];
}

const dashless = (id: string): string => id.toLowerCase().replaceAll("-", "");

/** The row's id and time, as the mapping reads them; a row without them is unmappable. */
function placed(row: Record<string, unknown> & { rowKey?: string }): {
  id: string;
  happendat: Date;
} {
  const id = row.rowKey ?? "";
  if (!isGuid(id)) throw new UnmappableLegacyRowError({}, "row key is not a GUID");
  const { happendat } = row;
  if (!(happendat instanceof Date) || Number.isNaN(happendat.getTime())) {
    throw new UnmappableLegacyRowError({ responseId: id.toLowerCase() }, "unexpected column types");
  }
  return { id, happendat };
}

/** Whether `placed` accepts the row. */
function isPlaced(row: Record<string, unknown> & { rowKey?: string }): boolean {
  try {
    placed(row);
    return true;
  } catch (error) {
    if (error instanceof UnmappableLegacyRowError) return false;
    throw error;
  }
}

/** The row as the mapping reads it; a row of another shape is unmappable. */
function legacyEntity(row: TableEntityResult<Record<string, unknown>>): LegacyResultEntity {
  const { id, happendat } = placed(row);
  const { result, clientid, ipaddress, ispartialcompleted } = row;
  if (typeof result !== "string") {
    throw new UnmappableLegacyRowError({ responseId: id.toLowerCase() }, "unexpected column types");
  }
  return {
    id,
    happendat,
    result,
    ...(typeof clientid === "string" && { clientid }),
    ...(typeof ipaddress === "string" && { ipaddress }),
    ...(typeof ispartialcompleted === "boolean" && { ispartialcompleted }),
  };
}

/** A row's place in `responseOrder`: its time to the millisecond and its lower-case id. */
function positionOf(id: string, happendat: Date): ResponsePosition {
  return { submittedAt: happendat.toISOString(), id: id.toLowerCase() };
}

/** A row as folding needs it (ADR 0038), with its time for the reads of full rows. */
interface PlacedLegacyRow extends PlacedRow {
  /** As stored: keys are case-sensitive, so a point read needs it as it is. */
  readonly rowKey: string;
  readonly happendat: Date;
}

/**
 * The row placed for folding. The client id and the partial flag are read as the mapping reads
 * them (an empty or non-string `clientid` is no client; only a Boolean true is partial), so the
 * runs folded here are the runs of the mapped rows.
 */
function placedForFolding(row: Record<string, unknown> & { rowKey?: string }): PlacedLegacyRow {
  const { id, happendat } = placed(row);
  const { clientid, ispartialcompleted } = row;
  return {
    ...positionOf(id, happendat),
    rowKey: id,
    happendat,
    ...(typeof clientid === "string" && clientid !== "" && { clientId: clientid }),
    partial: ispartialcompleted === true,
  };
}

/** Columns of the first read of a page: enough to place each row and fold it into runs. */
const POSITION_COLUMNS = ["RowKey", "happendat", "clientid", "ispartialcompleted"];

/** Point reads of a page's rows that come after its time window run this many at a time. */
const POINT_READS_AT_ONCE = 32;

export function createAzureResultStore(options: AzureResultStoreOptions): ResultStore {
  const { targets, publishIdOf, mapRows, now } = options;
  const rows = (survey: SurveyRecord): TableClient =>
    targets.resultTable(`post${dashless(survey.postId)}`);
  const markers = (survey: SurveyRecord): TableClient =>
    targets.resultTable(`SurveyCompletion${dashless(survey.id)}`);

  /** Every entity of a table, or `[]` when the table does not exist. */
  async function entitiesOf(
    operation: string,
    table: TableClient,
    select?: string[],
    filter?: string,
  ): Promise<TableEntityResult<Record<string, unknown>>[]> {
    const found: TableEntityResult<Record<string, unknown>>[] = [];
    try {
      for await (const entity of table.listEntities<Record<string, unknown>>(
        select || filter
          ? { queryOptions: { ...(select && { select }), ...(filter && { filter }) } }
          : undefined,
      )) {
        found.push(entity);
      }
    } catch (error) {
      if (statusOf(error) === 404) return [];
      throw new LegacyStoreError(operation, error);
    }
    return found;
  }

  /** The entity at `*` / `rowKey`; null when the row or the table is missing. */
  async function entityAt(
    operation: string,
    table: TableClient,
    rowKey: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      return await table.getEntity<Record<string, unknown>>("*", rowKey);
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError(operation, error);
    }
  }

  /**
   * The full rows of `runs` (given in page order) by id, each as the mapping reads it; a row that
   * is gone or cannot be read as a result row is missing (and reported by id). Rows inside the
   * page's time window, from its first run's first row to its last run's first row, come in one
   * filtered read, as in a survey without partial rows; rows of a run that continue after that
   * window come by key.
   */
  async function fullRows(
    table: TableClient,
    runs: readonly PlacedLegacyRow[][],
  ): Promise<Map<string, LegacyResultEntity>> {
    const from = runs[0]?.[0];
    const to = runs.at(-1)?.[0];
    if (!from || !to) return new Map();
    const members = runs.flat();
    const wanted = new Set(members.map((row) => row.id));
    // Stored times may have finer steps than a millisecond: take the whole millisecond.
    const end = to.happendat.getTime();
    const window = odata`happendat ge ${from.happendat} and happendat lt ${new Date(end + 1)}`;
    // Only the page's rows; a row that cannot be placed was reported by the positions read.
    const found = (await entitiesOf("response page", table, undefined, window)).filter(
      (row) => isPlaced(row) && wanted.has(String(row.rowKey).toLowerCase()),
    );

    const later = members.filter((row) => row.happendat.getTime() > end).map((row) => row.rowKey);
    for (let i = 0; i < later.length; i += POINT_READS_AT_ONCE) {
      const read = await Promise.all(
        later.slice(i, i + POINT_READS_AT_ONCE).map((key) => entityAt("response page", table, key)),
      );
      for (const row of read) {
        const entity = row as TableEntityResult<Record<string, unknown>> | null;
        if (entity !== null && isPlaced(entity)) found.push(entity);
      }
    }

    return new Map(mapRows(found, legacyEntity).map((entity) => [entity.id.toLowerCase(), entity]));
  }

  return {
    async appendResponse(survey, response) {
      const publishId = response.clientId === undefined ? null : await publishIdOf(survey.id);
      return writeResponse(targets, survey, response, publishId);
    },

    async hasResponse(survey, id) {
      if (!isGuid(id)) return false;
      return (await entityAt("response read", rows(survey), id.toLowerCase())) !== null;
    },

    async listResponses(survey) {
      const found = await entitiesOf("response list", rows(survey));
      return mapRows(found, (row) => responseFromLegacy(legacyEntity(row))).sort(responseOrder);
    },

    async stats(survey) {
      // Only complete rows count (ADR 0038): a partial row has `ispartialcompleted` true.
      const found = await entitiesOf("response statistics", rows(survey), [
        "happendat",
        "ispartialcompleted",
      ]);
      let count = 0;
      let first: Date | null = null;
      let last: Date | null = null;
      for (const { happendat, ispartialcompleted } of found) {
        if (ispartialcompleted === true) continue;
        count += 1;
        if (!(happendat instanceof Date) || Number.isNaN(happendat.getTime())) continue;
        if (first === null || happendat < first) first = happendat;
        if (last === null || happendat > last) last = happendat;
      }
      return {
        count,
        firstSubmittedAt: first?.toISOString() ?? null,
        lastSubmittedAt: last?.toISOString() ?? null,
      };
    },

    async hasPartial(survey) {
      // The iterator follows continuation tokens: a filtered page may come back empty.
      try {
        for await (const _marker of markers(survey).listEntities({
          queryOptions: { filter: odata`ispartialcompleted eq ${true}`, select: ["RowKey"] },
        })) {
          return true;
        }
        return false;
      } catch (error) {
        if (statusOf(error) === 404) return false;
        throw new LegacyStoreError("completion list", error);
      }
    },

    async completion(survey, clientId) {
      const marker = await entityAt("completion read", markers(survey), clientId);
      if (marker === null) return "none";
      return marker.ispartialcompleted === true ? "partial" : "completed";
    },

    async listResponsePage(survey, query) {
      const { limit, completedOnly = false } = query;
      const table = rows(survey);

      // First the position, client id and partial flag of every row: a row after the cursor may
      // continue a run that starts before it (ADR 0038), so later pages read them all too. A row
      // that cannot be placed is reported here and left out of the runs.
      const keys = await entitiesOf("response page", table, POSITION_COLUMNS);
      const runs = foldRuns(mapRows(keys, placedForFolding).sort(responseOrder));

      // Then the full rows of the page's runs. A row that cannot be mapped is left out of its
      // run; a run with no row left leaves a gap, so the page grows until it and the run after it
      // are full, or every run is in.
      const found: { response: SurveyResponse; position: ResponsePosition }[] = [];
      let taken = 0;
      let wanted = limit + 1;
      for (;;) {
        const page = pageOfFoldedRuns(runs, { ...query, limit: wanted });
        const fresh = page.runs.slice(taken);
        const full = await fullRows(table, fresh);
        for (const run of fresh) {
          const mapped = mapRows(
            run.flatMap((row) => full.get(row.id) ?? []),
            responseFromLegacy,
          );
          if (mapped.length === 0) continue;
          const response = responseOfRun(mapped);
          // Without its complete row (unmappable) the run reads as partial.
          if (completedOnly && response.partial) continue;
          const [first] = run as [PlacedLegacyRow];
          found.push({ response, position: positionOf(first.id, first.happendat) });
        }
        taken = page.runs.length;
        if (found.length > limit || page.next === null) break;
        wanted += limit + 1 - found.length;
      }
      const items = found.slice(0, limit);
      const last = items.at(-1);
      return {
        items: items.map(({ response }) => response),
        // The run's first row, which the next page's runs start after, even when it is unmappable.
        next: found.length > limit && last ? last.position : null,
      };
    },

    deleteAll: (survey) => writeResultsDeletion(targets, survey, new Date(now()).toISOString()),

    async deleteResponse(survey, responseId) {
      if (!isGuid(responseId)) return false;
      const table = rows(survey);
      /** The rows of `filter` placed for folding, in submission order. */
      const placedRows = async (filter?: string): Promise<PlacedLegacyRow[]> =>
        mapRows(
          await entitiesOf("response removal", table, POSITION_COLUMNS, filter),
          placedForFolding,
        ).sort(responseOrder);

      const key = responseId.toLowerCase();
      // Row keys are case-sensitive: the id is found among the placed rows, not by a point read.
      const target = (await placedRows()).find((row) => row.id === key);
      if (!target) return false;
      let run: readonly PlacedLegacyRow[] = [target];
      let marker: { clientId: string; etag: string } | null = null;
      const { clientId } = target;
      if (clientId !== undefined) {
        // The marker before the client's rows: a save stored after this read either has its row
        // in the read below or writes the marker again, which then stays (see writes.ts).
        const found = await entityAt("response removal", markers(survey), clientId);
        const held = runHolding(await placedRows(odata`clientid eq ${clientId}`), key);
        if (!held) return false;
        run = held.run;
        const etag = found?.etag;
        if (!held.laterRun && typeof etag === "string") marker = { clientId, etag };
      }
      // The full rows, for the audit copies; a row deleted meanwhile is skipped.
      const full: DeletedResultRow[] = [];
      for (let i = 0; i < run.length; i += POINT_READS_AT_ONCE) {
        const read = await Promise.all(
          run.slice(i, i + POINT_READS_AT_ONCE).map(async (row) => ({
            row,
            entity: await entityAt("response removal", table, row.rowKey),
          })),
        );
        for (const { row, entity } of read) {
          if (entity !== null) full.push({ ...entity, rowKey: row.rowKey });
        }
      }
      await writeResponseDeletion(targets, survey, full, marker, new Date(now()).toISOString());
      return true;
    },
  };
}
