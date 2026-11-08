// Mirrors server/src/projects/rules.ts (the last-admin, role-change and survey-receiver rules),
// json.ts (the Project and Member JSON) and server/src/providers/ordering.ts (member order), over
// the sandbox document. The sandbox code does not import server/src.
import type { SandboxInvitation, SandboxMembership, SandboxProject } from "../seed-types";
import type { SandboxData } from "../store";
import { compare, lower, sameId } from "./common";

type Role = "admin" | "user";

/** One membership row with the user's existence, as the last-admin rule sees it (rules.ts). */
interface Row {
  userId: string;
  role: string;
  userExists: boolean;
}

export type RoleChange = "not-found" | "unchanged" | "changed" | "last-admin";
export type Removal = "not-found" | "last-admin" | "removed";

/** The membership rows of a project, with whether each user exists. */
export function rowsOf(data: SandboxData, projectId: string): Row[] {
  return data.memberships
    .filter((m) => sameId(m.projectId, projectId))
    .map((m) => ({
      userId: m.userId,
      role: m.role,
      userExists: data.users.some((u) => sameId(u.id, m.userId)),
    }));
}

const isAdminRole = (role: string): boolean => role.toLowerCase() === "admin";

const adminsOf = (rows: readonly Row[]): Set<string> =>
  new Set(rows.filter((r) => r.userExists && isAdminRole(r.role)).map((r) => lower(r.userId)));

const visibleMembersOf = (rows: readonly Row[]): Set<string> =>
  new Set(rows.filter((r) => r.userExists).map((r) => lower(r.userId)));

/** R8: a role change of `userId` to `role` (rules.ts `decideRoleChange`). */
export function decideRoleChange(rows: readonly Row[], userId: string, role: Role): RoleChange {
  const own = rows.filter((r) => r.userExists && sameId(r.userId, userId));
  if (own.length === 0) return "not-found";
  if (own.every((r) => r.role.toLowerCase() === role)) return "unchanged";
  const admins = adminsOf(rows);
  if (role === "user" && admins.has(lower(userId)) && admins.size === 1) return "last-admin";
  return "changed";
}

/** R7, R8: removing (or the leaving of) `userId` (rules.ts `decideRemoval`). */
export function decideRemoval(rows: readonly Row[], userId: string): Removal {
  const target = lower(userId);
  const members = visibleMembersOf(rows);
  if (!members.has(target)) return "not-found";
  const admins = adminsOf(rows);
  if (members.size === 1 || (admins.has(target) && admins.size === 1)) return "last-admin";
  return "removed";
}

/** R2: the owner receives a deleted project's surveys while a visible member, else the deleting admin. */
export function surveyReceiver(
  ownerId: string | null,
  visibleMemberIds: readonly string[],
  deletingUserId: string,
): string {
  if (ownerId !== null && visibleMemberIds.some((id) => sameId(id, ownerId))) return lower(ownerId);
  return lower(deletingUserId);
}

/** The project's owner: its creator while the creator has a membership (memory.ts `projectRecord`). */
export function ownerOf(data: SandboxData, project: SandboxProject): string | null {
  const creator = project.creatorId;
  if (creator === null) return null;
  return data.memberships.some((m) => sameId(m.projectId, project.id) && sameId(m.userId, creator))
    ? lower(creator)
    : null;
}

/** The contract `Project` of a project and the caller's membership (json.ts `projectJson`). */
export function projectJson(data: SandboxData, project: SandboxProject, role: string) {
  return {
    id: project.id,
    name: project.name,
    ownerId: ownerOf(data, project),
    role,
    memberCount: data.memberships.filter((m) => sameId(m.projectId, project.id)).length,
    createdAt: project.createdAt,
  };
}

/** The contract `Member` of an active member (json.ts `memberJson`). */
export function memberJson(
  data: SandboxData,
  membership: Pick<SandboxMembership, "userId" | "role">,
) {
  const user = data.users.find((u) => sameId(u.id, membership.userId))!;
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    role: membership.role,
    status: "active" as const,
  };
}

/** The contract `Member` of an invitation (json.ts `pendingMemberJson`). */
export function pendingMemberJson({ email, role }: Pick<SandboxInvitation, "email" | "role">) {
  return { userId: null, displayName: email, email, role, status: "pending" as const };
}

/** Project list order: name ignoring case, then id (ordering.ts `projectRecordOrder`). */
export const projectOrder = (a: SandboxProject, b: SandboxProject): number =>
  compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.id, b.id);
