import type { components } from "@my-surveys/contract";
import type { ProjectMembership } from "../domain/types.js";

export type ProjectJson = components["schemas"]["Project"];

/** The contract `Project` of a membership: the project and the user's role in it. */
export function projectJson({ project, role }: ProjectMembership): ProjectJson {
  return {
    id: project.id,
    name: project.name,
    // Until C2 (Task 3) the contract's ownerId cannot be null.
    ownerId: project.ownerId as string,
    role,
    memberCount: project.memberCount,
    createdAt: project.createdAt,
  };
}
