import type { InvitationsUnderTest } from "../providers/suite/invitation-store-suite.js";
import { usersById } from "./account-store.js";
import type { SqlDialectName } from "./database.js";
import { createSqlInvitationStore } from "./invitation-store.js";
import { migrate } from "./migrator.js";
import { createSqlProjectStore } from "./project-store.js";
import { openDatabase, scratchDatabase } from "./scratch-databases.js";

/** The SQL invitation store on a new, migrated scratch database; `close` drops it. */
export async function scratchInvitations(dialect: SqlDialectName): Promise<InvitationsUnderTest> {
  const scratch = await scratchDatabase(dialect);
  const database = openDatabase(scratch.target);
  await migrate(database);
  return {
    invitations: createSqlInvitationStore(database),
    projects: createSqlProjectStore(database, usersById),
    async close() {
      await database.close();
      await scratch.drop();
    },
  };
}
