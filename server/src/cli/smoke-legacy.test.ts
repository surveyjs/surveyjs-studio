import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SurveyOwner, User } from "../domain/types.js";
import { createMemoryProviders } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";
import { KEY_OF_ANOTHER_ACCOUNT, type TestData } from "../smoke/steps.js";
import { createInterruptHandler, parseArgs, run, USAGE } from "./smoke-legacy.js";

// The refusals, the interrupt, the cleanup and the secret handling of `pnpm smoke:legacy`, on the
// memory store with an injected provider set. The full run against a stub of the legacy API on
// the local replica is smoke/smoke-legacy.azurite.test.ts.

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
/** The owner of the key in the "another account" test. */
const OTHER_ID = "11111111-0000-4000-8000-0000000000e3";

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

const memoryStore = (): ProviderSet =>
  createMemoryProviders({ users: [TESTER, BLOCKED], surveys: [], projects: [], memberships: [] });

/**
 * A `fetch` for the legacy API that answers `getActive` from the memory store as the key's user
 * (`keyUserId`) sees it, and every other call with 401 and the key in the text. `onList` sees each
 * `ownerId` asked for (undefined for Personal).
 */
function listingFetch(
  providers: ProviderSet,
  keyUserId: string,
  onList: (ownerId: string | undefined) => void = () => undefined,
): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/getActive")) {
      return new Response(`The accessKey '${url.searchParams.get("accessKey")}' is incorrect.`, {
        status: 401,
      });
    }
    const ownerId = url.searchParams.get("ownerId") ?? undefined;
    onList(ownerId);
    const member =
      ownerId !== undefined && (await providers.projects.getUserProject(keyUserId, ownerId));
    const owner: SurveyOwner = member
      ? { kind: "project", projectId: ownerId! }
      : { kind: "personal", userId: keyUserId };
    const list = (await providers.surveys.listSurveys(owner)).filter((s) => !s.archived);
    const body = list.map((s) => ({
      Id: s.id,
      Name: s.name,
      UserId: s.owner.kind === "project" ? s.owner.projectId : s.owner.userId,
      IsPublished: null,
      IsArchived: false,
      AllowAccessResult: s.settings.publicResults,
      Theme: null,
      PostId: s.postId,
      ResultId: s.resultId,
    }));
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

async function smoke(
  argv: string[],
  options: {
    env?: Record<string, string>;
    providers?: ProviderSet;
    fetch?: typeof fetch;
    signal?: AbortSignal;
  } = {},
) {
  const providers = options.providers ?? memoryStore();
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
      ...(options.fetch && { fetch: options.fetch }),
      ...(options.signal && { signal: options.signal }),
    },
  );
  return { code, out: out.join(""), err: err.join(""), made, providers };
}

