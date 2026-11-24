import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { createMemoryLocalAccounts } from "../providers/memory-accounts.js";
import { createMemoryInvitations } from "../providers/memory-invitations.js";
import type { LocalAccountStore, NewLocalAccount } from "../providers/types.js";
import { resolveExternalSignIn } from "./external-sign-in.js";
import type { IdentityClaims } from "./identity.js";

const NOW = "2026-11-02T10:00:00.000Z";
const PROJECT = "22222222-0000-4000-8000-000000000001";
const INVITER = "11111111-0000-4000-8000-000000000001";
const closed: AppConfig["joinPolicy"] = { signUpDomains: [], openSignUp: false };

const newAccount = (over: Partial<NewLocalAccount> = {}): NewLocalAccount => ({
  id: randomUUID(),
  email: `${randomUUID()}@example.com`,
  displayName: "Local",
  instanceRole: "user",
  status: "active",
  passwordHash: "$argon2id$x",
  mustChangePassword: false,
  createdAt: "2026-10-29T10:00:00.000Z",
  ...over,
});

const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
  sub: `sub-${randomUUID()}`,
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada Lovelace",
  ...over,
});

function setup(policy: AppConfig["joinPolicy"] = closed, accountsOverride?: LocalAccountStore) {
  const local = createMemoryLocalAccounts();
  const invitations = createMemoryInvitations({
    exists: () => true,
    isMember: () => false,
    addMember: () => undefined,
  }).store;
  const accounts = accountsOverride ?? local.accounts;
  const resolve = (
    provider: "google" | "github" | "facebook" | "surveyjs",
    who: IdentityClaims,
    readOnly = false,
  ) =>
    resolveExternalSignIn(provider, who, {
      accounts,
      invitations,
      policy,
      now: () => NOW,
      readOnly,
    });
  return { accounts: local.accounts, invitations, resolve };
}

/** The code of the AppError `run` rejects with. */
async function rejectionCode(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return { code: (error as AppError).code, status: (error as AppError).status };
  }
  throw new Error("resolved");
}

const READ_ONLY = { code: "read-only", status: 503 };

