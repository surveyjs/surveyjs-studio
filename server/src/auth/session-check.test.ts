import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors.js";
import { createMemoryLocalAccounts } from "../providers/memory-accounts.js";
import type { NewLocalAccount } from "../providers/types.js";
import { createSessionCheck } from "./session-check.js";

const account = (over: Partial<NewLocalAccount> = {}): NewLocalAccount => ({
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

async function codeOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
}

describe("createSessionCheck", () => {
  it("lets a session of an active account with its epoch through", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const created = await accounts.createAccount(account());
    const check = createSessionCheck({ accounts });
    expect(await codeOf(check.check({ sub: created.user.id, epoch: 0 }, "listSurveys"))).toBeNull();
  });

  it("ends the sessions of an older epoch, a disabled account and an unknown one", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const changed = await accounts.createAccount(account());
    await accounts.setPassword(changed.user.id, "$argon2id$y", { mustChange: false });
    const disabled = await accounts.createAccount(account({ status: "disabled" }));
    const check = createSessionCheck({ accounts });
    expect(await codeOf(check.check({ sub: changed.user.id, epoch: 0 }, "listSurveys"))).toBe(
      "unauthenticated",
    );
    expect(await codeOf(check.check({ sub: changed.user.id, epoch: 1 }, "listSurveys"))).toBeNull();
    expect(await codeOf(check.check({ sub: disabled.user.id, epoch: 0 }, "listSurveys"))).toBe(
      "unauthenticated",
    );
    expect(await codeOf(check.check({ sub: randomUUID(), epoch: 0 }, "listSurveys"))).toBe(
      "unauthenticated",
    );
  });

  it("reads a session without an epoch (another sign-in method) as epoch 0", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const created = await accounts.createAccount(account());
    const check = createSessionCheck({ accounts });
    expect(await codeOf(check.check({ sub: created.user.id }, "listSurveys"))).toBeNull();
  });

  it("keeps a must-change session to getting the user, changing the password and signing out", async () => {
    const { accounts } = createMemoryLocalAccounts();
    const created = await accounts.createAccount(account({ mustChangePassword: true }));
    const check = createSessionCheck({ accounts });
    const session = { sub: created.user.id, epoch: 0 };
    for (const allowed of ["getCurrentUser", "changeOwnPassword", "logout"]) {
      expect(await codeOf(check.check(session, allowed))).toBeNull();
    }
    expect(await codeOf(check.check(session, "listSurveys"))).toBe("password-change-required");
  });

  it("caches an answer for at most a minute, and forgets a user at once when asked", async () => {
    let now = 0;
    const { accounts } = createMemoryLocalAccounts();
    const created = await accounts.createAccount(account());
    const check = createSessionCheck({ accounts, now: () => now });
    const session = { sub: created.user.id, epoch: 0 };
    expect(await codeOf(check.check(session, "listSurveys"))).toBeNull();
    await accounts.setPassword(created.user.id, "$argon2id$z", { mustChange: false });
    // Within the cache window another server's change is not seen yet...
    now += 59_000;
    expect(await codeOf(check.check(session, "listSurveys"))).toBeNull();
    // ...after it, it is.
    now += 2_000;
    expect(await codeOf(check.check(session, "listSurveys"))).toBe("unauthenticated");
    // This server's own change is seen at once.
    const other = await accounts.createAccount(account());
    const otherSession = { sub: other.user.id, epoch: 0 };
    expect(await codeOf(check.check(otherSession, "listSurveys"))).toBeNull();
    await accounts.setPassword(other.user.id, "$argon2id$w", { mustChange: false });
    check.forget(other.user.id);
    expect(await codeOf(check.check(otherSession, "listSurveys"))).toBe("unauthenticated");
  });
});
