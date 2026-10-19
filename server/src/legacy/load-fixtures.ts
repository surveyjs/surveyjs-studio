import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Edm,
  TableClient,
  EdmTypes,
  TableEntity,
  TransactionAction,
} from "@azure/data-tables";
import sql from "mssql";
import {
  DEFAULT_FIXTURE_DIR,
  LEGACY_SQL_TABLES,
  readLegacyFixtures,
  type LegacyBlob,
  type LegacyTable,
  type RawTableEntity,
} from "../providers/azure-legacy/fixtures.js";
import { parseConnectionString } from "./connection-string.js";
import { assertLocalEndpoints } from "./endpoint-guard.js";
import { localBlobServiceClient, localTableClient } from "./local-clients.js";
import { validateFixtureTables } from "./table-validation.js";

/**
 * Loads the golden fixtures (server/fixtures/legacy) into a local replica of the legacy stores:
 * Azure SQL tables, Azure Tables with their Edm types and append blobs. It only ever talks to
 * local endpoints: endpoint-guard.ts checks the connection strings, and local-clients.ts checks
 * every storage client by the URL the SDK resolved. Running it twice leaves the same state.
 */

export type LegacyEnv = Readonly<Record<string, string | undefined>>;

export interface LoadOptions {
  /** Defaults to `server/fixtures/legacy`. */
  fixtureDir?: string;
  /** One line per call; defaults to `console.log`. */
  log?: (line: string) => void;
}

export interface LoadSummary {
  sqlRows: Record<string, number>;
  tableEntities: Record<string, number>;
  containers: number;
  blobs: number;
  filesSkipped: number;
}

/** Inserted in this order; dropped in the reverse order, so foreign keys hold. */
const SQL_TABLES = LEGACY_SQL_TABLES;
const DROP_ORDER = [...SQL_TABLES].reverse();
const APPEND_BLOCK_BYTES = 4 * 1024 * 1024;

function required(env: LegacyEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Edm annotation of a table-file property to the SDK's typed-value wrapper. */
function typedValue(annotation: string, value: string | number | boolean): Edm<EdmTypes> {
  const type = annotation.slice("Edm.".length) as EdmTypes;
  if (type === "Boolean") return { type, value: value === true } as Edm<"Boolean">;
  if (type === "Double" || type === "Int32") return { type, value: Number(value) } as Edm<"Int32">;
  return { type, value: String(value) } as Edm<"String">;
}

/** Fixture entity (Table REST JSON with annotations) to an SDK entity that keeps the Edm types. */
export function toSdkEntity(raw: RawTableEntity): TableEntity {
  const entity: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.endsWith("@odata.type") || value === null) continue;
    const annotation = raw[`${key}@odata.type`];
    entity[key] = typeof annotation === "string" ? typedValue(annotation, value) : value;
  }
  return entity as unknown as TableEntity;
}

// --- SQL ---------------------------------------------------------------------------------------

function sqlConfig(connectionString: string, database?: string): sql.config {
  const pairs = parseConnectionString(connectionString);
  const pick = (...keys: string[]) =>
    keys.map((key) => pairs.get(key)).find((value) => value !== undefined);
  const server = (
    pick("server", "data source", "address", "addr", "network address") ?? ""
  ).replace(/^[a-z]+:/i, "");
  const [host = "", port] = server.split(",");
  const flag = (value: string | undefined, fallback: boolean) =>
    value === undefined ? fallback : ["true", "yes", "1"].includes(value.toLowerCase());
  return {
    server: host.replace(/^\[|\]$/g, ""),
    ...(port ? { port: Number(port) } : {}),
    database: database ?? pick("database", "initial catalog"),
    user: pick("user id", "uid", "user"),
    password: pick("password", "pwd"),
    options: {
      encrypt: flag(pairs.get("encrypt"), true),
      trustServerCertificate: flag(pairs.get("trustservercertificate"), false),
    },
  };
}

function sqlType(
  dataType: string,
  length: number | null,
): sql.ISqlType | sql.ISqlTypeFactoryWithNoParams {
  const size = length === null || length < 0 ? sql.MAX : length;
  switch (dataType) {
    case "uniqueidentifier":
      return sql.UniqueIdentifier;
    case "datetime":
      return sql.DateTime;
    case "tinyint":
      return sql.TinyInt;
    case "int":
      return sql.Int;
    case "varchar":
      return sql.VarChar(size);
    case "nvarchar":
      return sql.NVarChar(size);
    default:
      throw new Error(`Unsupported SQL column type ${dataType}`);
  }
}

