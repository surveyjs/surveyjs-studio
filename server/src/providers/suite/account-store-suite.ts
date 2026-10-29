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

    it("notes the last sign-in", async () => {
      const account = await store.accounts.createAccount(newAccount());
      await store.accounts.recordSignIn(account.user.id, AT);
      expect((await store.accounts.account(account.user.id))?.lastSignInAt).toBe(AT);
    });

    it("uses a set-password link once, and not after it expired", async () => {
      const account = await store.accounts.createAccount(newAccount());
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
      expect(await store.accounts.usePasswordLink(once, AT)).toBe(account.user.id);
      expect(await store.accounts.usePasswordLink(once, AT)).toBeNull();
      const expired = `expired-${randomUUID()}`;
      await link(expired, AT);
      expect(await store.accounts.usePasswordLink(expired, LATER)).toBeNull();
      expect(await store.accounts.usePasswordLink(`unknown-${randomUUID()}`, AT)).toBeNull();
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
        store.accounts.usePasswordLink(tokenHash, AT),
        store.accounts.usePasswordLink(tokenHash, AT),
        store.accounts.usePasswordLink(tokenHash, AT),
      ]);
      expect(uses.filter((use) => use !== null)).toEqual([account.user.id]);
    });
  });
}
