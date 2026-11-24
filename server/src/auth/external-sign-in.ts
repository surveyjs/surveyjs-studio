import { randomUUID } from "node:crypto";
import type { AppConfig, ExternalMethod } from "../config.js";
import { GUID } from "../domain/guid.js";
import type { InvitationStore, LocalAccount, LocalAccountStore } from "../providers/types.js";
import { readOnlyError } from "../read-only.js";
import type { IdentityClaims } from "./identity.js";
import { decideJoin, type JoinRefusal } from "./join-policy.js";

/**
 * Why an external sign-in gets no session (D8). Hosted sign-in adds `blocked` (the site's block),
 * `identity-conflict` (the email's account belongs to another surveyjs.io id) and `failed` (a sub
 * that is not a GUID).
 */
export type SignInRefusal = JoinRefusal | "disabled" | "blocked" | "identity-conflict" | "failed";

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
  /**
   * `READ_ONLY=true`: nothing is written. A linked identity of an active account still signs in;
   * linking, creating an account or activating an invited one throws `503 read-only`.
   */
  readonly readOnly?: boolean;
  /**
   * Hosted sign-in (ADR 0043): `APP_EDITION=hosted` and the method is `surveyjs`. The account id is
   * the surveyjs.io id, and every sign-in refreshes the account from the site's claims.
   */
  readonly hosted?: boolean;
  /** Hosted: ADMIN_EMAIL, made instance admin at its sign-in while there is no active admin. */
  readonly adminEmail?: string | null;
  /** Hosted: where the warnings and notes go. They name the user id, never an email address. */
  readonly log?: {
    warn(obj: object, msg: string): void;
    info(obj: object, msg: string): void;
  };
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
 * With `readOnly`, the steps that would write throw `503 read-only` before touching the stores.
 *
 * Two first sign-ins of the same identity at once: the store refuses the second link or the second
 * account with the email, and that sign-in starts over once, so it finds the other's account.
 */
