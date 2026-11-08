import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalByteStore } from "../bytes/local.js";
import { newFileId } from "../domain/file-id.js";
import type { StoredFileRecord } from "../domain/types.js";
import { legacyFixtureSeed } from "../providers/azure-legacy/fixtures.js";
import { openDatabase } from "../sql/database.js";
import { createSqlFileStore } from "../sql/file-store.js";
import { migrate, migrationStatus } from "../sql/migrator.js";
import { seedSqlStores } from "../sql/seed.js";
import { createSqlSurveyStore } from "../sql/survey-store.js";
import { runBackup, runRestore } from "./backup.js";

const posix = process.platform !== "win32";
const isRoot = posix && process.getuid?.() === 0;

const CONTENT = "a respondent's file";

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

const sha = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

/** The backup folder that `backup` printed. */
const folderOf = (out: string): string => {
  const match = /^Backed up to (.+)$/m.exec(out);
  if (!match) throw new Error(`no folder in: ${out}`);
  return match[1]!;
};

describe("surveyjs-studio backup and restore", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) {
      if (posix) await chmod(root, 0o700).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  /** A migrated, seeded SQLite database and one file stored through the SQL file store. */
  async function setup() {
    const root = await mkdtemp(join(tmpdir(), "surveyjs-studio-backup-"));
    roots.push(root);
    const data = join(root, "data");
    const env = {
      STORAGE_PROVIDER: "sqlite",
      SQLITE_PATH: join(data, "surveyjs-studio.db"),
      FILES_PATH: join(data, "files"),
    };
    const seed = await legacyFixtureSeed();
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    await migrate(database);
    await seedSqlStores(database, seed);
    const surveyId = seed.surveys[0]!.id.toLowerCase();
    const file: StoredFileRecord = {
      id: newFileId(surveyId),
      surveyId,
      kind: "response",
      name: "answer.txt",
      contentType: "text/plain",
      size: Buffer.byteLength(CONTENT),
      createdAt: "2026-10-30T10:00:00.000Z",
    };
    const files = createSqlFileStore(database, createLocalByteStore(env.FILES_PATH));
    await files.putFile(file, Buffer.from(CONTENT));
    const surveys = createSqlSurveyStore(database);
    const before = await Promise.all(seed.surveys.map((s) => surveys.getSurvey(s.id)));
    const status = await migrationStatus(database);
    await database.close();
    return { root, data, env, seed, file, before, status };
  }

  async function backupOf(env: Record<string, string>, args: string[] = []) {
    const result = capture();
    expect(await runBackup(args, result.io, { env })).toBe(0);
    return folderOf(result.out);
  }

  it("backs up, and restores into an empty place what was there", async () => {
    const { data, env, seed, file, before, status } = await setup();
    const result = capture();
    expect(await runBackup([], result.io, { env })).toBe(0);
    const folder = folderOf(result.out);
    expect(dirname(folder)).toBe(join(data, "backups"));
    expect(folder).toMatch(/[/\\]surveyjs-studio-\d{8}-\d{6}Z$/);
    expect(result.out).toContain("Database: migration 4\n");
    expect(result.out).toContain(`Files: 1 file, ${file.size} bytes\n`);
    expect((await readdir(folder)).sort()).toEqual(["backup.json", "files", "surveyjs-studio.db"]);
    const manifest = JSON.parse(await readFile(join(folder, "backup.json"), "utf8"));
    expect(manifest).toEqual({
      format: 1,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/),
      migration: 4,
      files: 1,
      bytes: file.size,
    });

    await rm(env.SQLITE_PATH);
    await rm(env.FILES_PATH, { recursive: true });
    const restored = capture();
    expect(await runRestore([folder], restored.io, { env })).toBe(0);
    expect(restored.out).toContain(`Restored ${folder}`);

    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    try {
      const surveys = createSqlSurveyStore(database);
      expect(await Promise.all(seed.surveys.map((s) => surveys.getSurvey(s.id)))).toEqual(before);
      const files = createSqlFileStore(database, createLocalByteStore(env.FILES_PATH));
      const got = await files.getFile(file.id);
      expect(got?.file).toEqual(file);
      expect(await text(got!.content)).toBe(CONTENT);
      expect(await migrationStatus(database)).toEqual(status);
    } finally {
      await database.close();
    }
  });

  it("completes a backup while another connection keeps writing, and the copy is sound", async () => {
    const { env } = await setup();
    const writer = new DatabaseSync(env.SQLITE_PATH, { timeout: 5000 });
    writer.exec("create table churn (v text)");
    const insert = writer.prepare("insert into churn values (?)");
    writer.exec("begin");
    for (let i = 0; i < 5000; i++) insert.run("x".repeat(200));
    writer.exec("commit");
    let writing = true;
    let writes = 0;
    const churn = (async () => {
      while (writing) {
        insert.run("y".repeat(200));
        writes++;
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    try {
      const folder = await backupOf(env, ["--to", join(env.SQLITE_PATH, "..", "elsewhere")]);
      const copy = new DatabaseSync(join(folder, "surveyjs-studio.db"));
      try {
        expect(copy.prepare("pragma integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
        const row = copy.prepare("select count(*) as n from churn").get() as { n: number };
        expect(row.n).toBeGreaterThanOrEqual(5000);
      } finally {
        copy.close();
      }
    } finally {
      writing = false;
      await churn;
      writer.close();
    }
    expect(writes).toBeGreaterThan(0);
  });

  it("refuses to restore over existing data without --replace, and changes nothing", async () => {
    const { env } = await setup();
    const folder = await backupOf(env);
    const before = await sha(env.SQLITE_PATH);
    const filesBefore = await readdir(env.FILES_PATH, { recursive: true });
    const result = capture();
    expect(await runRestore([folder], result.io, { env })).toBe(2);
    expect(result.err).toContain("--replace");
    expect(await sha(env.SQLITE_PATH)).toBe(before);
    expect(await readdir(env.FILES_PATH, { recursive: true })).toEqual(filesBefore);
    expect((await readdir(dirname(env.SQLITE_PATH))).some((n) => n.startsWith("replaced-"))).toBe(
      false,
    );
  });

  it("refuses --replace while another connection holds a write transaction", async () => {
    const { env } = await setup();
    const folder = await backupOf(env);
    const other = new DatabaseSync(env.SQLITE_PATH, { timeout: 5000 });
    other.exec("create table marker (v text); insert into marker values ('kept')");
    other.exec("begin immediate; insert into marker values ('pending')");
    const result = capture();
    try {
      expect(await runRestore([folder, "--replace"], result.io, { env })).toBe(2);
    } finally {
      other.exec("rollback");
      other.close();
    }
    expect(result.err).toContain("the database is in use: stop the container first");
    expect(existsSync(env.SQLITE_PATH)).toBe(true);
    expect((await readdir(dirname(env.SQLITE_PATH))).some((n) => n.startsWith("replaced-"))).toBe(
      false,
    );
    const check = new DatabaseSync(env.SQLITE_PATH);
    expect(check.prepare("select v from marker").all()).toEqual([{ v: "kept" }]);
    check.close();
  });

  it("refuses --replace while a running server keeps the database open", async () => {
    const { env } = await setup();
    const folder = await backupOf(env);
    const server = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    try {
      await migrationStatus(server);
      const result = capture();
      expect(await runRestore([folder, "--replace"], result.io, { env })).toBe(2);
      expect(result.err).toContain("stop the container first");
    } finally {
      await server.close();
    }
    expect(existsSync(env.SQLITE_PATH)).toBe(true);
  });

  it("with --replace moves the current data aside and restores the backup's", async () => {
    const { data, env, seed, file } = await setup();
    const folder = await backupOf(env);
    // Changes made after the backup: they stay in the replaced copy only.
    const later = new DatabaseSync(env.SQLITE_PATH, { timeout: 5000 });
    later.exec("create table later (v text); insert into later values ('after the backup')");
    later.close();
    const extra = join(env.FILES_PATH, seed.surveys[1]!.id.toLowerCase(), "extra");
    await mkdir(dirname(extra), { recursive: true });
    await writeFile(extra, "later");

    const result = capture();
    expect(await runRestore(["--", folder, "--replace"], result.io, { env })).toBe(0);
    const replaced = (await readdir(data)).filter((n) => n.startsWith("replaced-"));
    expect(replaced).toEqual([expect.stringMatching(/^replaced-\d{8}-\d{6}Z$/)]);
    const aside = join(data, replaced[0]!);
    expect(result.out).toContain(`Moved the current data to ${aside}`);

    const old = new DatabaseSync(join(aside, "surveyjs-studio.db"));
    expect(old.prepare("select v from later").all()).toEqual([{ v: "after the backup" }]);
    old.close();
    expect(
      await readFile(join(aside, "files", seed.surveys[1]!.id.toLowerCase(), "extra"), "utf8"),
    ).toBe("later");
    expect(existsSync(extra)).toBe(false);

    const now = new DatabaseSync(env.SQLITE_PATH);
    const tables = now.prepare("select name from sqlite_master where name = 'later'").all();
    now.close();
    expect(tables).toEqual([]);
    expect(await readFile(join(env.FILES_PATH, file.surveyId, file.id), "utf8")).toBe(CONTENT);
  });

  it("refuses a folder without backup.json: a backup that did not finish", async () => {
    const { env } = await setup();
    const folder = await backupOf(env);
    const partial = join(dirname(folder), `.partial-${folder.split(/[/\\]/).pop()}`);
    await cp(folder, partial, { recursive: true });
    await rm(join(partial, "backup.json"));
    await rm(env.SQLITE_PATH);
    await rm(env.FILES_PATH, { recursive: true });
    const result = capture();
    expect(await runRestore([partial], result.io, { env })).toBe(2);
    expect(result.err).toContain("backup.json");
    expect(existsSync(env.SQLITE_PATH)).toBe(false);
  });

  it("refuses a backup of another format", async () => {
    const { env } = await setup();
    const folder = await backupOf(env);
    const manifest = JSON.parse(await readFile(join(folder, "backup.json"), "utf8"));
    await writeFile(join(folder, "backup.json"), JSON.stringify({ ...manifest, format: 2 }));
    await rm(env.SQLITE_PATH);
    await rm(env.FILES_PATH, { recursive: true });
    const result = capture();
    expect(await runRestore([folder], result.io, { env })).toBe(2);
    expect(existsSync(env.SQLITE_PATH)).toBe(false);
  });

  it.skipIf(!posix || isRoot)(
    "fails when a file cannot be read, and leaves no backup folder",
    async () => {
      const { env, file } = await setup();
      await chmod(join(env.FILES_PATH, file.surveyId, file.id), 0o000);
      const to = join(env.SQLITE_PATH, "..", "failed");
      const result = capture();
      expect(await runBackup(["--to", to], result.io, { env })).toBe(1);
      expect(result.err).toMatch(/^Error: /);
      expect(await readdir(to)).toEqual([]);
    },
  );

  it("skips the local byte store's temporary files", async () => {
    const { env, file } = await setup();
    await writeFile(join(env.FILES_PATH, file.surveyId, `${file.id}.0123456789ab.tmp`), "half");
    const folder = await backupOf(env);
    expect(await readdir(join(folder, "files", file.surveyId))).toEqual([file.id]);
  });

  it("with FILE_STORE=s3 backs up the database only and says where the files are", async () => {
    const { env } = await setup();
    const result = capture();
    const s3 = { ...env, FILE_STORE: "s3", S3_BUCKET: "surveyjs-studio-files" };
    expect(await runBackup([], result.io, { env: s3 })).toBe(0);
    expect(result.out).toContain(
      "files are in S3: use bucket versioning (docs/self-hosting.md#backups)",
    );
    const folder = folderOf(result.out);
    expect((await readdir(folder)).sort()).toEqual(["backup.json", "surveyjs-studio.db"]);
  });

  it("refuses PostgreSQL, and points to pg_dump", async () => {
    for (const command of [runBackup, runRestore]) {
      const result = capture();
      const env = { STORAGE_PROVIDER: "postgres", DATABASE_URL: "postgres://localhost/x" };
      expect(await command(command === runRestore ? ["somewhere"] : [], result.io, { env })).toBe(
        2,
      );
      expect(result.err).toContain(
        "backup covers SQLite and local files; for PostgreSQL use pg_dump (docs/self-hosting.md#backups)",
      );
    }
  });

  it("reports usage errors", async () => {
    const env = { STORAGE_PROVIDER: "sqlite" };
    const unknown = capture();
    expect(await runBackup(["--nope"], unknown.io, { env })).toBe(2);
    expect(unknown.err).toContain("Unknown argument: --nope");
    const missing = capture();
    expect(await runRestore([], missing.io, { env })).toBe(2);
    expect(missing.err).toContain("Usage:");
    const help = capture();
    expect(await runRestore(["--help"], help.io, { env })).toBe(0);
    expect(help.out).toContain("Usage:");
  });
});
