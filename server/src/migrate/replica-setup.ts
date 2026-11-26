/**
 * Test setup shared by the migration tool's replica tests (`*.azurite.test.ts`): a fresh migrated
 * SQLite target with its byte store, a copy from the local replica, and the target opened as the
 * hosted app opens it (the local user directory, ADR 0043). Azurite has no file service: the
 * legacy shares are the stub over the fixtures' share files.
 */
import type { Readable } from "node:stream";
import { replicaConfig } from "../legacy/replica-env.js";
import type { LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { createStubShareReader } from "../providers/azure-legacy/legacy-shares-stub.js";
import { localSuiteBytes, type SuiteBytes } from "../providers/sql-suite-setup.js";
import { createSqlProviders } from "../providers/sql.js";
import type { ProviderSet } from "../providers/types.js";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { runCopy, type CopyOptions } from "./copy.js";
import { createReport, type Report } from "./map/report.js";
import type { HighWaterMarks } from "./marks.js";
import { openLegacySource, type LegacySource } from "./source/index.js";
import { openMigrationTarget, type MigrationTarget } from "./target.js";

export interface Target {
  database: SqlDatabase;
  bytes: SuiteBytes;
  target: MigrationTarget;
  close(): Promise<void>;
}

/** A migrated scratch SQLite database and a local byte store; `close` removes both. */
export async function newTarget(): Promise<Target> {
  const scratch: ScratchDatabase = scratchSqlite();
  const database = openDatabase(scratch.target);
  await migrate(database);
  const bytes = await localSuiteBytes();
  const target = openMigrationTarget(database, bytes.store);
  return {
    database,
    bytes,
    target,
    async close() {
      await target.close();
      await database.close();
      await scratch.drop();
      await bytes.remove();
    },
  };
}

export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** The replica as the tool reads it, the shares being the stub over the fixtures' files. */
export const openReplicaSource = (fixtures: LegacyFixtures): LegacySource =>
  openLegacySource(replicaConfig(), { shares: createStubShareReader(fixtures.files) });

/** A copy from the replica into `into`; the report it made. */
export async function copyFromReplica(
  into: Target,
  fixtures: LegacyFixtures,
  options: Partial<CopyOptions> = {},
): Promise<Report> {
  const report = options.report ?? createReport();
  const source = openReplicaSource(fixtures);
  try {
    await runCopy(source, into.target, { ...options, report });
  } finally {
    await source.close();
  }
  return report;
}

/** The target opened as the hosted app opens it: the users come from the database. */
export const targetProviders = (into: Target): ProviderSet =>
  createSqlProviders(into.database, { bytes: into.bytes.store, localAccounts: true });

/** Marks with every part at one time (tests that move the marks past a change). */
export const marksAt = (at: string): HighWaterMarks => ({
  takenAt: at,
  sql: { users: at, surveys: at, organizations: at, organizationUsers: at },
  tables: at,
  blobs: at,
});
