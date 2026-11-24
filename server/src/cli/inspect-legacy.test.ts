import { describe, expect, it } from "vitest";
import { formatSurveyTable, parseArgs, run } from "./inspect-legacy.js";
import type { SurveyRecord } from "../domain/types.js";

function survey(over: Partial<SurveyRecord>): SurveyRecord {
  return {
    id: "s1",
    name: "One",
    owner: { kind: "personal", userId: "u" },
    creatorId: null,
    postId: "p",
    resultId: "r",
    published: true,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
    ...over,
  };
}

describe("parseArgs", () => {
  it("accepts --user and --env-file", () => {
    expect(parseArgs(["--user", "a@b.c", "--env-file", "x.env"])).toEqual({
      kind: "run",
      user: "a@b.c",
      envFile: "x.env",
    });
  });
  it("accepts --user alone", () => {
    expect(parseArgs(["--user", "a@b.c"])).toEqual({ kind: "run", user: "a@b.c", envFile: null });
  });
  it("rejects a missing --user", () => {
    expect(parseArgs([])).toMatchObject({ kind: "usage-error" });
  });
  it("rejects a --user without a value", () => {
    expect(parseArgs(["--user"])).toMatchObject({ kind: "usage-error" });
  });
  it("rejects an unknown flag", () => {
    expect(parseArgs(["--user", "a", "--write"])).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("--write"),
    });
  });
  it("returns help for --help", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
  });
});

describe("formatSurveyTable", () => {
  it("prints (no surveys) for an empty scope", () => {
    expect(formatSurveyTable([])).toBe("(no surveys)");
  });
  it("prints a fixed-width table", () => {
    const text = formatSurveyTable([
      survey({}),
      survey({ id: "s22", name: "Second", published: false, archived: true }),
    ]);
    expect(text).toBe(
      [
        "Id   Name    Published  Archived  Created                   Updated",
        "s1   One     yes        no        2026-01-01T00:00:00.000Z  2026-02-02T00:00:00.000Z",
        "s22  Second  no         yes       2026-01-01T00:00:00.000Z  2026-02-02T00:00:00.000Z",
      ].join("\n"),
    );
  });
});

