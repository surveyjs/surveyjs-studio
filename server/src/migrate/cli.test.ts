import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import type { LegacyConfig } from "../config.js";
import { USAGE, parseArgs, run } from "./cli.js";
import type { LegacySource } from "./source/index.js";
import { describeSource, sourceFingerprint } from "./source/fingerprint.js";

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
        "--no-pending",
        "--even-if-used",
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
      noPending: true,
      evenIfUsed: true,
    });
  });

  it("names the new switches in the usage", () => {
    expect(USAGE).toContain("--no-pending");
    expect(USAGE).toContain("--even-if-used");
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
    const code = await run(["copy"], result.io, { env: LEGACY_ENV, openSource: untouchable });
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

  /** Writes migration_state values into a target database. */
  async function setState(path: string, values: Record<string, unknown>) {
    const database = openDatabase({ dialect: "sqlite", path });
    try {
      for (const [key, value] of Object.entries(values)) {
        await database.db
          .insertInto("migration_state")
          .values({
            key,
            value: JSON.stringify(value),
            updated_at: "2026-01-01T00:00:00.000Z",
          } as never)
          .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) }))
          .execute();
      }
    } finally {
      await database.close();
    }
  }

  async function getState(path: string, key: string): Promise<unknown> {
    const database = openDatabase({ dialect: "sqlite", path });
    try {
      const row = await database.db
        .selectFrom("migration_state")
        .select("value")
        .where("key", "=", key)
        .executeTakeFirst();
      return row === undefined ? undefined : JSON.parse(String(row.value));
    } finally {
      await database.close();
    }
  }

  /** A source that must not be read: the command refuses, or stops, before. */
  const untouchable = (): LegacySource =>
    new Proxy({} as LegacySource, {
      get: (_, key) =>
        key === "close"
          ? () => Promise.resolve()
          : key === "then"
            ? undefined
            : () => {
                throw new Error(`the source was read (${String(key)})`);
              },
    });

  const OTHER_ENV = {
    LEGACY_SQL_CONNECTION_STRING: "Server=other.invalid;Database=elsewhere;Password=secret-one",
    LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "AccountName=otheracct;AccountKey=c2VjcmV0",
    LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "AccountName=otheracct;AccountKey=c2VjcmV0",
  };
  const legacyOf = (env: Record<string, string>): LegacyConfig => ({
    sqlConnectionString: env.LEGACY_SQL_CONNECTION_STRING!,
    surveysStorageConnectionString: env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING!,
    resultsStorageConnectionString: env.LEGACY_RESULTS_STORAGE_CONNECTION_STRING!,
  });

  it("--source: the file's settings win over the environment's, which are not used", async () => {
    const file = join(folder(), "source.env");
    writeFileSync(
      file,
      [
        "LEGACY_SQL_CONNECTION_STRING=Server=readonly.invalid;User Id=ro",
        "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true;x=ro-surveys",
        "LEGACY_RESULTS_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true;x=ro-results",
      ].join("\n"),
    );
    // As `docker compose run <app service>` gives it: the app's env_file (read-write login).
    const appEnv = {
      LEGACY_SQL_CONNECTION_STRING: "Server=readwrite.invalid;User Id=app",
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true;x=app-surveys",
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true;x=app-results",
    };
    let used: LegacyConfig | null = null;
    const result = capture();
    const code = await run(["plan", "--source", file], result.io, {
      env: appEnv,
      openSource: (legacy) => {
        used = legacy;
        throw new Error("stop here");
      },
    });
    expect(code).toBe(1);
    expect(used).toEqual({
      sqlConnectionString: "Server=readonly.invalid;User Id=ro",
      surveysStorageConnectionString: "UseDevelopmentStorage=true;x=ro-surveys",
      resultsStorageConnectionString: "UseDevelopmentStorage=true;x=ro-results",
    });
    expect(result.err).toContain("LEGACY_SQL_CONNECTION_STRING");
    expect(result.err).toMatch(/environment.*not used/);
    expect(result.out + result.err).not.toContain("app-surveys");
  });

  it("--source: a setting the file lacks is not taken from the environment", async () => {
    const file = join(folder(), "source.env");
    writeFileSync(file, "LEGACY_SQL_CONNECTION_STRING=Server=readonly.invalid\n");
    const result = capture();
    expect(await run(["plan", "--source", file], result.io, { env: LEGACY_ENV })).toBe(2);
    expect(result.err).toContain("LEGACY_SURVEYS_STORAGE_CONNECTION_STRING");
    expect(result.err).toContain("LEGACY_RESULTS_STORAGE_CONNECTION_STRING");
  });

  it("prints the source it opened: server, database and account names, never a secret", async () => {
    const result = capture();
    await run(["plan"], result.io, {
      env: OTHER_ENV,
      openSource: () => {
        throw new Error("stop here");
      },
    });
    expect(result.out).toContain(
      "Source: SQL server other.invalid, database elsewhere; " +
        "storage accounts otheracct (surveys), otheracct (results)",
    );
    expect(result.out + result.err).not.toContain("secret");
    expect(result.out + result.err).not.toContain("c2VjcmV0");
  });

  it("a remote source whose file shares cannot be read is refused before anything is written", async () => {
    const dir = folder();
    const path = join(dir, "new.db");
    const envFile = join(dir, "target.env");
    writeFileSync(
      envFile,
      `STORAGE_PROVIDER=sqlite\nSQLITE_PATH=${path}\nFILE_STORE=local\nFILES_PATH=${join(dir, "f")}\n`,
    );
    // A read-only SAS without a file endpoint: the file SDK cannot use it.
    const sas =
      "BlobEndpoint=https://acct.blob.core.windows.net/;" +
      "TableEndpoint=https://acct.table.core.windows.net/;" +
      "SharedAccessSignature=sv=2022-11-02&ss=bt&srt=sco&sp=rl&sig=abc";
    const result = capture();
    const code = await run(["copy", "--target", envFile], result.io, {
      env: {
        LEGACY_SQL_CONNECTION_STRING: "Server=sql.invalid;Database=x;Password=secret-one",
        LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: sas,
        LEGACY_RESULTS_STORAGE_CONNECTION_STRING: sas,
      },
    });
    expect(code).toBe(2);
    expect(result.err).toContain("surveyfiles");
    expect(result.err).toContain("LEGACY_SURVEYS_STORAGE_CONNECTION_STRING");
    expect(result.err).not.toContain("sig=abc");
    expect(existsSync(path)).toBe(false);
  });

  it("copy records the source it read, and refuses a target holding another source's copy", async () => {
    const fresh = await targetFolder();
    expect(
      await run(["copy", "--target", fresh.envFile], capture().io, {
        env: LEGACY_ENV,
        openSource: untouchable,
      }),
    ).toBe(1);
    expect(await getState(fresh.path, "source")).toEqual(sourceFingerprint(legacyOf(LEGACY_ENV)));

    const held = await targetFolder();
    await setState(held.path, { sample: null, source: sourceFingerprint(legacyOf(OTHER_ENV)) });
    const result = capture();
    expect(
      await run(["copy", "--target", held.envFile], result.io, {
        env: LEGACY_ENV,
        openSource: untouchable,
      }),
    ).toBe(2);
    expect(result.err).toContain("another source");
    expect(result.err).toContain(describeSource(sourceFingerprint(legacyOf(OTHER_ENV))));
    expect(await getState(held.path, "source")).toEqual(sourceFingerprint(legacyOf(OTHER_ENV)));
  });

  it("delta, reconcile and verify refuse a source other than the copy's (exit 2)", async () => {
    for (const command of ["delta", "reconcile", "verify"]) {
      const t = await targetFolder();
      await setState(t.path, {
        sample: null,
        "copy:complete": { at: "2026-01-01T00:00:00.000Z" },
        source: sourceFingerprint(legacyOf(OTHER_ENV)),
      });
      const result = capture();
      expect(
        await run([command, "--target", t.envFile], result.io, {
          env: LEGACY_ENV,
          openSource: untouchable,
        }),
        command,
      ).toBe(2);
      expect(result.err, command).toContain("another source");
    }
  });

  it("a target copied before sources were recorded takes the current one, with a note", async () => {
    const t = await targetFolder();
    await setState(t.path, { sample: null, "copy:complete": { at: "2026-01-01T00:00:00.000Z" } });
    const result = capture();
    // The untouchable source stops the run right after the guards.
    await run(["delta", "--target", t.envFile], result.io, {
      env: LEGACY_ENV,
      openSource: untouchable,
    });
    expect(result.err).toContain("no recorded source");
    expect(await getState(t.path, "source")).toEqual(sourceFingerprint(legacyOf(LEGACY_ENV)));
  });

  it("wipe refuses a target that names no database, and an empty --confirm", async () => {
    const t = await targetFolder();
    // As a DATABASE_URL without a database path opens.
    const nameless = () => ({
      database: openDatabase({ dialect: "sqlite", path: t.path }),
      bytes: { delete: () => Promise.resolve() } as never,
      localRoot: null,
      name: "",
      missing: false,
    });
    for (const confirm of ["", "anything"]) {
      const result = capture();
      expect(
        await run(["wipe", "--target", t.envFile, "--confirm", confirm], result.io, {
          env: {},
          openTarget: nameless,
        }),
        confirm,
      ).toBe(2);
      expect(result.err).toContain(confirm === "" ? "wipe needs --confirm" : "names no database");
    }
    expect(await count(t.path, "users")).toBe(1);
  });

  it("wipe refuses a target somebody has used, unless --even-if-used", async () => {
    const signedIn = await targetFolder();
    const database = openDatabase({ dialect: "sqlite", path: signedIn.path });
    await database.db
      .updateTable("users")
      .set({ last_sign_in_at: "2026-02-01T00:00:00.000Z" } as never)
      .execute();
    await database.close();
    const refused = capture();
    expect(
      await run(["wipe", "--target", signedIn.envFile, "--confirm", "hosted.db"], refused.io, {
        env: {},
      }),
    ).toBe(2);
    expect(refused.err).toContain("--even-if-used");
    expect(await count(signedIn.path, "users")).toBe(1);
    expect(existsSync(join(signedIn.filesPath, SURVEY, FILE))).toBe(true);
    expect(
      await run(
        ["wipe", "--target", signedIn.envFile, "--confirm", "hosted.db", "--even-if-used"],
        capture().io,
        { env: {} },
      ),
    ).toBe(0);
    expect(await count(signedIn.path, "users")).toBe(0);

    const linked = await targetFolder();
    const other = openDatabase({ dialect: "sqlite", path: linked.path });
    await other.db
      .insertInto("user_identities")
      .values({
        provider: "google",
        subject: "g-1",
        user_id: "99999999-2222-4333-8444-555555555555",
        email: null,
        email_verified: 0,
        created_at: "2026-01-01T00:00:00.000Z",
      } as never)
      .execute();
    await other.close();
    const refusedLinked = capture();
    expect(
      await run(["wipe", "--target", linked.envFile, "--confirm", "hosted.db"], refusedLinked.io, {
        env: {},
      }),
    ).toBe(2);
    expect(await count(linked.path, "users")).toBe(1);
  });

  it("wipe takes the migrated surveyjs sign-in as no use", async () => {
    const t = await targetFolder();
    const database = openDatabase({ dialect: "sqlite", path: t.path });
    await database.db
      .insertInto("user_identities")
      .values({
        provider: "surveyjs",
        subject: "99999999-2222-4333-8444-555555555555",
        user_id: "99999999-2222-4333-8444-555555555555",
        email: "someone@example.com",
        email_verified: 1,
        created_at: "2026-01-01T00:00:00.000Z",
      } as never)
      .execute();
    await database.close();
    expect(
      await run(["wipe", "--target", t.envFile, "--confirm", "hosted.db"], capture().io, {
        env: {},
      }),
    ).toBe(0);
  });
});

