import { describe, expect, it } from "vitest";
import type { SurveyRecord, User } from "../domain/types.js";
import { LegacyStoreError } from "../providers/azure-legacy/index.js";
import { createMemoryProviders } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";
import { formatPlan, run, USAGE } from "./account-erase.js";

const ERIN: User = {
  id: "11111111-0000-4000-8000-a00000000006",
  email: "erasable@example.com",
  displayName: "Erin Erasable",
  blocked: false,
};
const ADAM: User = {
  id: "11111111-0000-4000-8000-a00000000002",
  email: "admin@example.com",
  displayName: "Adam Admin",
  blocked: false,
};
/** Erin is its only admin, Adam a user: Adam is promoted. */
const HANDOVER = "77777777-0000-4000-8000-000000000001";
/** Erin alone: deleted with its two surveys. */
const SOLO = "77777777-0000-4000-8000-000000000002";
/** Adam is an admin too: Erin just leaves. */
const SHARED = "77777777-0000-4000-8000-000000000003";

let n = 0;
function survey(name: string, owner: SurveyRecord["owner"], archived = false): SurveyRecord {
  n += 1;
  const tail = String(n).padStart(12, "0");
  return {
    id: `88888888-0000-4000-8000-${tail}`,
    name,
    owner,
    creatorId: ERIN.id,
    postId: `88888888-0000-4000-8001-${tail}`,
    resultId: `88888888-0000-4000-8002-${tail}`,
    published: false,
    archived,
    createdAt: "2026-01-01T00:00:00.000Z",
    // Newest first in lists: the order the surveys are created here.
    updatedAt: `2026-02-${String(28 - n).padStart(2, "0")}T00:00:00.000Z`,
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

const PERSONAL = { kind: "personal", userId: ERIN.id } as const;
const S1 = survey("Erin's poll", PERSONAL);
const S2 = survey("Erin's old poll", PERSONAL, true);
const SOLO_SURVEYS = [
  survey("Solo one", { kind: "project", projectId: SOLO }),
  survey("Solo two", { kind: "project", projectId: SOLO }),
];
const HANDOVER_SURVEY = survey("Handover survey", { kind: "project", projectId: HANDOVER });

const CREATED = "2026-01-01T00:00:00.000Z";

function seeded(): ProviderSet {
  return createMemoryProviders({
    users: [ERIN, ADAM],
    surveys: [S1, S2, ...SOLO_SURVEYS, HANDOVER_SURVEY],
    projects: [
      { id: HANDOVER, name: "Alpha handover", creatorId: ERIN.id, createdAt: CREATED },
      { id: SOLO, name: "Beta solo", creatorId: ERIN.id, createdAt: CREATED },
      { id: SHARED, name: "Gamma shared", creatorId: ADAM.id, createdAt: CREATED },
    ],
    memberships: [
      { userId: ERIN.id, projectId: HANDOVER, role: "admin" },
      { userId: ADAM.id, projectId: HANDOVER, role: "user" },
      { userId: ERIN.id, projectId: SOLO, role: "admin" },
      { userId: ADAM.id, projectId: SHARED, role: "admin" },
      { userId: ERIN.id, projectId: SHARED, role: "user" },
    ],
  });
}

/** An azure-legacy configuration with placeholder connection strings (the store is injected). */
const LEGACY_ENV = {
  STORAGE_PROVIDER: "azure-legacy",
  LEGACY_SQL_CONNECTION_STRING: "placeholder-sql",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "placeholder-surveys",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "placeholder-results",
};

const NOW = Date.parse("2026-10-19T10:00:00.000Z");

async function erase(
  argv: string[],
  options: { env?: Record<string, string>; providers?: ProviderSet } = {},
) {
  const providers = options.providers ?? seeded();
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
      now: () => NOW,
    },
  );
  return { code, out: out.join(""), err: err.join(""), made, providers };
}

const PLAN = [
  `Account ${ERIN.id} (erasable@example.com, Erin Erasable)`,
  "Personal surveys to delete: 2",
  `  ${S1.id}  Erin's poll`,
  `  ${S2.id}  Erin's old poll`,
  "Projects: 3",
  `  ${HANDOVER}  Alpha handover: leaves the project; ${ADAM.id} becomes an admin`,
  `  ${SOLO}  Beta solo: the project is deleted with its 2 surveys`,
  `  ${SHARED}  Gamma shared: leaves the project`,
].join("\n");

