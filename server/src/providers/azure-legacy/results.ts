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

/** The row as the mapping reads it; a row of another shape is unmappable. */
function legacyEntity(row: TableEntityResult<Record<string, unknown>>): LegacyResultEntity {
  const id = row.rowKey ?? "";
  if (!isGuid(id)) throw new UnmappableLegacyRowError({}, "row key is not a GUID");
  const { happendat, result, clientid, ipaddress, ispartialcompleted } = row;
  if (
    !(happendat instanceof Date) ||
    Number.isNaN(happendat.getTime()) ||
    typeof result !== "string"
  ) {
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
      const filter = after && odata`happendat ge ${new Date(after.submittedAt)}`;
      const found = await entitiesOf("response page", rows(survey), undefined, filter);
      const positioned = mapRows(found, (row) => {
        const entity = legacyEntity(row);
        const position: ResponsePosition = {
          submittedAt: entity.happendat.toISOString(),
          id: entity.id.toLowerCase(),
        };
        return { entity, position };
      })
        .filter(({ position }) => !after || isAfterResponse(position, after))
        .sort((a, b) => responseOrder(a.position, b.position));
      const taken = positioned.slice(0, limit);
      const last = taken.at(-1);
      return {
        items: mapRows(taken, ({ entity }) => responseFromLegacy(entity)),
        next: positioned.length > taken.length && last ? last.position : null,
      };
    },

    deleteAll: (survey) => writeResultsDeletion(targets, survey, new Date(now()).toISOString()),
  };
}
