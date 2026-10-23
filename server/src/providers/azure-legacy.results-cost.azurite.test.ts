import { createHash, randomUUID } from "node:crypto";
import type {
  ListTableEntitiesOptions,
  TableClient,
  TableEntity,
  TransactionAction,
} from "@azure/data-tables";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SurveyRecord } from "../domain/types.js";
import { localBlobServiceClient, localTableClient } from "../legacy/local-clients.js";
import { replicaConfig } from "../legacy/replica-env.js";
import { UnmappableLegacyRowError } from "./azure-legacy/mapping.js";
import { createAzureResultStore } from "./azure-legacy/results.js";
import { writeResultsDeletion, type LegacyWriteTargets } from "./azure-legacy/writes.js";
import { responseOrder } from "./ordering.js";
import type { ResponsePosition, ResultStore } from "./types.js";

// Runs in the `providers-azurite` Vitest project. Pins what the results page read and the delete
// of all results cost on the local replica (Step 14, D6): which columns and how many rows each
// read takes, and how many keys the delete holds at once, while the order, the cursors and what
// gets deleted stay as before. Each test writes its own tables under fresh names (no survey row)
// and drops them at the end; no fixture data is touched.

const RESULTS = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";
const SURVEYS = "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING";
const config = replicaConfig();
const compact = (id: string) => id.replaceAll("-", "");
const tableOf = (name: string): TableClient =>
  localTableClient(config.resultsStorageConnectionString, name, RESULTS);

