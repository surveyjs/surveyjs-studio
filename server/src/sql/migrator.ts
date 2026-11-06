import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, type Kysely } from "kysely";
import type { SqlDatabase, SqlDialectName } from "./database.js";
import type { DatabaseSchema } from "./schema.js";
import { isoOf } from "./values.js";

/** One plain-SQL migration file, `NNNN-name.sql` (ADR 0024). */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  /** ISO 8601 UTC. */
  readonly appliedAt: string;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  /** Known to this version, not applied yet: the next start (or `db:migrate`) applies them. */
  readonly pending: readonly Migration[];
  /** Applied, but unknown to this version: a newer version migrated the database. */
  readonly unknown: readonly AppliedMigration[];
}

export interface MigrationRun {
  readonly applied: readonly Migration[];
}

/** The database was migrated by a newer version of the app (S6). */
export class DatabaseTooNewError extends Error {
  constructor(migration: AppliedMigration) {
    super(
      `The database has migration ${label(migration)}, which this version of SurveyJS Studio does not know: a newer version migrated it. Run that version or a newer one.`,
    );
    this.name = "DatabaseTooNewError";
  }
}

/** A recorded migration and this version's file of that number have different names. */
export class MigrationMismatchError extends Error {
  constructor(recorded: AppliedMigration, known: Migration) {
    super(
      `Migration ${pad(known.version)} is recorded as ${label(recorded)}, but this version calls it ${label(known)}.`,
    );
    this.name = "MigrationMismatchError";
  }
}

const pad = (version: number): string => String(version).padStart(4, "0");
const label = (m: { version: number; name: string }): string => `${pad(m.version)}-${m.name}`;

/** `server/sql`: one folder per dialect. */
const MIGRATIONS_ROOT = fileURLToPath(new URL("../../sql/", import.meta.url));

const FILE_NAME = /^(\d{4})-([a-z0-9-]+)\.sql$/;

/** The dialect's migration files, in version order; refuses gaps, duplicates and bad names. */
export function loadMigrations(dialect: SqlDialectName, root = MIGRATIONS_ROOT): Migration[] {
  const folder = join(root, dialect);
  const migrations = readdirSync(folder)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => {
      const match = FILE_NAME.exec(file);
      if (!match) throw new Error(`Migration file names are NNNN-name.sql: ${file}`);
      return {
        version: Number(match[1]),
        name: match[2]!,
        sql: readFileSync(join(folder, file), "utf8"),
      };
    })
    .sort((a, b) => a.version - b.version);
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      const previous = index === 0 ? "the start" : pad(migrations[index - 1]!.version);
      throw new Error(
        `Migrations must be numbered 0001, 0002, … without gaps: ${label(migration)}.sql follows ${previous}`,
      );
    }
  });
  return migrations;
}

/**
 * The statements of a migration file: split where a `;` ends a line (ADR 0024), with `--` comment
 * lines and blank lines dropped. A file never puts a `;` at the end of a line inside a statement.
 */
export function splitStatements(text: string): string[] {
  return text
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim(),
    )
    .filter((statement) => statement !== "");
}

/** A constant key for PostgreSQL's advisory lock: the migrator's own, held until commit. */
const POSTGRES_LOCK_KEY = 4_211_201;

const createTable = (dialect: SqlDialectName) =>
  sql.raw(
    `create table if not exists schema_migrations (version integer primary key, name text not null, applied_at ${
      dialect === "postgres" ? "timestamptz(3)" : "text"
    } not null)`,
  );

async function readApplied(db: Kysely<DatabaseSchema>): Promise<AppliedMigration[]> {
  const rows = await db
    .selectFrom("schema_migrations")
    .select(["version", "name", "applied_at"])
    .orderBy("version")
    .execute();
  return rows.map((row) => ({
    version: Number(row.version),
    name: row.name,
    appliedAt: isoOf(row.applied_at),
  }));
}

function compare(
  applied: readonly AppliedMigration[],
  migrations: readonly Migration[],
): MigrationStatus {
  const known = new Map(migrations.map((m) => [m.version, m]));
  const done = new Set(applied.map((m) => m.version));
  return {
    applied,
    pending: [...migrations]
      .filter((m) => !done.has(m.version))
      .sort((a, b) => a.version - b.version),
    unknown: applied.filter((m) => !known.has(m.version)),
  };
}

/** Which migrations the database has, and which it lacks. Writes nothing. */
export async function migrationStatus(
  database: SqlDatabase,
  migrations: readonly Migration[] = loadMigrations(database.dialect),
): Promise<MigrationStatus> {
  const tables = await database.db.introspection.getTables();
  const exists = tables.some((table) => table.name === "schema_migrations");
  return compare(exists ? await readApplied(database.db) : [], migrations);
}

/**
 * Applies the pending migrations in version order, all in one transaction under the migrator's
 * lock (SQLite: `BEGIN IMMEDIATE`; PostgreSQL: an advisory transaction lock), so two servers
 * starting together apply each migration once and a failure leaves the database as it was.
 * Refuses a database a newer version migrated (DatabaseTooNewError) and a recorded migration whose
 * name differs (MigrationMismatchError), before it changes anything.
 */
export async function migrate(
  database: SqlDatabase,
  migrations: readonly Migration[] = loadMigrations(database.dialect),
): Promise<MigrationRun> {
  return database.db.connection().execute(async (db) => {
    if (database.dialect === "sqlite") {
      await sql`begin immediate`.execute(db);
    } else {
      await sql`begin`.execute(db);
      await sql`select pg_advisory_xact_lock(${POSTGRES_LOCK_KEY})`.execute(db);
    }
    try {
      await createTable(database.dialect).execute(db);
      const status = compare(await readApplied(db), migrations);
      if (status.unknown.length > 0) throw new DatabaseTooNewError(status.unknown[0]!);
      const known = new Map(migrations.map((m) => [m.version, m]));
      for (const recorded of status.applied) {
        const migration = known.get(recorded.version)!;
        if (migration.name !== recorded.name) throw new MigrationMismatchError(recorded, migration);
      }
      for (const migration of status.pending) {
        for (const statement of splitStatements(migration.sql)) {
          await sql.raw(statement).execute(db);
        }
        await db
          .insertInto("schema_migrations")
          .values({
            version: migration.version,
            name: migration.name,
            applied_at: new Date().toISOString(),
          })
          .execute();
      }
      await sql`commit`.execute(db);
      return { applied: status.pending };
    } catch (error) {
      await sql`rollback`.execute(db);
      throw error;
    }
  });
}