async function loadSql(
  connectionString: string,
  rawRows: Record<string, Record<string, unknown>[]>,
  schemaSql: string,
): Promise<Record<string, number>> {
  const base = sqlConfig(connectionString);
  const database = base.database;
  if (!database || !/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(
      "LEGACY_SQL_CONNECTION_STRING must name a database with letters, digits or _ only",
    );
  }
  const master = await new sql.ConnectionPool(sqlConfig(connectionString, "master")).connect();
  try {
    await master.request().batch(`IF DB_ID(N'${database}') IS NULL CREATE DATABASE [${database}]`);
  } finally {
    await master.close();
  }

  const pool = await new sql.ConnectionPool(base).connect();
  const counts: Record<string, number> = {};
  try {
    for (const table of DROP_ORDER) {
      await pool
        .request()
        .batch(`IF OBJECT_ID(N'dbo.${table}', N'U') IS NOT NULL DROP TABLE dbo.${table}`);
    }
    await pool.request().batch(schemaSql);
    for (const table of SQL_TABLES) {
      const columns = await pool
        .request()
        .input("table", sql.NVarChar(128), table)
        .query<{ name: string; type: string; length: number | null }>(
          "SELECT COLUMN_NAME AS name, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS length " +
            "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @table",
        );
      const byName = new Map(
        columns.recordset.map((column) => [column.name.toLowerCase(), column]),
      );
      const rows = rawRows[table] ?? [];
      for (const row of rows) {
        const request = pool.request();
        const names: string[] = [];
        for (const [key, value] of Object.entries(row)) {
          const column = byName.get(key.toLowerCase());
          if (!column) throw new Error(`Fixture ${table}.json has unknown column "${key}"`);
          names.push(column.name);
          const bound =
            column.type === "datetime" && value !== null ? new Date(String(value)) : value;
          request.input(column.name, sqlType(column.type, column.length), bound);
        }
        await request.query(
          `INSERT INTO dbo.${table} (${names.map((n) => `[${n}]`).join(", ")}) ` +
            `VALUES (${names.map((n) => `@${n}`).join(", ")})`,
        );
      }
      counts[table] = rows.length;
    }
  } finally {
    await pool.close();
  }
  return counts;
}

// --- Tables ------------------------------------------------------------------------------------

/** A storage account of the fixtures: the variable that names it and its connection string. */
interface StorageAccount {
  variable: string;
  connectionString: string;
}

/** Azure Tables take at most 100 actions in a transaction, all on one partition. */
const MAX_TRANSACTION_ACTIONS = 100;

async function submitInBatches(
  client: TableClient,
  actions: readonly TransactionAction[],
  partitionOf: (action: TransactionAction) => string,
): Promise<void> {
  const byPartition = new Map<string, TransactionAction[]>();
  for (const action of actions) {
    const key = partitionOf(action);
    const group = byPartition.get(key) ?? [];
    group.push(action);
    byPartition.set(key, group);
  }
  for (const group of byPartition.values()) {
    for (let at = 0; at < group.length; at += MAX_TRANSACTION_ACTIONS) {
      await client.submitTransaction(group.slice(at, at + MAX_TRANSACTION_ACTIONS));
    }
  }
}

async function loadTable(account: StorageAccount, table: LegacyTable): Promise<number> {
  const client = localTableClient(account.connectionString, table.name, account.variable);
  await client.createTable();
  const existing: { partitionKey: string; rowKey: string }[] = [];
  for await (const entity of client.listEntities({
    queryOptions: { select: ["PartitionKey", "RowKey"] },
  })) {
    existing.push({ partitionKey: String(entity.partitionKey), rowKey: String(entity.rowKey) });
  }
  // One entity takes part in one action per transaction, so deletes and creates go separately.
  await submitInBatches(
    client,
    existing.map(({ partitionKey, rowKey }): TransactionAction => [
      "delete",
      { partitionKey, rowKey },
    ]),
    (action) => String((action[1] as { partitionKey: string }).partitionKey),
  );
  await submitInBatches(
    client,
    table.entities.map((raw): TransactionAction => ["create", toSdkEntity(raw)]),
    (action) => String((action[1] as { partitionKey: string }).partitionKey),
  );
  return table.entities.length;
}

