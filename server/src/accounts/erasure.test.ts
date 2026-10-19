import { describe, expect, it } from "vitest";
import { createMemoryProviders } from "../providers/memory.js";
import { createEraseAccount, type ErasureLogger } from "./erasure.js";

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
