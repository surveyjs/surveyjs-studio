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
