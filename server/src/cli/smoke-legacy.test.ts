import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "../domain/types.js";
import { createMemoryProviders } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";
import { run, USAGE } from "./smoke-legacy.js";

// The refusals and the secret handling of `pnpm smoke:legacy`, on the memory store with an
// injected provider set. The full run against a stub of the legacy API on the local replica is
// smoke/smoke-legacy.azurite.test.ts.

const TESTER: User = {
  id: "11111111-0000-4000-8000-0000000000e1",
  email: "smoke@example.com",
  displayName: "Smoke Tester",
  blocked: false,
};
const BLOCKED: User = {
  id: "11111111-0000-4000-8000-0000000000e2",
  email: "blocked-smoke@example.com",
  displayName: "Blocked",
  blocked: true,
};

/** Never printed: the canary of every test. */
const KEY = "canary-access-key-0f6b1c2d";

/** An azure-legacy configuration with placeholder connection strings (the store is injected). */
const LEGACY_ENV = {
  STORAGE_PROVIDER: "azure-legacy",
  LEGACY_SQL_CONNECTION_STRING: "placeholder-sql",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "placeholder-surveys",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "placeholder-results",
  SMOKE_ACCESS_KEY: KEY,
};

/** A legacy API that refuses every call and echoes the key, as the real one does for a wrong key. */
let echo: Server;
let echoUrl = "";

beforeAll(async () => {
  echo = createServer((request, response) => {
    const key = new URL(request.url ?? "/", "http://x").searchParams.get("accessKey") ?? KEY;
    response.writeHead(401, { "content-type": "text/plain" });
    response.end(`The accessKey '${key}' is incorrect.`);
  });
  await new Promise<void>((resolve) => echo.listen(0, "127.0.0.1", resolve));
  echoUrl = `http://127.0.0.1:${(echo.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => echo.close(() => resolve()));
});

async function smoke(
  argv: string[],
  options: { env?: Record<string, string>; providers?: ProviderSet } = {},
) {
  const providers =
    options.providers ??
    createMemoryProviders({ users: [TESTER, BLOCKED], surveys: [], projects: [], memberships: [] });
  const out: string[] = [];
  const err: string[] = [];
  let made = 0;
  const code = await run(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    {
      env: options.env ?? LEGACY_ENV,
      makeProviders: () => {
        made += 1;
        return Promise.resolve(providers);
      },
    },
  );
  return { code, out: out.join(""), err: err.join(""), made, providers };
}

const ARGS = ["--account", TESTER.email, "--yes", "--legacy-api"];

describe("smoke:legacy refusals", () => {
  it("prints the usage with --help", async () => {
    const r = await smoke(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${USAGE}\n`);
  });

  it("needs --account", async () => {
    const r = await smoke(["--yes"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--account is required");
    expect(r.made).toBe(0);
  });

  it("refuses without --yes and opens no store", async () => {
    const r = await smoke(["--account", TESTER.email]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^Refused: .*--yes/);
    expect(r.made).toBe(0);
  });

  it("refuses without SMOKE_ACCESS_KEY", async () => {
    const env: Record<string, string> = { ...LEGACY_ENV };
    delete env.SMOKE_ACCESS_KEY;
    const r = await smoke([...ARGS, echoUrl], { env });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^Refused: SMOKE_ACCESS_KEY is not set/);
    expect(r.made).toBe(0);
  });

  it("refuses with READ_ONLY=true", async () => {
    const r = await smoke([...ARGS, echoUrl], { env: { ...LEGACY_ENV, READ_ONLY: "true" } });
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/^Refused: READ_ONLY=true\./);
    expect(r.made).toBe(0);
  });

  it("refuses the memory store", async () => {
    const r = await smoke([...ARGS, echoUrl], {
      env: { STORAGE_PROVIDER: "memory", SMOKE_ACCESS_KEY: KEY },
    });
    expect(r.code).toBe(2);
    expect(r.made).toBe(0);
  });

  it("refuses a --legacy-api that is not an http(s) URL", async () => {
    const r = await smoke([...ARGS, "ftp://example.com"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--legacy-api");
    expect(r.made).toBe(0);
  });

  it("refuses an unknown account and writes nothing", async () => {
    const r = await smoke(["--account", "nobody@example.com", "--yes", "--legacy-api", echoUrl]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refused: no account with this email: nobody@example.com");
    expect(await r.providers.surveys.listSurveys({ kind: "personal", userId: TESTER.id })).toEqual(
      [],
    );
  });

  it("refuses a blocked account and writes nothing", async () => {
    const r = await smoke(["--account", BLOCKED.email, "--yes", "--legacy-api", echoUrl]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refused: the account blocked-smoke@example.com is blocked");
    expect(await r.providers.surveys.listSurveys({ kind: "personal", userId: BLOCKED.id })).toEqual(
      [],
    );
  });
});

describe("smoke:legacy when the legacy API refuses every read", () => {
  it("fails every check, cleans up, exits 1 and never prints the access key", async () => {
    const r = await smoke([...ARGS, echoUrl]);
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.out).toMatch(/^\| step +\| app +\| legacy +\| result +\|$/m);
    expect(r.out).toMatch(/^\| create survey .*\| FAIL +\|$/m);
    expect(r.out).toContain("create survey: getActive answered HTTP 401");
    expect(r.out).toMatch(/^\| delete project .*\| manual +\|$/m);
    expect(r.out).toContain("Result: FAILED");
    // Every step ran on the app, the last ones deleted what the run created.
    expect(await r.providers.surveys.listSurveys({ kind: "personal", userId: TESTER.id })).toEqual(
      [],
    );
    expect(await r.providers.projects.listUserProjects(TESTER.id)).toEqual([]);
  });

  it("stops at an app write that fails, skips the rest and deletes the test survey", async () => {
    const memory = createMemoryProviders({
      users: [TESTER],
      surveys: [],
      projects: [],
      memberships: [],
    });
    const providers: ProviderSet = {
      ...memory,
      projects: {
        ...memory.projects,
        createProject: () => Promise.reject(new Error(`store failure ${KEY}`)),
      },
    };
    const r = await smoke([...ARGS, echoUrl], { providers });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^\| create project .*\| error +\|$/m);
    expect(r.out).toContain("create project: app: unexpected failure (Error)");
    expect(r.out).toMatch(/^\| move into project .*\| skipped +\|$/m);
    expect(r.out).toMatch(/^\| delete project .*\| skipped +\|$/m);
    expect(r.out).toMatch(/^Cleanup: deleted the test survey [0-9a-f-]{36}$/m);
    expect(r.out + r.err).not.toContain(KEY);
    expect(await memory.surveys.listSurveys({ kind: "personal", userId: TESTER.id })).toEqual([]);
  });

  it("names a legacy API it cannot reach without the URL's query", async () => {
    const r = await smoke([...ARGS, "http://127.0.0.1:1"]);
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.out).toMatch(/create survey: getActive: the request failed \(TypeError/);
  });
});