describe("resolveExternalSignIn", () => {
  it("signs a known identity in to its account", async () => {
    const { accounts, resolve } = setup();
    const account = await accounts.createAccount(newAccount());
    const who = claims({ email: "someone-else@example.com", emailVerified: false });
    await accounts.linkIdentity({
      provider: "google",
      subject: who.sub,
      userId: account.user.id,
      email: account.user.email,
      emailVerified: true,
      createdAt: NOW,
    });
    expect(await resolve("google", who)).toMatchObject({
      ok: true,
      created: false,
      account: { user: { id: account.user.id } },
    });
  });

  it("refuses a known identity of a disabled account", async () => {
    const { accounts, resolve } = setup();
    const account = await accounts.createAccount(newAccount({ status: "disabled" }));
    const who = claims({ email: account.user.email });
    await accounts.linkIdentity({
      provider: "github",
      subject: who.sub,
      userId: account.user.id,
      email: account.user.email,
      emailVerified: true,
      createdAt: NOW,
    });
    expect(await resolve("github", who)).toEqual({ ok: false, reason: "disabled" });
  });

  it("links a verified email to the password account that has it: the same id (S36)", async () => {
    const { accounts, resolve } = setup();
    const account = await accounts.createAccount(newAccount({ email: "ada@example.com" }));
    const who = claims({ email: "Ada@Example.com" });
    expect(await resolve("google", who)).toMatchObject({
      ok: true,
      created: false,
      account: { user: { id: account.user.id } },
    });
    expect((await accounts.accountByIdentity("google", who.sub))?.user.id).toBe(account.user.id);
    expect(await accounts.countAccounts()).toBe(1);
  });

  it("refuses an unverified email that names an account, and creates none (Review Focus 1)", async () => {
    const { accounts, invitations, resolve } = setup({ signUpDomains: [], openSignUp: true });
    await accounts.createAccount(newAccount({ email: "ada@example.com" }));
    await invitations.addInvitation({
      projectId: PROJECT,
      email: "ada@example.com",
      role: "user",
      invitedBy: INVITER,
      createdAt: NOW,
    });
    const who = claims({ emailVerified: false });
    expect(await resolve("facebook", who)).toEqual({ ok: false, reason: "email-unverified" });
    expect(await accounts.countAccounts()).toBe(1);
    expect(await accounts.accountByIdentity("facebook", who.sub)).toBeNull();
  });

  it("refuses a disabled account's verified email", async () => {
    const { accounts, resolve } = setup();
    await accounts.createAccount(newAccount({ email: "ada@example.com", status: "disabled" }));
    const who = claims();
    expect(await resolve("google", who)).toEqual({ ok: false, reason: "disabled" });
    expect(await accounts.accountByIdentity("google", who.sub)).toBeNull();
  });

  it("makes an invited account active when an identity links to it", async () => {
    const { accounts, resolve } = setup();
    const invited = await accounts.createAccount(
      newAccount({ email: "ada@example.com", status: "invited", passwordHash: null }),
    );
    expect(await resolve("github", claims())).toMatchObject({
      ok: true,
      account: { user: { id: invited.user.id }, status: "active" },
    });
    expect(await accounts.account(invited.user.id)).toMatchObject({ status: "active" });
  });

  it("creates an account for an invited email, with D7's values", async () => {
    const { accounts, invitations, resolve } = setup();
    await invitations.addInvitation({
      projectId: PROJECT,
      email: "Ada@Example.com",
      role: "user",
      invitedBy: INVITER,
      createdAt: NOW,
    });
    const who = claims({ email: "ada@example.com" });
    const result = await resolve("google", who);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      account: {
        user: { email: "ada@example.com", displayName: "Ada Lovelace", blocked: false },
        instanceRole: "user",
        status: "active",
        passwordHash: null,
        mustChangePassword: false,
        createdAt: NOW,
      },
    });
    if (!result.ok) throw new Error("not signed in");
    expect((await accounts.accountByIdentity("google", who.sub))?.user.id).toBe(
      result.account.user.id,
    );
  });

  it("names a new account after its email when the provider gives no name", async () => {
    const { resolve } = setup({ signUpDomains: ["example.com"], openSignUp: false });
    expect(await resolve("github", claims({ name: undefined }))).toMatchObject({
      ok: true,
      created: true,
      account: { user: { displayName: "ada@example.com" } },
    });
  });

  it("creates an account for a listed domain, and with open sign-up", async () => {
    const byDomain = setup({ signUpDomains: ["example.com"], openSignUp: false });
    expect(await byDomain.resolve("google", claims())).toMatchObject({ ok: true, created: true });
    const open = setup({ signUpDomains: [], openSignUp: true });
    expect(await open.resolve("google", claims({ email: "x@anywhere.net" }))).toMatchObject({
      ok: true,
      created: true,
    });
  });

  it("refuses a stranger: not-invited, nothing created", async () => {
    const { accounts, resolve } = setup({ signUpDomains: ["example.org"], openSignUp: false });
    expect(await resolve("google", claims())).toEqual({ ok: false, reason: "not-invited" });
    expect(await accounts.countAccounts()).toBe(0);
  });

  it("refuses a first sign-in without an email", async () => {
    const { resolve } = setup({ signUpDomains: [], openSignUp: true });
    expect(await resolve("github", claims({ email: undefined }))).toEqual({
      ok: false,
      reason: "email-unverified",
    });
  });

  describe("two first sign-ins of the same identity at once (Review Focus 5)", () => {
    it("links to the other's account when the identity is taken meanwhile", async () => {
      const { accounts } = setup();
      const other = await accounts.createAccount(newAccount({ email: "ada@example.com" }));
      const who = claims();
      let first = true;
      const racing: LocalAccountStore = {
        ...accounts,
        linkIdentity: async (link) => {
          if (first) {
            first = false;
            // The other request links the identity first.
            await accounts.linkIdentity({ ...link, userId: other.user.id });
            return "taken";
          }
          return accounts.linkIdentity(link);
        },
      };
      const { resolve } = setup(closed, racing);
      expect(await resolve("google", who)).toMatchObject({
        ok: true,
        account: { user: { id: other.user.id } },
      });
    });

    it("starts over when the email is taken meanwhile: one account, one identity", async () => {
      const { accounts } = setup();
      const who = claims();
      let otherId: string | null = null;
      const racing: LocalAccountStore = {
        ...accounts,
        createAccount: async (account) => {
          if (otherId === null) {
            // The other request creates the account (and links the identity) first.
            const other = await accounts.createAccount({ ...account, id: randomUUID() });
            otherId = other.user.id;
            await accounts.linkIdentity({
              provider: "google",
              subject: who.sub,
              userId: other.user.id,
              email: other.user.email,
              emailVerified: true,
              createdAt: NOW,
            });
            throw new Error("An account with this id or email exists");
          }
          return accounts.createAccount(account);
        },
      };
      const { resolve } = setup({ signUpDomains: ["example.com"], openSignUp: false }, racing);
      const result = await resolve("google", who);
      expect(result).toMatchObject({ ok: true, created: false });
      if (!result.ok) throw new Error("not signed in");
      expect(result.account.user.id).toBe(otherId);
      expect(await accounts.countAccounts()).toBe(1);
    });

    it("starts over when the email is taken but the identity not yet linked", async () => {
      const { accounts } = setup();
      const who = claims();
      let otherId: string | null = null;
      const racing: LocalAccountStore = {
        ...accounts,
        createAccount: async (account) => {
          if (otherId === null) {
            const other = await accounts.createAccount({ ...account, id: randomUUID() });
            otherId = other.user.id;
            throw new Error("An account with this id or email exists");
          }
          return accounts.createAccount(account);
        },
      };
      const { resolve } = setup({ signUpDomains: ["example.com"], openSignUp: false }, racing);
      const result = await resolve("google", who);
      if (!result.ok) throw new Error("not signed in");
      expect(result.account.user.id).toBe(otherId);
      expect((await accounts.accountByIdentity("google", who.sub))?.user.id).toBe(otherId);
      expect(await accounts.countAccounts()).toBe(1);
    });

    it("passes a store failure on", async () => {
      const { accounts } = setup();
      const failing: LocalAccountStore = {
        ...accounts,
        createAccount: () => Promise.reject(new Error("database is down")),
      };
      const { resolve } = setup({ signUpDomains: ["example.com"], openSignUp: false }, failing);
      await expect(resolve("google", claims())).rejects.toThrow("database is down");
    });
  });

  describe("READ_ONLY=true: nothing is written", () => {
    it("signs a known identity of an active account in, writing nothing", async () => {
      const { accounts, resolve } = setup();
      const account = await accounts.createAccount(newAccount());
      const who = claims({ email: account.user.email });
      await accounts.linkIdentity({
        provider: "google",
        subject: who.sub,
        userId: account.user.id,
        email: account.user.email,
        emailVerified: true,
        createdAt: NOW,
      });
      expect(await resolve("google", who, true)).toMatchObject({
        ok: true,
        created: false,
        account: { user: { id: account.user.id }, status: "active" },
      });
    });

    it("refuses to link a verified email to its account: read-only, no identity stored", async () => {
      const { accounts, resolve } = setup();
      await accounts.createAccount(newAccount({ email: "ada@example.com" }));
      const who = claims();
      expect(await rejectionCode(resolve("google", who, true))).toEqual(READ_ONLY);
      expect(await accounts.accountByIdentity("google", who.sub)).toBeNull();
    });

    it("refuses to create an account for an invited email: read-only, none created", async () => {
      const { accounts, invitations, resolve } = setup();
      await invitations.addInvitation({
        projectId: PROJECT,
        email: "ada@example.com",
        role: "user",
        invitedBy: INVITER,
        createdAt: NOW,
      });
      expect(await rejectionCode(resolve("github", claims(), true))).toEqual(READ_ONLY);
      expect(await accounts.countAccounts()).toBe(0);
    });

    it("refuses an identity linked to an invited account: read-only, not activated", async () => {
      const { accounts, resolve } = setup();
      const invited = await accounts.createAccount(
        newAccount({ email: "ada@example.com", status: "invited", passwordHash: null }),
      );
      const who = claims();
      await accounts.linkIdentity({
        provider: "facebook",
        subject: who.sub,
        userId: invited.user.id,
        email: invited.user.email,
        emailVerified: true,
        createdAt: NOW,
      });
      expect(await rejectionCode(resolve("facebook", who, true))).toEqual(READ_ONLY);
      expect(await accounts.account(invited.user.id)).toMatchObject({ status: "invited" });
    });

    it("still refuses a stranger and an unverified email with their own reasons", async () => {
      const { resolve } = setup();
      expect(await resolve("google", claims(), true)).toEqual({
        ok: false,
        reason: "not-invited",
      });
      expect(await resolve("google", claims({ emailVerified: false }), true)).toEqual({
        ok: false,
        reason: "email-unverified",
      });
    });
  });
});

