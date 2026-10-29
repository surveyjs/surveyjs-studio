import { GUID } from "../domain/guid.js";
import type { User } from "../domain/types.js";
import type {
  LocalAccount,
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
});

/**
 * Local accounts in process memory (USER_DIRECTORY=local with STORAGE_PROVIDER=memory). The seed
 * users become active accounts without a password (a blocked one disabled), as in the SQL seed.
 */
export function createMemoryLocalAccounts(seedUsers: readonly User[] = []): MemoryLocalAccounts {
  const byId = new Map<string, StoredAccount>();
  const links = new Map<string, StoredLink>();
  for (const user of seedUsers) {
    const id = user.id.toLowerCase();
    byId.set(id, {
      id,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      instanceRole: "user",
      status: user.blocked ? "disabled" : "active",
      passwordHash: null,
      mustChangePassword: false,
      sessionEpoch: 0,
      lastSignInAt: null,
    });
  }

  const find = (id: string): StoredAccount | undefined =>
    GUID.test(id) ? byId.get(id.toLowerCase()) : undefined;
  const findByEmail = (email: string): StoredAccount | undefined => {
    const wanted = email.toLowerCase();
    return wanted.trim() === "" ? undefined : [...byId.values()].find((a) => a.email === wanted);
  };

  const accounts: LocalAccountStore = {
    countAccounts: () => Promise.resolve(byId.size),
    countActiveAdmins: () =>
      Promise.resolve(
        [...byId.values()].filter((a) => a.instanceRole === "admin" && a.status === "active")
          .length,
      ),
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
    setPassword: (id, passwordHash, { mustChange }) => {
      const found = find(id);
      if (!found) return Promise.resolve(null);
      const updated: StoredAccount = {
        ...found,
        passwordHash,
        mustChangePassword: mustChange,
        status: found.status === "invited" ? "active" : found.status,
        sessionEpoch: found.sessionEpoch + 1,
      };
      byId.set(found.id, updated);
      return Promise.resolve(updated.sessionEpoch);
    },
    recordSignIn: (id, at) => {
      const found = find(id);
      if (found) byId.set(found.id, { ...found, lastSignInAt: at });
      return Promise.resolve();
    },
    createPasswordLink: ({ tokenHash, userId, purpose, expiresAt }) => {
      links.set(tokenHash, { userId: userId.toLowerCase(), purpose, expiresAt, used: false });
      return Promise.resolve();
    },
    usePasswordLink: (tokenHash, at) => {
      const link = links.get(tokenHash);
      if (!link || link.used || Date.parse(link.expiresAt) <= Date.parse(at)) {
        return Promise.resolve(null);
      }
      link.used = true;
      return Promise.resolve(link.userId);
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
