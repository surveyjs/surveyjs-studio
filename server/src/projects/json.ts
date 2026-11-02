import type { components } from "@surveyjs-studio/contract";
import type { ProjectMember, ProjectMembership } from "../domain/types.js";
import type { ProjectInvitation } from "../providers/types.js";

export type ProjectJson = components["schemas"]["Project"];
export type MemberJson = components["schemas"]["Member"];

/** The contract `Project` of a membership: the project and the user's role in it. */
export function projectJson({ project, role }: ProjectMembership): ProjectJson {
  return {
    id: project.id,
    name: project.name,
    ownerId: project.ownerId,
    role,
    memberCount: project.memberCount,
    createdAt: project.createdAt,
  };
}

/** The contract `Member` of a visible member of a project. */
export function memberJson({ user, role }: ProjectMember): MemberJson {
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    role,
    status: "active",
  };
}

/** The contract `Member` of an invitation: pending, named by its email, without a user yet. */
export function pendingMemberJson({ email, role }: ProjectInvitation): MemberJson {
  return { userId: null, displayName: email, email, role, status: "pending" };
}
