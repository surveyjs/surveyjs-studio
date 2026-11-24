import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LocalAccountStore, NewLocalAccount, UserDirectory } from "../types.js";

export interface LocalAccountsUnderTest {
  readonly accounts: LocalAccountStore;
  readonly users: UserDirectory;
  close(): Promise<void>;
}

const newAccount = (over: Partial<NewLocalAccount> = {}): NewLocalAccount => ({
  id: randomUUID(),
  email: `${randomUUID()}@example.com`,
  displayName: "Local User",
  instanceRole: "user",
  status: "active",
  passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaA",
  mustChangePassword: false,
  createdAt: "2026-10-29T10:00:00.000Z",
  ...over,
});

const AT = "2026-10-29T12:00:00.000Z";
const LATER = "2026-11-10T12:00:00.000Z";

/** What every local account store does, and its user directory with it. `create` starts empty. */
export function describeLocalAccountSuite(
  name: string,
  create: () => Promise<LocalAccountsUnderTest>,
): void {
  describe(`local accounts: ${name}`, () => {
    let store: LocalAccountsUnderTest;
    beforeAll(async () => {
      store = await create();
    });
    afterAll(async () => {
      await store.close();
    });

    it("stores an account with a lower-case email, and finds it in any case", async () => {
      const before = await store.accounts.countAccounts();
      const id = randomUUID();
      const email = `Mixed.${randomUUID()}@Example.COM`;
      const created = await store.accounts.createAccount(
        newAccount({
          id: id.toUpperCase(),
          email,
          displayName: "Mixed Case",
          instanceRole: "admin",
        }),
      );
      const expected = {
        user: { id, email: email.toLowerCase(), displayName: "Mixed Case", blocked: false },
        instanceRole: "admin",
        status: "active",
        passwordHash: newAccount().passwordHash,
        mustChangePassword: false,
        sessionEpoch: 0,
        siteBlocked: false,
        licenceExpiresAt: null,
        lastSignInAt: null,
        createdAt: "2026-10-29T10:00:00.000Z",
      };
      expect(created).toEqual(expected);
      expect(await store.accounts.account(id.toUpperCase())).toEqual(expected);
      expect(await store.accounts.accountByEmail(email.toUpperCase())).toEqual(expected);
      expect(await store.accounts.countAccounts()).toBe(before + 1);
    });

    it("shows the accounts as the user directory's users, a disabled one as blocked", async () => {
      expect(store.users.kind).toBe("local");
      const active = await store.accounts.createAccount(newAccount({ displayName: "Active" }));
      const disabled = await store.accounts.createAccount(
        newAccount({ displayName: "Disabled", status: "disabled" }),
      );
      expect(await store.users.getUser(active.user.id)).toEqual(active.user);
      expect(await store.users.findUserByEmail(active.user.email.toUpperCase())).toEqual(
        active.user,
      );
      expect(await store.users.getUser(disabled.user.id)).toMatchObject({ blocked: true });
      const unknown = randomUUID();
      expect(await store.users.getUser(unknown)).toBeNull();
      expect(await store.users.missingUsers([active.user.id, unknown, "not-a-guid"])).toEqual([
        unknown,
      ]);
      expect(await store.users.signInUser({ sub: active.user.id })).toEqual(active.user);
      expect(await store.users.findUserByEmail("")).toBeNull();
    });

    describe("refreshFromSignIn", () => {
      const LICENCE = "2027-01-31T00:00:00.000Z";

      it("updates the email, the name, the block and the licence date", async () => {
        const account = await store.accounts.createAccount(newAccount());
        const email = `new.${randomUUID()}@example.com`;
        const result = await store.accounts.refreshFromSignIn(account.user.id.toUpperCase(), {
          email,
          displayName: "Renamed",
          siteBlocked: true,
          licenceExpiresAt: LICENCE,
        });
        expect(result.outcome).toBe("updated");
        const stored = await store.accounts.account(account.user.id);
        expect(stored).toMatchObject({
          user: { email, displayName: "Renamed", blocked: true },
          status: "active",
          siteBlocked: true,
          licenceExpiresAt: LICENCE,
          passwordHash: account.passwordHash,
          instanceRole: "user",
        });
        expect(result).toEqual({ outcome: "updated", account: stored });
        expect(await store.users.getUser(account.user.id)).toMatchObject({ blocked: true });
        const cleared = await store.accounts.refreshFromSignIn(account.user.id, {
          email,
          displayName: "Renamed",
          siteBlocked: false,
          licenceExpiresAt: null,
        });
        expect(cleared).toMatchObject({
          outcome: "updated",
          account: { siteBlocked: false, licenceExpiresAt: null, user: { blocked: false } },
        });
      });

      it("keeps the old email when another account has the new one, and updates the rest", async () => {
        const holder = await store.accounts.createAccount(newAccount());
        const account = await store.accounts.createAccount(newAccount());
        const result = await store.accounts.refreshFromSignIn(account.user.id, {
          email: holder.user.email,
          displayName: "Other Name",
          siteBlocked: true,
          licenceExpiresAt: LICENCE,
        });
        expect(result.outcome).toBe("email-taken");
        const stored = await store.accounts.account(account.user.id);
        expect(stored).toMatchObject({
          user: { email: account.user.email, displayName: "Other Name" },
          siteBlocked: true,
          licenceExpiresAt: LICENCE,
        });
        expect(result).toEqual({ outcome: "email-taken", account: stored });
        expect(await store.accounts.account(holder.user.id)).toEqual(holder);
      });

      it("follows an email change in the account's surveyjs identity", async () => {
        const account = await store.accounts.createAccount(newAccount());
        await store.accounts.linkIdentity({
          provider: "surveyjs",
          subject: `sub-${randomUUID()}`,
          userId: account.user.id,
          email: account.user.email,
          emailVerified: true,
          createdAt: AT,
        });
        const email = `moved.${randomUUID()}@example.com`;
        await store.accounts.refreshFromSignIn(account.user.id, {
          email,
          displayName: account.user.displayName,
          siteBlocked: false,
          licenceExpiresAt: null,
        });
        const links = await store.accounts.listIdentities(account.user.id);
        expect(links.map((link) => link.email)).toEqual([email]);
      });

      it("answers not-found for an unknown or malformed id", async () => {
        const change = {
          email: `x.${randomUUID()}@example.com`,
          displayName: "X",
          siteBlocked: false,
          licenceExpiresAt: null,
        };
        expect(await store.accounts.refreshFromSignIn(randomUUID(), change)).toEqual({
          outcome: "not-found",
        });
        expect(await store.accounts.refreshFromSignIn("not-a-guid", change)).toEqual({
          outcome: "not-found",
        });
      });

      it("creates an account blocked by the site, with a licence date", async () => {
        const account = await store.accounts.createAccount(
          newAccount({ siteBlocked: true, licenceExpiresAt: LICENCE }),
        );
        expect(account).toMatchObject({ siteBlocked: true, licenceExpiresAt: LICENCE });
        expect(account.user.blocked).toBe(true);
        expect(account.status).toBe("active");
      });
    });

    it("refuses a second account with an email or an id in use", async () => {
      const first = await store.accounts.createAccount(newAccount());
      await expect(
        store.accounts.createAccount(newAccount({ email: first.user.email.toUpperCase() })),
      ).rejects.toThrow();
      await expect(
        store.accounts.createAccount(newAccount({ id: first.user.id })),
      ).rejects.toThrow();
      expect(await store.accounts.account(first.user.id)).toEqual(first);
    });

    it("creates an account with its set-password link, and neither when the email is taken", async () => {
      const tokenHash = `with-${randomUUID()}`;
      const link = { tokenHash, purpose: "invitation" as const, createdAt: AT, expiresAt: LATER };
      const invited = await store.accounts.createAccount(
        newAccount({ status: "invited", passwordHash: null }),
        { link },
      );
      expect((await store.accounts.pendingPasswordLinks(AT)).get(invited.user.id)).toEqual({
        purpose: "invitation",
        expiresAt: LATER,
      });
      // The second account fails: its link is not stored either.
      const refused = `refused-${randomUUID()}`;
      await expect(
        store.accounts.createAccount(newAccount({ email: invited.user.email }), {
          link: { ...link, tokenHash: refused },
        }),
      ).rejects.toThrow();
      expect(await store.accounts.usePasswordLink(refused, AT, "$argon2id$x")).toBeNull();
      expect(await store.accounts.usePasswordLink(tokenHash, AT, "$argon2id$set")).toEqual({
        userId: invited.user.id,
        epoch: 1,
      });
    });

    it("lists each account's pending link: unused, not expired, the latest expiry", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const none = await store.accounts.createAccount(newAccount());
      const link = (tokenHash: string, expiresAt: string) =>
        store.accounts.createPasswordLink({
          tokenHash,
          userId: account.user.id,
          purpose: "reset",
          createdAt: AT,
          expiresAt,
        });
      await link(`soon-${randomUUID()}`, "2026-11-01T12:00:00.000Z");
      await link(`later-${randomUUID()}`, LATER);
      const used = `used-${randomUUID()}`;
      await store.accounts.createPasswordLink({
        tokenHash: used,
        userId: none.user.id,
        purpose: "reset",
        createdAt: AT,
        expiresAt: LATER,
      });
      await store.accounts.usePasswordLink(used, AT, "$argon2id$x");
      const pending = await store.accounts.pendingPasswordLinks(AT);
      expect(pending.get(account.user.id)).toEqual({ purpose: "reset", expiresAt: LATER });
      expect(pending.has(none.user.id)).toBe(false);
      // Once the later one has expired too, none is pending.
      const after = await store.accounts.pendingPasswordLinks("2026-11-11T00:00:00.000Z");
      expect(after.has(account.user.id)).toBe(false);
    });

    it("sets a password: raises the epoch, sets the flag, activates an invited account", async () => {
      const invited = await store.accounts.createAccount(
        newAccount({ status: "invited", passwordHash: null }),
      );
      expect(
        await store.accounts.setPassword(invited.user.id, "$argon2id$new", { mustChange: true }),
      ).toBe(1);
      expect(await store.accounts.account(invited.user.id)).toMatchObject({
        status: "active",
        passwordHash: "$argon2id$new",
        mustChangePassword: true,
        sessionEpoch: 1,
      });
      expect(
        await store.accounts.setPassword(invited.user.id, "$argon2id$newer", { mustChange: false }),
      ).toBe(2);
      expect(await store.accounts.account(invited.user.id)).toMatchObject({
        mustChangePassword: false,
        sessionEpoch: 2,
      });
      expect(await store.accounts.setPassword(randomUUID(), "x", { mustChange: false })).toBeNull();
    });

    it("keeps a disabled account disabled when its password is set", async () => {
      const disabled = await store.accounts.createAccount(newAccount({ status: "disabled" }));
      await store.accounts.setPassword(disabled.user.id, "$argon2id$reset", { mustChange: true });
      expect(await store.accounts.account(disabled.user.id)).toMatchObject({ status: "disabled" });
    });

    it("counts the active admins, not the invited or disabled ones", async () => {
      const before = await store.accounts.countActiveAdmins();
      await store.accounts.createAccount(newAccount({ instanceRole: "admin" }));
      await store.accounts.createAccount(newAccount({ instanceRole: "admin", status: "invited" }));
      await store.accounts.createAccount(newAccount({ instanceRole: "admin", status: "disabled" }));
      await store.accounts.createAccount(newAccount({ instanceRole: "user" }));
      expect(await store.accounts.countActiveAdmins()).toBe(before + 1);
    });

    it("notes the last sign-in", async () => {
      const account = await store.accounts.createAccount(newAccount());
      await store.accounts.recordSignIn(account.user.id, AT);
      expect((await store.accounts.account(account.user.id))?.lastSignInAt).toBe(AT);
    });

    it("uses a set-password link once, and not after it expired", async () => {
      const account = await store.accounts.createAccount(
        newAccount({ status: "invited", passwordHash: null }),
      );
      const link = (tokenHash: string, expiresAt: string) =>
        store.accounts.createPasswordLink({
          tokenHash,
          userId: account.user.id,
          purpose: "setup",
          createdAt: AT,
          expiresAt,
        });
      const once = `once-${randomUUID()}`;
      await link(once, LATER);
      // The link and the password in one step: the account is active, with the new hash and epoch.
      expect(await store.accounts.usePasswordLink(once, AT, "$argon2id$first")).toEqual({
        userId: account.user.id,
        epoch: 1,
      });
      expect(await store.accounts.account(account.user.id)).toMatchObject({
        status: "active",
        passwordHash: "$argon2id$first",
        mustChangePassword: false,
        sessionEpoch: 1,
      });
      expect(await store.accounts.usePasswordLink(once, AT, "$argon2id$again")).toBeNull();
      const expired = `expired-${randomUUID()}`;
      await link(expired, AT);
      expect(await store.accounts.usePasswordLink(expired, LATER, "$argon2id$late")).toBeNull();
      expect(
        await store.accounts.usePasswordLink(`unknown-${randomUUID()}`, AT, "$argon2id$x"),
      ).toBeNull();
      expect((await store.accounts.account(account.user.id))?.passwordHash).toBe("$argon2id$first");
    });

    it("lets only one of two uses of a link at the same time succeed", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const tokenHash = `race-${randomUUID()}`;
      await store.accounts.createPasswordLink({
        tokenHash,
        userId: account.user.id,
        purpose: "reset",
        createdAt: AT,
        expiresAt: LATER,
      });
      const uses = await Promise.all([
        store.accounts.usePasswordLink(tokenHash, AT, "$argon2id$a"),
        store.accounts.usePasswordLink(tokenHash, AT, "$argon2id$b"),
        store.accounts.usePasswordLink(tokenHash, AT, "$argon2id$c"),
      ]);
      expect(uses.filter((use) => use !== null).map((use) => use?.userId)).toEqual([
        account.user.id,
      ]);
      expect((await store.accounts.account(account.user.id))?.sessionEpoch).toBe(1);
    });

    it("keeps each account's creation time", async () => {
      const account = await store.accounts.createAccount(newAccount());
      expect(account.createdAt).toBe("2026-10-29T10:00:00.000Z");
    });

    it("lists every account by email", async () => {
      const prefix = randomUUID();
      const b = await store.accounts.createAccount(
        newAccount({ email: `${prefix}-b@example.com` }),
      );
      const a = await store.accounts.createAccount(
        newAccount({ email: `${prefix}-A@example.com` }),
      );
      const listed = (await store.accounts.listAccounts()).filter((account) =>
        account.user.email.startsWith(prefix),
      );
      expect(listed.map((account) => account.user.id)).toEqual([a.user.id, b.user.id]);
      const emails = (await store.accounts.listAccounts()).map((account) => account.user.email);
      expect(emails).toEqual([...emails].sort());
    });

    it("changes the role and the status; disabling ends the sessions", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const promoted = await store.accounts.updateAccount(account.user.id, {
        instanceRole: "admin",
      });
      expect(promoted).toMatchObject({
        outcome: "updated",
        account: { instanceRole: "admin", status: "active", sessionEpoch: 0 },
      });
      const disabled = await store.accounts.updateAccount(account.user.id, { status: "disabled" });
      expect(disabled).toMatchObject({
        outcome: "updated",
        account: { status: "disabled", sessionEpoch: 1, user: { blocked: true } },
      });
      // Disabling again ends nothing more.
      await store.accounts.updateAccount(account.user.id, { status: "disabled" });
      const enabled = await store.accounts.updateAccount(account.user.id, { status: "active" });
      expect(enabled).toMatchObject({
        outcome: "updated",
        account: { status: "active", sessionEpoch: 1 },
      });
      expect(await store.accounts.updateAccount(randomUUID(), { status: "active" })).toEqual({
        outcome: "not-found",
      });
      expect(await store.accounts.updateAccount("not-a-guid", { status: "active" })).toEqual({
        outcome: "not-found",
      });
    });

    it("enables an account that never set a password as invited", async () => {
      const invited = await store.accounts.createAccount(
        newAccount({ status: "invited", passwordHash: null }),
      );
      await store.accounts.updateAccount(invited.user.id, { status: "disabled" });
      const enabled = await store.accounts.updateAccount(invited.user.id, { status: "active" });
      expect(enabled).toMatchObject({ outcome: "updated", account: { status: "invited" } });
    });

    it("enables an account with a linked identity and no password as active", async () => {
      const invited = await store.accounts.createAccount(
        newAccount({ status: "invited", passwordHash: null }),
      );
      await store.accounts.linkIdentity({
        provider: "github",
        subject: randomUUID(),
        userId: invited.user.id,
        email: invited.user.email,
        emailVerified: true,
        createdAt: AT,
      });
      expect(
        await store.accounts.updateAccount(invited.user.id, { status: "active" }),
      ).toMatchObject({ outcome: "updated", account: { status: "active" } });
      await store.accounts.updateAccount(invited.user.id, { status: "disabled" });
      expect(
        await store.accounts.updateAccount(invited.user.id, { status: "active" }),
      ).toMatchObject({ outcome: "updated", account: { status: "active" } });
    });

    it("never demotes, disables or deletes the last active admin", async () => {
      // A store of its own: the other tests leave active admins behind.
      const own = await create();
      try {
        const admin = await own.accounts.createAccount(newAccount({ instanceRole: "admin" }));
        await own.accounts.createAccount(newAccount({ instanceRole: "admin", status: "disabled" }));
        await own.accounts.createAccount(newAccount({ instanceRole: "admin", status: "invited" }));
        const last = { outcome: "last-instance-admin" };
        expect(await own.accounts.updateAccount(admin.user.id, { instanceRole: "user" })).toEqual(
          last,
        );
        expect(await own.accounts.updateAccount(admin.user.id, { status: "disabled" })).toEqual(
          last,
        );
        expect(await own.accounts.deleteAccount(admin.user.id)).toBe("last-instance-admin");
        // A change that keeps it an active admin is fine.
        expect(
          await own.accounts.updateAccount(admin.user.id, {
            instanceRole: "admin",
            status: "active",
          }),
        ).toMatchObject({ outcome: "updated" });

        const second = await own.accounts.createAccount(newAccount({ instanceRole: "admin" }));
        // Two demotions at once: one of them must be refused.
        const both = await Promise.all([
          own.accounts.updateAccount(admin.user.id, { instanceRole: "user" }),
          own.accounts.updateAccount(second.user.id, { instanceRole: "user" }),
        ]);
        expect(both.map((change) => change.outcome).sort()).toEqual([
          "last-instance-admin",
          "updated",
        ]);
        expect(await own.accounts.countActiveAdmins()).toBe(1);
      } finally {
        await own.close();
      }
    });

    it("disables and deletes the last active admin when the caller allows it (the webhook)", async () => {
      const own = await create();
      try {
        const allow = { allowLastInstanceAdmin: true };
        const admin = await own.accounts.createAccount(newAccount({ instanceRole: "admin" }));
        expect(
          await own.accounts.updateAccount(admin.user.id, { status: "disabled" }, allow),
        ).toMatchObject({
          outcome: "updated",
          account: { status: "disabled", sessionEpoch: admin.sessionEpoch + 1 },
        });
        expect(await own.accounts.countActiveAdmins()).toBe(0);
        expect(await own.accounts.deleteAccount(admin.user.id, allow)).toBe("deleted");

        // An active last admin too; without the allowance it is still refused.
        const other = await own.accounts.createAccount(newAccount({ instanceRole: "admin" }));
        expect(await own.accounts.deleteAccount(other.user.id)).toBe("last-instance-admin");
        expect(await own.accounts.deleteAccount(other.user.id, allow)).toBe("deleted");
        expect(await own.accounts.countAccounts()).toBe(0);
      } finally {
        await own.close();
      }
    });

    it("deletes an account with its links", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const tokenHash = `gone-${randomUUID()}`;
      await store.accounts.createPasswordLink({
        tokenHash,
        userId: account.user.id,
        purpose: "reset",
        createdAt: AT,
        expiresAt: LATER,
      });
      expect(await store.accounts.deleteAccount(account.user.id)).toBe("deleted");
      expect(await store.accounts.account(account.user.id)).toBeNull();
      expect(await store.accounts.usePasswordLink(tokenHash, AT, "$argon2id$x")).toBeNull();
      expect(await store.accounts.deleteAccount(account.user.id)).toBe("not-found");
      expect(await store.accounts.deleteAccount("not-a-guid")).toBe("not-found");
    });

    it("links an identity to an account, once per provider and subject", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const other = await store.accounts.createAccount(newAccount());
      const subject = randomUUID();
      const link = {
        provider: "google" as const,
        subject,
        userId: account.user.id,
        email: "linked@example.com",
        emailVerified: true,
        createdAt: AT,
      };
      expect(await store.accounts.accountByIdentity("google", subject)).toBeNull();
      expect(await store.accounts.linkIdentity(link)).toBe("linked");
      expect(await store.accounts.accountByIdentity("google", subject)).toEqual(account);
      // Taken: by the same account or by another one.
      expect(await store.accounts.linkIdentity(link)).toBe("taken");
      expect(await store.accounts.linkIdentity({ ...link, userId: other.user.id })).toBe("taken");
      expect((await store.accounts.accountByIdentity("google", subject))?.user.id).toBe(
        account.user.id,
      );
      // The same subject at another provider is another identity.
      expect(await store.accounts.accountByIdentity("github", subject)).toBeNull();
      expect(
        await store.accounts.linkIdentity({
          ...link,
          provider: "github",
          userId: other.user.id,
          email: null,
          emailVerified: false,
        }),
      ).toBe("linked");
      expect((await store.accounts.accountByIdentity("github", subject))?.user.id).toBe(
        other.user.id,
      );
    });

    it("removes an account's identities with the account", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const subject = randomUUID();
      await store.accounts.linkIdentity({
        provider: "facebook",
        subject,
        userId: account.user.id,
        email: null,
        emailVerified: false,
        createdAt: AT,
      });
      expect(await store.accounts.deleteAccount(account.user.id)).toBe("deleted");
      expect(await store.accounts.accountByIdentity("facebook", subject)).toBeNull();
    });

    it("lists an account's identities by provider; unlinking one ends the sessions", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const other = await store.accounts.createAccount(newAccount());
      const identity = (provider: "google" | "github", subject: string, createdAt: string) => ({
        provider,
        subject,
        userId: account.user.id.toUpperCase(),
        email: "Ada@Example.com",
        emailVerified: true,
        createdAt,
      });
      // A subject is whatever text the provider gives, a slash included.
      const google = identity("google", `g/${randomUUID()}`, LATER);
      const github = identity("github", randomUUID(), AT);
      await store.accounts.linkIdentity(google);
      await store.accounts.linkIdentity(github);
      await store.accounts.linkIdentity({
        ...github,
        subject: randomUUID(),
        userId: other.user.id,
      });
      const stored = (link: typeof google) => ({
        ...link,
        userId: account.user.id,
        email: "ada@example.com",
      });
      expect(await store.accounts.listIdentities(account.user.id.toUpperCase())).toEqual([
        stored(github),
        stored(google),
      ]);
      expect(await store.accounts.listIdentities(randomUUID())).toEqual([]);
      expect(await store.accounts.listIdentities("not-a-guid")).toEqual([]);

      expect(await store.accounts.unlinkIdentity(account.user.id, "google", google.subject)).toBe(
        1,
      );
      expect(await store.accounts.accountByIdentity("google", google.subject)).toBeNull();
      expect(await store.accounts.listIdentities(account.user.id)).toEqual([stored(github)]);
      expect((await store.accounts.account(account.user.id))?.sessionEpoch).toBe(1);
      // Gone already, or another account's: nothing changes.
      expect(
        await store.accounts.unlinkIdentity(account.user.id, "google", google.subject),
      ).toBeNull();
      expect(
        await store.accounts.unlinkIdentity(other.user.id, "github", github.subject),
      ).toBeNull();
      expect(
        await store.accounts.unlinkIdentity("not-a-guid", "github", github.subject),
      ).toBeNull();
      expect((await store.accounts.account(account.user.id))?.sessionEpoch).toBe(1);
      expect((await store.accounts.account(other.user.id))?.sessionEpoch).toBe(0);
    });

    it("unlinks every identity with a reset", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const subject = randomUUID();
      await store.accounts.linkIdentity({
        provider: "github",
        subject,
        userId: account.user.id,
        email: account.user.email,
        emailVerified: true,
        createdAt: AT,
      });
      await store.accounts.resetPassword(account.user.id, {
        tokenHash: `reset-${randomUUID()}`,
        createdAt: AT,
        expiresAt: LATER,
      });
      expect(await store.accounts.listIdentities(account.user.id)).toEqual([]);
      expect(await store.accounts.accountByIdentity("github", subject)).toBeNull();
      expect((await store.accounts.pendingPasswordLinks(AT)).get(account.user.id)).toEqual({
        purpose: "reset",
        expiresAt: LATER,
      });
    });

    it("resets a password: no password, a new epoch, only the new link works", async () => {
      const account = await store.accounts.createAccount(newAccount());
      const earlier = `earlier-${randomUUID()}`;
      await store.accounts.createPasswordLink({
        tokenHash: earlier,
        userId: account.user.id,
        purpose: "reset",
        createdAt: AT,
        expiresAt: LATER,
      });
      const fresh = `fresh-${randomUUID()}`;
      expect(
        await store.accounts.resetPassword(account.user.id, {
          tokenHash: fresh,
          createdAt: AT,
          expiresAt: LATER,
        }),
      ).toBe(1);
      expect(await store.accounts.account(account.user.id)).toMatchObject({
        passwordHash: null,
        sessionEpoch: 1,
        status: "active",
      });
      expect(await store.accounts.usePasswordLink(earlier, AT, "$argon2id$x")).toBeNull();
      expect(await store.accounts.usePasswordLink(fresh, AT, "$argon2id$new")).toEqual({
        userId: account.user.id,
        epoch: 2,
      });
      expect(
        await store.accounts.resetPassword(randomUUID(), {
          tokenHash: `none-${randomUUID()}`,
          createdAt: AT,
          expiresAt: LATER,
        }),
      ).toBeNull();
    });
  });
}