/** A survey record with fresh ids; only `id` and `postId` name the tables. */
function surveyRecord(): SurveyRecord {
  return {
    id: randomUUID(),
    name: "Cost check",
    owner: { kind: "personal", userId: randomUUID() },
    creatorId: null,
    postId: randomUUID(),
    resultId: randomUUID(),
    published: true,
    archived: false,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

/** One `listEntities` call: its options, the page size asked for, and what it returned. */
interface ListCall {
  readonly options: ListTableEntitiesOptions | undefined;
  pageSize?: number;
  rows: number;
}

/** What a spied client did, in order: page requests, pages, transactions and single deletes. */
type Event =
  | { readonly kind: "request" }
  | { readonly kind: "page"; readonly keys: number }
  | { readonly kind: "transaction"; readonly partitions: string[]; readonly keys: number }
  | { readonly kind: "delete" };

interface Spied {
  readonly client: TableClient;
  readonly calls: ListCall[];
  readonly events: Event[];
}

/**
 * A client of the replica table whose reads, transactions and deletes are recorded. `byPage`
 * gets pages of `pageRows` keys from the service whatever size the caller asked for (the service
 * may return fewer rows than asked); `onPage` runs after each page arrives.
 */
function spiedTable(
  name: string,
  pageRows: number,
  onPage: (keys: { partitionKey: string; rowKey: string }[]) => Promise<void> = () =>
    Promise.resolve(),
): Spied {
  const client = tableOf(name);
  const calls: ListCall[] = [];
  const events: Event[] = [];
  const list = client.listEntities.bind(client);
  const transact = client.submitTransaction.bind(client);
  const remove = client.deleteEntity.bind(client);

  const spy = (options?: ListTableEntitiesOptions) => {
    const call: ListCall = { options, rows: 0 };
    calls.push(call);
    const rows = list(options);
    return {
      async next() {
        const step = await rows.next();
        if (!step.done) call.rows += 1;
        return step;
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      byPage(settings?: { maxPageSize?: number; continuationToken?: string }) {
        call.pageSize = settings?.maxPageSize;
        const pages = list(options).byPage({ ...settings, maxPageSize: pageRows });
        return {
          async next() {
            events.push({ kind: "request" });
            const step = await pages.next();
            if (!step.done) {
              call.rows += step.value.length;
              events.push({ kind: "page", keys: step.value.length });
              await onPage(
                step.value.map((row) => ({
                  partitionKey: row.partitionKey ?? "",
                  rowKey: row.rowKey ?? "",
                })),
              );
            }
            return step;
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    };
  };
  client.listEntities = spy as unknown as TableClient["listEntities"];
  client.submitTransaction = (actions: TransactionAction[], ...rest) => {
    const partitions = [...new Set(actions.map(([, entity]) => entity.partitionKey))];
    events.push({ kind: "transaction", partitions, keys: actions.length });
    return transact(actions, ...rest);
  };
  client.deleteEntity = (...args) => {
    events.push({ kind: "delete" });
    return remove(...args);
  };
  return { client, calls, events };
}

/** Writes the rows in transactions of 100 per partition, creating the table first. */
async function seed(name: string, rows: TableEntity[]): Promise<void> {
  const client = tableOf(name);
  await client.createTable();
  const partitions = new Set(rows.map((row) => row.partitionKey));
  for (const key of partitions) {
    const partition = rows.filter((row) => row.partitionKey === key);
    for (let from = 0; from < partition.length; from += 100) {
      await client.submitTransaction(
        partition.slice(from, from + 100).map((row): TransactionAction => ["create", row]),
      );
    }
  }
}

/** All keys left in the table. */
async function keysOf(name: string): Promise<string[]> {
  const keys: string[] = [];
  for await (const row of tableOf(name).listEntities({
    queryOptions: { select: ["PartitionKey", "RowKey"] },
  })) {
    keys.push(`${row.partitionKey ?? ""}/${row.rowKey ?? ""}`);
  }
  return keys;
}

/** A GUID that depends only on `seedText`, so the rows and their order are the same each run. */
function stableGuid(seedText: string): string {
  const hex = createHash("sha256").update(seedText).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const dropped: string[] = [];
afterAll(async () => {
  for (const name of dropped) await tableOf(name).deleteTable();
});

describe("azure-legacy results page reads (local replica)", () => {
  const LIMIT = 50;
  const GOOD_ROWS = 250;
  const survey = surveyRecord();
  const postName = `post${compact(survey.postId)}`;
  const warnings: string[] = [];
  /** The good rows in submission order: `happendat` (ms) then lower-case id (`responseOrder`). */
  let expected: ResponsePosition[] = [];
  /** The row with a non-string answer: placed by its keys, skipped by the full read. */
  const unanswered = stableGuid("unanswered");

  /** A result store whose table `tableName` is `table`. */
  function storeOn(table: TableClient, tableName = postName): ResultStore {
    const targets: LegacyWriteTargets = {
      pool: () => Promise.reject(new Error("no SQL in this test")),
      blobs: localBlobServiceClient(config.surveysStorageConnectionString, SURVEYS),
      events: tableOf("unused"),
      resultTables: undefined as never,
      resultTable: (name) => (name === tableName ? table : tableOf(name)),
      logger: { warn: () => undefined },
    };
    return createAzureResultStore({
      targets,
      publishIdOf: () => Promise.resolve(null),
      now: Date.now,
      mapRows: (rows, map) => {
        const mapped = [];
        for (const row of rows) {
          try {
            mapped.push(map(row));
          } catch (error) {
            if (!(error instanceof UnmappableLegacyRowError)) throw error;
            warnings.push(error.message);
          }
        }
        return mapped;
      },
    });
  }

  beforeAll(async () => {
    dropped.push(postName);
    const base = Date.UTC(2026, 8, 10, 8, 0, 0);
    const rows: TableEntity[] = [];
    for (let n = 0; n < GOOD_ROWS; n++) {
      // Three rows per instant, so pages of 50 end inside a group of equal times. Every fifth
      // group stores seven decimals, as the legacy writer does, all within the same millisecond.
      const group = Math.floor(n / 3);
      const id = stableGuid(`row-${String(n)}`);
      const at = new Date(base + group * 1000 + 123).toISOString();
      const happendat =
        group % 5 === 0 ? at.replace(".123Z", `.123${String(1000 + n * 37).slice(-4)}Z`) : at;
      rows.push({
        partitionKey: "*",
        // Some keys are upper case: the store sorts by the lower-case id, not by RowKey.
        rowKey: n % 7 === 0 ? id.toUpperCase() : id,
        id: { type: "Guid", value: id },
        happendat: { type: "DateTime", value: happendat },
        result: JSON.stringify({ q1: n }),
      });
      expected.push({ submittedAt: at, id });
    }
    // Rows the store skips: an answer that is not a string (at the end of the first page), a
    // time stored as a string, and a key that is not a GUID.
    rows.push(
      {
        partitionKey: "*",
        rowKey: unanswered,
        happendat: { type: "DateTime", value: new Date(base + 16 * 1000 + 123).toISOString() },
        result: { type: "Int32", value: "7" },
      },
      {
        partitionKey: "*",
        rowKey: stableGuid("string-time"),
        happendat: { type: "String", value: new Date(base + 20 * 1000).toISOString() },
        result: "{}",
      },
      {
        partitionKey: "*",
        rowKey: "not-a-guid",
        happendat: { type: "DateTime", value: new Date(base + 30 * 1000).toISOString() },
        result: "{}",
      },
    );
    await seed(postName, rows);
    expected = expected.sort(responseOrder);
  });

  /** Walks every page with `LIMIT`; returns the pages and the reads of each. */
  async function walk(spied: Spied) {
    const store = storeOn(spied.client);
    const pages: { ids: string[]; next: ResponsePosition | null; calls: ListCall[] }[] = [];
    let after: ResponsePosition | undefined;
    do {
      const from = spied.calls.length;
      const page = await store.listResponsePage(survey, {
        limit: LIMIT,
        ...(after && { after }),
      });
      pages.push({
        ids: page.items.map((item) => item.id),
        next: page.next,
        calls: spied.calls.slice(from),
      });
      after = page.next ?? undefined;
    } while (after && pages.length < 20);
    return pages;
  }

  it("walks 250 rows in pages of 50 in submission order, each cursor at the page's last row", async () => {
    const pages = await walk(spiedTable(postName, 1000));
    expect(pages.map((page) => page.ids.length)).toEqual([50, 50, 50, 50, 50]);
    expect(pages.flatMap((page) => page.ids)).toEqual(expected.map((row) => row.id));
    pages.forEach((page, index) => {
      const last = expected[index * LIMIT + LIMIT - 1];
      expect(page.next).toEqual(index < pages.length - 1 ? last : null);
    });
    const all = await storeOn(tableOf(postName)).listResponses(survey);
    expect(all.map((response) => response.id)).toEqual(expected.map((row) => row.id));
  });

  it("reads keys and times first, then the full rows of the page only", async () => {
    const pages = await walk(spiedTable(postName, 1000));
    expect(pages.flatMap((page) => page.ids)).toEqual(expected.map((row) => row.id));
    for (const page of pages) {
      const [first, ...full] = page.calls;
      expect(first?.options?.queryOptions?.select).toEqual(["RowKey", "happendat"]);
      expect(full.length).toBeGreaterThan(0);
      for (const call of full) expect(call.options?.queryOptions?.select).toBeUndefined();
      // The page, the row after it, the rows of the boundary instants on either side (two more
      // each) and the three rows the store skips when they fall in the page's time window.
      const read = full.reduce((sum, call) => sum + call.rows, 0);
      expect(read).toBeLessThanOrEqual(LIMIT + 1 + 2 + 2 + 3);
    }
  });

  it("still reports the rows it skips", async () => {
    warnings.length = 0;
    await walk(spiedTable(postName, 1000));
    expect(warnings).toContain("Legacy row cannot be mapped: row key is not a GUID");
    expect(warnings).toContain("Legacy row cannot be mapped: unexpected column types");
  });

  describe("rows that only the full read skips (an answer that is not a string)", () => {
    const at = (second: number) => new Date(Date.UTC(2026, 8, 11, 9, 0, second)).toISOString();
    const good = (second: number): TableEntity => ({
      partitionKey: "*",
      rowKey: stableGuid(`good-${String(second)}`),
      happendat: { type: "DateTime", value: at(second) },
      result: JSON.stringify({ second }),
    });
    const unanswered = (second: number): TableEntity => ({
      partitionKey: "*",
      rowKey: stableGuid(`unanswered-${String(second)}`),
      happendat: { type: "DateTime", value: at(second) },
      result: { type: "Int32", value: String(second) },
    });

    /** Walks a fresh table of `rows` with `limit` 2: each page's ids, next cursor and reads. */
    async function walkRows(rows: TableEntity[]) {
      const other = surveyRecord();
      const name = `post${compact(other.postId)}`;
      dropped.push(name);
      await seed(name, rows);
      const spied = spiedTable(name, 1000);
      const store = storeOn(spied.client, name);
      const pages: { ids: string[]; next: ResponsePosition | null; reads: number }[] = [];
      let after: ResponsePosition | undefined;
      do {
        const from = spied.calls.length;
        const page = await store.listResponsePage(other, { limit: 2, ...(after && { after }) });
        pages.push({
          ids: page.items.map((item) => item.id),
          next: page.next,
          reads: spied.calls.length - from,
        });
        after = page.next ?? undefined;
      } while (after && pages.length < 10);
      return pages;
    }

    const idOf = (row: TableEntity) => String(row.rowKey);
    const placeOf = (row: TableEntity) => ({
      submittedAt: (row.happendat as { value: string }).value,
      id: idOf(row),
    });

    it("fills the page with the good row after them, the cursor at the page's last row", async () => {
      const rows = [good(0), good(1), unanswered(2), unanswered(3), unanswered(4), good(5)];
      const pages = await walkRows(rows);
      expect(pages.map(({ ids, next }) => ({ ids, next }))).toEqual([
        { ids: [idOf(good(0)), idOf(good(1))], next: placeOf(good(1)) },
        { ids: [idOf(good(5))], next: null },
      ]);
      // The window grew row by row past the three skipped rows: one key read, four full reads.
      expect(pages[0]?.reads).toBe(5);
    });

    it("ends the walk when only such rows follow the page", async () => {
      const rows = [good(0), good(1), unanswered(2), unanswered(3)];
      const pages = await walkRows(rows);
      expect(pages.map(({ ids, next }) => ({ ids, next }))).toEqual([
        { ids: [idOf(good(0)), idOf(good(1))], next: null },
      ]);
    });
  });
});

describe("azure-legacy deleting all results (local replica)", () => {
  const PAGE_ROWS = 60;

  function targetsFor(spied: Spied, postName: string): LegacyWriteTargets {
    const audit = `costaudit${compact(randomUUID())}`;
    dropped.push(audit);
    return {
      pool: () => Promise.reject(new Error("no SQL in this test")),
      blobs: localBlobServiceClient(config.surveysStorageConnectionString, SURVEYS),
      events: tableOf(audit),
      resultTables: undefined as never,
      resultTable: (name) => (name === postName ? spied.client : tableOf(name)),
      logger: { warn: () => undefined },
    };
  }

  /** 250 rows: 130 in partition `*` and 120 in partition `p2`. */
  async function seeded(postName: string): Promise<void> {
    dropped.push(postName);
    const rows: TableEntity[] = Array.from({ length: 250 }, (_, n) => ({
      partitionKey: n < 130 ? "*" : "p2",
      rowKey: randomUUID(),
      result: "{}",
    }));
    await seed(postName, rows);
  }

  /** Every page's keys are deleted before the next page is asked for. */
  function expectPageByPage(events: Event[]): void {
    let held = 0;
    let pages = 0;
    for (const event of events) {
      if (event.kind === "request")
        expect(held, "keys still held when the next page is asked for").toBe(0);
      if (event.kind === "page") {
        held = event.keys;
        pages += 1;
      }
      if (event.kind === "transaction") {
        expect(event.partitions).toHaveLength(1);
        expect(event.keys).toBeLessThanOrEqual(100);
        // A failed transaction's keys are deleted one by one before the next request.
        held -= event.keys;
      }
    }
    expect(held).toBe(0);
    expect(pages).toBeGreaterThan(1);
  }

  it("deletes 250 rows of two partitions one listing page at a time", async () => {
    const survey = surveyRecord();
    const postName = `post${compact(survey.postId)}`;
    await seeded(postName);
    const spied = spiedTable(postName, PAGE_ROWS);

    await writeResultsDeletion(targetsFor(spied, postName), survey, new Date().toISOString());

    expect(await keysOf(postName)).toEqual([]);
    expect(spied.calls).toHaveLength(1);
    expect(spied.calls[0]?.options?.queryOptions?.select).toEqual(["PartitionKey", "RowKey"]);
    expect(spied.calls[0]?.pageSize).toBeLessThanOrEqual(1000);
    expect(spied.calls[0]?.rows).toBe(250);
    expectPageByPage(spied.events);
  });

  it("falls back to row by row when a listed row is gone before its transaction", async () => {
    const survey = surveyRecord();
    const postName = `post${compact(survey.postId)}`;
    await seeded(postName);
    let removed = false;
    const spied = spiedTable(postName, PAGE_ROWS, async (keys) => {
      const [key] = keys;
      if (removed || !key) return;
      removed = true;
      await tableOf(postName).deleteEntity(key.partitionKey, key.rowKey);
    });

    await writeResultsDeletion(targetsFor(spied, postName), survey, new Date().toISOString());

    expect(await keysOf(postName)).toEqual([]);
    expect(spied.events.filter((event) => event.kind === "delete")).toHaveLength(PAGE_ROWS);
  });
});
