import type { SqlDialectName } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { openDatabase, scratchDatabase } from "../sql/scratch-databases.js";
import { seedSqlStores } from "../sql/seed.js";
import type { ProviderSuiteSection } from "./suite/provider-suite.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createSqlProviders } from "./sql.js";
import type { ProviderSet } from "./types.js";

/** The stores on SQL so far (self-hosted Step 1); the rest are the memory fallback. */
export const SQL_SUITE_SECTIONS: readonly ProviderSuiteSection[] = ["surveys", "results", "views", "lifecycle"];

/**
 * A SQL provider set on a new scratch database, migrated and holding the golden fixtures (the
 * memory fallback holds them too). `close` drops the database.
 */
export async function createSeededSqlProviders(dialect: SqlDialectName): Promise<ProviderSet> {
  const scratch = await scratchDatabase(dialect);
  const database = openDatabase(scratch.target);
  await migrate(database);
  const seed = await legacyFixtureSeed();
  await seedSqlStores(database, seed);
  const providers = createSqlProviders(database, { fallbackSeed: seed });
  return {
    ...providers,
    async close() {
      await providers.close();
      await scratch.drop();
    },
  };
}
