import { randomUUID } from "node:crypto";
import type { AppConfig, ExternalMethod } from "../config.js";
import type { InvitationStore, LocalAccount, LocalAccountStore } from "../providers/types.js";
import type { IdentityClaims } from "./identity.js";
import { decideJoin, type JoinRefusal } from "./join-policy.js";

/** Why an external sign-in gets no session (D8). */
export type SignInRefusal = JoinRefusal | "disabled";

export type ExternalSignIn =
  | { readonly ok: true; readonly account: LocalAccount; readonly created: boolean }
  | { readonly ok: false; readonly reason: SignInRefusal };

export interface ExternalSignInDeps {
  readonly accounts: LocalAccountStore;
  readonly invitations: InvitationStore;
  readonly policy: AppConfig["joinPolicy"];
  /** ISO 8601 UTC. */
  readonly now: () => string;
  readonly newId?: () => string;
}

/** Another sign-in of the same identity or email won a write: look again from step (1). */
const LOST_RACE = Symbol("lost race");

const refused = (reason: SignInRefusal): ExternalSignIn => ({ ok: false, reason });

/**
 * The local account an external identity signs in to (D3, USER_DIRECTORY=local): (1) the account
 * the identity is linked to; (2) else the account its verified email names, which the identity is
 * linked to; (3) else a new account, when the join policy lets the email join; (4) else refused.
 * A disabled account is refused at (1) and (2); an invited one becomes active when linked. A
 * first sign-in, linking or creating, needs a verified email.
 *
 * Two first sign-ins of the same identity at once: the store refuses the second link or the second
 * account with the email, and that sign-in starts over once, so it finds the other's account.
 */
export async function resolveExternalSignIn(
  provider: ExternalMethod,
  claims: IdentityClaims,
  deps: ExternalSignInDeps,
): Promise<ExternalSignIn> {
  const { accounts, invitations, policy, now } = deps;
  const newId = deps.newId ?? randomUUID;

  /** Signs in to `account`, unless it is disabled; an invited one becomes active. */
  const signInTo = async (account: LocalAccount, created: boolean): Promise<ExternalSignIn> => {
    if (account.status === "disabled") return refused("disabled");
    if (account.status === "invited") {
      // Its identity can sign it in now, so enabling it makes it active (nextStatus).
      const update = await accounts.updateAccount(account.user.id, { status: "active" });
      if (update.outcome === "updated") account = update.account;
    }
    return { ok: true, account, created };
  };

  const link = (userId: string, email: string) =>
    accounts.linkIdentity({
      provider,
      subject: claims.sub,
      userId,
      email,
      emailVerified: true,
      createdAt: now(),
    });

  /** Step (1) alone: the account a linked identity names, or null. */
  const known = async (): Promise<ExternalSignIn | null> => {
    const account = await accounts.accountByIdentity(provider, claims.sub);
    return account ? signInTo(account, false) : null;
  };

  const attempt = async (): Promise<ExternalSignIn | typeof LOST_RACE> => {
    const linked = await known();
    if (linked) return linked;

    const email = claims.email?.trim().toLowerCase();
    if (!email || claims.emailVerified !== true) return refused("email-unverified");

    const existing = await accounts.accountByEmail(email);
    if (existing) {
      if (existing.status === "disabled") return refused("disabled");
      if ((await link(existing.user.id, email)) === "taken") return (await known()) ?? LOST_RACE;
      return signInTo(existing, false);
    }

    const decision = decideJoin(
      { email, emailVerified: true, invited: await invitations.hasInvitation(email) },
      policy,
    );
    if (!decision.join) return refused(decision.reason);
    let created: LocalAccount;
    try {
      created = await accounts.createAccount({
        id: newId(),
        email,
        displayName: claims.name?.trim() || email,
        instanceRole: "user",
        status: "active",
        passwordHash: null,
        mustChangePassword: false,
        createdAt: now(),
      });
    } catch (error) {
      // Created at the same time by another sign-in: the email is in use now.
      if (await accounts.accountByEmail(email)) return LOST_RACE;
      throw error;
    }
    if ((await link(created.user.id, email)) === "taken") return (await known()) ?? LOST_RACE;
    return signInTo(created, true);
  };

  const first = await attempt();
  if (first !== LOST_RACE) return first;
  const second = await attempt();
  if (second !== LOST_RACE) return second;
  throw new Error("the external sign-in lost the same race twice");
}
