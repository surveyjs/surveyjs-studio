import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTableClient } from "../legacy/local-clients.js";
import { replicaConfig } from "../legacy/replica-env.js";
import { readLegacyFixtures, type LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { createStubShareReader } from "../providers/azure-legacy/legacy-shares-stub.js";
import { API_TOKENS_TABLE } from "../providers/azure-legacy/writes.js";
import { openDatabase, type DatabaseTarget } from "../sql/database.js";
import { scratchPostgres, scratchSqlite } from "../sql/scratch-databases.js";
import { run as runDispatcher } from "../cli/surveyjs-studio.js";
import { run } from "./cli.js";

// Runs in the `providers-azurite` Vitest project: the command line end to end against the local
// replica, into SQLite and (with DATABASE_URL set, `pnpm postgres:up`) into PostgreSQL. As the
// verify tests do, it takes the provider's own token rows and the users' editor files of no
// survey out of the replica for the run (the copy takes neither, so verify needs both stores
// empty) and puts them back.

const config = replicaConfig();
const blobs = BlobServiceClient.fromConnectionString(config.surveysStorageConnectionString);
const tokens = localTableClient(
  config.surveysStorageConnectionString,
  API_TOKENS_TABLE,
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
);
const filesContainer = blobs.getContainerClient("my-surveys-files");

let fixtures: LegacyFixtures;
let tokenRows: Record<string, unknown>[] = [];
let userFiles: {
  name: string;
  content: Buffer;
  metadata: Record<string, string>;
  type?: string;
}[] = [];
const folders: string[] = [];

function capture() {
  let out = "";
  let err = "";
  return {
    io: { out: (t: string) => (out += t), err: (t: string) => (err += t) },
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-cli-e2e-"));
  folders.push(dir);
  return dir;
};

/** The command with the replica's stub shares (Azurite has no file service). */
const cli = (argv: string[], io: ReturnType<typeof capture>["io"]) =>
  run(argv, io, { env: process.env, shares: createStubShareReader(fixtures.files) });

/** A target env file for a SQLite target in a new folder: its path, files folder, file name. */
function sqliteTarget() {
  const dir = folder();
  const scratch = scratchSqlite();
  if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
  const filesPath = join(dir, "files");
  const envFile = join(dir, "target.env");
  writeFileSync(
    envFile,
    `STORAGE_PROVIDER=sqlite\nSQLITE_PATH=${scratch.target.path}\nFILE_STORE=local\nFILES_PATH=${filesPath}\n`,
  );
  return { target: scratch.target, filesPath, envFile, name: "test.db", drop: scratch.drop };
}

/** Every table and its row count (but not `schema_migrations`'s) of a database. */
async function rowCounts(target: DatabaseTarget): Promise<Record<string, number>> {
  const database = openDatabase(target);
  try {
    const { rows } =
      target.dialect === "sqlite"
        ? await sql<{ name: string }>`select name from sqlite_master
            where type = 'table' and name not like 'sqlite_%'`.execute(database.db)
        : await sql<{ name: string }>`select table_name as name from information_schema.tables
            where table_schema = current_schema() and table_type = 'BASE TABLE'`.execute(
            database.db,
          );
    const counts: Record<string, number> = {};
    for (const { name } of rows) {
      // Table names come from the catalog, never from input.
      const result = await sql<{
        n: number | string;
      }>`select count(*) as n from ${sql.table(name)}`.execute(database.db);
      counts[name] = Number(result.rows[0]!.n);
    }
    return counts;
  } finally {
    await database.close();
  }
}

const filesLeft = (path: string): string[] =>
  existsSync(path)
    ? readdirSync(path, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
    : [];

beforeAll(async () => {
  fixtures = await readLegacyFixtures();
  for await (const row of tokens.listEntities<Record<string, unknown>>()) {
    tokenRows.push(
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "etag" && key !== "timestamp"),
      ),
    );
  }
  for (const row of tokenRows) {
    await tokens.deleteEntity(String(row.partitionKey), String(row.rowKey));
  }
  await filesContainer.createIfNotExists();
  for await (const blob of filesContainer.listBlobsFlat({
    includeMetadata: true,
    prefix: "uploads/",
  })) {
    userFiles.push({
      name: blob.name,
      content: await filesContainer.getBlobClient(blob.name).downloadToBuffer(),
      metadata: blob.metadata ?? {},
      ...(blob.properties.contentType && { type: blob.properties.contentType }),
    });
  }
  for (const { name } of userFiles) await filesContainer.deleteBlob(name);
});

afterAll(async () => {
  for (const row of tokenRows) {
    await tokens.upsertEntity(row as { partitionKey: string; rowKey: string }, "Replace");
  }
  tokenRows = [];
  for (const { name, content, metadata, type } of userFiles) {
    await filesContainer.getBlockBlobClient(name).uploadData(content, {
      metadata,
      ...(type && { blobHTTPHeaders: { blobContentType: type } }),
    });
  }
  userFiles = [];
  for (const dir of folders) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

describe("migrate:hosted against the local replica", () => {
  it("plans without a target and writes the volumes where --report points", async () => {
    const report = join(folder(), "plan.json");
    const result = capture();
    expect(await cli(["plan", "--report", report], result.io)).toBe(0);
    expect(result.out).toMatch(/^Plan: \d+ users/m);
    const written = JSON.parse(readFileSync(report, "utf8")) as {
      plan: { volumes: { surveys: number } };
    };
    expect(written.plan.volumes.surveys).toBeGreaterThan(0);
    expect(result.out).not.toContain("UseDevelopmentStorage");
  });

  it("copies, verifies green, then wipes: every table empty but schema_migrations, files gone", async () => {
    const t = sqliteTarget();
    try {
      const reportDir = folder();
      const copyReport = join(reportDir, "copy.json");
      const verifyReport = join(reportDir, "verify.json");
      const dump = join(reportDir, "dump");

      const copied = capture();
      expect(
        await cli(
          ["copy", "--target", t.envFile, "--report", copyReport, "--dump", dump],
          copied.io,
        ),
      ).toBe(0);
      expect(copied.out).toContain("copy: done");
      expect(existsSync(join(dump, "records.ndjson"))).toBe(true);
      expect(JSON.parse(readFileSync(copyReport, "utf8"))).toHaveProperty("counts");
      const before = await rowCounts(t.target);
      expect(before.surveys).toBeGreaterThan(0);
      expect(before.survey_responses).toBeGreaterThan(0);
      expect(filesLeft(t.filesPath).length).toBeGreaterThan(0);

      const verified = capture();
      expect(
        await cli(
          ["verify", "--full", "--target", t.envFile, "--report", verifyReport],
          verified.io,
        ),
      ).toBe(0);
      expect(verified.out).toContain("verify --full: OK, 0 differences");
      const checks = JSON.parse(readFileSync(verifyReport, "utf8")) as {
        differences: unknown[];
      };
      expect(checks.differences).toEqual([]);

      // A delta and an incremental verify after it stay green.
      expect(await cli(["delta", "--target", t.envFile], capture().io)).toBe(0);
      expect(await cli(["verify", "--target", t.envFile], capture().io)).toBe(0);

      // Review focus 5: the wrong name changes nothing.
      const wrong = capture();
      expect(
        await cli(["wipe", "--target", t.envFile, "--confirm", "elsewhere.db"], wrong.io),
      ).toBe(2);
      expect((await rowCounts(t.target)).surveys).toBe(before.surveys);

      const wiped = capture();
      expect(await cli(["wipe", "--target", t.envFile, "--confirm", t.name], wiped.io)).toBe(0);
      const after = await rowCounts(t.target);
      for (const [table, n] of Object.entries(after)) {
        if (table === "schema_migrations") expect(n).toBeGreaterThan(0);
        else expect({ table, n }).toEqual({ table, n: 0 });
      }
      expect(filesLeft(t.filesPath)).toEqual([]);
    } finally {
      await t.drop();
    }
  });

  it("copies and verifies a sample of the accounts", async () => {
    const t = sqliteTarget();
    try {
      const include = join(folder(), "ids.txt");
      writeFileSync(include, "11111111-0000-4000-8000-a00000000001\n");
      const copied = capture();
      expect(
        await cli(
          ["copy", "--target", t.envFile, "--sample", "0", "--include", include],
          copied.io,
        ),
      ).toBe(0);
      expect(copied.out).toMatch(/Sample: 1 accounts/);
      const verified = capture();
      expect(
        await cli(
          ["verify", "--full", "--target", t.envFile, "--sample", "0", "--include", include],
          verified.io,
        ),
      ).toBe(0);
    } finally {
      await t.drop();
    }
  });

  it("without --target copies into a scratch target it prints and leaves", async () => {
    const result = capture();
    expect(await cli(["copy", "--sample", "0"], result.io)).toBe(0);
    const dir = /scratch target in (.+?) \(/.exec(result.out)?.[1];
    expect(dir).toBeTruthy();
    folders.push(dir!);
    expect(existsSync(join(dir!, "target.db"))).toBe(true);
  });

  it("is on the image's command: surveyjs-studio migrate-hosted --help", async () => {
    const result = capture();
    expect(await runDispatcher(["migrate-hosted", "--help"], result.io, { env: {} })).toBe(0);
    expect(result.out).toContain("Usage: surveyjs-studio migrate-hosted <command>");
  });

  it.runIf(Boolean(process.env.DATABASE_URL))(
    "copies into a PostgreSQL database, verifies green, and wipes it",
    async () => {
      const scratch = await scratchPostgres();
      if (scratch.target.dialect !== "postgres") throw new Error("unreachable");
      try {
        const dir = folder();
        const filesPath = join(dir, "files");
        const envFile = join(dir, "target.env");
        writeFileSync(
          envFile,
          `STORAGE_PROVIDER=postgres\nDATABASE_URL=${scratch.target.url}\nFILE_STORE=local\nFILES_PATH=${filesPath}\n`,
        );
        const name = new URL(scratch.target.url).pathname.slice(1);

        expect(await cli(["copy", "--target", envFile], capture().io)).toBe(0);
        const verified = capture();
        expect(await cli(["verify", "--full", "--target", envFile], verified.io)).toBe(0);
        expect(verified.out).toContain("verify --full: OK");
        const before = await rowCounts(scratch.target);
        expect(before.surveys).toBeGreaterThan(0);

        expect(await cli(["wipe", "--target", envFile, "--confirm", "other"], capture().io)).toBe(
          2,
        );
        expect((await rowCounts(scratch.target)).surveys).toBe(before.surveys);
        expect(await cli(["wipe", "--target", envFile, "--confirm", name], capture().io)).toBe(0);
        for (const [table, n] of Object.entries(await rowCounts(scratch.target))) {
          if (table !== "schema_migrations") expect({ table, n }).toEqual({ table, n: 0 });
        }
        expect(filesLeft(filesPath)).toEqual([]);
      } finally {
        await scratch.drop();
      }
    },
  );
});
