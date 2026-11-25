import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../sql/database.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { createSqlSurveyStore } from "../sql/survey-store.js";
import { createLocalByteStore } from "../bytes/local.js";
import { createSqlFileStore } from "../sql/file-store.js";
import { createSqlCredentialStore } from "../sql/credential-store.js";
import { legacyFixtureSeed } from "../providers/azure-legacy/fixtures.js";
import {
  LEGACY_ASSET_NAME,
  LEGACY_RESPONSE_NAME,
  surveyFeedback,
} from "../providers/suite/expected.js";
import { describeTarget, run } from "./db.js";

/**
 * What `migrate` prints for a new database: every migration file of the folder, read here rather
 * than counted by hand, so a later migration does not break this test.
 */
const APPLIED_ALL = (() => {
  const names = readdirSync(new URL("../../sql/sqlite/", import.meta.url))
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -".sql".length))
    .sort();
  return `Applied ${names.length} migrations: ${names.join(", ")}`;
})();

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
  const folders: string[] = [];
  afterEach(async () => {
    for (const scratch of scratches.splice(0)) await scratch.drop();
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
  /** A new SQLite file, and a new folder for the file bytes the seed writes. */
  const sqliteEnv = (extra: Record<string, string> = {}) => {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    const files = mkdtempSync(join(tmpdir(), "surveyjs-studio-db-cli-files-"));
    folders.push(files);
    return {
      STORAGE_PROVIDER: "sqlite",
      SQLITE_PATH: scratch.target.path,
      FILES_PATH: files,
      ...extra,
    };
  };

  it("shows a new database's migrations as pending, then applies them once", async () => {
    const env = sqliteEnv();
    const before = capture();
    expect(await run(["status"], before.io, { env })).toBe(0);
    expect(before.out).toContain("Applied: none");
    expect(before.out).toMatch(/Pending:\n {2}0001-surveys\n/);

    const first = capture();
    expect(await run(["migrate"], first.io, { env })).toBe(0);
    expect(first.out).toMatch(/^Database: sqlite, .+test\.db\n/);
    expect(first.out.split("\n").slice(1)).toEqual([APPLIED_ALL, ""]);

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

  it("seeds a new database with the shared seed, migrating it first", async () => {
    const env = sqliteEnv();
    const result = capture();
    expect(await run(["seed"], result.io, { env })).toBe(0);
    expect(result.out).toMatch(/^Database: sqlite, .+\n/);
    expect(result.out.split("\n").slice(1)).toEqual([
      APPLIED_ALL,
      "Seeded 9 surveys and 2 projects.",
      "",
    ]);
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    const store = createSqlSurveyStore(database);
    expect(await store.getSurvey(surveyFeedback.id)).toEqual(surveyFeedback);
    await database.close();
  });

  it("reseeds the seed surveys and keeps every other survey", async () => {
    const env = sqliteEnv();
    await run(["seed"], capture().io, { env });
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    const store = createSqlSurveyStore(database);
    await store.updateSurvey(surveyFeedback.id, {
      name: "Renamed",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });
    const own = await store.createSurvey({
      id: "dddddddd-0000-4000-8000-000000000011",
      name: "Mine",
      owner: { kind: "personal", userId: surveyFeedback.creatorId! },
      creatorId: surveyFeedback.creatorId!,
      postId: "dddddddd-0000-4000-8000-000000000012",
      resultId: "dddddddd-0000-4000-8000-000000000013",
      createdAt: "2026-10-01T10:00:00.000Z",
      updatedAt: "2026-10-01T10:00:00.000Z",
    });
    await database.close();

    const again = capture();
    expect(await run(["seed"], again.io, { env })).toBe(0);
    expect(again.out).toContain("Nothing to apply");
    const reopened = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    const after = createSqlSurveyStore(reopened);
    expect(await after.getSurvey(surveyFeedback.id)).toEqual(surveyFeedback);
    expect(await after.getSurvey(own.id)).toEqual(own);
    await reopened.close();
  });

  it("seeds the legacy files, bytes included, and seeds them again unchanged", async () => {
    const env = sqliteEnv();
    for (let round = 0; round < 2; round++) {
      expect(await run(["seed"], capture().io, { env })).toBe(0);
      const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
      const files = createSqlFileStore(database, createLocalByteStore(env.FILES_PATH));
      for (const [kind, name] of [
        ["asset", LEGACY_ASSET_NAME],
        ["response", LEGACY_RESPONSE_NAME],
      ] as const) {
        const found = await files.getFileByLegacyName(kind, name);
        expect(found?.file, `${kind} ${name}`).toMatchObject({ kind, name });
        const chunks: Buffer[] = [];
        for await (const chunk of found!.content) chunks.push(chunk as Buffer);
        expect(Buffer.concat(chunks).subarray(1, 4).toString(), `${kind} ${name}`).toBe("PNG");
      }
      const rows = await database.db.selectFrom("legacy_files").selectAll().execute();
      expect(rows).toHaveLength(2);
      await database.close();
    }
  });

  it("seeds the users' legacy access keys, revoked where the seed says, and seeds them again unchanged", async () => {
    const { legacyAccessKeys = {}, revokedLegacyKeys = [] } = await legacyFixtureSeed();
    const keys = Object.entries(legacyAccessKeys);
    expect(keys.length).toBeGreaterThan(0);
    const env = sqliteEnv();
    for (let round = 0; round < 2; round++) {
      expect(await run(["seed"], capture().io, { env })).toBe(0);
      const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
      const credentials = createSqlCredentialStore(database);
      for (const [userId, key] of keys) {
        const revoked = revokedLegacyKeys.includes(userId);
        expect(await credentials.findLegacyKey(key.toUpperCase()), userId).toEqual({
          userId: userId.toLowerCase(),
          revoked,
        });
        expect(await credentials.legacyKeyOf(userId), userId).toEqual({
          lastFour: key.slice(-4).toLowerCase(),
          revoked,
        });
      }
      const rows = await database.db.selectFrom("legacy_access_keys").selectAll().execute();
      expect(rows).toHaveLength(keys.length);
      await database.close();
    }
  });

  it("skips the legacy files, with one line, when neither FILES_PATH nor FILE_STORE is set", async () => {
    const { STORAGE_PROVIDER, SQLITE_PATH } = sqliteEnv();
    const env = { STORAGE_PROVIDER, SQLITE_PATH };
    const result = capture();
    expect(await run(["seed"], result.io, { env })).toBe(0);
    expect(result.out).toMatch(
      /\nSeeded 9 surveys and 2 projects\.\nLegacy files skipped: set FILES_PATH or FILE_STORE to load them\.\n$/,
    );
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    expect(await database.db.selectFrom("legacy_files").selectAll().execute()).toEqual([]);
    await database.close();
  });

  it("refuses to seed with READ_ONLY=true", async () => {
    const result = capture();
    expect(await run(["seed"], result.io, { env: sqliteEnv({ READ_ONLY: "true" }) })).toBe(2);
    expect(result.err).toBe("Refused: READ_ONLY=true. Nothing was seeded.\n");
  });

  it("points memory and azure-legacy to their own seeding", async () => {
    const memory = capture();
    expect(await run(["seed"], memory.io, { env: { STORAGE_PROVIDER: "memory" } })).toBe(2);
    expect(memory.err).toContain(
      "memory loads the seed at start-up with MEMORY_SEED=legacy-fixtures",
    );
    const legacy = capture();
    expect(await run(["seed"], legacy.io, { env: { STORAGE_PROVIDER: "azure-legacy" } })).toBe(2);
    expect(legacy.err).toContain(
      "azure-legacy loads it into the local replica with pnpm legacy:load",
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
