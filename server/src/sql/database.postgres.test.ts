import { sql } from "kysely";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { scratchPostgres } from "./scratch-databases.js";

describe("openDatabase (postgres)", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("survives an idle connection that the server ends, reports it, and connects again", async () => {
    const scratch = await scratchPostgres();
    cleanups.push(() => scratch.drop());
    if (scratch.target.dialect !== "postgres") throw new Error("unreachable");
    const codes: string[] = [];
    const database = openDatabase(scratch.target, {
      onConnectionError: (code) => codes.push(code),
    });
    cleanups.unshift(() => database.close());

    const { rows } = await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(
      database.db,
    );
    const admin = new pg.Client({ connectionString: scratch.target.url });
    await admin.connect();
    try {
      await admin.query("select pg_terminate_backend($1)", [rows[0]!.pid]);
    } finally {
      await admin.end();
    }
    await expect.poll(() => codes, { timeout: 5000 }).toEqual(["57P01"]);

    const again = await sql<{ one: number }>`select 1 as one`.execute(database.db);
    expect(again.rows).toEqual([{ one: 1 }]);
  });
});
