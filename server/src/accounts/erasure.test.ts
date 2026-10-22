import { describe, expect, it } from "vitest";
import type { SurveyRecord } from "../domain/types.js";
import { createMemoryProviders } from "../providers/memory.js";
import { createEraseAccount, type ErasureLogger } from "./erasure.js";
import { findErasureCandidates } from "./reconcile.js";

const USER = {
  id: "eeeeeeee-0000-4000-8000-0000000000d1",
  email: "erased@example.com",
  displayName: "Erased Person",
  blocked: false,
};
const PROJECT = "eeeeeeee-0000-4000-8000-0000000000d2";
const NOW = "2026-08-02T10:00:00.000Z";

const seeded = () =>
  createMemoryProviders({
    users: [USER],
    surveys: [
      {
        id: "eeeeeeee-0000-4000-8000-0000000000d3",
        name: "Personal survey",
        owner: { kind: "personal", userId: USER.id },
        creatorId: USER.id,
        postId: "eeeeeeee-0000-4000-8000-0000000000d4",
        resultId: "eeeeeeee-0000-4000-8000-0000000000d5",
        published: false,
        archived: false,
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-01T10:00:00.000Z",
        settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
      },
    ],
    projects: [{ id: PROJECT, name: "Team project", creatorId: USER.id, createdAt: NOW }],
    memberships: [{ userId: USER.id, projectId: PROJECT, role: "admin" }],
  });

describe("eraseAccount", () => {
  it("rejects an id that is not a GUID, writing nothing", async () => {
    const providers = seeded();
    await expect(createEraseAccount(providers)("not-a-guid", { now: NOW })).rejects.toThrow(
      "Erasure needs a user GUID",
    );
    expect(await providers.projects.listUserProjects(USER.id)).toHaveLength(1);
  });

  it("logs one line with the summary's ids and counts only", async () => {
    const lines: { details: Readonly<Record<string, string | number>>; message: string }[] = [];
    const logger: ErasureLogger = { info: (details, message) => lines.push({ details, message }) };

    const summary = await createEraseAccount(seeded(), logger)(USER.id.toUpperCase(), {
      now: NOW,
    });

    expect(summary).toEqual({
      userId: USER.id,
      surveysDeleted: 1,
      projectsLeft: 0,
      projectsDeleted: 1,
      adminsPromoted: 0,
    });
    expect(lines).toEqual([{ details: summary, message: "Erased the data of an account." }]);
    expect(Object.keys(lines[0]!.details).sort()).toEqual([
      "adminsPromoted",
      "projectsDeleted",
      "projectsLeft",
      "surveysDeleted",
      "userId",
    ]);
    expect(JSON.stringify(lines)).not.toMatch(
      /Erased Person|erased@example\.com|Team project|Personal survey/,
    );
  });
});

describe("eraseAccount and reconciliation", () => {
  // Memory maps every row, so the unmappable legacy shapes are covered on the replica
  // (azure-legacy.null-rows.azurite.test.ts). Orphan memberships are what memory can hold.
  const GONE = "eeeeeeee-0000-4000-8000-0000000000e1";
  const OTHER_GONE = "eeeeeeee-0000-4000-8000-0000000000e2";
  const SHARED = "eeeeeeee-0000-4000-8000-0000000000e3";
  const ORPHANS_ONLY = "eeeeeeee-0000-4000-8000-0000000000e4";
  const survey = (n: number, owner: SurveyRecord["owner"], archived = false): SurveyRecord => ({
    id: `eeeeeeee-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`,
    name: `Survey ${String(n)}`,
    owner,
    creatorId: GONE,
    postId: `eeeeeeee-0000-4000-8001-00000000f${String(n).padStart(3, "0")}`,
    resultId: `eeeeeeee-0000-4000-8002-00000000f${String(n).padStart(3, "0")}`,
    published: false,
    archived,
    createdAt: NOW,
    updatedAt: NOW,
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  });

  it("leaves no row of an id the directory does not know, so it is not a candidate again", async () => {
    const providers = createMemoryProviders({
      users: [USER],
      surveys: [
        survey(1, { kind: "personal", userId: GONE }),
        survey(2, { kind: "personal", userId: GONE }, true),
        survey(3, { kind: "project", projectId: ORPHANS_ONLY }),
      ],
      projects: [
        { id: SHARED, name: "Shared", creatorId: USER.id, createdAt: NOW },
        { id: ORPHANS_ONLY, name: "Orphans only", creatorId: GONE, createdAt: NOW },
      ],
      memberships: [
        { userId: USER.id, projectId: SHARED, role: "admin" },
        { userId: GONE, projectId: SHARED, role: "user" },
        { userId: GONE, projectId: ORPHANS_ONLY, role: "admin" },
        { userId: OTHER_GONE, projectId: ORPHANS_ONLY, role: "user" },
      ],
    });
    expect(await findErasureCandidates(providers)).toEqual([GONE, OTHER_GONE]);

    expect(await createEraseAccount(providers)(GONE, { now: NOW })).toEqual({
      userId: GONE,
      surveysDeleted: 3,
      projectsLeft: 1,
      projectsDeleted: 1,
      adminsPromoted: 0,
    });

    // OTHER_GONE's only row went with the project nobody visible was left in.
    expect(await findErasureCandidates(providers)).toEqual([]);
    expect(await providers.projects.listUserProjectIds(GONE)).toEqual([]);
    expect(await providers.surveys.listSurveyIds({ kind: "personal", userId: GONE })).toEqual([]);
    expect(await providers.projects.listUserProjectIds(USER.id)).toEqual([SHARED]);
  });
});