export async function resolveExternalSignIn(
  provider: ExternalMethod,
  claims: IdentityClaims,
  deps: ExternalSignInDeps,
): Promise<ExternalSignIn> {
  if (deps.hosted === true) return resolveHostedSignIn(claims, deps);
  const { accounts, invitations, policy, now } = deps;
  const newId = deps.newId ?? randomUUID;
  const readOnly = deps.readOnly === true;

  /** Signs in to `account`, unless it is disabled; an invited one becomes active. */
  const signInTo = async (account: LocalAccount, created: boolean): Promise<ExternalSignIn> => {
    if (account.status === "disabled") return refused("disabled");
    if (account.status === "invited") {
      if (readOnly) throw readOnlyError();
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
      if (readOnly) throw readOnlyError();
      if ((await link(existing.user.id, email)) === "taken") return (await known()) ?? LOST_RACE;
      return signInTo(existing, false);
    }

    const decision = decideJoin(
      { email, emailVerified: true, invited: await invitations.hasInvitation(email) },
      policy,
    );
    if (!decision.join) return refused(decision.reason);
    if (readOnly) throw readOnlyError();
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

/**
 * Hosted sign-in through surveyjs.io (ADR 0043 point 1): the steps of `resolveExternalSignIn`, with
 * the surveyjs.io id as the account id and the site's claims stored at every sign-in.
 *
 * (0) A sub that is not a GUID is refused (`failed`). (1) The linked account is refreshed from the
 * claims (the email only when verified and free), then refused when the site blocks it or an admin
 * disabled it: neither clears the other. The account whose id is the sub but whose identity is
 * gone (an admin unlinked it) is linked again and treated the same; with another surveyjs.io id it
 * is `identity-conflict`. Without either, a blocked claim is refused before anything is written.
 * (2) The account of the verified email is linked only when it has no `surveyjs` identity yet (an
 * account an admin created); one with another surveyjs.io id is `identity-conflict`. (3) Else a
 * new account with the sub as its id, when the join policy lets the email join. After a sign-in,
 * ADMIN_EMAIL becomes instance admin while there is none (logged with the user id).
 *
 * With `readOnly` nothing is written: the claims decide the block, a linked active account signs
 * in unchanged, and the steps that would write throw `503 read-only`.
 *
 * The identity's subject is stored lower-case, like the account id, so the account-deleted
 * webhook's id finds it whatever the case.
 */
async function resolveHostedSignIn(
  claims: IdentityClaims,
  deps: ExternalSignInDeps,
): Promise<ExternalSignIn> {
  const { accounts, invitations, policy, now, log } = deps;
  const readOnly = deps.readOnly === true;
  const sub = claims.sub.toLowerCase();
  if (!GUID.test(sub)) return refused("failed");
  const siteBlocked = claims.blocked === true;
  const licenceExpiresAt = claims.licenseExpiresAt ?? null;
  const verifiedEmail =
    claims.emailVerified === true ? claims.email?.trim().toLowerCase() || undefined : undefined;
  const displayName = claims.name?.trim() || undefined;

  /** Stores the claims on `account`; the email only when verified and no other account holds it. */
  const refresh = async (account: LocalAccount): Promise<LocalAccount | null> => {
    const result = await accounts.refreshFromSignIn(account.user.id, {
      email: verifiedEmail ?? account.user.email,
      displayName: displayName ?? account.user.displayName,
      siteBlocked,
      licenceExpiresAt,
    });
    if (result.outcome === "not-found") return null;
    if (result.outcome === "email-taken") {
      log?.warn(
        { userId: account.user.id },
        "sign-in kept the old email: the new one belongs to another account",
      );
    }
    return result.account;
  };

  /** ADMIN_EMAIL becomes the instance admin at its sign-in while there is no active admin. */
  const promote = async (account: LocalAccount): Promise<LocalAccount> => {
    const adminEmail = deps.adminEmail?.trim().toLowerCase();
    if (!adminEmail || account.user.email.toLowerCase() !== adminEmail) return account;
    if (account.instanceRole === "admin" || (await accounts.countActiveAdmins()) !== 0) {
      return account;
    }
    const update = await accounts.updateAccount(account.user.id, { instanceRole: "admin" });
    if (update.outcome !== "updated") return account;
    log?.info(
      { userId: account.user.id },
      "made the ADMIN_EMAIL account an instance admin at sign-in",
    );
    return update.account;
  };

  /** Signs in to `account` unless the site blocks it or it is disabled; invited becomes active. */
  const signInTo = async (account: LocalAccount, created: boolean): Promise<ExternalSignIn> => {
    // The claims decide the block: under READ_ONLY the stored value is the last sign-in's.
    if (siteBlocked) return refused("blocked");
    if (account.status === "disabled") return refused("disabled");
    if (account.status === "invited") {
      if (readOnly) throw readOnlyError();
      const update = await accounts.updateAccount(account.user.id, { status: "active" });
      if (update.outcome === "updated") account = update.account;
    }
    if (!readOnly) account = await promote(account);
    return { ok: true, account, created };
  };

  /** The linked account, refreshed (unless read-only), signed in to. */
  const signInLinked = async (account: LocalAccount): Promise<ExternalSignIn> => {
    if (!readOnly) {
      const refreshed = await refresh(account);
      // Erased between the look-up and the refresh (the account-deleted webhook, say).
      if (refreshed === null) return refused("failed");
      account = refreshed;
    }
    return signInTo(account, false);
  };

  const link = (userId: string, email: string) =>
    accounts.linkIdentity({
      provider: "surveyjs",
      subject: sub,
      userId,
      email,
      emailVerified: true,
      createdAt: now(),
    });

  /** The account the identity is linked to, signed in to; null when none. */
  const known = async (): Promise<ExternalSignIn | null> => {
    const account = await accounts.accountByIdentity("surveyjs", sub);
    return account ? signInLinked(account) : null;
  };

  /**
   * The `surveyjs` identities of an account that is not linked to this sign-in's: `ours` when this
   * identity was linked to it by another sign-in of the same person since `known` looked, `other`
   * when another surveyjs.io id holds it (warned, by user id only), `none` when it has none.
   */
  const siteIdentity = async (account: LocalAccount): Promise<"ours" | "other" | "none"> => {
    const site = (await accounts.listIdentities(account.user.id)).filter(
      (identity) => identity.provider === "surveyjs",
    );
    if (site.some((identity) => identity.subject.toLowerCase() === sub)) return "ours";
    if (site.length === 0) return "none";
    log?.warn(
      { userId: account.user.id },
      "sign-in refused: the account belongs to another surveyjs.io id",
    );
    return "other";
  };

  const attempt = async (): Promise<ExternalSignIn | typeof LOST_RACE> => {
    const linked = await known();
    if (linked) return linked;

    // The account with this surveyjs.io id whose identity is gone (an admin unlinked it): the
    // same person, so it is linked again and treated as a linked account.
    const own = await accounts.account(sub);
    if (own) {
      const held = await siteIdentity(own);
      if (held === "ours") return (await known()) ?? LOST_RACE;
      if (held === "other") return refused("identity-conflict");
      if (readOnly) {
        if (siteBlocked) return refused("blocked");
        if (own.status === "disabled") return refused("disabled");
        throw readOnlyError();
      }
      const linkEmail = verifiedEmail ?? own.user.email;
      if ((await link(own.user.id, linkEmail)) === "taken") return (await known()) ?? LOST_RACE;
      return signInLinked(own);
    }

    // A blocked person signing in without an account of their own gets nothing written.
    if (siteBlocked) return refused("blocked");

    const email = verifiedEmail;
    if (!email) return refused("email-unverified");

    const existing = await accounts.accountByEmail(email);
    if (existing) {
      const held = await siteIdentity(existing);
      if (held === "ours") return (await known()) ?? LOST_RACE;
      if (held === "other") return refused("identity-conflict");
      if (existing.status === "disabled") return refused("disabled");
      if (readOnly) throw readOnlyError();
      if ((await link(existing.user.id, email)) === "taken") return (await known()) ?? LOST_RACE;
      return signInLinked(existing);
    }

    const decision = decideJoin(
      { email, emailVerified: true, invited: await invitations.hasInvitation(email) },
      policy,
    );
    if (!decision.join) return refused(decision.reason);
    if (readOnly) throw readOnlyError();
    let created: LocalAccount;
    try {
      created = await accounts.createAccount({
        id: sub,
        email,
        displayName: displayName ?? email,
        instanceRole: "user",
        status: "active",
        passwordHash: null,
        mustChangePassword: false,
        siteBlocked,
        licenceExpiresAt,
        createdAt: now(),
      });
    } catch (error) {
      // Created at the same time by another sign-in of the same person: the email is in use now.
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
  throw new Error("the hosted sign-in lost the same race twice");
}
