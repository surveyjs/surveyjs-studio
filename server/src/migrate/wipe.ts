/**
 * `wipe`: empties a migration target so a run can start over (the rehearsals, and a restart before
 * the cutover): every table but `schema_migrations` in one transaction, children before parents,
 * and every byte the `files` table names in the file store. The bytes go first: a stop in between
 * leaves rows a second `wipe` finds. A table the list below does not know is an error before
 * anything is deleted, so a new migration cannot leave rows behind unnoticed. A target that shows
 * use (somebody signed in, or a sign-in other than the one the migration wrote) is refused unless
 * `evenIfUsed`: after the cutover the target is production.
 */
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "kysely";
import type { ByteStore } from "../bytes/types.js";
import { BYTE_KEY } from "../bytes/types.js";
import type { SqlDatabase } from "../sql/database.js";

/** The tables, children first. */
const TABLES = [
  "legacy_files",
  "files",
  "survey_history",
  "survey_responses",
  "completion_markers",
  "saved_views",
  "survey_layouts",
  "private_questions",
  "survey_events",
  "deleted_responses",
  "api_tokens",
  "project_invitations",
  "project_members",
  "password_links",
  "user_identities",
  "legacy_access_keys",
  "surveys",
  "projects",
  "users",
  "migration_state",
] as const;

/** wipe cannot run safely on this schema; nothing was deleted. */
export class WipeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WipeRefused";
  }
}

export interface WipeResult {
  /** Tables emptied. */
  tables: number;
  /** Rows deleted, all tables together. */
  rows: number;
  /** Byte-store objects deleted for the rows of `files`. */
  files: number;
  /**
   * Local store: byte files found under the folder that no `files` row named (deleted too).
   * null for S3: its objects are listed from the `files` table only, so a stray object in the
   * bucket is not found; empty the bucket's prefix by other means if the bucket was shared.
   */
  strayFiles: number | null;
}

/**
 * How the target shows use: users who signed in, and sign-ins other than the `surveyjs` one the
 * migration writes for each person (subject = the user's id).
 */
async function targetUse(
  database: SqlDatabase,
): Promise<{ signedIn: number; otherIdentities: number }> {
  const { rows } = await sql<{ signed_in: number | string; other: number | string }>`
    select
      (select count(*) from users where last_sign_in_at is not null) as signed_in,
      (select count(*) from user_identities i
        where not (i.provider = 'surveyjs' and i.subject = cast(i.user_id as text))) as other
  `.execute(database.db);
  const row = rows[0]!;
  return { signedIn: Number(row.signed_in), otherIdentities: Number(row.other) };
}

async function tableNames(database: SqlDatabase): Promise<string[]> {
  if (database.dialect === "sqlite") {
    const { rows } = await sql<{ name: string }>`
      select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`.execute(
      database.db,
    );
    return rows.map((row) => row.name);
  }
  const { rows } = await sql<{ name: string }>`
    select table_name as name from information_schema.tables
    where table_schema = current_schema() and table_type = 'BASE TABLE'`.execute(database.db);
  return rows.map((row) => row.name);
}

/** Every key file under a local store's folder, as `{dir}/{id}` keys; folders are removed after. */
async function localKeys(root: string): Promise<string[]> {
  const keys: string[] = [];
  let top;
  try {
    top = await readdir(root, { withFileTypes: true });
  } catch {
    return keys;
  }
  for (const dir of top) {
    if (!dir.isDirectory()) continue;
    for (const entry of await readdir(join(root, dir.name), { withFileTypes: true })) {
      const key = `${dir.name}/${entry.name}`;
      if (entry.isFile() && BYTE_KEY.test(key)) keys.push(key);
    }
  }
  return keys;
}

export async function wipeTarget(
  database: SqlDatabase,
  bytes: ByteStore,
  options: { localRoot: string | null; evenIfUsed?: boolean },
): Promise<WipeResult> {
  const known = new Set<string>([...TABLES, "schema_migrations"]);
  const present = new Set(await tableNames(database));
  const unknown = [...present].filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new WipeRefused(
      `wipe does not know the table ${unknown.sort().join(", ")}; nothing was deleted`,
    );
  }
  const missing = TABLES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new WipeRefused(
      `the target lacks the table ${missing.join(", ")} (an older schema?); nothing was deleted`,
    );
  }

  if (options.evenIfUsed !== true) {
    const use = await targetUse(database);
    if (use.signedIn > 0 || use.otherIdentities > 0) {
      throw new WipeRefused(
        `the target shows use (${use.signedIn} users signed in, ${use.otherIdentities} sign-ins ` +
          "other than the migrated one): it may be production. Pass --even-if-used to wipe it " +
          "anyway; nothing was deleted",
      );
    }
  }

  const { db } = database;
  const named = await db.selectFrom("files").select(["id", "survey_id"]).execute();
  const keys = named.map((row) => `${row.survey_id ?? "uploads"}/${row.id}`);
  await bytes.delete(keys);
  let strayFiles: number | null = null;
  if (options.localRoot !== null) {
    const left = await localKeys(options.localRoot);
    strayFiles = left.length;
    await bytes.delete(left);
    // The (now empty) folders of the keys go too, so nothing is left under the root.
    for (const dir of new Set(left.concat(keys).map((key) => key.split("/")[0]!))) {
      await rm(join(options.localRoot, dir), { recursive: true, force: true });
    }
  }

  let rows = 0;
  await db.transaction().execute(async (trx) => {
    for (const table of TABLES) {
      const result = await trx.deleteFrom(table).executeTakeFirst();
      rows += Number(result.numDeletedRows);
    }
  });
  return { tables: TABLES.length, rows, files: keys.length, strayFiles };
}
