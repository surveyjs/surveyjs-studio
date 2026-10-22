import { describe, expect, it } from "vitest";
import type { SurveyRecord, User } from "../domain/types.js";
import { LegacyStoreError } from "../providers/azure-legacy/index.js";
import { createMemoryProviders } from "../providers/memory.js";
import type { ProviderSet } from "../providers/types.js";
import { run, USAGE } from "./account-reconcile.js";

const KNOWN: User = {
  id: "cccccccc-0000-4000-8000-000000000001",
  email: "known@example.com",
  displayName: "Known",
  blocked: false,
};
/** Owns a personal survey; the directory does not know them. */
const G1 = "aaaaaaaa-0000-4000-8000-000000000001";
/** A member of KNOWN's project; the directory does not know them. */
const G2 = "bbbbbbbb-0000-4000-8000-000000000001";
const PROJECT = "dddddddd-0000-4000-8000-000000000001";

let n = 0;
function personal(userId: string): SurveyRecord {
  n += 1;
  const tail = String(n).padStart(12, "0");
  return {
    id: `eeeeeeee-0000-4000-8000-${tail}`,
    name: "Survey",
    owner: { kind: "personal", userId },
    creatorId: userId,
    postId: `eeeeeeee-0000-4000-8001-${tail}`,
    resultId: `eeeeeeee-0000-4000-8002-${tail}`,
    published: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

function seeded(ghosts = true): ProviderSet {
  return createMemoryProviders({
    users: [KNOWN],
    surveys: [personal(KNOWN.id), ...(ghosts ? [personal(G1)] : [])],
    projects: [
      { id: PROJECT, name: "Team", creatorId: KNOWN.id, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    memberships: [
      { userId: KNOWN.id, projectId: PROJECT, role: "admin" },
      ...(ghosts ? [{ userId: G2, projectId: PROJECT, role: "user" as const }] : []),
    ],
  });
}

const LEGACY_ENV = {
  STORAGE_PROVIDER: "azure-legacy",
  LEGACY_SQL_CONNECTION_STRING: "placeholder-sql",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "placeholder-surveys",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "placeholder-results",
};

async function reconcile(
  argv: string[],
  providers: ProviderSet = seeded(),
  env: Record<string, string> = LEGACY_ENV,
) {
  const out: string[] = [];
  const err: string[] = [];
  let made = 0;
  const code = await run(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    {
      env,
      makeProviders: () => {
        made += 1;
        return Promise.resolve(providers);
      },
      now: () => Date.parse("2026-10-19T10:00:00.000Z"),
    },
  );
  return { code, out: out.join(""), err: err.join(""), made };
}

/** Whether the ghosts' data is still there. */
async function ghostData(providers: ProviderSet) {
  return {
    g1Surveys: (await providers.surveys.listSurveys({ kind: "personal", userId: G1 })).length,
    g2Projects: (await providers.projects.listUserProjects(G2)).length,
  };
}

const LISTED = `Users the directory does not know: 2\n  ${G1}\n  ${G2}\n`;
const ERASED_G1 = `Erased ${G1}: 1 surveys deleted, 0 projects left, 0 projects deleted, 0 admins promoted.\n`;
const ERASED_G2 = `Erased ${G2}: 0 surveys deleted, 1 projects left, 0 projects deleted, 0 admins promoted.\n`;

describe("account:reconcile", () => {
  it("lists the ids the directory does not know and erases nothing without --apply", async () => {
    const providers = seeded();
    const r = await reconcile([], providers);
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toBe(
      LISTED +
        "These are owner ids the directory does not know, not necessarily people: the id of a deleted project can own surveys too.\n" +
        "Dry run: nothing was erased. Run again with --apply to erase them.\n",
    );
    expect(await ghostData(providers)).toEqual({ g1Surveys: 1, g2Projects: 1 });
  });

  it("erases each of them with --apply", async () => {
    const providers = seeded();
    const r = await reconcile(["--apply"], providers);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`${LISTED}${ERASED_G1}${ERASED_G2}Erased 2 of 2 users.\n`);
    expect(await ghostData(providers)).toEqual({ g1Surveys: 0, g2Projects: 0 });
    expect(await providers.projects.listUserProjects(KNOWN.id)).toHaveLength(1);
  });

  it("refuses to erase more than --max users", async () => {
    const providers = seeded();
    const r = await reconcile(["--apply", "--max", "1"], providers);
    expect(r.code).toBe(1);
    expect(r.out).toBe(LISTED);
    expect(r.err).toBe("Refused: 2 users is more than --max 1. Nothing was erased.\n");
    expect(await ghostData(providers)).toEqual({ g1Surveys: 1, g2Projects: 1 });
  });

  it.each([["0"], ["x"], ["1.5"], ["-1"]])("exits 2 for --max %s", async (max) => {
    const r = await reconcile(["--max", max]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--max must be a positive integer");
    expect(r.err).toContain(USAGE);
    expect(r.made).toBe(0);
  });

  it("starts the usage with the command line", () => {
    expect(USAGE.split("\n")[0]).toBe(
      "Usage: pnpm account:reconcile [--apply] [--max <n>] [--env-file <path>]",
    );
  });

  it("exits 1 and erases nothing when the directory fails", async () => {
    const providers = seeded();
    const failing = {
      ...providers,
      users: { ...providers.users, missingUsers: () => Promise.reject(new Error("Token=abc")) },
    };
    const r = await reconcile(["--apply"], failing);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("Error: unexpected failure (Error)\n");
    expect(await ghostData(providers)).toEqual({ g1Surveys: 1, g2Projects: 1 });
  });

  it("reports how many were erased before a store failure", async () => {
    const providers = seeded();
    const failing = {
      ...providers,
      projects: {
        ...providers.projects,
        eraseMember: () =>
          Promise.reject(new LegacyStoreError("member erase", { code: "ETIMEOUT" })),
      },
    };
    const r = await reconcile(["--apply"], failing);
    expect(r.code).toBe(1);
    expect(r.out).toBe(`${LISTED}${ERASED_G1}`);
    expect(r.err).toBe(
      "Error: Legacy store member erase failed (ETIMEOUT) Erased 1 of 2 users before the failure.\n",
    );
  });

  it("refuses --apply with exit 2 when READ_ONLY=true, before opening the stores", async () => {
    const providers = seeded();
    const r = await reconcile(["--apply"], providers, { ...LEGACY_ENV, READ_ONLY: "true" });
    expect(r.code).toBe(2);
    expect(r.made).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toBe("Refused: READ_ONLY=true. Nothing was erased.\n");
    expect(await ghostData(providers)).toEqual({ g1Surveys: 1, g2Projects: 1 });
  });

  it("still lists the ids without --apply when READ_ONLY=true", async () => {
    const r = await reconcile([], seeded(), { ...LEGACY_ENV, READ_ONLY: "true" });
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    expect(r.out).toContain(LISTED);
    expect(r.out).toContain("Dry run: nothing was erased.");
  });

  it("has nothing to erase when the directory knows everyone", async () => {
    const r = await reconcile(["--apply"], seeded(false));
    expect(r.code).toBe(0);
    expect(r.out).toBe("Users the directory does not know: 0\nNothing to erase.\n");
  });

  it("refuses the memory store", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      [],
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      { env: {}, makeProviders: () => Promise.reject(new Error("not called")) },
    );
    expect(code).toBe(2);
    expect(err.join("")).toContain("STORAGE_PROVIDER must name a persistent store");
  });
});
