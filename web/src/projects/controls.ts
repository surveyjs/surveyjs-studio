import type { Member, Project } from "../api/projects";

export interface ProjectControls {
  /** Rename and Remove in the card's summary. */
  readonly manage: boolean;
  /** Add a New Member. */
  readonly addMember: boolean;
  /** Leave Project in the summary (plain members; an admin leaves through the "x" on their row). */
  readonly leave: boolean;
}

/** What the viewer may do with a project card, from their role in it (R22). */
export function projectControls(project: Pick<Project, "role">): ProjectControls {
  const admin = project.role === "admin";
  return { manage: admin, addMember: admin, leave: !admin };
}

export interface MemberControls {
  /** The remove "x" (admins, on every row; on their own row it means leaving). */
  readonly remove: boolean;
  /** "Make Admin" on a plain member's row (admins). */
  readonly makeAdmin: boolean;
  /** "Remove Admin Rights" on an admin's row (admins). */
  readonly removeAdminRights: boolean;
  /** The row is the viewer's own. */
  readonly self: boolean;
}

export function memberControls(
  project: Pick<Project, "role">,
  member: Pick<Member, "userId" | "role">,
  viewerId: string,
): MemberControls {
  const admin = project.role === "admin";
  // A pending member has no user yet: an admin can withdraw the invitation, nothing else.
  const joined = member.userId !== null;
  return {
    remove: admin,
    makeAdmin: admin && joined && member.role === "user",
    removeAdminRights: admin && joined && member.role === "admin",
    self: member.userId?.toLowerCase() === viewerId.toLowerCase(),
  };
}