describe("resolveExternalSignIn, hosted sign-in through surveyjs.io (ADR 0043)", () => {
  const open: AppConfig["joinPolicy"] = { signUpDomains: [], openSignUp: true };
  const LICENCE = "2027-03-01T00:00:00.000Z";

  /** The claims of a surveyjs.io sign-in: the subject is a GUID, upper-case as a test of case. */
  const site = (over: Partial<IdentityClaims> = {}): IdentityClaims =>
    claims({ sub: randomUUID().toUpperCase(), ...over });

  function hosted({
    adminEmail = null,
    policy = open,
  }: { adminEmail?: string | null; policy?: AppConfig["joinPolicy"] } = {}) {
    const { accounts, invitations } = setup(policy);
    const warnings: { obj: object; msg: string }[] = [];
    const infos: { obj: object; msg: string }[] = [];
    const resolve = (who: IdentityClaims, readOnly = false) =>
      resolveExternalSignIn("surveyjs", who, {
        accounts,
        invitations,
        policy,
        now: () => NOW,
        readOnly,
        hosted: true,
        adminEmail,
        log: {
          warn: (obj, msg) => warnings.push({ obj, msg }),
          info: (obj, msg) => infos.push({ obj, msg }),
        },
      });
    /** Links `who`'s surveyjs.io identity to `userId`, as an earlier sign-in did. */
    const linkSite = (who: IdentityClaims, userId: string) =>
      accounts.linkIdentity({
        provider: "surveyjs",
        subject: who.sub.toLowerCase(),
        userId,
        email: who.email ?? null,
        emailVerified: true,
        createdAt: NOW,
      });
    return { accounts, invitations, resolve, warnings, infos, linkSite };
  }

  /** The account a returning surveyjs.io user signs in to: id = their sub, identity linked. */
  async function returning(
    env: ReturnType<typeof hosted>,
    who: IdentityClaims,
    over: Partial<NewLocalAccount> = {},
  ) {
    const account = await env.accounts.createAccount(
      newAccount({
        id: who.sub.toLowerCase(),
        email: who.email,
        displayName: "Old Name",
        passwordHash: null,
        ...over,
      }),
    );
    await env.linkSite(who, account.user.id);
    return account;
  }

  it("creates a new user's account with the sub as its id, and the site's values", async () => {
    const env = hosted();
    const who = site({ licenseExpiresAt: LICENCE });
    const result = await env.resolve(who);
    expect(result).toMatchObject({
      ok: true,
      created: true,
      account: {
        user: { id: who.sub.toLowerCase(), email: "ada@example.com", displayName: "Ada Lovelace" },
        siteBlocked: false,
        licenceExpiresAt: LICENCE,
        instanceRole: "user",
        status: "active",
      },
    });
    expect((await env.accounts.accountByIdentity("surveyjs", who.sub.toLowerCase()))?.user.id).toBe(
      who.sub.toLowerCase(),
    );
  });

  it("stores no licence date when the claim is absent", async () => {
    const env = hosted();
    expect(await env.resolve(site())).toMatchObject({
      ok: true,
      account: { licenceExpiresAt: null },
    });
  });

  it("refuses a sub that is not a GUID: failed, nothing written", async () => {
    const env = hosted();
    expect(await env.resolve(site({ sub: "u-42" }))).toEqual({ ok: false, reason: "failed" });
    expect(await env.accounts.countAccounts()).toBe(0);
  });

  it("refuses a blocked first sign-in: blocked, no account and no identity (Review Focus 2)", async () => {
    const env = hosted();
    const who = site({ blocked: true });
    expect(await env.resolve(who)).toEqual({ ok: false, reason: "blocked" });
    expect(await env.accounts.countAccounts()).toBe(0);
    expect(await env.accounts.accountByIdentity("surveyjs", who.sub.toLowerCase())).toBeNull();
  });

  it("refuses a blocked sign-in whose email names an unlinked account, linking nothing", async () => {
    const env = hosted();
    const admins = await env.accounts.createAccount(newAccount({ email: "ada@example.com" }));
    const who = site({ blocked: true });
    expect(await env.resolve(who)).toEqual({ ok: false, reason: "blocked" });
    expect(await env.accounts.listIdentities(admins.user.id)).toEqual([]);
  });

  it("refreshes a returning user's email, name, block and licence date", async () => {
    const env = hosted();
    const who = site({ email: "ada@example.com" });
    await returning(env, who);
    const back = {
      ...who,
      email: "Ada.New@Example.com",
      name: "Ada King",
      licenseExpiresAt: LICENCE,
    };
    expect(await env.resolve(back)).toMatchObject({
      ok: true,
      created: false,
      account: {
        user: { id: who.sub.toLowerCase(), email: "ada.new@example.com", displayName: "Ada King" },
        siteBlocked: false,
        licenceExpiresAt: LICENCE,
      },
    });
    expect(await env.accounts.account(who.sub.toLowerCase())).toMatchObject({
      user: { email: "ada.new@example.com", displayName: "Ada King" },
      licenceExpiresAt: LICENCE,
    });
    expect(env.warnings).toEqual([]);
  });

  it("keeps the email when the new one is not verified, refreshing the rest", async () => {
    const env = hosted();
    const who = site({ email: "ada@example.com" });
    await returning(env, who);
    const back = { ...who, email: "other@example.com", emailVerified: false, name: "Ada King" };
    expect(await env.resolve(back)).toMatchObject({
      ok: true,
      account: { user: { email: "ada@example.com", displayName: "Ada King" } },
    });
  });

  it("keeps the old email when another account holds the new one, logging no address (Review Focus 1)", async () => {
    const env = hosted();
    const who = site({ email: "ada@example.com" });
    await returning(env, who);
    const other = await env.accounts.createAccount(newAccount({ email: "taken@example.com" }));
    const back = {
      ...who,
      email: "taken@example.com",
      name: "Ada King",
      licenseExpiresAt: LICENCE,
    };
    expect(await env.resolve(back)).toMatchObject({
      ok: true,
      account: {
        user: { id: who.sub.toLowerCase(), email: "ada@example.com", displayName: "Ada King" },
        licenceExpiresAt: LICENCE,
      },
    });
    expect(await env.accounts.account(other.user.id)).toEqual(other);
    expect(env.warnings).toEqual([
      {
        obj: { userId: who.sub.toLowerCase() },
        msg: "sign-in kept the old email: the new one belongs to another account",
      },
    ]);
    expect(JSON.stringify(env.warnings)).not.toMatch(/@/);
  });

  it("refuses a returning user the site blocked, still refreshing the account", async () => {
    const env = hosted();
    const who = site({ email: "ada@example.com" });
    await returning(env, who);
    const back = { ...who, blocked: true, name: "Ada King", licenseExpiresAt: LICENCE };
    expect(await env.resolve(back)).toEqual({ ok: false, reason: "blocked" });
    expect(await env.accounts.account(who.sub.toLowerCase())).toMatchObject({
      siteBlocked: true,
      licenceExpiresAt: LICENCE,
      user: { displayName: "Ada King", blocked: true },
      status: "active",
    });
  });

  it("lets a user the site unblocked in again", async () => {
    const env = hosted();
    const who = site();
    await returning(env, who, { siteBlocked: true });
    expect(await env.resolve(who)).toMatchObject({ ok: true, account: { siteBlocked: false } });
  });

  it("keeps an admin's disable apart from the site's block: blocked=false does not lift it", async () => {
    const env = hosted();
    const who = site();
    await returning(env, who, { status: "disabled" });
    expect(await env.resolve({ ...who, blocked: false })).toEqual({
      ok: false,
      reason: "disabled",
    });
    expect(await env.accounts.account(who.sub.toLowerCase())).toMatchObject({
      status: "disabled",
      siteBlocked: false,
    });
  });

  it("links an admin-created account (random id, no identity) by its verified email, and refreshes it", async () => {
    const env = hosted();
    const made = await env.accounts.createAccount(
      newAccount({ email: "ada@example.com", displayName: "ada", passwordHash: null }),
    );
    const who = site({ licenseExpiresAt: LICENCE });
    expect(await env.resolve(who)).toMatchObject({
      ok: true,
      created: false,
      account: {
        user: { id: made.user.id, displayName: "Ada Lovelace" },
        licenceExpiresAt: LICENCE,
      },
    });
    expect((await env.accounts.accountByIdentity("surveyjs", who.sub.toLowerCase()))?.user.id).toBe(
      made.user.id,
    );
    expect(await env.accounts.countAccounts()).toBe(1);
  });

  it("refuses an email whose account belongs to another surveyjs.io id: identity-conflict, nothing written", async () => {
    const env = hosted();
    const before = site({ email: "ada@example.com" });
    const old = await returning(env, before);
    const recreated = site({
      email: "ada@example.com",
      name: "Ada Again",
      licenseExpiresAt: LICENCE,
    });
    expect(await env.resolve(recreated)).toEqual({ ok: false, reason: "identity-conflict" });
    expect(await env.accounts.account(old.user.id)).toEqual(old);
    expect(await env.accounts.countAccounts()).toBe(1);
    expect(
      await env.accounts.accountByIdentity("surveyjs", recreated.sub.toLowerCase()),
    ).toBeNull();
    expect(env.warnings).toHaveLength(1);
    expect(env.warnings[0]?.obj).toEqual({ userId: old.user.id });
    expect(JSON.stringify(env.warnings)).not.toMatch(/@/);
  });

  it("signs in, not conflict, when its own identity was linked to the email's account meanwhile", async () => {
    const env = hosted();
    const who = site();
    // An admin-created account (random id) the other sign-in links: found by email, not by id.
    const account = await returning(env, who, { id: randomUUID() });
    let first = true;
    const racing: LocalAccountStore = {
      ...env.accounts,
      // The other sign-in of the same person links the identity just after this one looked.
      accountByIdentity: (provider, subject) => {
        if (first) {
          first = false;
          return Promise.resolve(null);
        }
        return env.accounts.accountByIdentity(provider, subject);
      },
    };
    const result = await resolveExternalSignIn("surveyjs", who, {
      accounts: racing,
      invitations: env.invitations,
      policy: open,
      now: () => NOW,
      hosted: true,
    });
    expect(result).toMatchObject({ ok: true, account: { user: { id: account.user.id } } });
  });

  describe("the account with the sub as its id, without the identity (an admin unlinked it)", () => {
    /** The person's own account (id = sub), whose surveyjs identity is gone; another email. */
    const unlinked = (env: ReturnType<typeof hosted>, who: IdentityClaims, over = {}) =>
      env.accounts.createAccount(
        newAccount({
          id: who.sub.toLowerCase(),
          email: "ada.old@example.com",
          displayName: "Old Name",
          passwordHash: null,
          ...over,
        }),
      );

    it("links the identity to it, refreshes it and signs in", async () => {
      const env = hosted();
      const who = site({ licenseExpiresAt: LICENCE });
      await unlinked(env, who);
      expect(await env.resolve(who)).toMatchObject({
        ok: true,
        created: false,
        account: {
          user: {
            id: who.sub.toLowerCase(),
            email: "ada@example.com",
            displayName: "Ada Lovelace",
          },
          licenceExpiresAt: LICENCE,
        },
      });
      expect(
        (await env.accounts.accountByIdentity("surveyjs", who.sub.toLowerCase()))?.user.id,
      ).toBe(who.sub.toLowerCase());
      expect(await env.accounts.countAccounts()).toBe(1);
    });

    it("links and refreshes it, then refuses the site's block", async () => {
      const env = hosted();
      const who = site({ blocked: true });
      await unlinked(env, who);
      expect(await env.resolve(who)).toEqual({ ok: false, reason: "blocked" });
      expect(await env.accounts.account(who.sub.toLowerCase())).toMatchObject({
        siteBlocked: true,
      });
    });

    it("refuses it when an admin disabled it", async () => {
      const env = hosted();
      const who = site();
      await unlinked(env, who, { status: "disabled" });
      expect(await env.resolve(who)).toEqual({ ok: false, reason: "disabled" });
    });

    it("refuses identity-conflict when it has another surveyjs identity, writing nothing", async () => {
      const env = hosted();
      const who = site();
      const own = await unlinked(env, who);
      await env.linkSite(site(), own.user.id);
      expect(await env.resolve(who)).toEqual({ ok: false, reason: "identity-conflict" });
      expect(await env.accounts.account(own.user.id)).toEqual(own);
      expect(await env.accounts.accountByIdentity("surveyjs", who.sub.toLowerCase())).toBeNull();
      expect(env.warnings.map((line) => line.obj)).toEqual([{ userId: own.user.id }]);
    });

    it("READ_ONLY=true: refuses read-only, writing nothing", async () => {
      const env = hosted();
      const who = site();
      const own = await unlinked(env, who);
      expect(await rejectionCode(env.resolve(who, true))).toEqual(READ_ONLY);
      expect(await env.accounts.account(own.user.id)).toEqual(own);
      expect(await env.resolve({ ...who, blocked: true }, true)).toEqual({
        ok: false,
        reason: "blocked",
      });
    });
  });

  it("makes the ADMIN_EMAIL account admin at its sign-in while there is no active admin", async () => {
    const env = hosted({ adminEmail: "Ada@Example.com" });
    const result = await env.resolve(site());
    expect(result).toMatchObject({ ok: true, account: { instanceRole: "admin" } });
    expect(await env.accounts.countActiveAdmins()).toBe(1);
    if (!result.ok) throw new Error("not signed in");
    expect(env.infos).toEqual([
      {
        obj: { userId: result.account.user.id },
        msg: "made the ADMIN_EMAIL account an instance admin at sign-in",
      },
    ]);
  });

  it("makes a returning ADMIN_EMAIL account admin too", async () => {
    const env = hosted({ adminEmail: "ada@example.com" });
    const who = site();
    await returning(env, who);
    expect(await env.resolve(who)).toMatchObject({ ok: true, account: { instanceRole: "admin" } });
  });

  it("leaves the ADMIN_EMAIL account's role alone when an active admin exists", async () => {
    const env = hosted({ adminEmail: "ada@example.com" });
    await env.accounts.createAccount(newAccount({ instanceRole: "admin" }));
    expect(await env.resolve(site())).toMatchObject({
      ok: true,
      account: { instanceRole: "user" },
    });
    expect(env.infos).toEqual([]);
  });

  it("makes no other email admin", async () => {
    const env = hosted({ adminEmail: "root@example.com" });
    expect(await env.resolve(site())).toMatchObject({
      ok: true,
      account: { instanceRole: "user" },
    });
    expect(await env.accounts.countActiveAdmins()).toBe(0);
  });

  it("still applies the join policy to a new account", async () => {
    const env = hosted({ policy: closed });
    expect(await env.resolve(site())).toEqual({ ok: false, reason: "not-invited" });
    expect(await env.accounts.countAccounts()).toBe(0);
  });

  describe("READ_ONLY=true: nothing is written (Review Focus 4)", () => {
    it("signs a linked, active, unblocked user in without refreshing anything", async () => {
      const env = hosted({ adminEmail: "ada.new@example.com" });
      const who = site({ email: "ada@example.com" });
      const account = await returning(env, who, { siteBlocked: true });
      const back = {
        ...who,
        email: "ada.new@example.com",
        name: "Ada King",
        licenseExpiresAt: LICENCE,
      };
      expect(await env.resolve(back, true)).toMatchObject({
        ok: true,
        account: { user: { id: account.user.id } },
      });
      expect(await env.accounts.account(account.user.id)).toEqual(account);
    });

    it("refuses a blocked claim for a linked user, writing nothing", async () => {
      const env = hosted();
      const who = site();
      const account = await returning(env, who);
      expect(await env.resolve({ ...who, blocked: true }, true)).toEqual({
        ok: false,
        reason: "blocked",
      });
      expect(await env.accounts.account(account.user.id)).toEqual(account);
    });

    it("refuses a blocked first sign-in as blocked, not read-only", async () => {
      const env = hosted();
      expect(await env.resolve(site({ blocked: true }), true)).toEqual({
        ok: false,
        reason: "blocked",
      });
      expect(await env.accounts.countAccounts()).toBe(0);
    });

    it("refuses to create or link: read-only", async () => {
      const env = hosted();
      expect(await rejectionCode(env.resolve(site(), true))).toEqual(READ_ONLY);
      await env.accounts.createAccount(newAccount({ email: "ada@example.com" }));
      expect(await rejectionCode(env.resolve(site(), true))).toEqual(READ_ONLY);
      expect(await env.accounts.countAccounts()).toBe(1);
    });
  });

  it("ignores the site's claims when not hosted", async () => {
    const { resolve } = setup(open);
    expect(
      await resolve("surveyjs", site({ sub: "u-42", blocked: true, licenseExpiresAt: LICENCE })),
    ).toMatchObject({
      ok: true,
      created: true,
      account: { siteBlocked: false, licenceExpiresAt: null },
    });
  });
});
