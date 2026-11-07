import type { LocalAccountsUnderTest } from "../providers/suite/account-store-suite.js";
import { createSqlLocalAccounts } from "./account-store.js";
import type { SqlDialectName } from "./database.js";
import { migrate } from "./migrator.js";
import { openDatabase, scratchDatabase } from "./scratch-databases.js";

/** The SQL local accounts on a new, migrated scratch database; `close` drops it. */
export async function scratchLocalAccounts(
  dialect: SqlDialectName,
): Promise<LocalAccountsUnderTest> {
  const scratch = await scratchDatabase(dialect);
  const database = openDatabase(scratch.target);
  await migrate(database);
  return {
    ...createSqlLocalAccounts(database),
    async close() {
      await database.close();
      await scratch.drop();
    },
  };
}
