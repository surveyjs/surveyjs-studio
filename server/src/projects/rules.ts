import type { RemovalOutcome, RoleChangeOutcome } from "../providers/types.js";

/** One membership row as the last-admin rule sees it. */
export interface MembershipFacts {
  readonly userId: string;
  /** As stored; only `admin` (any case) counts as admin. */
  readonly role: string | null;
  /** Whether the user's account exists: an orphan row is neither visible nor an admin (R11). */
  readonly userExists: boolean;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const isAdminRole = (role: string | null): boolean => role?.toLowerCase() === "admin";

/** The visible users of the project that hold an admin row (R8), lower-case, each once. */
export function adminsOf(rows: readonly MembershipFacts[]): Set<string> {
  return new Set(
    rows
      .filter((row) => row.userExists && isAdminRole(row.role))
      .map((row) => row.userId.toLowerCase()),
  );
}

/** The visible users of the project, lower-case, each once. */
export function visibleMembersOf(rows: readonly MembershipFacts[]): Set<string> {
  return new Set(rows.filter((row) => row.userExists).map((row) => row.userId.toLowerCase()));
}

/**
 * R8: a role change of `userId` to `role`. not-found: no visible row of the user. unchanged: every row
 * of the user already has `role` (case-insensitive; no write). last-admin: the user is an admin, the
 * new role is `user`, and no other visible admin remains. Otherwise change.
 */
export function decideRoleChange(
  rows: readonly MembershipFacts[],
  userId: string,
  role: "admin" | "user",
): RoleChangeOutcome {
  const own = rows.filter((row) => row.userExists && same(row.userId, userId));
  if (own.length === 0) return "not-found";
  if (own.every((row) => row.role !== null && same(row.role, role))) return "unchanged";
  const admins = adminsOf(rows);
  const target = userId.toLowerCase();
  if (role === "user" && admins.has(target) && admins.size === 1) return "last-admin";
  return "changed";
}

/**
 * R7, R8: removing (or the leaving of) `userId`. not-found: no visible row of the user. last-admin:
 * the user is the only visible admin, or the only visible member (the sole member deletes the
 * project instead). Otherwise removed.
 */
export function decideRemoval(rows: readonly MembershipFacts[], userId: string): RemovalOutcome {
  const target = userId.toLowerCase();
  const members = visibleMembersOf(rows);
  if (!members.has(target)) return "not-found";
  const admins = adminsOf(rows);
  if (members.size === 1 || (admins.has(target) && admins.size === 1)) return "last-admin";
  return "removed";
}

/**
 * R2: who receives the surveys of a deleted project: the owner when they are a visible member,
 * else the admin who deletes it.
 */
export function surveyReceiver(
  ownerId: string | null,
  visibleMemberIds: readonly string[],
  deletingUserId: string,
): string {
  if (ownerId !== null && visibleMemberIds.some((id) => same(id, ownerId))) {
    return ownerId.toLowerCase();
  }
  return deletingUserId.toLowerCase();
}
