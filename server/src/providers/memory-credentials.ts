import { hashCredential, lastFour as lastFourOf } from "../credentials/format.js";
import type { ApiTokenRecord, CredentialStore } from "./types.js";

/** Ids are GUIDs: stored lower-case, looked up case-insensitively. */
const lower = (id: string): string => id.toLowerCase();

interface StoredToken {
  record: ApiTokenRecord;
  hash: string;
}

interface StoredLegacyKey {
  readonly hash: string;
  readonly lastFour: string;
  revoked: boolean;
}

export interface MemoryCredentials {
  readonly store: CredentialStore;
  /** Test and seed hook: gives the user this legacy key (replacing any earlier one). */
  seedLegacyKey(userId: string, key: string): void;
}

/**
 * In-memory credentials. `seedKeys` maps a user id to that user's legacy access key;
 * `revokedUsers` are the users among them whose key is revoked.
 */
export function createMemoryCredentials(
  seedKeys: Readonly<Record<string, string>> = {},
  revokedUsers: readonly string[] = [],
): MemoryCredentials {
  const tokens: StoredToken[] = [];
  /** Per user, oldest first: the last is the user's key; a replaced key stays, revoked. */
  const keys = new Map<string, StoredLegacyKey[]>();
  const seedLegacyKey = (userId: string, key: string): void => {
    keys.set(lower(userId), [
      {
        hash: hashCredential(key, "legacy-key"),
        lastFour: lastFourOf(key.toLowerCase()),
        revoked: false,
      },
    ]);
  };
  const newest = (userId: string): StoredLegacyKey | undefined => keys.get(lower(userId))?.at(-1);
  for (const [userId, key] of Object.entries(seedKeys)) seedLegacyKey(userId, key);
  for (const userId of revokedUsers) {
    const key = newest(userId);
    if (key) key.revoked = true;
  }

  const byId = (id: string) => tokens.find((t) => t.record.id === lower(id));
  const revokeAll = (matches: (t: ApiTokenRecord) => boolean, at: string): number => {
    let count = 0;
    for (const t of tokens) {
      if (t.record.revokedAt === null && matches(t.record)) {
        t.record = { ...t.record, revokedAt: at };
        count++;
      }
    }
    return count;
  };

  const store: CredentialStore = {
    createApiToken: (token, hash) => {
      tokens.push({
        record: {
          ...token,
          id: lower(token.id),
          creatorId: lower(token.creatorId),
          projectId: token.projectId === null ? null : lower(token.projectId),
          lastUsedAt: null,
          revokedAt: null,
        },
        hash,
      });
      return Promise.resolve();
    },
    findApiToken: (hash) => {
      const found = tokens.find((t) => t.hash === hash);
      return Promise.resolve(found ? { ...found.record } : null);
    },
    getApiToken: (id) => {
      const found = byId(id);
      return Promise.resolve(found ? { ...found.record } : null);
    },
    listApiTokens: (scope) => {
      const creator = "creatorId" in scope ? lower(scope.creatorId) : null;
      const project = "projectId" in scope ? lower(scope.projectId) : null;
      return Promise.resolve(
        tokens
          .map((t) => t.record)
          .filter((r) => r.revokedAt === null)
          .filter((r) =>
            creator !== null
              ? r.creatorId === creator && r.projectId === null
              : r.projectId === project,
          )
          .sort((a, b) =>
            a.createdAt === b.createdAt
              ? a.id.localeCompare(b.id)
              : a.createdAt < b.createdAt
                ? 1
                : -1,
          )
          .map((r) => ({ ...r })),
      );
    },
    revokeApiToken: (id, at) => {
      const found = byId(id);
      if (!found || found.record.revokedAt !== null) return Promise.resolve(false);
      found.record = { ...found.record, revokedAt: at };
      return Promise.resolve(true);
    },
    replaceApiTokenHash: (id, hash, lastFour) => {
      const found = byId(id);
      if (!found || found.record.revokedAt !== null) return Promise.resolve(false);
      found.hash = hash;
      found.record = { ...found.record, lastFour };
      return Promise.resolve(true);
    },
    touchApiToken: (id, at) => {
      const found = byId(id);
      if (found) found.record = { ...found.record, lastUsedAt: at };
      return Promise.resolve();
    },
    revokeApiTokensOfCreator: (userId, at) =>
      Promise.resolve(revokeAll((r) => r.creatorId === lower(userId), at)),
    revokeApiTokensOfProject: (projectId, at) =>
      Promise.resolve(revokeAll((r) => r.projectId === lower(projectId), at)),
    findLegacyKey: (value) => {
      const hash = hashCredential(value, "legacy-key");
      for (const [userId, rows] of keys) {
        const row = rows.find((r) => r.hash === hash);
        if (row) return Promise.resolve({ userId, revoked: row.revoked });
      }
      return Promise.resolve(null);
    },
    legacyKeyOf: (userId) => {
      const key = newest(userId);
      return Promise.resolve(key ? { lastFour: key.lastFour, revoked: key.revoked } : null);
    },
    revokeLegacyKey: (userId) => {
      const rows = keys.get(lower(userId));
      if (!rows?.length) return Promise.resolve(false);
      for (const row of rows) row.revoked = true;
      return Promise.resolve(true);
    },
    replaceLegacyKey: (userId, expectedHash, hash, lastFour) => {
      const key = keys.get(lower(userId))?.find((r) => r.hash === expectedHash);
      if (!key || key.revoked) return Promise.resolve(false);
      key.revoked = true;
      keys.get(lower(userId))!.push({ hash, lastFour, revoked: false });
      return Promise.resolve(true);
    },
  };
  return { store, seedLegacyKey };
}
