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
