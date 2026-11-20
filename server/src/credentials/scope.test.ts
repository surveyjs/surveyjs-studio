import { describe, expect, it, vi } from "vitest";
import type { CredentialScope, RequestUser } from "../auth/authenticate.js";
import type { ProjectMembership, ProjectRecord } from "../domain/types.js";
import { inScope, scopedMembership } from "./scope.js";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PROJECT_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const OTHER_ID = "bbbbbbbb-0000-4000-8000-000000000002";

const record = (id: string): ProjectRecord => ({
  id,
  name: "Team",
  ownerId: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  memberCount: 1,
});

const userWith = (scope: CredentialScope = { kind: "all" }): RequestUser => ({
  id: USER_ID,
  displayName: "User",
  email: "user@example.com",
  avatarUrl: null,
  scope,
});

const personalOwner = { kind: "personal", userId: USER_ID } as const;
const projectOwner = { kind: "project", projectId: PROJECT_ID } as const;
const otherOwner = { kind: "project", projectId: OTHER_ID } as const;

describe("inScope", () => {
  it("lets a session or legacy key reach every owner", () => {
    const all = { kind: "all" } as const;
    expect([personalOwner, projectOwner, otherOwner].map((o) => inScope(all, o))).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("keeps a Personal token to personal owners", () => {
    const personal = { kind: "personal" } as const;
    expect(inScope(personal, personalOwner)).toBe(true);
    expect(inScope(personal, projectOwner)).toBe(false);
  });

  it("keeps a project token to its project, matching the id in any letter case", () => {
    const scope = { kind: "project", projectId: PROJECT_ID.toUpperCase() } as const;
    expect(inScope(scope, projectOwner)).toBe(true);
    expect(inScope(scope, otherOwner)).toBe(false);
    expect(inScope(scope, personalOwner)).toBe(false);
  });
});

describe("scopedMembership", () => {
  const member: ProjectMembership = { project: record(PROJECT_ID), role: "user" };

  it("answers the user's own membership for a session or legacy key", async () => {
    const lookup = vi.fn(async () => member);
    const project = vi.fn(async () => record(PROJECT_ID));
    expect(await scopedMembership(userWith(), PROJECT_ID, lookup, project)).toBe(member);
    expect(await scopedMembership(userWith({ kind: "all" }), PROJECT_ID, lookup, project)).toBe(
      member,
    );
    expect(lookup).toHaveBeenCalledWith(USER_ID, PROJECT_ID);
    expect(project).not.toHaveBeenCalled();
  });

  it("answers null for every project under a Personal token, without a lookup", async () => {
    const lookup = vi.fn(async () => member);
    const project = vi.fn(async () => record(PROJECT_ID));
    expect(
      await scopedMembership(userWith({ kind: "personal" }), PROJECT_ID, lookup, project),
    ).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
  });

  it("makes a project token an admin of its project whatever its creator's membership", async () => {
    const user = userWith({ kind: "project", projectId: PROJECT_ID });
    const lookup = vi.fn(async () => null);
    const project = vi.fn(async (id: string) => record(id));
    expect(await scopedMembership(user, PROJECT_ID.toUpperCase(), lookup, project)).toEqual({
      project: record(PROJECT_ID.toUpperCase()),
      role: "admin",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("answers null for a project token's deleted project and for any other project", async () => {
    const user = userWith({ kind: "project", projectId: PROJECT_ID });
    const lookup = vi.fn(async () => member);
    expect(await scopedMembership(user, PROJECT_ID, lookup, async () => null)).toBeNull();
    const project = vi.fn(async (id: string) => record(id));
    expect(await scopedMembership(user, OTHER_ID, lookup, project)).toBeNull();
    expect(project).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
});
