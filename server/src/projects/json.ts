import type { components } from "@my-surveys/contract";
import type { ProjectMember, ProjectMembership } from "../domain/types.js";

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
  return { userId: user.id, displayName: user.displayName, email: user.email, role };
}
