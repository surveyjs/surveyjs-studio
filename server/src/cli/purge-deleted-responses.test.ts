import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import { scratchSqlite, type ScratchDatabase } from "../sql/scratch-databases.js";
import { parseArgs, READ_ONLY_PURGE, run, USAGE } from "./purge-deleted-responses.js";

/** Response ids are GUIDs (a uuid column on PostgreSQL). */
const rid = (i: number) => `00000000-0000-4000-8000-00000000000${i}`;

const BEFORE = "2026-06-01T00:00:00.000Z";

describe("purge:deleted-responses", () => {
  const scratches: ScratchDatabase[] = [];
  afterEach(async () => {
    for (const scratch of scratches.splice(0)) await scratch.drop();
  });

  /** A migrated SQLite database with a row at each of the given times (response ids r0, r1, ...). */
  async function seeded(times: string[]) {
    const scratch = scratchSqlite();
    scratches.push(scratch);
    const database = openDatabase(scratch.target);
    try {
      await migrate(database);
      for (const [i, at] of times.entries()) {
        await database.db
          .insertInto("deleted_responses")
          .values({
            survey_id: "11111111-1111-4111-8111-111111111111",
            response_id: rid(i),
            deleted_at: at,
            response: "{}",
          })
          .execute();
      }
    } finally {
      await database.close();
    }
    if (scratch.target.dialect !== "sqlite") throw new Error("unreachable");
    return { STORAGE_PROVIDER: "sqlite", SQLITE_PATH: scratch.target.path };
  }

  async function remaining(env: { SQLITE_PATH: string }): Promise<string[]> {
    const database = openDatabase({ dialect: "sqlite", path: env.SQLITE_PATH });
    try {
      const rows = await database.db
        .selectFrom("deleted_responses")
        .select("response_id")
        .execute();
      return rows.map((r) => r.response_id).sort();
    } finally {
      await database.close();
    }
  }

  async function purge(argv: string[], env: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, { env });
    return { code, out: out.join(""), err: err.join("") };
  }

  const TIMES = [
    "2026-05-31T23:59:59.999Z",
    BEFORE,
    "2026-06-01T00:00:00.001Z",
    "2025-01-01T00:00:00.000Z",
  ];

  it("counts the copies before the date and deletes nothing without --apply", async () => {
    const env = await seeded(TIMES);
    const r = await purge(["--before", BEFORE], env);
    expect(r).toEqual({
      code: 0,
      out: `2 deleted-response copies before ${BEFORE}. Run again with --apply to delete them.\n`,
      err: "",
    });
    expect(await remaining(env)).toEqual([0, 1, 2, 3].map(rid));
  });

  it("deletes exactly the rows strictly before the date with --apply, and none at it", async () => {
    const env = await seeded(TIMES);
    const r = await purge(["--before", BEFORE, "--apply"], env);
    expect(r).toEqual({
      code: 0,
      out: `Deleted 2 deleted-response copies before ${BEFORE}.\n`,
      err: "",
    });
    expect(await remaining(env)).toEqual([1, 2].map(rid));
  });

  it("reads a plain date as the start of that day, UTC", async () => {
    const env = await seeded(TIMES);
    const r = await purge(["--before", "2026-06-01", "--apply"], env);
    expect(r.out).toBe(`Deleted 2 deleted-response copies before ${BEFORE}.\n`);
  });

  it("refuses a missing or unparseable --before with the usage, exit 2", async () => {
    const env = await seeded(TIMES);
    for (const argv of [[], ["--before", "last week"], ["--before"]]) {
      const r = await purge(argv, env);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toContain(USAGE);
    }
    expect(await remaining(env)).toHaveLength(4);
  });

  it("refuses a provider without a database", async () => {
    for (const STORAGE_PROVIDER of ["memory", "azure-legacy"]) {
      const r = await purge(["--before", BEFORE], { STORAGE_PROVIDER });
      expect(r).toEqual({
        code: 1,
        out: "",
        err: "Error: purge:deleted-responses needs STORAGE_PROVIDER=sqlite or postgres.\n",
      });
    }
  });

  it("refuses --apply with READ_ONLY=true and deletes nothing", async () => {
    const env = await seeded(TIMES);
    const r = await purge(["--before", BEFORE, "--apply"], { ...env, READ_ONLY: "true" });
    expect(r).toEqual({ code: 2, out: "", err: `${READ_ONLY_PURGE}\n` });
    expect(READ_ONLY_PURGE).toBe("Refused: READ_ONLY=true. Nothing was deleted.");
    expect(await remaining(env)).toHaveLength(4);
  });

  it("reads its arguments", () => {
    expect(parseArgs(["--before", BEFORE, "--apply", "--env-file", "x.env"])).toEqual({
      kind: "run",
      before: BEFORE,
      apply: true,
      envFile: "x.env",
    });
    expect(parseArgs(["--before", BEFORE])).toMatchObject({ apply: false, envFile: null });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });
});