describe("run (provider seam)", () => {
  const user = {
    id: "11111111-0000-4000-8000-a00000000001",
    email: "o@x.y",
    displayName: "O",
    blocked: false,
  };
  const READ = ["getUser", "findUserByEmail", "listSurveys", "listUserProjects", "close"];

  /** Fake ProviderSet that records calls and throws on any method outside the read set. */
  function fake(options: { found?: boolean; failOn?: string; error?: unknown } = {}) {
    const calls: string[] = [];
    let made = 0;
    const call = (name: string, result: unknown) => async () => {
      calls.push(name);
      if (options.failOn === name) throw options.error ?? new Error("boom");
      return result;
    };
    const guard = <T extends object>(target: T, label: string): T =>
      new Proxy(target, {
        get(t, prop, receiver) {
          if (typeof prop === "string" && prop !== "then" && !(prop in t)) {
            throw new Error(`unexpected access: ${label}.${prop}`);
          }
          return Reflect.get(t, prop, receiver) as unknown;
        },
      });
    const found = options.found ?? true;
    const providers = guard(
      {
        name: "fake",
        surveys: guard({ listSurveys: call("listSurveys", []), getSurvey: undefined }, "surveys"),
        users: guard(
          {
            getUser: call("getUser", found ? user : null),
            findUserByEmail: call("findUserByEmail", found ? user : null),
          },
          "users",
        ),
        projects: guard(
          {
            listUserProjects: call("listUserProjects", [
              { project: { id: "p1", name: "P" }, role: "admin" },
            ]),
          },
          "projects",
        ),
        close: call("close", undefined),
      },
      "providers",
    );
    return {
      calls,
      made: () => made,
      make: async () => {
        made++;
        return providers as never;
      },
    };
  }

  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
  }
  const seeded = { STORAGE_PROVIDER: "memory", MEMORY_SEED: "legacy-fixtures" };
  const STORE_VARIABLES = ["STORAGE_PROVIDER", "MEMORY_SEED"] as const;
  async function runWith(
    f: ReturnType<typeof fake>,
    user: string,
    env: Partial<Record<(typeof STORE_VARIABLES)[number], string>> = seeded,
  ) {
    const sink = io();
    const saved = { ...process.env };
    for (const k of STORE_VARIABLES) delete process.env[k];
    Object.assign(process.env, env);
    try {
      return { code: await run(["--user", user], sink.io, f.make), ...sink };
    } finally {
      for (const k of STORE_VARIABLES) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  }

  it("routes an email to findUserByEmail, lists surveys, then closes", async () => {
    const f = fake();
    const r = await runWith(f, "o@x.y");
    expect(r.code).toBe(0);
    expect(r.out.join("")).toContain("Project P (p1, role admin)");
    expect(f.calls).toEqual([
      "findUserByEmail",
      "listSurveys",
      "listUserProjects",
      "listSurveys",
      "close",
    ]);
  });

  it("routes a GUID to getUser", async () => {
    const f = fake();
    await runWith(f, "11111111-0000-4000-8000-A00000000001");
    expect(f.calls[0]).toBe("getUser");
    expect(f.calls).not.toContain("findUserByEmail");
  });

  it("only calls read methods", async () => {
    const f = fake();
    await runWith(f, "o@x.y");
    expect(f.calls.every((c) => READ.includes(c))).toBe(true);
  });

  it("closes when the user is not found and names the provider", async () => {
    const f = fake({ found: false });
    const r = await runWith(f, "o@x.y");
    expect(r.code).toBe(1);
    expect(f.calls).toEqual(["findUserByEmail", "close"]);
    expect(r.err.join("")).toBe("User not found in the fake store: o@x.y\n");
  });

  it.each([
    ["STORAGE_PROVIDER is not set", {}],
    ["STORAGE_PROVIDER is blank", { STORAGE_PROVIDER: " " }],
    ["the memory store has no seed", { STORAGE_PROVIDER: "memory" }],
    ["the memory store is seeded empty", { STORAGE_PROVIDER: "memory", MEMORY_SEED: "empty" }],
  ])("refuses with exit 2 when %s", async (_name, env) => {
    const f = fake();
    const r = await runWith(f, "o@x.y", env);
    expect(r.code).toBe(2);
    expect(f.made()).toBe(0);
    expect(r.out).toEqual([]);
    expect(r.err.join("")).toContain("--env-file docker/azurite.env");
  });

  it("prints the name and a safe code of an unexpected error, never its message", async () => {
    const error = Object.assign(new TypeError("Server=prod;Password=boom"), { code: "ESOCKET" });
    const r = await runWith(fake({ failOn: "listSurveys", error }), "o@x.y");
    expect(r.code).toBe(1);
    expect(r.err.join("")).toBe("Error: unexpected failure (TypeError, code ESOCKET)\n");
  });

  it("leaves out a code that is not a plain identifier", async () => {
    const error = Object.assign(new Error("x"), { code: "Password=boom" });
    const r = await runWith(fake({ failOn: "listSurveys", error }), "o@x.y");
    expect(r.err.join("")).toBe("Error: unexpected failure (Error)\n");
  });

  it("closes and exits 1 when a store method throws", async () => {
    const f = fake({ failOn: "listSurveys" });
    const r = await runWith(f, "o@x.y");
    expect(r.code).toBe(1);
    expect(f.calls.at(-1)).toBe("close");
    expect(r.err.join("")).not.toContain("boom");
  });
});

