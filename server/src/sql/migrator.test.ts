import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";
import { describeMigratorSuite, testMigrations } from "./migrator-suite.js";
import { loadMigrations, migrationStatus, splitStatements } from "./migrator.js";
import { scratchSqlite } from "./scratch-databases.js";

describeMigratorSuite("sqlite");

describe("splitStatements", () => {
  it("splits at a semicolon that ends a line and drops comments and blanks", () => {
    expect(
      splitStatements(
        "-- a comment\ncreate table a (x text default 'a;b');\n\ncreate index i on a (x) ;  \n-- trailing\n",
      ),
    ).toEqual(["create table a (x text default 'a;b')", "create index i on a (x)"]);
  });

  it("keeps a last statement without a semicolon", () => {
    expect(splitStatements("select 1;\nselect 2")).toEqual(["select 1", "select 2"]);
  });
});

describe("loadMigrations", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const folder = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), "migrations-"));
    dirs.push(root);
    mkdirSync(join(root, "sqlite"));
    for (const [name, text] of Object.entries(files))
      writeFileSync(join(root, "sqlite", name), text);
    return root;
  };

  it("reads NNNN-name.sql files in version order", () => {
    const root = folder({ "0002-b.sql": "select 2;", "0001-a.sql": "select 1;", "README.md": "" });
    expect(loadMigrations("sqlite", root)).toEqual([
      { version: 1, name: "a", sql: "select 1;" },
      { version: 2, name: "b", sql: "select 2;" },
    ]);
  });

  it("refuses a gap, a duplicate version and a badly named file", () => {
    expect(() => loadMigrations("sqlite", folder({ "0001-a.sql": "", "0003-c.sql": "" }))).toThrow(
      "Migrations must be numbered 0001, 0002, … without gaps: 0003-c.sql follows 0001",
    );
    expect(() => loadMigrations("sqlite", folder({ "0001-a.sql": "", "0001-b.sql": "" }))).toThrow(
      "without gaps",
    );
    expect(() => loadMigrations("sqlite", folder({ "1-a.sql": "" }))).toThrow(
      "Migration file names are NNNN-name.sql: 1-a.sql",
    );
  });

  it("ships the same versions and names for SQLite and PostgreSQL", () => {
    const names = (dialect: "sqlite" | "postgres") =>
      loadMigrations(dialect).map(({ version, name }) => ({ version, name }));
    expect(names("sqlite").length).toBeGreaterThan(0);
    expect(names("postgres")).toEqual(names("sqlite"));
  });
});

describe("migrator lock (sqlite, across processes)", () => {
  it("applies each migration once when two processes migrate one file together", async () => {
    const scratch = scratchSqlite();
    try {
      if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
      const { path } = scratch.target;
      const migrator = pathToFileURL(fileURLToPath(new URL("./migrator.ts", import.meta.url)));
      const databaseModule = pathToFileURL(
        fileURLToPath(new URL("./database.ts", import.meta.url)),
      );
      const script = `
        const { migrate } = await import(${JSON.stringify(migrator.href)});
        const { openDatabase } = await import(${JSON.stringify(databaseModule.href)});
        const database = openDatabase({ dialect: "sqlite", path: process.argv[1] });
        const run = await migrate(database, ${JSON.stringify(testMigrations)});
        await database.close();
        console.log(run.applied.length);
      `;
      const child = () =>
        new Promise<string>((resolve, reject) => {
          const process = spawn(
            "node",
            ["--import", "tsx", "--input-type=module", "-e", script, path],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          let out = "";
          let err = "";
          process.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
          process.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()));
          process.on("close", (code) =>
            code === 0 ? resolve(out.trim()) : reject(new Error(`exit ${String(code)}: ${err}`)),
          );
        });
      const counts = await Promise.all([child(), child()]);
      expect(counts.sort()).toEqual(["0", "2"]);
      const database = openDatabase(scratch.target);
      expect((await migrationStatus(database, testMigrations)).applied).toHaveLength(2);
      await database.close();
    } finally {
      await scratch.drop();
    }
  }, 30_000);
});
