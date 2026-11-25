import { odata, TableClient, type TableEntityResult } from "@azure/data-tables";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import type { LegacyResultEntity } from "../../providers/azure-legacy/rows.js";

/** The legacy Azure Tables, read only: pages of entities, never a table in memory. */
export interface TableSource {
  responses(postId: string, since?: Date): AsyncIterable<LegacyResultEntity & { timestamp: Date }>;
  markers(
    surveyId: string,
    since?: Date,
  ): AsyncIterable<{ clientId: string; partial: boolean; timestamp: Date }>;
  deletedCopies(
    postId: string,
    since?: Date,
  ): AsyncIterable<{ responseId: string; deletedAt: Date; entity: LegacyResultEntity }>;
  events(since?: Date): AsyncIterable<{
    id: string;
    surveyId: string;
    type: string;
    at: Date;
    rest: Record<string, unknown>;
    timestamp: Date;
  }>;
}

const PAGE_SIZE = 500;
const EPOCH = new Date(0);
const dashless = (id: string) => id.replaceAll("-", "").toLowerCase();

type Entity = TableEntityResult<Record<string, unknown>>;

const dateOf = (value: unknown): Date | undefined => {
  const date =
    value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? date : undefined;
};
/** An Edm.Guid (and other annotated) property comes as `{ type, value }`: its plain value. */
const plain = (value: unknown): unknown =>
  typeof value === "object" && value !== null && !(value instanceof Date) && "value" in value
    ? (value as { value: unknown }).value
    : value;
const stringOf = (value: unknown): string | undefined => {
  const found = plain(value);
  return typeof found === "string" ? found : undefined;
};

function tableClient(connectionString: string, name: string): TableClient {
  try {
    return TableClient.fromConnectionString(connectionString, name, {
      allowInsecureConnection: isLocalStorageString(connectionString),
    });
  } catch {
    throw new Error("A legacy storage connection string is not a valid Azure Storage one");
  }
}

/** Properties of an event row that `events()` gives as fields of their own. */
const EVENT_OWN = new Set([
  "partitionKey",
  "rowKey",
  "etag",
  "timestamp",
  "id",
  "surveyid",
  "type",
  "happendat",
]);

export function openTableSource(config: {
  surveysStorageConnectionString: string;
  resultsStorageConnectionString: string;
}): TableSource {
  /** Every entity of the table, page by page; a missing table is empty. */
  async function* entitiesOf(
    operation: string,
    table: TableClient,
    since?: Date,
  ): AsyncGenerator<Entity> {
    const pages = table
      .listEntities<Record<string, unknown>>({
        queryOptions: since ? { filter: odata`Timestamp gt ${since}` } : {},
      })
      .byPage({ maxPageSize: PAGE_SIZE });
    try {
      for await (const page of pages) yield* page;
    } catch (error) {
      if (statusOf(error) === 404) return;
      throw new LegacyStoreError(operation, error);
    }
  }
  const results = (name: string) => tableClient(config.resultsStorageConnectionString, name);

  const resultEntity = (row: Entity, id: string): LegacyResultEntity => {
    const { result, clientid, ipaddress, ispartialcompleted } = row;
    return {
      id,
      happendat: dateOf(row.happendat) ?? dateOf(row.timestamp) ?? EPOCH,
      result: typeof result === "string" ? result : "",
      ...(typeof clientid === "string" && { clientid }),
      ...(typeof ipaddress === "string" && { ipaddress }),
      ...(typeof ispartialcompleted === "boolean" && { ispartialcompleted }),
    };
  };

  return {
    async *responses(postId, since) {
      const table = results(`post${dashless(postId)}`);
      for await (const row of entitiesOf("response read", table, since)) {
        yield {
          ...resultEntity(row, stringOf(row.id) ?? row.rowKey ?? ""),
          timestamp: dateOf(row.timestamp) ?? EPOCH,
        };
      }
    },
    async *markers(surveyId, since) {
      const table = results(`SurveyCompletion${dashless(surveyId)}`);
      for await (const row of entitiesOf("marker read", table, since)) {
        yield {
          clientId: row.rowKey ?? "",
          partial: row.ispartialcompleted === true,
          timestamp: dateOf(row.timestamp) ?? EPOCH,
        };
      }
    },
    async *deletedCopies(postId, since) {
      const table = results(`postdelete${dashless(postId)}`);
      for await (const row of entitiesOf("deleted response read", table, since)) {
        // The copy's `instanceid` is the deleted row's key; its time is the deletion time.
        const responseId = stringOf(row.instanceid) ?? "";
        const entity = resultEntity(row, responseId);
        yield { responseId, deletedAt: entity.happendat, entity };
      }
    },
    async *events(since) {
      const table = tableClient(config.surveysStorageConnectionString, "surveys");
      for await (const row of entitiesOf("event read", table, since)) {
        const timestamp = dateOf(row.timestamp) ?? EPOCH;
        yield {
          id: stringOf(row.id) ?? row.rowKey ?? "",
          surveyId: stringOf(row.surveyid) ?? "",
          type: stringOf(row.type) ?? "",
          at: dateOf(row.happendat) ?? timestamp,
          rest: Object.fromEntries(
            Object.entries(row)
              .filter(([key]) => !EVENT_OWN.has(key))
              .map(([key, value]) => [key, plain(value)]),
          ),
          timestamp,
        };
      }
    },
  };
}
