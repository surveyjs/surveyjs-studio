import { describe, expect, it } from "vitest";
import { LICENCE_EXPIRED } from "../notices/account-notices.js";
import { legacyFixtureSeed } from "./azure-legacy/fixtures.js";
import { createMemoryProviders } from "./memory.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("memory (legacy fixture seed)", async () =>
  createMemoryProviders(await legacyFixtureSeed()),
);

describe("memory provider with a user whose legacy email is NULL", () => {
  // A NULL legacy email maps to "". Like azure-legacy, a blank lookup must not find that user.
  const user = {
    id: "eeeeeeee-0000-4000-8000-0000000000e1",
    email: "",
    displayName: "",
    blocked: false,
  };
  const providers = createMemoryProviders({
    users: [user],
    surveys: [],
    projects: [],
    memberships: [],
  });

  it("finds the user by id but not by a blank email", async () => {
    expect(await providers.users.getUser(user.id)).toEqual(user);
    expect(await providers.users.findUserByEmail("")).toBeNull();
    expect(await providers.users.findUserByEmail(" ")).toBeNull();
  });
});

describe("memory provider with orphan memberships", () => {
  // Only memory can hold a membership whose user does not exist (the replica has an FK).
  const user = {
    id: "eeeeeeee-0000-4000-8000-0000000000e3",
    email: "a@example.com",
    displayName: "Admin",
    blocked: false,
  };
  const ORPHAN = "eeeeeeee-0000-4000-8000-0000000000e4";
  const LEFT = "eeeeeeee-0000-4000-8000-0000000000e5";
  const PROJECT = "eeeeeeee-0000-4000-8000-0000000000f1";
  const providers = () =>
    createMemoryProviders({
      users: [user],
      surveys: [],
      // The seeded creator has no membership any more: the project has no owner (R2).
      projects: [{ id: PROJECT, name: "P", creatorId: LEFT, createdAt: "2025-01-01T00:00:00Z" }],
      memberships: [
        { userId: user.id, projectId: PROJECT, role: "admin" },
        { userId: ORPHAN, projectId: PROJECT, role: "admin" },
      ],
    });

  it("counts an orphan row but neither shows it nor counts it as an admin (R11)", async () => {
    const { projects } = providers();
    expect(await projects.getUserProject(user.id, PROJECT)).toMatchObject({
      project: { ownerId: null, memberCount: 2 },
    });
    expect(await projects.listMembers(PROJECT)).toEqual([{ user, role: "admin" }]);
    expect(await projects.setMemberRole(PROJECT, user.id, "user", { now: "" })).toBe("last-admin");
    expect(await projects.removeMember(PROJECT, user.id)).toBe("last-admin");
    expect(await projects.removeMember(PROJECT, ORPHAN)).toBe("not-found");
    expect(await projects.setMemberRole(PROJECT, ORPHAN, "user", { now: "" })).toBe("not-found");
  });
});

describe("memory provider isolation", () => {
  const owner = { kind: "personal", userId: "eeeeeeee-0000-4000-8000-0000000000e2" } as const;
  const newSurvey = {
    id: "eeeeeeee-0000-4000-8000-0000000000a1",
    name: "Copy check",
    owner,
    creatorId: owner.userId,
    postId: "eeeeeeee-0000-4000-8000-0000000000b1",
    resultId: "eeeeeeee-0000-4000-8000-0000000000c1",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };

  it("keeps its own copy of a definition, before and after it is read", async () => {
    const providers = createMemoryProviders();
    const definition: Record<string, unknown> = { title: "Original" };
    await providers.surveys.createSurvey(newSurvey, definition);
    definition.title = "Changed by the caller";
    const read = (await providers.surveys.getDefinition(newSurvey.id))!.content;
    expect(read).toEqual({ title: "Original" });
    read.title = "Changed again";
    expect((await providers.surveys.getDefinition(newSurvey.id))?.content).toEqual({
      title: "Original",
    });
  });

  it("names the id when it refuses a duplicate", async () => {
    const providers = createMemoryProviders();
    await providers.surveys.createSurvey(newSurvey);
    await expect(
      providers.surveys.createSurvey({ ...newSurvey, id: newSurvey.id.toUpperCase() }),
    ).rejects.toThrow(`survey ${newSurvey.id} already exists`);
  });

  it("refuses a seed whose membership names an unknown project", () => {
    expect(() =>
      createMemoryProviders({
        users: [],
        surveys: [],
        projects: [],
        memberships: [{ userId: owner.userId, projectId: newSurvey.id, role: "user" }],
      }),
    ).toThrow(/unknown project/);
  });
});

describe("memory provider account notices", () => {
  const userId = "11111111-0000-4000-8000-a00000000001";

  it("has none by default", async () => {
    expect(await createMemoryProviders().notices.noticesFor(userId)).toEqual([]);
  });

  it("serves the demo notice that ACCOUNT_NOTICES selects", async () => {
    const providers = createMemoryProviders(undefined, { accountNotices: "license-expired" });
    expect(await providers.notices.noticesFor(userId)).toEqual([LICENCE_EXPIRED]);
  });

  it("refuses surveyjs-licenses, which needs the legacy site data", () => {
    expect(() => createMemoryProviders(undefined, { accountNotices: "surveyjs-licenses" })).toThrow(
      /surveyjs-licenses needs STORAGE_PROVIDER=azure-legacy/,
    );
  });
});
