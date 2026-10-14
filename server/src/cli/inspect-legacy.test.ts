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
  function fake(options: { found?: boolean; failOn?: string } = {}) {
    const calls: string[] = [];
    const call = (name: string, result: unknown) => async () => {
      calls.push(name);
      if (options.failOn === name) throw new Error("boom");
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
        directory: guard(
          {
            getUser: call("getUser", found ? user : null),
            findUserByEmail: call("findUserByEmail", found ? user : null),
            listUserProjects: call("listUserProjects", [
              { project: { id: "p1", name: "P" }, role: "admin" },
            ]),
          },
          "directory",
        ),
        close: call("close", undefined),
      },
      "providers",
    );
    return { calls, make: async () => providers as never };
  }

  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t) } };
  }
  const env = { STORAGE_PROVIDER: "memory" };
  async function runWith(f: ReturnType<typeof fake>, user: string) {
    const sink = io();
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return { code: await run(["--user", user], sink.io, f.make), ...sink };
    } finally {
      for (const k of Object.keys(env)) {
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

  it("closes when the user is not found", async () => {
    const f = fake({ found: false });
    const r = await runWith(f, "o@x.y");
    expect(r.code).toBe(1);
    expect(f.calls).toEqual(["findUserByEmail", "close"]);
  });

  it("closes and exits 1 when a store method throws", async () => {
    const f = fake({ failOn: "listSurveys" });
    const r = await runWith(f, "o@x.y");
    expect(r.code).toBe(1);
    expect(f.calls.at(-1)).toBe("close");
    expect(r.err.join("")).not.toContain("boom");
  });
});
