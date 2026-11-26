import { odata, TableClient, TableServiceClient, type TableEntityResult } from "@azure/data-tables";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { LegacyStoreError, statusOf } from "../../providers/azure-legacy/errors.js";
import type { LegacyResultEntity } from "../../providers/azure-legacy/rows.js";
import { API_TOKENS_TABLE } from "../../providers/azure-legacy/writes.js";

/**
 * A result row as the app's reader takes it (providers/azure-legacy/results.ts): the id is the row
 * key, and `happendat` is null when the row holds no date there (the reader skips such a row).
 */
export interface ResultRow extends Omit<LegacyResultEntity, "happendat"> {
  happendat: Date | null;
  /**
   * The row's `id` property, when it holds one: never the id (a response whose `id` property
   * differs from its key is reported).
   */
  idProperty?: string;
}

/** The legacy Azure Tables, read only: pages of entities, never a table in memory. */
export interface TableSource {
  responses(postId: string, since?: Date): AsyncIterable<ResultRow & { timestamp: Date }>;
  /** `ispartialcompleted` as stored (the mapping takes only a Boolean true as partial). */
  markers(
    surveyId: string,
    since?: Date,
  ): AsyncIterable<{ clientId: string; ispartialcompleted: unknown; timestamp: Date }>;
  /** `deletedAt`: the copy's `happendat`, null when it holds no date. */
  deletedCopies(
    postId: string,
    since?: Date,
  ): AsyncIterable<{ responseId: string; deletedAt: Date | null; entity: ResultRow }>;
  /** An event keyed by its row key (as the app writes it); `at` null when it holds no date. */
  events(since?: Date): AsyncIterable<{
    id: string;
    idProperty?: string;
    surveyId: string;
    type: string;
    at: Date | null;
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
/** The surveys account's event table: every source holds it (`probeLegacySource` checks). */
export const EVENTS_TABLE = "surveys";
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
/** A stored date (`Edm.DateTime`), as the app's reader takes one: anything else is none. */
const storedDate = (value: unknown): Date | null =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value : null;
/** An Edm.Guid (and other annotated) property comes as `{ type, value }`: its plain value. */
const plain = (value: unknown): unknown =>
  typeof value === "object" && value !== null && !(value instanceof Date) && "value" in value
    ? (value as { value: unknown }).value
    : value;
const stringOf = (value: unknown): string | undefined => {
  const found = plain(value);
  return typeof found === "string" ? found : undefined;
};

export function tableClient(connectionString: string, name: string): TableClient {
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
  /**
   * Every entity of the table, page by page. A missing table is empty only when the table is
   * made on first use (`madeOnFirstUse`): a survey's response, deletion-copy and completion
   * tables (the old service creates each on the survey's first response, first deletion and
   * first completion marker) and the app's own token table (created on the first token write).
   * Any other table answering 404 (the event table every source holds) is an error.
   */
  async function* entitiesOf(
    operation: string,
    table: TableClient,
    since?: Date,
    madeOnFirstUse = false,
  ): AsyncGenerator<Entity> {
    const pages = table
      .listEntities<Record<string, unknown>>({
        queryOptions: since ? { filter: odata`Timestamp gt ${since}` } : {},
      })
      .byPage({ maxPageSize: PAGE_SIZE });
    try {
      for await (const page of pages) yield* page;
    } catch (error) {
      if (statusOf(error) === 404 && madeOnFirstUse) return;
      throw new LegacyStoreError(operation, error);
    }
  }
  const results = (name: string) => tableClient(config.resultsStorageConnectionString, name);

  const resultRow = (row: Entity, id: string): ResultRow => {
    const { result, clientid, ipaddress, ispartialcompleted } = row;
    const idProperty = stringOf(row.id);
    return {
      id,
      ...(idProperty !== undefined && { idProperty }),
      happendat: storedDate(row.happendat),
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
      for await (const row of entitiesOf("response read", table, since, true)) {
        yield { ...resultRow(row, row.rowKey ?? ""), timestamp: dateOf(row.timestamp) ?? EPOCH };
      }
    },
    async *markers(surveyId, since) {
      const table = results(`SurveyCompletion${dashless(surveyId)}`);
      for await (const row of entitiesOf("marker read", table, since, true)) {
        yield {
          clientId: row.rowKey ?? "",
          ispartialcompleted: row.ispartialcompleted,
          timestamp: dateOf(row.timestamp) ?? EPOCH,
        };
      }
    },
    async *deletedCopies(postId, since) {
      const table = results(deletedTableOf(postId));
      for await (const row of entitiesOf("deleted response read", table, since, true)) {
        // The copy's `instanceid` is the deleted row's key; its time is the deletion time.
        const responseId = stringOf(row.instanceid) ?? "";
        const entity = resultRow(row, responseId);
        yield { responseId, deletedAt: entity.happendat, entity };
      }
    },
    async *events(since) {
      const table = tableClient(config.surveysStorageConnectionString, EVENTS_TABLE);
      for await (const row of entitiesOf("event read", table, since)) {
        const idProperty = stringOf(row.id);
        yield {
          id: row.rowKey ?? "",
          ...(idProperty !== undefined && { idProperty }),
          surveyId: stringOf(row.surveyid) ?? "",
          type: stringOf(row.type) ?? "",
          at: storedDate(row.happendat),
          rest: Object.fromEntries(
            Object.entries(row)
              .filter(([key]) => !EVENT_OWN.has(key))
              .map(([key, value]) => [key, plain(value)]),
          ),
          timestamp: dateOf(row.timestamp) ?? EPOCH,
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
      for await (const row of entitiesOf("token row read", table, undefined, true)) {
        yield { partition: row.partitionKey ?? "" };
      }
    },
  };
}
