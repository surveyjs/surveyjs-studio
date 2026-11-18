import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRecord, User } from "../domain/types.js";
import { AppError } from "../errors.js";
import { createMemoryCredentials } from "../providers/memory-credentials.js";
import { createMemoryLocalAccounts } from "../providers/memory-accounts.js";
import type { CredentialStore, NewLocalAccount, UserDirectory } from "../providers/types.js";
import { hashCredential, lastFour, newApiTokenValue } from "./format.js";
import { createOwnerCheck } from "./owner-check.js";
import { createBearerResolver } from "./resolve.js";

const T0 = Date.parse("2026-11-18T10:00:00.000Z");

/** A directory over a mutable map: tests change a user between requests. */
function directory(...users: User[]) {
  const byId = new Map(users.map((user) => [user.id, user]));
  const getUser = vi.fn((id: string) => Promise.resolve(byId.get(id.toLowerCase()) ?? null));
  const users_: UserDirectory = {
    kind: "external",
    getUser,
    findUserByEmail: () => Promise.resolve(null),
    signInUser: () => Promise.resolve(null),
    missingUsers: () => Promise.resolve([]),
  };
  return { users: users_, getUser, set: (user: User) => byId.set(user.id, user) };
}

const user = (over: Partial<User> = {}): User => ({
  id: randomUUID(),
  email: "owner@example.com",
  displayName: "Owner",
  blocked: false,
  ...over,
});

async function storeToken(
  credentials: CredentialStore,
  creatorId: string,
  projectId: string | null = null,
): Promise<{ id: string; value: string }> {
  const value = newApiTokenValue();
  const id = randomUUID();
  await credentials.createApiToken(
    {
      id,
      creatorId,
      projectId,
      name: "CI",
      lastFour: lastFour(value),
      createdAt: "2026-11-18T09:00:00.000Z",
    },
    hashCredential(value, "api-token"),
  );
  return { id, value };
}

async function codeOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
}

function setup(...users: User[]) {
  let now = T0;
  const clock = { now: () => now, advance: (ms: number) => (now += ms) };
  const dir = directory(...users);
  const { store, seedLegacyKey } = createMemoryCredentials();
  const warn = vi.fn();
  /** The ids of the projects that exist. */
  const projectIds = new Set<string>();
  const resolver = createBearerResolver({
    credentials: store,
    projects: {
      getProject: (id) => Promise.resolve(projectIds.has(id) ? ({ id } as ProjectRecord) : null),
    },
    owners: createOwnerCheck({ users: dir.users, accounts: null, now: clock.now }),
    now: clock.now,
    log: { warn },
  });
  return { clock, dir, store, seedLegacyKey, resolver, warn, projectIds };
}

