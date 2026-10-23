import { odata, type TableClient, type TableEntityResult } from "@azure/data-tables";
import type { SurveyRecord } from "../../domain/types.js";
import { isAfterResponse, responseOrder } from "../ordering.js";
import type { ResponsePosition, ResultStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import { UnmappableLegacyRowError, isGuid, responseFromLegacy } from "./mapping.js";
import type { LegacyResultEntity } from "./rows.js";
import { writeResponse, writeResultsDeletion, type LegacyWriteTargets } from "./writes.js";

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

/** Columns of the first read of a page: enough to place each row. */
const POSITION_COLUMNS = ["RowKey", "happendat"];

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
      const found = await entitiesOf("response statistics", rows(survey), ["happendat"]);
      let first: Date | null = null;
      let last: Date | null = null;
      for (const { happendat } of found) {
        if (!(happendat instanceof Date) || Number.isNaN(happendat.getTime())) continue;
        if (first === null || happendat < first) first = happendat;
        if (last === null || happendat > last) last = happendat;
      }
      return {
        count: found.length,
        firstSubmittedAt: first?.toISOString() ?? null,
        lastSubmittedAt: last?.toISOString() ?? null,
      };
    },

    async completion(survey, clientId) {
      const marker = await entityAt("completion read", markers(survey), clientId);
      if (marker === null) return "none";
      return marker.ispartialcompleted === true ? "partial" : "completed";
    },

    async listResponsePage(survey, { after, limit }) {
      // Rows before the cursor time are left out by the store; the cursor row itself and rows of
      // the same instant are cut by position below. A row with an unexpected column type may or
      // may not match the filter; either way it never reaches a page.
      const table = rows(survey);
      const from = after && odata`happendat ge ${new Date(after.submittedAt)}`;
      const isNext = (position: ResponsePosition) => !after || isAfterResponse(position, after);

      // First the keys and times only, to place the rows; a row that cannot be placed is
      // reported here and left out of the full reads.
      const keys = await entitiesOf("response page", table, POSITION_COLUMNS, from);
      const candidates = mapRows(keys, (row) => {
        const { id, happendat } = placed(row);
        return positionOf(id, happendat);
      })
        .filter(isNext)
        .sort(responseOrder);

      // Then the full rows up to the instant of the row after the page: the same rows, in the
      // same order, as a read of everything from the cursor on, cut at that instant. A row whose
      // other columns cannot be mapped leaves a gap, so the window grows until the page and the
      // row after it are full, or every placed row is in.
      let wanted = limit + 1;
      for (;;) {
        const end = candidates[Math.min(wanted, candidates.length) - 1];
        if (end === undefined) return { items: [], next: null };
        // Stored times may have finer steps than a millisecond: take the whole millisecond.
        const until = odata`happendat lt ${new Date(Date.parse(end.submittedAt) + 1)}`;
        const filter = from ? `${from} and ${until}` : until;
        const found = await entitiesOf("response page", table, undefined, filter);
        const positioned = mapRows(found.filter(isPlaced), (row) => {
          const entity = legacyEntity(row);
          return { entity, position: positionOf(entity.id, entity.happendat) };
        })
          .filter(({ position }) => isNext(position))
          .sort((a, b) => responseOrder(a.position, b.position));
        if (positioned.length > limit || wanted >= candidates.length) {
          const taken = positioned.slice(0, limit);
          const last = taken.at(-1);
          return {
            items: mapRows(taken, ({ entity }) => responseFromLegacy(entity)),
            next: positioned.length > taken.length && last ? last.position : null,
          };
        }
        wanted += limit + 1 - positioned.length;
      }
    },

    deleteAll: (survey) => writeResultsDeletion(targets, survey, new Date(now()).toISOString()),
  };
}
