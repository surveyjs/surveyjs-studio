import { decideAccountChange, nextStatus } from "../admin/rules.js";
import { GUID } from "../domain/guid.js";
import type { User } from "../domain/types.js";
import type {
  LocalAccount,
  IdentityLink,
  LocalAccountStore,
  NewLocalAccount,
  PasswordLinkPurpose,
  UserDirectory,
} from "./types.js";

interface StoredAccount extends Omit<LocalAccount, "user"> {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
}

interface StoredLink {
  readonly userId: string;
  readonly purpose: PasswordLinkPurpose;
  readonly expiresAt: string;
  used: boolean;
}

export interface MemoryLocalAccounts {
  readonly accounts: LocalAccountStore;
  /** The local user directory over the same accounts. */
  readonly users: UserDirectory;
  /** The user of an id at once, for the memory provider's project rules (which are synchronous). */
  findUser(id: string): User | undefined;
}

const userOf = (stored: StoredAccount): User => ({
  id: stored.id,
  email: stored.email,
  displayName: stored.displayName,
  blocked: stored.status === "disabled",
});

const accountOf = (stored: StoredAccount): LocalAccount => ({
  user: userOf(stored),
  instanceRole: stored.instanceRole,
  status: stored.status,
  passwordHash: stored.passwordHash,
  mustChangePassword: stored.mustChangePassword,
  sessionEpoch: stored.sessionEpoch,
  lastSignInAt: stored.lastSignInAt,
  createdAt: stored.createdAt,
});

/** The seed's accounts were made at this time, as in the SQL seed (sql/seed.ts). */
const SEED_CREATED_AT = "2025-01-01T00:00:00.000Z";

/**
 * Local accounts in process memory (USER_DIRECTORY=local with STORAGE_PROVIDER=memory). The seed
 * users become active accounts without a password (a blocked one disabled), and `seedAdmins` active
 * instance admins without one, as in the SQL seed.
 */