describe("createBearerResolver", () => {
  it("resolves a Personal API token to its creator with the personal scope", async () => {
    const owner = user();
    const { store, resolver } = setup(owner);
    const token = await storeToken(store, owner.id);
    expect(await resolver.resolve(token.value)).toEqual({
      id: owner.id,
      displayName: "Owner",
      email: "owner@example.com",
      avatarUrl: null,
      scope: { kind: "personal" },
      credential: { kind: "api-token", id: token.id },
    });
  });

  it("resolves a project token even when its creator is not a member", async () => {
    // Project tokens belong to the project (ADR 0037): membership is not checked here.
    const owner = user();
    const projectId = randomUUID();
    const { store, resolver, projectIds } = setup(owner);
    projectIds.add(projectId);
    const token = await storeToken(store, owner.id, projectId);
    const resolved = await resolver.resolve(token.value);
    expect(resolved.id).toBe(owner.id);
    expect(resolved.scope).toEqual({ kind: "project", projectId });
  });

  it("refuses a project token whose project no longer exists, though it was never revoked", async () => {
    const owner = user();
    const projectId = randomUUID();
    const { store, resolver, projectIds } = setup(owner);
    projectIds.add(projectId);
    const token = await storeToken(store, owner.id, projectId);
    expect((await resolver.resolve(token.value)).id).toBe(owner.id);
    projectIds.delete(projectId);
    expect(await codeOf(resolver.resolve(token.value))).toBe("unauthenticated");
  });

  it("resolves a legacy key to its owner with the scope of everything, in any letter case", async () => {
    const owner = user();
    const { seedLegacyKey, resolver } = setup(owner);
    const key = "0123456789abcdef0123456789abcdef";
    seedLegacyKey(owner.id, key);
    expect(await resolver.resolve(key.toUpperCase())).toEqual({
      id: owner.id,
      displayName: "Owner",
      email: "owner@example.com",
      avatarUrl: null,
      scope: { kind: "all" },
      credential: { kind: "legacy-key" },
    });
  });

  it("refuses unknown, revoked and malformed values with 401", async () => {
    const owner = user();
    const { store, seedLegacyKey, resolver } = setup(owner);
    const revoked = await storeToken(store, owner.id);
    await store.revokeApiToken(revoked.id, "2026-11-18T09:30:00.000Z");
    seedLegacyKey(owner.id, "fedcba9876543210fedcba9876543210");
    await store.revokeLegacyKey(owner.id, "2026-11-18T09:30:00.000Z");
    for (const value of [
      newApiTokenValue(),
      revoked.value,
      "fedcba9876543210fedcba9876543210",
      "0123456789abcdef0123456789abcdef",
      "sjs_short",
      "",
    ]) {
      expect(await codeOf(resolver.resolve(value)), value).toBe("unauthenticated");
    }
  });

  it("refuses a token whose revocation is not a date (any non-null mark)", async () => {
    const owner = user();
    const value = newApiTokenValue();
    const credentials = createMemoryCredentials().store;
    const marked = createBearerResolver({
      credentials: {
        ...credentials,
        findApiToken: () =>
          Promise.resolve({
            id: randomUUID(),
            creatorId: owner.id,
            projectId: null,
            name: "CI",
            lastFour: lastFour(value),
            createdAt: "2026-11-18T09:00:00.000Z",
            lastUsedAt: null,
            revokedAt: "replaced",
          }),
      },
      projects: { getProject: () => Promise.resolve(null) },
      owners: createOwnerCheck({ users: directory(owner).users, accounts: null }),
    });
    expect(await codeOf(marked.resolve(value))).toBe("unauthenticated");
  });

  it("refuses the credentials of an unknown or blocked owner", async () => {
    const blocked = user({ blocked: true });
    const { store, seedLegacyKey, resolver } = setup(blocked);
    const token = await storeToken(store, blocked.id);
    const orphan = await storeToken(store, randomUUID());
    seedLegacyKey(blocked.id, "0123456789abcdef0123456789abcdef");
    expect(await codeOf(resolver.resolve(token.value))).toBe("unauthenticated");
    expect(await codeOf(resolver.resolve(orphan.value))).toBe("unauthenticated");
    expect(await codeOf(resolver.resolve("0123456789abcdef0123456789abcdef"))).toBe(
      "unauthenticated",
    );
  });

  it("reuses the owner check for at most 60 seconds", async () => {
    const owner = user();
    const { clock, dir, store, resolver } = setup(owner);
    const token = await storeToken(store, owner.id);
    expect(await codeOf(resolver.resolve(token.value))).toBeNull();
    dir.set({ ...owner, blocked: true });
    clock.advance(59_000);
    expect(await codeOf(resolver.resolve(token.value))).toBeNull();
    clock.advance(1_000);
    expect(await codeOf(resolver.resolve(token.value))).toBe("unauthenticated");
    // A refusal is cached too, and ends with the cache.
    dir.set(owner);
    expect(await codeOf(resolver.resolve(token.value))).toBe("unauthenticated");
    clock.advance(60_000);
    expect(await codeOf(resolver.resolve(token.value))).toBeNull();
    expect(dir.getUser).toHaveBeenCalledTimes(3);
  });

  it("writes last used at most once a minute per token", async () => {
    const owner = user();
    const { clock, store, resolver } = setup(owner);
    const touch = vi.spyOn(store, "touchApiToken");
    const first = await storeToken(store, owner.id);
    const second = await storeToken(store, owner.id);
    await resolver.resolve(first.value);
    clock.advance(30_000);
    await resolver.resolve(first.value);
    await resolver.resolve(second.value);
    expect(touch.mock.calls).toEqual([
      [first.id, "2026-11-18T10:00:00.000Z"],
      [second.id, "2026-11-18T10:00:30.000Z"],
    ]);
    clock.advance(30_000);
    await resolver.resolve(first.value);
    expect(touch).toHaveBeenLastCalledWith(first.id, "2026-11-18T10:01:00.000Z");
    expect(touch).toHaveBeenCalledTimes(3);
  });

  it("logs a failed last-used write and still authenticates", async () => {
    const owner = user();
    const { store, resolver, warn } = setup(owner);
    vi.spyOn(store, "touchApiToken").mockRejectedValue(new Error("storage down"));
    const token = await storeToken(store, owner.id);
    expect((await resolver.resolve(token.value)).id).toBe(owner.id);
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token.value);
  });

  it("does not write last used for a legacy key", async () => {
    const owner = user();
    const { store, seedLegacyKey, resolver } = setup(owner);
    const touch = vi.spyOn(store, "touchApiToken");
    seedLegacyKey(owner.id, "0123456789abcdef0123456789abcdef");
    await resolver.resolve("0123456789abcdef0123456789abcdef");
    expect(touch).not.toHaveBeenCalled();
  });
});

describe("createOwnerCheck with local accounts", () => {
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

  it("lets an active account through and refuses a disabled or invited one", async () => {
    const { accounts, users } = createMemoryLocalAccounts();
    const active = await accounts.createAccount(account());
    const disabled = await accounts.createAccount(account({ status: "disabled" }));
    const invited = await accounts.createAccount(
      account({ status: "invited", passwordHash: null }),
    );
    const check = createOwnerCheck({ users, accounts });
    expect((await check.owner(active.user.id)).displayName).toBe("Local");
    expect(await codeOf(check.owner(disabled.user.id))).toBe("unauthenticated");
    expect(await codeOf(check.owner(invited.user.id))).toBe("unauthenticated");
    expect(await codeOf(check.owner(randomUUID()))).toBe("unauthenticated");
  });

  it("sees a disabled account within 60 seconds", async () => {
    const { accounts, users } = createMemoryLocalAccounts();
    const created = await accounts.createAccount(account());
    let now = T0;
    const check = createOwnerCheck({ users, accounts, now: () => now });
    expect(await codeOf(check.owner(created.user.id))).toBeNull();
    await accounts.updateAccount(created.user.id, { status: "disabled" });
    now += 30_000;
    expect(await codeOf(check.owner(created.user.id))).toBeNull();
    now += 30_000;
    expect(await codeOf(check.owner(created.user.id))).toBe("unauthenticated");
  });
});
