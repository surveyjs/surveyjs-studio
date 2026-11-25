/**
 * What the migration tool remembers between runs, in the `migration_state` table: one JSON value
 * per key (the current run, the high-water marks, the surveys already copied).
 */
import { sql, type Kysely } from "kysely";
import type { SqlDialectName } from "../sql/database.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { jsonOf, jsonText } from "../sql/values.js";

export interface MigrationState {
  get<T>(key: string): Promise<T | null>;
  /** Writes the value of the key, replacing an earlier one. */
  set(key: string, value: unknown, at: string): Promise<void>;
  /** The keys that start with the prefix, in order. */
  keys(prefix: string): Promise<string[]>;
  clear(): Promise<void>;
}

export function createMigrationState(
  db: Kysely<DatabaseSchema>,
  dialect: SqlDialectName,
): MigrationState {
  return {
    async get<T>(key: string): Promise<T | null> {
      const row = await db
        .selectFrom("migration_state")
        .select("value")
        .where("key", "=", key)
        .executeTakeFirst();
      return row ? jsonOf<T>(row.value) : null;
    },
    async set(key, value, at) {
      const text = jsonText(dialect, value);
      await db
        .insertInto("migration_state")
        .values({ key, value: text, updated_at: at })
        .onConflict((oc) => oc.column("key").doUpdateSet({ value: text, updated_at: at }))
        .execute();
    },
    async keys(prefix) {
      // starts-with by range-free comparison: substr is exact where LIKE would read % and _
      const rows = await db
        .selectFrom("migration_state")
        .select("key")
        .where(sql<boolean>`substr(key, 1, ${prefix.length}) = ${prefix}`)
        .orderBy("key")
        .execute();
      return rows.map((row) => row.key);
    },
    async clear() {
      await db.deleteFrom("migration_state").execute();
    },
  };
}
