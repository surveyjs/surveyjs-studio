import type { AccountStatus, InstanceRole } from "../providers/types.js";

/** An account as the instance-admin rules see it. */
export interface AccountFacts {
  readonly instanceRole: InstanceRole;
  readonly status: AccountStatus;
}

/**
 * S16, as the last-project-admin rule (R8): the last active instance admin is never demoted,
 * disabled or deleted (`after` null). `activeAdmins` counts the active admins, the target included
 * when it is one. A change that keeps the target an active admin is always allowed.
 */
export function decideAccountChange(
  target: AccountFacts,
  after: AccountFacts | null,
  activeAdmins: number,
): "allowed" | "last-instance-admin" {
  const isActiveAdmin = (facts: AccountFacts | null) =>
    facts !== null && facts.instanceRole === "admin" && facts.status === "active";
  if (!isActiveAdmin(target) || isActiveAdmin(after)) return "allowed";
  return activeAdmins <= 1 ? "last-instance-admin" : "allowed";
}

/**
 * The status after setting `wanted` (an admin, or an identity linked at sign-in): `disabled`
 * disables any account; `active` keeps an active account active and makes a disabled or invited
 * one active when it can sign in (it has a password or a linked identity), else `invited`.
 */
export function nextStatus(
  current: AccountStatus,
  wanted: "active" | "disabled" | undefined,
  canSignIn: boolean,
): AccountStatus {
  if (wanted === undefined) return current;
  if (wanted === "disabled") return "disabled";
  if (current === "active") return "active";
  return canSignIn ? "active" : "invited";
}
