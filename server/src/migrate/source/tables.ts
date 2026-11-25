import { odata, TableClient, TableServiceClient, type TableEntityResult } from "@azure/data-tables";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import type { LegacyResultEntity } from "../../providers/azure-legacy/rows.js";
import { API_TOKENS_TABLE } from "../../providers/azure-legacy/writes.js";

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
  /**
   * The partition of each row of the app's own token table in the surveys account (API tokens
   * and key revocations Studio wrote). The copy does not take them; `verify` flags any.
   */
  ownTokenRows(): AsyncIterable<{ partition: string }>;
  /**
   * The names of the results account's tables, lower-case (one listing): a survey without a
   * `post…` or `postdelete…` table has no responses or deletion copies to query.
   */
  resultTables(): Promise<Set<string>>;
  /** The results account's clock (its responses' change times are stamped by it); null: none. */
  tablesClock(): Promise<Date | null>;
}

const PAGE_SIZE = 500;
/** A table no survey has (the zero post id): asked only for the service's `Date` header. */
const CLOCK_TABLE = "post00000000000000000000000000000000";
const EPOCH = new Date(0);
const dashless = (id: string) => id.replaceAll("-", "").toLowerCase();
/** A survey's response and deletion-copy tables, lower-case, as `resultTables` lists them. */
export const responseTableOf = (postId: string): string => `post${dashless(postId)}`;
export const deletedTableOf = (postId: string): string => `postdelete${dashless(postId)}`;

type Entity = TableEntityResult<Record<string, unknown>>;
type Headers = { get(name: string): string | undefined } | undefined;

/** The time of a response's `Date` header; null without one. */
export function dateHeader(headers: Headers): Date | null {
  const text = headers?.get("date");
  const date = text === undefined ? null : new Date(text);
  return date !== null && Number.isFinite(date.getTime()) ? date : null;
}

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
    async resultTables() {
      const names = new Set<string>();
      try {
        const service = TableServiceClient.fromConnectionString(
          config.resultsStorageConnectionString,
          { allowInsecureConnection: isLocalStorageString(config.resultsStorageConnectionString) },
        );
        for await (const table of service.listTables()) {
          if (table.name) names.add(table.name.toLowerCase());
        }
      } catch (error) {
        throw new LegacyStoreError("table list", error);
      }
      return names;
    },
    async *responses(postId, since) {
      const table = results(responseTableOf(postId));
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
      const table = results(deletedTableOf(postId));
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
    async tablesClock() {
      // Any answer carries the service's time, a refusal or a missing table's included.
      let clock: Date | null = null;
      try {
        await results(CLOCK_TABLE)
          .listEntities({
            queryOptions: { select: ["RowKey"] },
            onResponse: (response) => void (clock = dateHeader(response.headers)),
          })
          .byPage({ maxPageSize: 1 })
          .next();
      } catch (error) {
        clock ??= dateHeader((error as { response?: { headers?: Headers } }).response?.headers);
      }
      return clock;
    },
    async *ownTokenRows() {
      const table = tableClient(config.surveysStorageConnectionString, API_TOKENS_TABLE);
      for await (const row of entitiesOf("token row read", table)) {
        yield { partition: row.partitionKey ?? "" };
      }
    },
  };
}
