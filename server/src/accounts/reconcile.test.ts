import { describe, expect, it } from "vitest";
import type { SurveyRecord, User } from "../domain/types.js";
import { createMemoryProviders } from "../providers/memory.js";
import type { UserDirectory } from "../providers/types.js";
import { findErasureCandidates } from "./reconcile.js";

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
  return {
    id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: "Survey",
    owner: { kind: "personal", userId },
    creatorId: userId,
    postId: `eeeeeeee-0000-4000-8001-${String(n).padStart(12, "0")}`,
    resultId: `eeeeeeee-0000-4000-8002-${String(n).padStart(12, "0")}`,
    published: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

const seeded = () =>
  createMemoryProviders({
    users: [KNOWN],
    surveys: [personal(KNOWN.id), personal(G1)],
    projects: [
      { id: PROJECT, name: "Team", creatorId: KNOWN.id, createdAt: "2026-01-01T00:00:00.000Z" },
    ],
    memberships: [
      { userId: KNOWN.id, projectId: PROJECT, role: "admin" },
      { userId: G2, projectId: PROJECT, role: "user" },
    ],
  });

/** The memory directory with `missingUsers` replaced. */
function withMissingUsers(users: UserDirectory, missingUsers: UserDirectory["missingUsers"]) {
  return { ...users, missingUsers };
}

describe("findErasureCandidates", () => {
  it("finds the personal-survey owners and members the directory does not know", async () => {
    const providers = seeded();
    expect(await findErasureCandidates(providers)).toEqual([G1, G2]);
  });

  it("answers in ascending order whatever order the directory answers in", async () => {
    const providers = seeded();
    const users = withMissingUsers(providers.users, async (ids) =>
      [...(await providers.users.missingUsers(ids))].reverse(),
    );
    expect(await findErasureCandidates({ ...providers, users })).toEqual([G1, G2]);
  });

  it("rejects when the directory fails", async () => {
    const providers = seeded();
    const users = withMissingUsers(providers.users, () => Promise.reject(new Error("down")));
    await expect(findErasureCandidates({ ...providers, users })).rejects.toThrow("down");
  });
});
