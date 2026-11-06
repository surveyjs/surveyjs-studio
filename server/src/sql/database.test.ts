import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

describe("openDatabase (sqlite)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("creates the folder of a new database file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sqlite-"));
    dirs.push(dir);
    const path = join(dir, "nested", "data", "studio.db");
    const database = openDatabase({ dialect: "sqlite", path });
    expect(database.dialect).toBe("sqlite");
    const { rows } = await sql<{ one: number }>`select 1 as one`.execute(database.db);
    expect(rows).toEqual([{ one: 1 }]);
    await database.close();
    expect(existsSync(path)).toBe(true);
  });

  it("opens an in-memory database", async () => {
    const database = openDatabase({ dialect: "sqlite", path: ":memory:" });
    const { rows } = await sql<{ one: number }>`select 1 as one`.execute(database.db);
    expect(rows).toEqual([{ one: 1 }]);
    await database.close();
  });
});
