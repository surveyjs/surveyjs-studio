import { TableClient, TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import type { LegacyConfig } from "../config.js";
import { LegacyStoreError } from "../providers/azure-legacy/errors.js";
import { isLocalStorageString } from "./endpoint-guard.js";
import {
  measureContainer,
  type ContainerMeasurement,
  type SqlCounts,
  type StatsMeasurements,
  type StorageAccountName,
  type TableMeasurement,
} from "./stats.js";

/**
 * Reads the counts and sizes of stats.ts from the legacy stores. Read-only: SELECT COUNT and
 * SUM on SQL, table and blob listings, and entity queries that select `RowKey` (and `result`
 * with `resultBytes`). Errors name the operation only (LegacyStoreError), never a connection
 * string or host.
 */

export interface MeasureOptions {
  /** Read every `result` to sum its length; that reads all response data. */
  readonly resultBytes: boolean;
  /** A line now and then while it lists, for a long run on production. */
  readonly progress?: (line: string) => void;
}

const SQL_COUNTS = `
SELECT
  (SELECT COUNT(*) FROM Users) AS users,
  (SELECT COUNT(*) FROM Users WHERE accesskey IS NOT NULL AND accesskey <> '') AS usersWithAccessKey,
  (SELECT COUNT(*) FROM Users WHERE blocked = 1) AS blockedUsers,
  (SELECT COUNT(*) FROM Surveys) AS surveys,
  (SELECT COUNT(*) FROM Surveys s
     WHERE EXISTS (SELECT 1 FROM Organizations o WHERE o.id = s.userid)) AS projectSurveys,
  (SELECT COUNT(*) FROM Surveys WHERE isarchived = 1) AS archivedSurveys,
  (SELECT COUNT(*) FROM Surveys WHERE DATALENGTH(theme) > 0) AS surveysWithTheme,
  (SELECT COALESCE(SUM(CAST(DATALENGTH(theme) AS bigint)), 0) FROM Surveys) AS themeBytes,
  (SELECT COUNT(*) FROM Organizations) AS projects,
  (SELECT COUNT(*) FROM OrganizationUsers) AS memberships`;

/** Every 100 tables or containers. */
const PROGRESS_EVERY = 100;

async function readSqlCounts(connectionString: string): Promise<SqlCounts> {
  let pool: sql.ConnectionPool;
  try {
    pool = new sql.ConnectionPool(connectionString);
  } catch (error) {
    throw new LegacyStoreError("SQL connect", error);
  }
  pool.on("error", () => undefined);
  try {
    await pool.connect();
    const row = (await pool.request().query(SQL_COUNTS)).recordset[0] as Record<
      keyof SqlCounts,
      number | string
    >;
    // bigint comes back as a string.
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, Number(value)]),
    ) as unknown as SqlCounts;
  } catch (error) {
    throw new LegacyStoreError("SQL counts", error);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

interface Account {
  readonly name: StorageAccountName;
  readonly connectionString: string;
  readonly tables: TableServiceClient;
  readonly blobs: BlobServiceClient;
}

function account(name: StorageAccountName, variable: string, connectionString: string): Account {
  try {
    return {
      name,
      connectionString,
      blobs: BlobServiceClient.fromConnectionString(connectionString),
      tables: TableServiceClient.fromConnectionString(connectionString, {
        allowInsecureConnection: isLocalStorageString(connectionString),
      }),
    };
  } catch {
    throw new Error(`${variable} is not a valid Azure Storage connection string`);
  }
}

/** One account when both strings reach the same table and blob endpoints (layout §2.3). */
function accountsOf(legacy: LegacyConfig): Account[] {
  const surveys = account(
    "surveys",
    "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    legacy.surveysStorageConnectionString,
  );
  const results = account(
    "results",
    "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    legacy.resultsStorageConnectionString,
  );
  const same = surveys.tables.url === results.tables.url && surveys.blobs.url === results.blobs.url;
  return same ? [{ ...surveys, name: "shared" }] : [surveys, results];
}

async function measureTables(
  target: Account,
  options: MeasureOptions,
  progress: (line: string) => void,
): Promise<TableMeasurement[]> {
  const names: string[] = [];
  try {
    for await (const table of target.tables.listTables()) {
      if (table.name) names.push(table.name);
    }
  } catch (error) {
    throw new LegacyStoreError(`list tables (${target.name})`, error);
  }
  const measured: TableMeasurement[] = [];
  for (const name of names) {
    const client = TableClient.fromConnectionString(target.connectionString, name, {
      allowInsecureConnection: isLocalStorageString(target.connectionString),
    });
    const select = options.resultBytes ? ["RowKey", "result"] : ["RowKey"];
    let rows = 0;
    let chars = 0;
    try {
      for await (const entity of client.listEntities<{ result?: unknown }>({
        queryOptions: { select },
      })) {
        rows += 1;
        if (typeof entity.result === "string") chars += entity.result.length;
      }
    } catch (error) {
      throw new LegacyStoreError(`count table rows (${target.name})`, error);
    }
    measured.push({
      account: target.name,
      name,
      rows,
      resultChars: options.resultBytes ? chars : null,
    });
    if (measured.length % PROGRESS_EVERY === 0) {
      progress(`tables (${target.name}): ${measured.length} of ${names.length}`);
    }
  }
  return measured;
}

async function measureContainers(target: Account): Promise<ContainerMeasurement[]> {
  const measured: ContainerMeasurement[] = [];
  try {
    for await (const container of target.blobs.listContainers()) {
      const blobs: { name: string; bytes: number }[] = [];
      for await (const blob of target.blobs.getContainerClient(container.name).listBlobsFlat()) {
        blobs.push({ name: blob.name, bytes: blob.properties.contentLength ?? 0 });
      }
      measured.push(measureContainer(target.name, container.name, blobs));
    }
  } catch (error) {
    throw new LegacyStoreError(`list blobs (${target.name})`, error);
  }
  return measured;
}

export async function measureLegacyStores(
  legacy: LegacyConfig,
  options: MeasureOptions,
): Promise<StatsMeasurements> {
  const progress = options.progress ?? (() => undefined);
  const accounts = accountsOf(legacy);
  const sqlCounts = await readSqlCounts(legacy.sqlConnectionString);
  progress("SQL: counted");
  const tables: TableMeasurement[] = [];
  const containers: ContainerMeasurement[] = [];
  for (const target of accounts) {
    tables.push(...(await measureTables(target, options, progress)));
    progress(`tables (${target.name}): done`);
    containers.push(...(await measureContainers(target)));
    progress(`containers (${target.name}): done`);
  }
  return { sql: sqlCounts, tables, containers, resultBytesMeasured: options.resultBytes };
}
