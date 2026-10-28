import { sql } from "kysely";
import type { AccountNoticesSetting, AppConfig } from "../config.js";
import { openDatabase, type SqlDatabase } from "../sql/database.js";
import { DatabaseTooNewError, migrate, migrationStatus, type Migration } from "../sql/migrator.js";
import { createSqlResultStore } from "../sql/result-store.js";
import { createSqlSurveyStore } from "../sql/survey-store.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import type { LegacyWarningLogger } from "./azure-legacy/index.js";
import { createMemoryProviders, type MemorySeed } from "./memory.js";
import type { ProviderSet, ReadinessCheck } from "./types.js";

export interface SqlProviderOptions {
  /**
   * Seeds the memory fallback (`MEMORY_SEED`): users, projects, results, views and files stay in
   * memory until self-hosted Steps 2–4 move them to SQL.
   */
  readonly fallbackSeed?: MemorySeed;
  /** `ACCOUNT_NOTICES`; default `none`. */
  readonly accountNotices?: AccountNoticesSetting;
}

/** READ_ONLY=true must not change the schema, and the code needs the schema it was built for. */
export class PendingMigrationsError extends Error {
  constructor(pending: readonly Migration[]) {
    const names = pending.map((m) => `${String(m.version).padStart(4, "0")}-${m.name}`);
    super(
      `READ_ONLY=true, but the database lacks migration${names.length === 1 ? "" : "s"} ${names.join(", ")}: run pnpm db:migrate (or start once without READ_ONLY) first.`,
    );
    this.name = "PendingMigrationsError";
  }
}

/**
 * Opens the configured database and brings its schema up to date (the migrations run at
 * start-up), then builds the provider set. With READ_ONLY=true nothing is migrated: pending
 * migrations refuse the start (PendingMigrationsError). A database a newer version migrated is
 * refused either way (DatabaseTooNewError). The database is closed when the start is refused.
 */
export async function openSqlProviders(
  config: AppConfig,
  accountNotices: AccountNoticesSetting,
  logger?: LegacyWarningLogger,
): Promise<ProviderSet> {
  if (!config.database)
    throw new Error(`STORAGE_PROVIDER=${config.storageProvider} needs a database`);
  const database = openDatabase(config.database, {
    onConnectionError: (code) =>
      logger?.warn({ code }, "A database connection was closed; the next query opens a new one."),
  });
  try {
    if (config.readOnly) {
      const status = await migrationStatus(database);
      if (status.unknown.length > 0) throw new DatabaseTooNewError(status.unknown[0]!);
      if (status.pending.length > 0) throw new PendingMigrationsError(status.pending);
    } else {
      await migrate(database);
    }
  } catch (error) {
    await database.close();
    throw error;
  }
  return createSqlProviders(database, {
    accountNotices,
    ...(config.memorySeed === "legacy-fixtures" && { fallbackSeed: await legacyFixtureSeed() }),
  });
}

/** How long the readiness check waits for the database. */
const READY_TIMEOUT_MS = 3000;

async function probe(database: SqlDatabase): Promise<Omit<ReadinessCheck, "name">> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<Omit<ReadinessCheck, "name">>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "timeout" }), READY_TIMEOUT_MS);
  });
  const query = sql`select 1`.execute(database.db).then(
    () => ({ ok: true }),
    (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      return { ok: false, ...(typeof code === "string" && { reason: code }) };
    },
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The SQL provider set on an open, migrated database (self-hosted track). Surveys are in the
 * database; until Steps 2–4 the other stores are the memory provider's (`fallbackSeed`), so they
 * are lost on restart and erasure and project deletion do not reach the database. `close` closes
 * the database.
 */
export function createSqlProviders(
  database: SqlDatabase,
  options: SqlProviderOptions = {},
): ProviderSet {
  const fallback = createMemoryProviders(options.fallbackSeed, {
    ...(options.accountNotices && { accountNotices: options.accountNotices }),
  });
  return {
    name: database.dialect,
    surveys: createSqlSurveyStore(database),
    users: fallback.users,
    projects: fallback.projects,
    files: fallback.files,
    results: createSqlResultStore(database),
    views: fallback.views,
    notices: fallback.notices,
    readinessNames: ["database"],
    ready: async () => [{ name: "database", ...(await probe(database)) }],
    close: () => database.close(),
  };
}
