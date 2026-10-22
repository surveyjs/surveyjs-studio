import { describe, expect, it } from "vitest";
import { createEraseAccount } from "../accounts/erasure.js";
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

describe("erasure with orphan memberships", () => {
  // The erased account is already gone from the user directory: its rows are orphans (R11).
  const user = {
    id: "eeeeeeee-0000-4000-8000-0000000000e6",
    email: "u@example.com",
    displayName: "User",
    blocked: false,
  };
  const ERASED = "eeeeeeee-0000-4000-8000-0000000000e7";
  const OTHER_ORPHAN = "eeeeeeee-0000-4000-8000-0000000000e8";
  const SHARED = "eeeeeeee-0000-4000-8000-0000000000f2";
  const ALONE = "eeeeeeee-0000-4000-8000-0000000000f3";
  const NOW = "2026-08-02T10:00:00.000Z";
  const survey = {
    id: "eeeeeeee-0000-4000-8000-0000000000a2",
    name: "Orphan's survey",
    owner: { kind: "personal", userId: ERASED },
    creatorId: ERASED,
    postId: "eeeeeeee-0000-4000-8000-0000000000b2",
    resultId: "eeeeeeee-0000-4000-8000-0000000000c2",
    published: false,
    archived: false,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  } as const;
  const providers = () =>
    createMemoryProviders({
      users: [user],
      surveys: [survey],
      projects: [
        { id: SHARED, name: "Shared", creatorId: ERASED, createdAt: "2025-01-01T00:00:00Z" },
        { id: ALONE, name: "Alone", creatorId: ERASED, createdAt: "2025-01-01T00:00:00Z" },
      ],
      memberships: [
        { userId: ERASED, projectId: SHARED, role: "admin" },
        { userId: ERASED, projectId: SHARED, role: "user" },
        { userId: user.id, projectId: SHARED, role: "user" },
        { userId: ERASED, projectId: ALONE, role: "admin" },
        { userId: OTHER_ORPHAN, projectId: ALONE, role: "admin" },
      ],
    });

  it("promotes the visible member and drops every orphan row of the erased id", async () => {
    const { projects } = providers();
    expect(await projects.eraseMember(SHARED, ERASED, { now: NOW })).toEqual({
      kind: "promote",
      successorId: user.id,
    });
    expect(await projects.getUserProject(user.id, SHARED)).toEqual({
      project: {
        id: SHARED,
        name: "Shared",
        ownerId: null,
        createdAt: "2025-01-01T00:00:00Z",
        memberCount: 1,
      },
      role: "admin",
    });
    expect(await projects.listMembers(SHARED)).toEqual([{ user, role: "admin" }]);
  });

  it("answers last-member when only other orphans remain, and writes nothing", async () => {
    const { projects } = providers();
    expect(await projects.eraseMember(ALONE, ERASED, { now: NOW })).toEqual({
      kind: "last-member",
    });
    expect(await projects.getUserProject(ERASED, ALONE)).toMatchObject({
      project: { memberCount: 2 },
    });
  });

  it("erases an orphan member: its rows, its lone project and its personal surveys", async () => {
    const set = providers();
    expect(await createEraseAccount(set)(ERASED, { now: NOW })).toEqual({
      userId: ERASED,
      surveysDeleted: 1,
      projectsLeft: 1,
      projectsDeleted: 1,
      adminsPromoted: 1,
    });
    expect(await set.projects.listUserProjects(ERASED)).toEqual([]);
    expect(await set.projects.listMemberUserIds()).toEqual([user.id]);
    expect(await set.surveys.getSurvey(survey.id)).toBeNull();
    expect(await set.surveys.listPersonalOwnerIds()).toEqual([]);
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
