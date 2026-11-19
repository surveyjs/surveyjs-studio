import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalByteStore } from "../bytes/local.js";
import type { ByteStore } from "../bytes/types.js";
import type { SqlDialectName } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { openDatabase, scratchDatabase } from "../sql/scratch-databases.js";
import { seedSqlStores } from "../sql/seed.js";
import { withSeedInvitation } from "./seed-invitations.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createSqlCredentialStore } from "../sql/credential-store.js";
import { createSqlProjectStore } from "../sql/project-store.js";
import { usersById } from "../sql/account-store.js";
import { createSqlProviders } from "./sql.js";
import type { CredentialsUnderTest } from "./suite/credential-store-suite.js";
import type { ProviderSet } from "./types.js";

/** Where a suite run keeps file bytes, and how to remove them afterwards. */
export interface SuiteBytes {
  readonly store: ByteStore;
  remove(): Promise<void>;
}

/** File bytes in a new temporary folder. */
export function localSuiteBytes(): Promise<SuiteBytes> {
  const root = mkdtempSync(join(tmpdir(), "surveyjs-studio-suite-files-"));
  return Promise.resolve({
    store: createLocalByteStore(root),
    remove: () =>
      Promise.resolve(
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
      ),
  });
}

/**
 * A SQL provider set on a new scratch database, migrated and holding the golden fixtures (the
 * memory provider behind the users holds them too), with file bytes from `bytes` (default a
 * temporary folder). `close` drops the database and removes the bytes.
 */
export async function createSeededSqlProviders(
  dialect: SqlDialectName,
  bytes: () => Promise<SuiteBytes> = localSuiteBytes,
  options: { readonly localAccounts?: boolean } = {},
): Promise<ProviderSet> {
  const scratch = await scratchDatabase(dialect);
  const database = openDatabase(scratch.target);
  await migrate(database);
  const seed = await legacyFixtureSeed();
  const files = await bytes();
  await seedSqlStores(database, withSeedInvitation(seed), { bytes: files.store });
  const providers = createSqlProviders(database, {
    fallbackSeed: seed,
    bytes: files.store,
    ...(options.localAccounts && { localAccounts: true }),
  });
  return {
    ...providers,
    async close() {
      await providers.close();
      await scratch.drop();
      await files.remove();
    },
  };
}

/** The SQL credential store on a new, migrated scratch database; `close` drops it. */
export async function scratchCredentials(dialect: SqlDialectName): Promise<CredentialsUnderTest> {
  const scratch = await scratchDatabase(dialect);
  const database = openDatabase(scratch.target);
  await migrate(database);
  const projects = createSqlProjectStore(database, usersById);
  return {
    store: createSqlCredentialStore(database),
    seedsLegacyKeys: false,
    seedLegacyKey: () => Promise.reject(new Error("The SQL store has no legacy keys")),
    async newProjectId() {
      const id = randomUUID();
      await projects.createProject({
        id,
        name: `Project ${id}`,
        creatorId: randomUUID(),
        createdAt: "2026-11-01T10:00:00.000Z",
      });
      return id;
    },
    async close() {
      await database.close();
      await scratch.drop();
    },
  };
}