// --- Blobs -------------------------------------------------------------------------------------

async function loadBlobs(
  accounts: Record<string, StorageAccount>,
  blobs: LegacyBlob[],
): Promise<{ containers: number; blobs: number }> {
  const seen = new Set<string>();
  for (const blob of blobs) {
    const account = accounts[blob.account];
    if (!account) {
      throw new Error(`No connection string for blob account "${blob.account}"`);
    }
    const key = `${blob.account}/${blob.container}`;
    const container = localBlobServiceClient(
      account.connectionString,
      account.variable,
    ).getContainerClient(blob.container);
    if (!seen.has(key)) {
      seen.add(key);
      await container.createIfNotExists();
      for await (const existing of container.listBlobsFlat()) {
        await container.deleteBlob(existing.name);
      }
    }
    const append = container.getAppendBlobClient(blob.name);
    await append.create();
    for (let offset = 0; offset < blob.content.length; offset += APPEND_BLOCK_BYTES) {
      const chunk = blob.content.subarray(offset, offset + APPEND_BLOCK_BYTES);
      await append.appendBlock(chunk, chunk.length);
    }
  }
  return { containers: seen.size, blobs: blobs.length };
}

/** Container of the saved results layouts of this app (Step 9): emptied on every load. */
const VIEWS_CONTAINER = "my-surveys-views";

/** Deletes every saved layout, so layouts saved by hand in a demo do not leak into test runs. */
async function clearViews(account: StorageAccount): Promise<number> {
  const container = localBlobServiceClient(
    account.connectionString,
    account.variable,
  ).getContainerClient(VIEWS_CONTAINER);
  let cleared = 0;
  try {
    for await (const blob of container.listBlobsFlat()) {
      await container.deleteBlob(blob.name, { deleteSnapshots: "include" });
      cleared += 1;
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  }
  return cleared;
}

// --- Entry points ------------------------------------------------------------------------------

/** Loads every fixture store. Refuses to run unless all three connection strings are local. */
export async function loadLegacyFixtures(
  env: LegacyEnv,
  options: LoadOptions = {},
): Promise<LoadSummary> {
  const log = options.log ?? ((line: string) => console.log(line));
  assertLocalEndpoints(env);
  const dir = options.fixtureDir ?? DEFAULT_FIXTURE_DIR;
  const fixtures = await readLegacyFixtures(dir);
  const problems = validateFixtureTables(fixtures.tables);
  if (problems.length > 0) throw new Error(`Invalid fixture tables:\n${problems.join("\n")}`);

  const account = (variable: string): StorageAccount => ({
    variable,
    connectionString: required(env, variable),
  });
  const accounts: Record<string, StorageAccount> = {
    surveys: account("LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"),
    results: account("LEGACY_RESULTS_STORAGE_CONNECTION_STRING"),
  };

  const schemaSql = await readFile(join(dir, "sql", "schema.sql"), "utf8");
  const sqlRows = await loadSql(
    required(env, "LEGACY_SQL_CONNECTION_STRING"),
    fixtures.rawSqlRows,
    schemaSql,
  );
  log(
    `SQL: ${Object.entries(sqlRows)
      .map(([table, count]) => `${table}=${count}`)
      .join(", ")}`,
  );

  const tableEntities: Record<string, number> = {};
  for (const table of fixtures.tables) {
    const tableAccount = accounts[table.account];
    if (!tableAccount) {
      throw new Error(`No connection string for table account "${table.account}"`);
    }
    tableEntities[table.name] = await loadTable(tableAccount, table);
  }
  const tableTotal = Object.values(tableEntities).reduce((a, b) => a + b, 0);
  log(`Tables: ${fixtures.tables.length} tables, ${tableTotal} entities`);

  const blobResult = await loadBlobs(accounts, fixtures.blobs);
  log(`Blobs: ${blobResult.blobs} append blobs in ${blobResult.containers} containers`);

  log(`Views: cleared ${await clearViews(accounts.surveys!)} saved layouts`);

  if (fixtures.files.length > 0) {
    log(
      `Files: skipped ${fixtures.files.length} fixture files (Azure Files is not emulated by Azurite)`,
    );
  }
  return { sqlRows, tableEntities, ...blobResult, filesSkipped: fixtures.files.length };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadLegacyFixtures(process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