describe("account:erase", () => {
  it("prints the plan and erases nothing without --yes", async () => {
    const r = await erase(["--user", ERIN.id]);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toBe(
      `${PLAN}\n` +
        "The final decision for each project is made at erase time and can differ from this plan.\n" +
        "Dry run: nothing was erased. Run again with --yes to erase.\n",
    );
    expect(await r.providers.surveys.listSurveys(PERSONAL)).toHaveLength(2);
    expect(await r.providers.projects.listUserProjects(ERIN.id)).toHaveLength(3);
  });

  it("erases with --yes and prints the summary", async () => {
    const r = await erase(["--user", ERIN.id, "--yes"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      `${PLAN}\nErased ${ERIN.id}: 4 surveys deleted, 2 projects left, 1 projects deleted, 1 admins promoted.\n`,
    );
    expect(await r.providers.surveys.listSurveys(PERSONAL)).toEqual([]);
    expect(await r.providers.projects.listUserProjects(ERIN.id)).toEqual([]);
    expect(await r.providers.projects.getUserProject(ADAM.id, HANDOVER)).toMatchObject({
      role: "admin",
    });
  });

  it("finds the account by email", async () => {
    const r = await erase(["--user", "Erasable@Example.com"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`Account ${ERIN.id} (erasable@example.com, Erin Erasable)`);
  });

  it("erases an id the directory does not know", async () => {
    const ghost = "99999999-0000-4000-8000-000000000001";
    const r = await erase(["--user", ghost.toUpperCase(), "--yes"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        `Account ${ghost} (not in the user directory)`,
        "Personal surveys to delete: 0",
        "Projects: 0",
        `Erased ${ghost}: 0 surveys deleted, 0 projects left, 0 projects deleted, 0 admins promoted.`,
        "",
      ].join("\n"),
    );
  });

  it("exits 1 for an unknown email", async () => {
    const r = await erase(["--user", "nobody@example.com", "--yes"]);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("User not found in the user directory: nobody@example.com\n");
  });

  it("exits 2 with the usage without --user", async () => {
    const r = await erase(["--yes"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--user is required");
    expect(r.err).toContain(USAGE);
    expect(r.made).toBe(0);
  });

  it("prints the usage for --help", async () => {
    const r = await erase(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${USAGE}\n`);
    expect(USAGE.split("\n")[0]).toBe(
      "Usage: pnpm account:erase --user <id|email> [--yes] [--env-file <path>]",
    );
  });

  it.each([
    ["STORAGE_PROVIDER is not set", {}],
    ["STORAGE_PROVIDER is memory", { STORAGE_PROVIDER: "memory", MEMORY_SEED: "legacy-fixtures" }],
  ])("refuses with exit 2 when %s", async (_name, env) => {
    const r = await erase(["--user", ERIN.id, "--yes"], { env });
    expect(r.code).toBe(2);
    expect(r.made).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "STORAGE_PROVIDER must name a persistent store: memory keeps its data inside the server " +
        "process. Pass --env-file docker/azurite.env for the local replica.\n",
    );
  });

  it("prints a LegacyStoreError's message", async () => {
    const providers = seeded();
    const failing = {
      ...providers,
      surveys: {
        ...providers.surveys,
        listSurveys: () => Promise.reject(new LegacyStoreError("survey list", { code: "ESOCKET" })),
      },
    };
    const r = await erase(["--user", ERIN.id, "--yes"], { providers: failing });
    expect(r.code).toBe(1);
    expect(r.err).toBe("Error: Legacy store survey list failed (ESOCKET)\n");
  });

  it("prints only the name and a safe code of any other error", async () => {
    const providers = seeded();
    const error = Object.assign(new TypeError("Server=prod;Password=boom"), { code: "ESOCKET" });
    const failing = {
      ...providers,
      users: { ...providers.users, getUser: () => Promise.reject(error) },
    };
    const r = await erase(["--user", ERIN.id], { providers: failing });
    expect(r.code).toBe(1);
    expect(r.err).toBe("Error: unexpected failure (TypeError, code ESOCKET)\n");
  });
});

describe("formatPlan", () => {
  it("names a project whose membership cannot be read, and lists an unreadable survey by id", () => {
    const plan = formatPlan(null, {
      userId: ERIN.id,
      personalSurveys: [{ id: S1.id, name: "" }],
      projects: [{ id: SHARED, name: "", decision: { kind: "remove" }, surveyCount: 0 }],
    });
    expect(plan).toBe(
      `Account ${ERIN.id} (not in the user directory)\n` +
        "Personal surveys to delete: 1\n" +
        `  ${S1.id}  \n` +
        "Projects: 1\n" +
        `  ${SHARED}  (membership not readable): leaves the project\n`,
    );
  });
});
