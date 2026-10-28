import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kysely, SqliteDialect, sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openNodeSqlite } from "./node-sqlite.js";

interface TestSchema {
  parent: { id: string };
  child: { id: string; parent_id: string; note: string | null };
}

const open = (path = ":memory:") =>
  new Kysely<TestSchema>({ dialect: new SqliteDialect({ database: openNodeSqlite(path) }) });

async function withTables(db: Kysely<TestSchema>): Promise<void> {
  await sql`create table parent (id text primary key)`.execute(db);
  await sql`create table child (id text primary key, parent_id text not null references parent (id), note text)`.execute(
    db,
  );
}

describe("openNodeSqlite (Kysely over node:sqlite)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads rows, and reports the rows a write changed", async () => {
    const db = open();
    await withTables(db);
    const inserted = await db
      .insertInto("parent")
      .values([{ id: "a" }, { id: "b" }])
      .executeTakeFirst();
    expect(inserted.numInsertedOrUpdatedRows).toBe(2n);
    const deleted = await db.deleteFrom("parent").where("id", "=", "b").executeTakeFirst();
    expect(deleted.numDeletedRows).toBe(1n);
    expect(await db.selectFrom("parent").selectAll().execute()).toEqual([{ id: "a" }]);
    await db.destroy();
  });

  it("returns rows from insert ... returning", async () => {
    const db = open();
    await withTables(db);
    expect(await db.insertInto("parent").values({ id: "r" }).returning("id").execute()).toEqual([
      { id: "r" },
    ]);
    await db.destroy();
  });

  // The SQL stores pass booleans as parameters; node:sqlite binds them as the integers 1 and 0.
  it("binds JS booleans as the integers 1 and 0", async () => {
    const db = open();
    const { rows } = await sql<{
      t: string;
      yes: number;
      no: number;
    }>`select typeof(${true}) t, ${true} yes, ${false} no`.execute(db);
    expect(rows).toEqual([{ t: "integer", yes: 1, no: 0 }]);
    await db.destroy();
  });

  it("enforces foreign keys", async () => {
    const db = open();
    await withTables(db);
    await expect(
      db.insertInto("child").values({ id: "c", parent_id: "missing", note: null }).execute(),
    ).rejects.toThrow(/FOREIGN KEY/);
    await db.destroy();
  });

  it("rolls a failed transaction back", async () => {
    const db = open();
    await withTables(db);
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("parent").values({ id: "t" }).execute();
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await db.selectFrom("parent").selectAll().execute()).toEqual([]);
    await db.destroy();
  });

  it("keeps a file database across connections, in WAL mode", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-"));
    dirs.push(dir);
    const path = join(dir, "test.db");
    const first = open(path);
    await withTables(first);
    await first.insertInto("parent").values({ id: "kept" }).execute();
    await first.destroy();
    const second = open(path);
    expect(await second.selectFrom("parent").selectAll().execute()).toEqual([{ id: "kept" }]);
    const { rows } = await sql<{ journal_mode: string }>`pragma journal_mode`.execute(second);
    expect(rows).toEqual([{ journal_mode: "wal" }]);
    await second.destroy();
  });
});