describe("the source fingerprint", () => {
  const legacy = (sql: string, surveys: string, results = surveys): LegacyConfig => ({
    sqlConnectionString: sql,
    surveysStorageConnectionString: surveys,
    resultsStorageConnectionString: results,
  });

  it("takes names only, the same for read-only and read-write credentials", () => {
    const readWrite = sourceFingerprint(
      legacy(
        "Server=tcp:db.example.net,1433;Initial Catalog=Legacy;User Id=app;Password=p",
        "DefaultEndpointsProtocol=https;AccountName=Surveys1;AccountKey=a2V5;EndpointSuffix=core.windows.net",
        "DefaultEndpointsProtocol=https;AccountName=results1;AccountKey=a2V5",
      ),
    );
    const readOnly = sourceFingerprint(
      legacy(
        "Data Source=db.example.net;Database=legacy;User Id=ro;Password=q",
        "BlobEndpoint=https://surveys1.blob.core.windows.net/;SharedAccessSignature=sv=1&sig=x",
        "TableEndpoint=https://results1.table.core.windows.net;SharedAccessSignature=sv=1&sig=y",
      ),
    );
    expect(readWrite).toEqual({
      sqlServer: "db.example.net",
      sqlDatabase: "legacy",
      surveysAccount: "surveys1",
      resultsAccount: "results1",
    });
    expect(readOnly).toEqual(readWrite);
    expect(JSON.stringify(readWrite)).not.toMatch(/a2V5|sig=|Password/);
  });

  it("names the local replica's account", () => {
    expect(
      sourceFingerprint(
        legacy(
          "Server=127.0.0.1,14333;Database=surveyjs_legacy;Password=x",
          "DefaultEndpointsProtocol=http;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" +
            "TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;",
          "UseDevelopmentStorage=true",
        ),
      ),
    ).toEqual({
      sqlServer: "127.0.0.1,14333",
      sqlDatabase: "surveyjs_legacy",
      surveysAccount: "devstoreaccount1",
      resultsAccount: "devstoreaccount1",
    });
  });
});
