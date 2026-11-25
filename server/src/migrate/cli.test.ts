import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { USAGE, parseArgs, run } from "./cli.js";

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

const LEGACY_ENV = {
  LEGACY_SQL_CONNECTION_STRING: "Server=sql.invalid;Password=secret-one",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true;x=secret-two",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true;x=secret-three",
};

describe("migrate:hosted arguments", () => {
  it("reads each command", () => {
    for (const command of ["plan", "copy", "verify", "delta", "reconcile", "wipe"]) {
      expect(parseArgs([command])).toMatchObject({ kind: "run", command, full: false });
    }
  });

  it("reads every flag, before or after the command, and skips a lone --", () => {
    expect(
      parseArgs([
        "--",
        "--source",
        "s.env",
        "verify",
        "--target",
        "t.env",
        "--sample",
        "0.25",
        "--include",
        "ids.txt",
        "--report",
        "r.json",
        "--dump",
        "d",
        "--full",
        "--deep-sample",
        "3",
        "--deep-max-responses",
        "100",
        "--confirm",
        "name",
      ]),
    ).toEqual({
      kind: "run",
      command: "verify",
      source: "s.env",
      target: "t.env",
      sample: 0.25,
      include: "ids.txt",
      report: "r.json",
      dump: "d",
      full: true,
      deepSample: 3,
      deepMaxResponses: 100,
      confirm: "name",
    });
  });

  it("refuses a missing or unknown command, an unknown flag and a flag without value", () => {
    expect(parseArgs([])).toMatchObject({ kind: "usage-error" });
    expect(parseArgs(["frobnicate"])).toMatchObject({ kind: "usage-error" });
    expect(parseArgs(["copy", "--nope"])).toMatchObject({ kind: "usage-error" });
    expect(parseArgs(["copy", "--target"])).toMatchObject({ kind: "usage-error" });
  });

  it("refuses a sample outside 0 to 1 or not a number, and takes the ends", () => {
    for (const bad of ["1.5", "-0.1", "abc"]) {
      expect(parseArgs(["copy", "--sample", bad])).toMatchObject({ kind: "usage-error" });
    }
    expect(parseArgs(["copy", "--sample", "0"])).toMatchObject({ sample: 0 });
    expect(parseArgs(["copy", "--sample", "1"])).toMatchObject({ sample: 1 });
  });

  it("refuses bad deep-walk numbers", () => {
    expect(parseArgs(["verify", "--deep-sample", "1.5"])).toMatchObject({ kind: "usage-error" });
    expect(parseArgs(["verify", "--deep-max-responses", "0"])).toMatchObject({
      kind: "usage-error",
    });
  });
});

