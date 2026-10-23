import type { FastifyBaseLogger } from "fastify";
import { describe, expect, it } from "vitest";
import type { ReadinessCheck, ReadinessName } from "./providers/types.js";
import { createReadiness, READINESS_CACHE_MS } from "./readiness.js";
import { safeErrorCategory } from "./safe-error.js";

const NAMES: readonly ReadinessName[] = ["sql", "surveys-storage"];

function harness(results: Array<readonly ReadinessCheck[] | Error>) {
  let calls = 0;
  let clock = 1_000;
  const lines: Array<Record<string, unknown>> = [];
  const log = {
    warn: (fields: Record<string, unknown>, msg: string) => lines.push({ ...fields, msg }),
  } as unknown as FastifyBaseLogger;
  const readiness = createReadiness(
    {
      readinessNames: NAMES,
      ready: async () => {
        const result = results[Math.min(calls, results.length - 1)]!;
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (result instanceof Error) throw result;
        return result;
      },
    },
    log,
    () => clock,
  );
  return {
    readiness,
    lines,
    calls: () => calls,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const ok: readonly ReadinessCheck[] = [
  { name: "sql", ok: true },
  { name: "surveys-storage", ok: true },
];
const sqlDown: readonly ReadinessCheck[] = [
  { name: "sql", ok: false, reason: "ELOGIN" },
  { name: "surveys-storage", ok: true },
];

describe("createReadiness", () => {
  it("runs one check for concurrent callers", async () => {
    const { readiness, calls } = harness([ok]);
    const answers = await Promise.all(Array.from({ length: 20 }, () => readiness.check()));
    expect(calls()).toBe(1);
    expect(answers.every((answer) => answer.failing.length === 0)).toBe(true);
  });

  it("reuses an answer, a failure too, until the cache time has passed", async () => {
    const { readiness, calls, advance } = harness([sqlDown, ok]);
    expect((await readiness.check()).failing).toEqual(["sql"]);
    advance(READINESS_CACHE_MS - 1);
    expect((await readiness.check()).failing).toEqual(["sql"]);
    expect(calls()).toBe(1);
    advance(1);
    expect((await readiness.check()).failing).toEqual([]);
    expect(calls()).toBe(2);
  });

  it("logs a check only when it starts or stops failing", async () => {
    const { readiness, lines, advance } = harness([sqlDown, sqlDown, ok, ok]);
    for (let i = 0; i < 4; i += 1) {
      await readiness.check();
      advance(READINESS_CACHE_MS);
    }
    expect(lines).toEqual([
      { check: "sql", reason: "ELOGIN", msg: "readiness check failing" },
      { check: "sql", msg: "readiness check ok again" },
    ]);
  });

  it("names every check when ready() throws, and logs only the error's code", async () => {
    const error = Object.assign(
      new Error("Login failed for sa at sql-canary.database.windows.net; Password=canary-secret"),
      { code: "ELOGIN" },
    );
    const { readiness, lines } = harness([error]);
    expect((await readiness.check()).failing).toEqual(NAMES);
    const logged = JSON.stringify(lines);
    expect(logged).toContain("ELOGIN");
    expect(logged).not.toContain("canary");
    expect(logged).not.toContain("database.windows.net");
    expect(lines.map((line) => line.check)).toEqual(NAMES);
  });
});

describe("safeErrorCategory", () => {
  it("keeps a timeout, codes, SQL numbers and HTTP statuses, and never a message", () => {
    expect(safeErrorCategory(new DOMException("t", "TimeoutError"))).toBe("timeout");
    expect(safeErrorCategory(Object.assign(new Error("host x"), { code: "ESOCKET" }))).toBe(
      "ESOCKET",
    );
    expect(
      safeErrorCategory(
        Object.assign(new Error("account a"), { code: "AuthorizationFailure", statusCode: 403 }),
      ),
    ).toBe("AuthorizationFailure, HTTP 403");
    expect(safeErrorCategory(Object.assign(new Error("x"), { number: 18456 }))).toBe(
      "SQL error 18456",
    );
    expect(
      safeErrorCategory(Object.assign(new Error("x"), { code: "Server=host.example.com" })),
    ).toBe("error");
    expect(safeErrorCategory(new Error("Password=canary"))).toBe("error");
    expect(safeErrorCategory("Password=canary")).toBe("error");
  });
});