describe("parseArgs --stats", () => {
  it("accepts --stats with --json, --result-bytes and --env-file", () => {
    expect(parseArgs(["--stats", "--json", "--result-bytes", "--env-file", "x.env"])).toEqual({
      kind: "stats",
      envFile: "x.env",
      json: true,
      resultBytes: true,
    });
  });
  it("accepts --stats alone", () => {
    expect(parseArgs(["--stats"])).toEqual({
      kind: "stats",
      envFile: null,
      json: false,
      resultBytes: false,
    });
  });
  it("rejects --stats with --user", () => {
    expect(parseArgs(["--stats", "--user", "a"])).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("not both"),
    });
  });
  it("rejects --json or --result-bytes without --stats", () => {
    expect(parseArgs(["--user", "a", "--json"])).toMatchObject({ kind: "usage-error" });
    expect(parseArgs(["--user", "a", "--result-bytes"])).toMatchObject({ kind: "usage-error" });
  });
  it("asks for --user or --stats when neither is given", () => {
    expect(parseArgs([])).toMatchObject({
      kind: "usage-error",
      message: expect.stringContaining("--stats"),
    });
  });
});

describe("run --stats (measure seam)", () => {
  const legacyEnv = {
    LEGACY_SQL_CONNECTION_STRING: "Server=sql.invalid;Password=Secret-Sql-1",
    LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "AccountName=a;AccountKey=Secret-Key-1",
    LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "AccountName=a;AccountKey=Secret-Key-1",
  };
  const measurements = {
    sql: {
      users: 3,
      usersWithAccessKey: 1,
      blockedUsers: 0,
      surveys: 4,
      projectSurveys: 1,
      archivedSurveys: 0,
      surveysWithTheme: 0,
      themeBytes: 0,
      projects: 1,
      memberships: 2,
    },
    tables: [],
    containers: [],
    resultBytesMeasured: false,
  };

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
  }
  const noProviders = () => {
    throw new Error("the provider set is not used by --stats");
  };

  it("prints the text summary of what the measurer read", async () => {
    const { out, err, io } = capture();
    const seen: unknown[] = [];
    const code = await run(["--stats"], io, noProviders, {
      env: legacyEnv,
      measure: async (legacy, options) => {
        seen.push(legacy, options.resultBytes);
        return measurements;
      },
    });
    expect(err.join("")).toBe("");
    expect(code).toBe(0);
    expect(out.join("")).toMatch(/^Surveys\s+4 \(personal 3, project 1, archived 0\)$/m);
    expect(seen).toEqual([
      {
        sqlConnectionString: legacyEnv.LEGACY_SQL_CONNECTION_STRING,
        surveysStorageConnectionString: legacyEnv.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING,
        resultsStorageConnectionString: legacyEnv.LEGACY_RESULTS_STORAGE_CONNECTION_STRING,
      },
      false,
    ]);
  });

  it("prints the summary as JSON with --json, and passes --result-bytes on", async () => {
    const { out, io } = capture();
    let resultBytes: boolean | null = null;
    const code = await run(["--stats", "--json", "--result-bytes"], io, noProviders, {
      env: legacyEnv,
      measure: async (_legacy, options) => {
        resultBytes = options.resultBytes;
        return measurements;
      },
    });
    expect(code).toBe(0);
    expect(resultBytes).toBe(true);
    expect(JSON.parse(out.join(""))).toMatchObject({ sql: { surveys: 4, personalSurveys: 3 } });
  });

  it("exits 2 and names the variable when a connection string is missing", async () => {
    const { out, err, io } = capture();
    const code = await run(["--stats"], io, noProviders, {
      env: { ...legacyEnv, LEGACY_RESULTS_STORAGE_CONNECTION_STRING: " " },
      measure: async () => measurements,
    });
    expect(code).toBe(2);
    expect(out.join("")).toBe("");
    expect(err.join("")).toContain("LEGACY_RESULTS_STORAGE_CONNECTION_STRING");
    expect(err.join("")).toContain("--env-file docker/azurite.env");
  });

  it("exits 1 with a safe message, never a secret, when the measurer fails", async () => {
    const { out, err, io } = capture();
    const code = await run(["--stats"], io, noProviders, {
      env: legacyEnv,
      measure: async () => {
        throw new Error(`login failed: ${legacyEnv.LEGACY_SQL_CONNECTION_STRING}`);
      },
    });
    expect(code).toBe(1);
    expect(out.join("")).toBe("");
    expect(err.join("")).toMatch(/^Error: /);
    expect(err.join("")).not.toContain("Secret");
  });
});