const ARGS = ["--account", TESTER.email, "--yes", "--legacy-api"];
const PERSONAL: SurveyOwner = { kind: "personal", userId: TESTER.id };
const GUID = "[0-9a-f-]{36}";

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

  it("refuses with READ_ONLY=true, in its own words", async () => {
    const r = await smoke([...ARGS, echoUrl], { env: { ...LEGACY_ENV, READ_ONLY: "true" } });
    expect(r.code).toBe(2);
    expect(r.err).toBe("Refused: READ_ONLY=true. The smoke test writes; nothing was written.\n");
    expect(r.made).toBe(0);
  });

  it("refuses the memory store", async () => {
    const r = await smoke([...ARGS, echoUrl], {
      env: { STORAGE_PROVIDER: "memory", SMOKE_ACCESS_KEY: KEY },
    });
    expect(r.code).toBe(2);
    expect(r.made).toBe(0);
  });

  it.each(["ftp://example.com", "http://example.com", "http://api.surveyjs.io", "not a url"])(
    "refuses --legacy-api %s",
    async (url) => {
      const r = await smoke([...ARGS, url]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("--legacy-api must be an https URL");
      expect(r.made).toBe(0);
    },
  );

  it.each([
    "https://api.surveyjs.io",
    "http://localhost:4100",
    "http://127.0.0.1:4100",
    "http://[::1]:4100",
  ])("accepts --legacy-api %s", (url) => {
    const parsed = parseArgs(["--account", TESTER.email, "--yes", "--legacy-api", url]);
    expect(parsed).toMatchObject({ kind: "run", legacyApi: url });
  });

  it("refuses an unknown account and writes nothing", async () => {
    const r = await smoke(["--account", "nobody@example.com", "--yes", "--legacy-api", echoUrl]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("Refused: no account with this email: nobody@example.com");
    expect(await r.providers.surveys.listSurveys(PERSONAL)).toEqual([]);
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

describe("smoke:legacy stops at the first check when the key cannot be confirmed", () => {
  it("stops when the legacy API refuses the key, cleans up and never prints it", async () => {
    const r = await smoke([...ARGS, echoUrl]);
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.out).toMatch(new RegExp(`^Created test survey ${GUID}$`, "m"));
    expect(r.out).toMatch(/^\| step +\| app +\| legacy +\| result +\|$/m);
    expect(r.out).toMatch(/^\| create survey .*\| FAIL +\|$/m);
    expect(r.out).toContain("create survey: getActive answered HTTP 401. The run stopped.");
    expect(r.out).toMatch(/^\| rename .*\| skipped +\|$/m);
    expect(r.out).toMatch(/^\| delete project .*\| skipped +\|$/m);
    expect(r.out).toMatch(new RegExp(`^Cleanup: deleted the test survey ${GUID}$`, "m"));
    expect(r.out).toContain("Result: FAILED.");
    expect(await r.providers.surveys.listSurveys(PERSONAL)).toEqual([]);
  });

  it("stops when the key belongs to another account", async () => {
    const providers = memoryStore();
    const r = await smoke([...ARGS, "http://127.0.0.1:9"], {
      providers,
      fetch: listingFetch(providers, OTHER_ID),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`create survey: ${KEY_OF_ANOTHER_ACCOUNT}. The run stopped.`);
    expect(r.out).toMatch(/^\| rename .*\| skipped +\|$/m);
    expect(r.out).toMatch(new RegExp(`^Cleanup: deleted the test survey ${GUID}$`, "m"));
    expect(await providers.surveys.listSurveys(PERSONAL)).toEqual([]);
  });

  it("names a legacy API it cannot reach without the URL's query", async () => {
    const r = await smoke([...ARGS, "http://127.0.0.1:1"]);
    expect(r.code).toBe(1);
    expect(r.out + r.err).not.toContain(KEY);
    expect(r.out).toMatch(/create survey: getActive: the request failed \(TypeError/);
  });
});

describe("smoke:legacy app failures, cleanup failures and interrupts", () => {
  it("stops at an app write that fails, skips the rest and deletes the test survey", async () => {
    const memory = memoryStore();
    const providers: ProviderSet = {
      ...memory,
      projects: {
        ...memory.projects,
        createProject: () => Promise.reject(new Error(`store failure ${KEY}`)),
      },
    };
    const r = await smoke([...ARGS, "http://127.0.0.1:9"], {
      providers,
      fetch: listingFetch(memory, TESTER.id),
    });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^\| create survey .*\| pass +\|$/m);
    expect(r.out).toMatch(/^\| create project .*\| error +\|$/m);
    expect(r.out).toContain("create project: app: unexpected failure (Error)");
    expect(r.out).toMatch(/^\| move into project .*\| skipped +\|$/m);
    expect(r.out).toMatch(/^\| delete project .*\| skipped +\|$/m);
    expect(r.out).toMatch(new RegExp(`^Cleanup: deleted the test survey ${GUID}$`, "m"));
    expect(r.out + r.err).not.toContain(KEY);
    expect(await memory.surveys.listSurveys(PERSONAL)).toEqual([]);
  });

  it("prints ACTION NEEDED with the ids when the cleanup cannot delete them", async () => {
    const memory = memoryStore();
    const providers: ProviderSet = {
      ...memory,
      surveys: { ...memory.surveys, deleteSurvey: () => Promise.reject(new Error("no delete")) },
      projects: {
        ...memory.projects,
        deleteProject: () => Promise.reject(new Error("no delete")),
      },
    };
    const r = await smoke([...ARGS, "http://127.0.0.1:9"], {
      providers,
      fetch: listingFetch(memory, TESTER.id),
    });
    expect(r.code).toBe(1);
    const survey = /^Created test survey (\S+)$/m.exec(r.out)?.[1];
    const project = /^Created test project (\S+)$/m.exec(r.out)?.[1];
    expect(survey).toMatch(new RegExp(`^${GUID}$`));
    expect(project).toMatch(new RegExp(`^${GUID}$`));
    expect(r.out).toMatch(/^\| delete survey .*\| error +\|$/m);
    expect(r.err).toContain(
      `Cleanup: could not delete the test survey ${survey}: unexpected failure (Error)\n`,
    );
    expect(r.err).toContain(
      `Cleanup: could not delete the test project ${project}: unexpected failure (Error)\n`,
    );
    expect(r.err).toContain(
      `ACTION NEEDED: remove survey ${survey} / project ${project} as the test account\n`,
    );
    expect(r.out).toContain("Result: FAILED.");
  });

  it("on an interrupt skips the steps left and deletes the survey and the project", async () => {
    const controller = new AbortController();
    const providers = memoryStore();
    // The interrupt arrives during the project's check.
    const fetch = listingFetch(providers, TESTER.id, (ownerId) => {
      if (ownerId !== undefined) controller.abort();
    });
    const r = await smoke([...ARGS, "http://127.0.0.1:9"], {
      providers,
      fetch,
      signal: controller.signal,
    });
    expect(r.code).toBe(1);
    const survey = /^Created test survey (\S+)$/m.exec(r.out)?.[1];
    const project = /^Created test project (\S+)$/m.exec(r.out)?.[1];
    expect(r.out).toMatch(/^\| create project .*\| pass +\|$/m);
    expect(r.out).toMatch(/^\| move into project .*\| skipped +\|$/m);
    expect(r.out).toMatch(/^\| delete survey .*\| skipped +\|$/m);
    expect(r.out).toContain(`Cleanup: deleted the test survey ${survey}\n`);
    expect(r.out).toContain(`Cleanup: deleted the test project ${project}\n`);
    expect(r.err).not.toContain("ACTION NEEDED");
    expect(r.out).toContain("Result: FAILED (interrupted).");
    expect(await providers.surveys.listSurveys(PERSONAL)).toEqual([]);
    expect(await providers.projects.listUserProjects(TESTER.id)).toEqual([]);
  });

  it("aborts on the first signal and exits at once with the ids on the second", () => {
    const controller = new AbortController();
    const pending = new Map<TestData, string>([
      ["survey", "22222222-0000-4000-8000-0000000000aa"],
      ["project", "55555555-0000-4000-8000-0000000000bb"],
    ]);
    const err: string[] = [];
    const exits: number[] = [];
    const handler = createInterruptHandler({
      controller,
      io: { out: () => undefined, err: (t) => err.push(t) },
      pending,
      exit: (code) => exits.push(code),
    });
    handler();
    expect(controller.signal.aborted).toBe(true);
    expect(exits).toEqual([]);
    expect(err.join("")).toContain("Interrupted: the current step finishes");
    handler();
    expect(exits).toEqual([130]);
    expect(err.join("")).toContain(
      "ACTION NEEDED: remove survey 22222222-0000-4000-8000-0000000000aa / " +
        "project 55555555-0000-4000-8000-0000000000bb as the test account",
    );
  });
});
