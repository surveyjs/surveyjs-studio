/**
 * What an API token reaches (ADR 0037): a Personal token the owner's personal surveys, a project
 * token one project with a project admin's rights. A session or legacy key (`all`) reaches what the
 * user can. Outside the scope a survey or project answers like an unknown one (404), so a token
 * cannot probe what exists.
 */
import { type CredentialScope, type RequestUser } from "../auth/authenticate.js";
import type { ProjectMembership, ProjectRecord, SurveyOwner } from "../domain/types.js";
import type { ProjectStore } from "../providers/types.js";

/** Ids are GUIDs, matched case-insensitively. */
const sameId = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Whether surveys of `owner` are within `scope`; who may see them is still the survey rules' call. */
export function inScope(scope: CredentialScope, owner: SurveyOwner): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "personal":
      return owner.kind === "personal";
    case "project":
      return owner.kind === "project" && sameId(owner.projectId, scope.projectId);
  }
}

/**
 * The membership the request acts with in a project, or null. `all`: the user's own (`lookup`). A
 * project token in its own project: admin, whether or not its creator is still a member or an
 * admin (ADR 0037, point 3), with the record from `project` (null once the project is gone). Any
 * other project under a token: null.
 */
export async function scopedMembership(
  user: RequestUser,
  projectId: string,
  lookup: (userId: string, projectId: string) => Promise<ProjectMembership | null>,
  project: (id: string) => Promise<ProjectRecord | null>,
): Promise<ProjectMembership | null> {
  const scope = user.scope;
  if (scope.kind === "all") return lookup(user.id, projectId);
  if (scope.kind === "personal" || !sameId(projectId, scope.projectId)) return null;
  const record = await project(projectId);
  return record ? { project: record, role: "admin" } : null;
}

/** `scopedMembership` over a project store. */
export function membershipIn(
  projects: ProjectStore,
): (user: RequestUser, projectId: string) => Promise<ProjectMembership | null> {
  return (user, projectId) =>
    scopedMembership(
      user,
      projectId,
      (userId, id) => projects.getUserProject(userId, id),
      (id) => projects.getProject(id),
    );
}
