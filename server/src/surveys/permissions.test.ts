import { describe, expect, it } from "vitest";
import type { ProjectMembership, ProjectRole, SurveyRecord } from "../domain/types.js";
import { canModify, canSee } from "./permissions.js";

const USER = { id: "11111111-0000-4000-8000-a00000000003" };
const OTHER = "11111111-0000-4000-8000-a00000000001";
const PROJECT = "55555555-0000-4000-8000-a00000000001";
const OTHER_PROJECT = "55555555-0000-4000-8000-a00000000002";

function survey(owner: SurveyRecord["owner"], creatorId: string | null): SurveyRecord {
  return {
    id: "22222222-0000-4000-8000-a00000000001",
    name: "Survey",
    owner,
    creatorId,
    postId: "33333333-0000-4000-8000-a00000000001",
    resultId: "44444444-0000-4000-8000-a00000000001",
    published: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    settings: { publicResults: false, storeRespondentIp: false, useCookies: false },
  };
}

function membership(role: ProjectRole, projectId = PROJECT): ProjectMembership {
  return {
    project: {
      id: projectId,
      name: "Project",
      ownerId: OTHER,
      createdAt: "2025-01-01T00:00:00.000Z",
      memberCount: 2,
    },
    role,
  };
}

const project = { kind: "project", projectId: PROJECT } as const;

describe("personal surveys", () => {
  it("only the owner sees and modifies them", () => {
    const own = survey({ kind: "personal", userId: USER.id }, USER.id);
    expect(canSee(own, USER, null)).toBe(true);
    expect(canModify(own, USER, null)).toBe(true);
  });

  it("the owner is matched whatever the id case", () => {
    const own = survey({ kind: "personal", userId: USER.id.toUpperCase() }, null);
    expect(canSee(own, USER, null)).toBe(true);
    expect(canModify(own, USER, null)).toBe(true);
  });

  it("another user neither sees nor modifies them, even as their creator", () => {
    const foreign = survey({ kind: "personal", userId: OTHER }, USER.id);
    expect(canSee(foreign, USER, null)).toBe(false);
    expect(canModify(foreign, USER, null)).toBe(false);
  });
});

describe("project surveys", () => {
  it.each<[string, ProjectRole, string | null, boolean]>([
    ["an admin modifies a survey someone else created", "admin", OTHER, true],
    ["an admin modifies a survey without a creator", "admin", null, true],
    ["a member modifies a survey they created", "user", USER.id, true],
    ["a member matches their creator id whatever its case", "user", USER.id.toUpperCase(), true],
    ["a member does not modify a survey someone else created", "user", OTHER, false],
    ["a member does not modify a survey without a creator", "user", null, false],
  ])("%s", (_name, role, creatorId, expected) => {
    const record = survey(project, creatorId);
    expect(canSee(record, USER, membership(role))).toBe(true);
    expect(canModify(record, USER, membership(role))).toBe(expected);
  });

  it("a non-member neither sees nor modifies them, even as their creator", () => {
    const record = survey(project, USER.id);
    expect(canSee(record, USER, null)).toBe(false);
    expect(canModify(record, USER, null)).toBe(false);
  });

  it("a membership of another project does not count", () => {
    const record = survey(project, USER.id);
    expect(canSee(record, USER, membership("admin", OTHER_PROJECT))).toBe(false);
    expect(canModify(record, USER, membership("admin", OTHER_PROJECT))).toBe(false);
  });
});
