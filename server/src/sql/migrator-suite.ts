import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "./database.js";
import {
  DatabaseTooNewError,
  MigrationMismatchError,
  loadMigrations,
  migrate,
  migrationStatus,
  type Migration,
} from "./migrator.js";
import { scratchDatabase, type ScratchDatabase } from "./scratch-databases.js";

/** Two migrations that work on both dialects; the second has two statements. */
export const testMigrations: readonly Migration[] = [
  { version: 1, name: "first", sql: "create table first_table (id integer primary key);" },
  {
    version: 2,
    name: "second",
    sql: "create table second_table (id integer primary key);\ninsert into second_table (id) values (7);\n",
  },
];

const tablesOf = async (database: SqlDatabase): Promise<string[]> => {
  const names = (await database.db.introspection.getTables()).map((table) => table.name);
  return names.filter((name) => name !== "schema_migrations").sort();
};

/** The migrator's behaviour on one dialect, each test on an empty database. */
export function describeMigratorSuite(dialect: SqlDialectName): void {
  describe(`migrator: ${dialect}`, () => {
    const opened: SqlDatabase[] = [];
    const scratches: ScratchDatabase[] = [];
    afterEach(async () => {
      for (const database of opened.splice(0)) await database.close();
      for (const scratch of scratches.splice(0)) await scratch.drop();
    });
    const fresh = async (): Promise<{ scratch: ScratchDatabase; database: SqlDatabase }> => {
      const scratch = await scratchDatabase(dialect);
      scratches.push(scratch);
      const database = openDatabase(scratch.target);
      opened.push(database);
      return { scratch, database };
    };
    const reopen = (scratch: ScratchDatabase): SqlDatabase => {
      const database = openDatabase(scratch.target);
      opened.push(database);
      return database;
    };

    it("applies the migrations in version order and records them", async () => {
      const { database } = await fresh();
      const run = await migrate(database, [...testMigrations].reverse());
      expect(run.applied.map((m) => m.version)).toEqual([1, 2]);
      expect(await tablesOf(database)).toEqual(["first_table", "second_table"]);
      const { rows } = await sql<{ id: number }>`select id from second_table`.execute(database.db);
      expect(rows).toEqual([{ id: 7 }]);
      const status = await migrationStatus(database, testMigrations);
      expect(status.applied.map(({ version, name }) => ({ version, name }))).toEqual([
        { version: 1, name: "first" },
        { version: 2, name: "second" },
      ]);
      expect(status.pending).toEqual([]);
      expect(status.unknown).toEqual([]);
      expect(status.applied.every((m) => !Number.isNaN(Date.parse(m.appliedAt)))).toBe(true);
    });

    it("applies only what is pending, and nothing on a second run", async () => {
      const { database } = await fresh();
      await migrate(database, testMigrations.slice(0, 1));
      expect((await migrationStatus(database, testMigrations)).pending.map((m) => m.name)).toEqual([
        "second",
      ]);
      expect((await migrate(database, testMigrations)).applied.map((m) => m.name)).toEqual([
        "second",
      ]);
      expect((await migrate(database, testMigrations)).applied).toEqual([]);
    });

    it("reports an empty database as all pending", async () => {
      const { database } = await fresh();
      const status = await migrationStatus(database, testMigrations);
      expect(status.applied).toEqual([]);
      expect(status.pending.map((m) => m.version)).toEqual([1, 2]);
    });

    it("refuses a database migrated by a newer version, and changes nothing", async () => {
      const { scratch, database } = await fresh();
      await migrate(database, testMigrations);
      const older = reopen(scratch);
      const error = await migrate(older, testMigrations.slice(0, 1)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DatabaseTooNewError);
      expect((error as Error).message).toBe(
        "The database has migration 0002-second, which this version of SurveyJS Studio does not know: a newer version migrated it. Run that version or a newer one.",
      );
      const status = await migrationStatus(older, testMigrations.slice(0, 1));
      expect(status.unknown.map((m) => m.version)).toEqual([2]);
    });

    it("refuses a recorded migration whose name differs", async () => {
      const { database } = await fresh();
      await migrate(database, testMigrations.slice(0, 1));
      const renamed = [{ ...testMigrations[0]!, name: "renamed" }];
      await expect(migrate(database, renamed)).rejects.toThrow(MigrationMismatchError);
      await expect(migrate(database, renamed)).rejects.toThrow(
        "Migration 0001 is recorded as 0001-first, but this version calls it 0001-renamed.",
      );
    });

    it("rolls the whole run back when a migration fails", async () => {
      const { database } = await fresh();
      const broken: Migration = { version: 3, name: "broken", sql: "create table oops (;" };
      await expect(migrate(database, [...testMigrations, broken])).rejects.toThrow();
      expect(await tablesOf(database)).toEqual([]);
      expect((await migrationStatus(database, testMigrations)).applied).toEqual([]);
    });

    it("applies the shipped migrations to an empty database", async () => {
      const { database } = await fresh();
      const shipped = loadMigrations(dialect);
      expect((await migrate(database)).applied).toEqual(shipped);
      expect(await tablesOf(database)).toEqual([
        "completion_markers",
        "files",
        "legacy_views",
        "password_links",
        "private_questions",
        "project_invitations",
        "project_members",
        "projects",
        "saved_views",
        "survey_history",
        "survey_responses",
        "surveys",
        "user_identities",
        "users",
      ]);
      expect((await migrationStatus(database)).pending).toEqual([]);
    });

    if (dialect === "postgres") {
      // SQLite's lock is checked across processes in migrator.test.ts (node:sqlite is synchronous).
      it("applies each migration once when two servers start together", async () => {
        const { scratch, database } = await fresh();
        const other = reopen(scratch);
        const runs = await Promise.all([
          migrate(database, testMigrations),
          migrate(other, testMigrations),
        ]);
        expect(runs.map((run) => run.applied.length).sort()).toEqual([0, 2]);
        expect((await migrationStatus(database, testMigrations)).applied).toHaveLength(2);
      });
    }
  });
}
