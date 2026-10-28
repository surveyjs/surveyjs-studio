import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../sql/database.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { describeTarget, run } from "./db.js";

function capture() {
  let out = "";
  let err = "";
  return {
    io: { out: (text: string) => (out += text), err: (text: string) => (err += text) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

describe("db CLI", () => {
  const scratches: ScratchDatabase[] = [];
  afterEach(async () => {
    for (const scratch of scratches.splice(0)) await scratch.drop();
  });
  const sqliteEnv = (extra: Record<string, string> = {}) => {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    return { STORAGE_PROVIDER: "sqlite", SQLITE_PATH: scratch.target.path, ...extra };
  };

  it("shows a new database's migrations as pending, then applies them once", async () => {
    const env = sqliteEnv();
    const before = capture();
    expect(await run(["status"], before.io, { env })).toBe(0);
    expect(before.out).toContain("Applied: none");
    expect(before.out).toMatch(/Pending:\n {2}0001-surveys\n/);

    const first = capture();
    expect(await run(["migrate"], first.io, { env })).toBe(0);
    expect(first.out).toMatch(
      /^Database: sqlite, .+test\.db\nApplied 1 migration: 0001-surveys\n$/,
    );

    const second = capture();
    expect(await run(["migrate", "--"], second.io, { env })).toBe(0);
    expect(second.out).toContain("Nothing to apply: the database is up to date.");

    const after = capture();
    expect(await run(["status"], after.io, { env })).toBe(0);
    expect(after.out).toMatch(/Applied:\n {2}0001-surveys {2}\d{4}-\d\d-\d\dT[\d:.]+Z\n/);
    expect(after.out).toContain("Pending: none");
  });

  it("reports a database a newer version migrated, and refuses to migrate it", async () => {
    const env = sqliteEnv();
    await run(["migrate"], capture().io, { env });
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    await database.db
      .insertInto("schema_migrations")
      .values({ version: 9999, name: "future", applied_at: new Date().toISOString() })
      .execute();
    await database.close();

    const status = capture();
    expect(await run(["status"], status.io, { env })).toBe(1);
    expect(status.out).toContain("Applied by a newer version:\n  9999-future");
    expect(status.err).toContain("does not know: a newer version migrated it");

    const migrate = capture();
    expect(await run(["migrate"], migrate.io, { env })).toBe(1);
    expect(migrate.err).toBe(
      "Error: The database has migration 9999-future, which this version of SurveyJS Studio does not know: a newer version migrated it. Run that version or a newer one.\n",
    );
  });

  it("refuses a storage provider without a database", async () => {
    for (const STORAGE_PROVIDER of [undefined, "memory", "azure-legacy"]) {
      const result = capture();
      expect(await run(["status"], result.io, { env: { STORAGE_PROVIDER } })).toBe(2);
      expect(result.err).toContain("STORAGE_PROVIDER must be sqlite or postgres");
    }
  });

  it("refuses to migrate with READ_ONLY=true, but shows the status", async () => {
    const env = sqliteEnv({ READ_ONLY: "true" });
    const migrate = capture();
    expect(await run(["migrate"], migrate.io, { env })).toBe(2);
    expect(migrate.err).toBe("Refused: READ_ONLY=true. Nothing was migrated.\n");
    expect(await run(["status"], capture().io, { env })).toBe(0);
  });

  it("explains its usage", async () => {
    const help = capture();
    expect(await run(["--help"], help.io, {})).toBe(0);
    expect(help.out).toContain("Usage: pnpm db:migrate");
    const wrong = capture();
    expect(await run(["drop"], wrong.io, {})).toBe(2);
    expect(wrong.err).toContain("Unknown command: drop");
  });
});

describe("describeTarget", () => {
  it("names a PostgreSQL database by host, port and name, never the credentials", () => {
    expect(
      describeTarget({
        dialect: "postgres",
        url: "postgres://user:Secret-77@db.example.net:6543/studio",
      }),
    ).toBe("postgres, db.example.net:6543/studio");
    expect(describeTarget({ dialect: "postgres", url: "postgresql://u:p@h/d" })).toBe(
      "postgres, h:5432/d",
    );
  });
});
