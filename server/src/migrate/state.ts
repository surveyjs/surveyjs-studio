/**
 * What the migration tool remembers between runs, in the `migration_state` table: one JSON value
 * per key (the current run, the high-water marks, the surveys already copied).
 */
import { sql, type Kysely } from "kysely";
import type { SqlDialectName } from "../sql/database.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { jsonOf, jsonText } from "../sql/values.js";
import { sampleMismatch, type SampleSet, type StoredSample } from "./sample.js";

export interface MigrationState {
  get<T>(key: string): Promise<T | null>;
  /** Writes the value of the key, replacing an earlier one. */
  set(key: string, value: unknown, at: string): Promise<void>;
  /** The keys that start with the prefix, in order. */
  keys(prefix: string): Promise<string[]>;
  /** Removes the key; nothing when it is not there. */
  delete(key: string): Promise<void>;
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
    async delete(key) {
      await db.deleteFrom("migration_state").where("key", "=", key).execute();
    },
    async clear() {
      await db.deleteFrom("migration_state").execute();
    },
  };
}

/** A command refused before it changed anything (exit 2): the target does not fit it. */
export class Refused extends Error {
  override name = "Refused";
}

/** State key `sample`: the copy's sample (`StoredSample`), or null for a full copy. */
export const SAMPLE = "sample";
/** State key `copy:complete`: a copy finished a whole pass (`{ at }`). */
export const COPY_COMPLETE = "copy:complete";

/** Refuses a command whose `--sample`/`--include` differ from the copy's. */
export async function requireSameSample(
  state: MigrationState,
  sample: SampleSet | undefined,
): Promise<void> {
  const why = sampleMismatch(await state.get<StoredSample>(SAMPLE), sample);
  if (why !== null) throw new Refused(why);
}

/**
 * Refuses `delta` and `reconcile` until a copy has finished a whole pass: what a stopped copy
 * never reached (events, views, Studio's own files from before the marks) no delta reads.
 */
export async function requireCompleteCopy(state: MigrationState): Promise<void> {
  if ((await state.get(COPY_COMPLETE)) === null) {
    throw new Refused(
      "no copy has finished in this target: run copy (again) until it ends with copy: done",
    );
  }
}