export function createMemoryLocalAccounts(
  seedUsers: readonly User[] = [],
  seedAdmins: readonly User[] = [],
): MemoryLocalAccounts {
  const byId = new Map<string, StoredAccount>();
  const links = new Map<string, StoredLink>();
  const identities = new Map<string, IdentityLink>();
  const identityKey = (provider: string, subject: string): string =>
    JSON.stringify([provider, subject]);
  const seeded = [
    ...seedUsers.map((user) => ({ user, instanceRole: "user" as const })),
    ...seedAdmins.map((user) => ({ user, instanceRole: "admin" as const })),
  ];
  for (const { user, instanceRole } of seeded) {
    const id = user.id.toLowerCase();
    byId.set(id, {
      id,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      instanceRole,
      status: user.blocked ? "disabled" : "active",
      passwordHash: null,
      mustChangePassword: false,
      sessionEpoch: 0,
      lastSignInAt: null,
      createdAt: SEED_CREATED_AT,
    });
  }

  const find = (id: string): StoredAccount | undefined =>
    GUID.test(id) ? byId.get(id.toLowerCase()) : undefined;
  const findByEmail = (email: string): StoredAccount | undefined => {
    const wanted = email.toLowerCase();
    return wanted.trim() === "" ? undefined : [...byId.values()].find((a) => a.email === wanted);
  };

  const activeAdmins = () =>
    [...byId.values()].filter((a) => a.instanceRole === "admin" && a.status === "active").length;

  /** Stores the hash, activates an invited account and raises the epoch; null for no account. */
  const setPassword = (id: string, passwordHash: string, mustChange: boolean): number | null => {
    const found = find(id);
    if (!found) return null;
    const updated: StoredAccount = {
      ...found,
      passwordHash,
      mustChangePassword: mustChange,
      status: found.status === "invited" ? "active" : found.status,
      sessionEpoch: found.sessionEpoch + 1,
    };
    byId.set(found.id, updated);
    return updated.sessionEpoch;
  };

  const accounts: LocalAccountStore = {
    countAccounts: () => Promise.resolve(byId.size),
    countActiveAdmins: () => Promise.resolve(activeAdmins()),
    createAccount: (account: NewLocalAccount) => {
      const id = account.id.toLowerCase();
      if (!GUID.test(id)) return Promise.reject(new Error("Account ids must be GUIDs"));
      if (byId.has(id) || findByEmail(account.email)) {
        return Promise.reject(new Error("An account with this id or email exists"));
      }
      const stored: StoredAccount = {
        id,
        email: account.email.toLowerCase(),
        displayName: account.displayName,
        instanceRole: account.instanceRole,
        status: account.status,
        passwordHash: account.passwordHash,
        mustChangePassword: account.mustChangePassword,
        sessionEpoch: 0,
        lastSignInAt: null,
        createdAt: account.createdAt,
      };
      byId.set(id, stored);
      return Promise.resolve(accountOf(stored));
    },
    account: (id) => {
      const found = find(id);
      return Promise.resolve(found ? accountOf(found) : null);
    },
    accountByEmail: (email) => {
      const found = findByEmail(email);
      return Promise.resolve(found ? accountOf(found) : null);
    },
    listAccounts: () =>
      Promise.resolve(
        [...byId.values()]
          .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0))
          .map(accountOf),
      ),
    updateAccount: (id, change) => {
      const found = find(id);
      if (!found) return Promise.resolve({ outcome: "not-found" as const });
      const after = {
        instanceRole: change.instanceRole ?? found.instanceRole,
        status: nextStatus(
          found.status,
          change.status,
          found.passwordHash !== null ||
            [...identities.values()].some((link) => link.userId === found.id),
        ),
      };
      if (decideAccountChange(found, after, activeAdmins()) === "last-instance-admin") {
        return Promise.resolve({ outcome: "last-instance-admin" as const });
      }
      const disabling = after.status === "disabled" && found.status !== "disabled";
      const updated: StoredAccount = {
        ...found,
        ...after,
        sessionEpoch: found.sessionEpoch + (disabling ? 1 : 0),
      };
      byId.set(found.id, updated);
      return Promise.resolve({ outcome: "updated" as const, account: accountOf(updated) });
    },
    accountByIdentity: (provider, subject) => {
      const link = identities.get(identityKey(provider, subject));
      const found = link ? find(link.userId) : undefined;
      return Promise.resolve(found ? accountOf(found) : null);
    },
    linkIdentity: (link) => {
      const userId = link.userId.toLowerCase();
      if (!GUID.test(userId)) return Promise.reject(new Error("Account ids must be GUIDs"));
      const identity = identityKey(link.provider, link.subject);
      if (identities.has(identity)) return Promise.resolve("taken" as const);
      identities.set(identity, {
        ...link,
        userId,
        email: link.email === null ? null : link.email.toLowerCase(),
      });
      return Promise.resolve("linked" as const);
    },
    deleteAccount: (id) => {
      const found = find(id);
      if (!found) return Promise.resolve("not-found" as const);
      if (decideAccountChange(found, null, activeAdmins()) === "last-instance-admin") {
        return Promise.resolve("last-instance-admin" as const);
      }
      byId.delete(found.id);
      for (const [tokenHash, link] of links) if (link.userId === found.id) links.delete(tokenHash);
      for (const [identity, link] of identities) {
        if (link.userId === found.id) identities.delete(identity);
      }
      return Promise.resolve("deleted" as const);
    },
    resetPassword: (id, { tokenHash, expiresAt }) => {
      const found = find(id);
      if (!found) return Promise.resolve(null);
      for (const link of links.values()) if (link.userId === found.id) link.used = true;
      const purpose: PasswordLinkPurpose = found.status === "invited" ? "invitation" : "reset";
      links.set(tokenHash, { userId: found.id, purpose, expiresAt, used: false });
      const updated: StoredAccount = {
        ...found,
        passwordHash: null,
        mustChangePassword: false,
        sessionEpoch: found.sessionEpoch + 1,
      };
      byId.set(found.id, updated);
      return Promise.resolve(updated.sessionEpoch);
    },
    setPassword: (id, passwordHash, { mustChange }) =>
      Promise.resolve(setPassword(id, passwordHash, mustChange)),
    recordSignIn: (id, at) => {
      const found = find(id);
      if (found) byId.set(found.id, { ...found, lastSignInAt: at });
      return Promise.resolve();
    },
    createPasswordLink: ({ tokenHash, userId, purpose, expiresAt }) => {
      links.set(tokenHash, { userId: userId.toLowerCase(), purpose, expiresAt, used: false });
      return Promise.resolve();
    },
    usePasswordLink: (tokenHash, at, passwordHash) => {
      const link = links.get(tokenHash);
      if (!link || link.used || Date.parse(link.expiresAt) <= Date.parse(at)) {
        return Promise.resolve(null);
      }
      const epoch = setPassword(link.userId, passwordHash, false);
      if (epoch === null) return Promise.resolve(null);
      link.used = true;
      return Promise.resolve({ userId: link.userId, epoch });
    },
  };

  const users: UserDirectory = {
    kind: "local",
    getUser: (id) => {
      const found = find(id);
      return Promise.resolve(found ? userOf(found) : null);
    },
    findUserByEmail: (email) => {
      const found = findByEmail(email);
      return Promise.resolve(found ? userOf(found) : null);
    },
    // Password sign-in does not go through claims; an OAuth2 identity links here in Step 8.
    signInUser: (claims) => {
      const found = find(claims.sub);
      return Promise.resolve(found ? userOf(found) : null);
    },
    missingUsers: (ids) => {
      const asked = [...new Set(ids.filter((id) => GUID.test(id)).map((id) => id.toLowerCase()))];
      return Promise.resolve(asked.filter((id) => !byId.has(id)));
    },
  };

  return {
    accounts,
    users,
    findUser: (id) => {
      const found = find(id);
      return found ? userOf(found) : undefined;
    },
  };
}
