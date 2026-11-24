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
        "api_tokens",
        "completion_markers",
        "files",
        "legacy_files",
        "password_links",
        "private_questions",
        "project_invitations",
        "project_members",
        "projects",
        "saved_views",
        "survey_history",
        "survey_layouts",
        "survey_responses",
        "surveys",
        "user_identities",
        "users",
      ]);
      expect((await migrationStatus(database)).pending).toEqual([]);
    });

    it("moves the old per-survey layouts into survey_layouts (0009)", async () => {
      const { database } = await fresh();
      const shipped = loadMigrations(dialect);
      await migrate(
        database,
        shipped.filter((m) => m.version < 9),
      );
      const surveyId = "22222222-0000-4000-8000-a00000000001";
      await sql`insert into legacy_views (survey_id, view, state)
        values (${surveyId}, 'table', ${'{"pageSize":10}'})`.execute(database.db);
      await migrate(database, shipped);
      const { rows } = await sql<{
        survey_id: string;
        kind: string;
        text: string;
      }>`select survey_id, kind, text from survey_layouts`.execute(database.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ survey_id: surveyId, kind: "table" });
      expect(JSON.parse(rows[0]!.text)).toEqual({ pageSize: 10 });
    });

    it("adds site_blocked and licence_expires_at and keeps the accounts (0010)", async () => {
      const { database } = await fresh();
      const { db } = database;
      const shipped = loadMigrations(dialect);
      await migrate(
        database,
        shipped.filter((m) => m.version < 10),
      );
      const userId = "11111111-0000-4000-8000-a00000000001";
      await sql`insert into users (id, email, display_name, instance_role, status,
          must_change_password, session_epoch, created_at)
        values (${userId}, 'old@example.com', 'Old', 'user', 'active', false, 0,
          '2026-09-01T10:00:00.000Z')`.execute(db);
      await migrate(database, shipped);
      const { rows } = await sql<{
        email: string;
        site_blocked: boolean | number;
        licence_expires_at: unknown;
      }>`select email, site_blocked, licence_expires_at from users`.execute(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.email).toBe("old@example.com");
      expect(Number(rows[0]!.site_blocked)).toBe(0);
      expect(rows[0]!.licence_expires_at).toBeNull();
    });

    it("keeps the files and their legacy names when files gains an owner (0009)", async () => {
      const { database } = await fresh();
      const { db } = database;
      const shipped = loadMigrations(dialect);
      await migrate(
        database,
        shipped.filter((m) => m.version < 9),
      );
      const surveyId = "22222222-0000-4000-8000-a00000000001";
      const ownerId = "11111111-0000-4000-8000-a00000000001";
      const fileId = `${surveyId.replaceAll("-", "")}${"ab".repeat(16)}`;
      const createdAt = "2026-09-01T10:00:00.000Z";
      await sql`insert into files (id, survey_id, kind, name, content_type, size, created_at)
        values (${fileId}, ${surveyId}, 'asset', 'logo.png', 'image/png', 12, ${createdAt})`.execute(
        db,
      );
      await sql`insert into legacy_files (kind, legacy_name, file_id)
        values ('asset', 'a.png', ${fileId})`.execute(db);

      await migrate(database, shipped);
      const files = await sql<{
        id: string;
        survey_id: string | null;
        owner_user_id: string | null;
        name: string;
        size: number | string;
      }>`select id, survey_id, owner_user_id, name, size from files`.execute(db);
      expect(files.rows.map((row) => ({ ...row, size: Number(row.size) }))).toEqual([
        { id: fileId, survey_id: surveyId, owner_user_id: null, name: "logo.png", size: 12 },
      ]);
      const names = await sql`select kind, legacy_name, file_id from legacy_files`.execute(db);
      expect(names.rows).toEqual([{ kind: "asset", legacy_name: "a.png", file_id: fileId }]);
      if (dialect === "sqlite") {
        expect((await sql`pragma foreign_key_check`.execute(db)).rows).toEqual([]);
        const keys = await sql<{
          table: string;
        }>`select "table" from pragma_foreign_key_list('legacy_files')`.execute(db);
        expect(keys.rows).toEqual([{ table: "files" }]);
      }

      // Exactly one of the survey and the owner.
      const insertFile = (id: string, survey: string | null, owner: string | null) =>
        sql`insert into files (id, survey_id, owner_user_id, kind, name, content_type, size, created_at)
          values (${id}, ${survey}, ${owner}, 'asset', 'x.png', 'image/png', 1, ${createdAt})`.execute(
          db,
        );
      const ownerFileId = `${ownerId.replaceAll("-", "")}${"cd".repeat(16)}`;
      await expect(insertFile(ownerFileId, null, null)).rejects.toThrow();
      await expect(insertFile(ownerFileId, surveyId, ownerId)).rejects.toThrow();
      await insertFile(ownerFileId, null, ownerId);

      // The legacy names still refer to files: an unknown file is refused, and a file's names go
      // with it.
      await expect(
        sql`insert into legacy_files (kind, legacy_name, file_id)
          values ('asset', 'b.png', ${"f".repeat(64)})`.execute(db),
      ).rejects.toThrow();
      await sql`delete from files where id = ${fileId}`.execute(db);
      expect((await sql`select legacy_name from legacy_files`.execute(db)).rows).toEqual([]);
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