describe("migrate:hosted run", () => {
  const folders: string[] = [];
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-cli-test-"));
    folders.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of folders.splice(0))
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const SURVEY = "11111111-2222-4333-8444-555555555555";
  const FILE = "a".repeat(64);

  /** A migrated SQLite target with a user, a state value and a stored file, and its env file. */
  async function targetFolder() {
    const dir = folder();
    const path = join(dir, "hosted.db");
    const filesPath = join(dir, "files");
    const envFile = join(dir, "target.env");
    writeFileSync(
      envFile,
      `STORAGE_PROVIDER=sqlite\nSQLITE_PATH=${path}\nFILE_STORE=local\nFILES_PATH=${filesPath}\n`,
    );
    const database = openDatabase({ dialect: "sqlite", path });
    await migrate(database);
    await database.db
      .insertInto("users")
      .values({
        id: "99999999-2222-4333-8444-555555555555",
        email: "someone@example.com",
        display_name: "Someone",
        instance_role: "user",
        status: "active",
        must_change_password: 0,
        session_epoch: 0,
        site_blocked: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      } as never)
      .execute();
    await database.db
      .insertInto("migration_state")
      .values({ key: "k", value: "{}", updated_at: "2026-01-01T00:00:00.000Z" } as never)
      .execute();
    await database.db
      .insertInto("files")
      .values({
        id: FILE,
        survey_id: SURVEY,
        owner_user_id: null,
        kind: "asset",
        name: "x.png",
        content_type: "image/png",
        size: 5,
        created_at: "2026-01-01T00:00:00.000Z",
      } as never)
      .execute();
    await database.close();
    mkdirSync(join(filesPath, SURVEY), { recursive: true });
    writeFileSync(join(filesPath, SURVEY, FILE), "bytes");
    // A stray file no row names.
    writeFileSync(join(filesPath, SURVEY, "b".repeat(64)), "stray");
    return { dir, path, filesPath, envFile };
  }

  const count = async (path: string, table: "users" | "files" | "migration_state") => {
    const database = openDatabase({ dialect: "sqlite", path });
    try {
      const row = await database.db
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as("n"))
        .executeTakeFirstOrThrow();
      return Number(row.n);
    } finally {
      await database.close();
    }
  };

  it("prints the usage for --help and exits 2 for a usage error", async () => {
    const help = capture();
    expect(await run(["--help"], help.io, { env: {} })).toBe(0);
    expect(help.out).toBe(USAGE + "\n");
    const bad = capture();
    expect(await run(["copy", "--sample", "2"], bad.io, { env: LEGACY_ENV })).toBe(2);
    expect(bad.err).toContain("--sample");
  });

  it("needs the source settings, and names the missing ones only", async () => {
    const result = capture();
    expect(await run(["plan"], result.io, { env: {} })).toBe(2);
    expect(result.err).toContain("LEGACY_SQL_CONNECTION_STRING");
    const noFile = capture();
    expect(
      await run(["plan", "--source", join(folder(), "nope.env")], noFile.io, { env: {} }),
    ).toBe(2);
  });

  it("without --target uses a scratch target, says where, and leaves it", async () => {
    const result = capture();
    const code = await run(["copy"], result.io, {
      env: LEGACY_ENV,
      openSource: () => {
        throw new Error("no source in this test");
      },
    });
    expect(code).toBe(1);
    const dir = /scratch target in (.+?) \(/.exec(result.out)?.[1];
    expect(dir).toBeTruthy();
    folders.push(dir!);
    expect(existsSync(join(dir!, "target.db"))).toBe(true);
    expect(result.out + result.err).not.toContain("secret-");
  });

  it("verify, delta and reconcile refuse without --target (exit 2)", async () => {
    for (const command of ["verify", "delta", "reconcile"]) {
      const result = capture();
      expect(await run([command], result.io, { env: LEGACY_ENV })).toBe(2);
      expect(result.err).toContain(`${command} needs --target`);
      expect(result.out).not.toContain("scratch");
    }
  });

  it("wipe refuses a target lacking one of its tables, before any byte is deleted", async () => {
    const t = await targetFolder();
    const database = openDatabase({ dialect: "sqlite", path: t.path });
    await sql`drop table password_links`.execute(database.db);
    await database.close();
    const result = capture();
    expect(
      await run(["wipe", "--target", t.envFile, "--confirm", "hosted.db"], result.io, { env: {} }),
    ).toBe(2);
    expect(result.err).toContain("password_links");
    expect(await count(t.path, "files")).toBe(1);
    expect(existsSync(join(t.filesPath, SURVEY, FILE))).toBe(true);
  });

  it("wipe refuses without --target and touches nothing", async () => {
    const result = capture();
    expect(await run(["wipe", "--confirm", "hosted.db"], result.io, { env: {} })).toBe(2);
    expect(result.err).toContain("--target");
  });

  it("wipe refuses without --confirm or with another name, and changes nothing", async () => {
    const t = await targetFolder();
    const none = capture();
    expect(await run(["wipe", "--target", t.envFile], none.io, { env: {} })).toBe(2);
    const wrong = capture();
    expect(
      await run(["wipe", "--target", t.envFile, "--confirm", "other.db"], wrong.io, { env: {} }),
    ).toBe(2);
    expect(wrong.err).toContain("does not match");
    expect(await count(t.path, "users")).toBe(1);
    expect(await count(t.path, "files")).toBe(1);
    expect(existsSync(join(t.filesPath, SURVEY, FILE))).toBe(true);
  });

  it("wipe refuses a SQLite file that does not exist, and does not create it", async () => {
    const dir = folder();
    const envFile = join(dir, "t.env");
    writeFileSync(
      envFile,
      `STORAGE_PROVIDER=sqlite\nSQLITE_PATH=${join(dir, "missing.db")}\nFILES_PATH=${join(dir, "f")}\n`,
    );
    const result = capture();
    expect(
      await run(["wipe", "--target", envFile, "--confirm", "missing.db"], result.io, { env: {} }),
    ).toBe(2);
    expect(existsSync(join(dir, "missing.db"))).toBe(false);
  });

  it("wipe with the right name empties every table but schema_migrations, and the files", async () => {
    const t = await targetFolder();
    const result = capture();
    expect(
      await run(["wipe", "--target", t.envFile, "--confirm", "hosted.db"], result.io, { env: {} }),
    ).toBe(0);
    for (const table of ["users", "files", "migration_state"] as const) {
      expect(await count(t.path, table)).toBe(0);
    }
    const database = openDatabase({ dialect: "sqlite", path: t.path });
    try {
      const applied = await database.db.selectFrom("schema_migrations").selectAll().execute();
      expect(applied.length).toBeGreaterThan(0);
    } finally {
      await database.close();
    }
    expect(readdirSync(t.filesPath)).toEqual([]);
    expect(result.out).toContain("1 stray files");
  });
});
