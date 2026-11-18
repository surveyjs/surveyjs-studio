import { hashCredential } from "../credentials/format.js";
import { lastFour as lastFourOf } from "../credentials/format.js";
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
  /** The hash of the key that was revoked: a different key for the same user is not revoked. */
  revokedHash: string | null;
}

export interface MemoryCredentials {
  readonly store: CredentialStore;
  /** Test and seed hook: gives the user this legacy key (replacing any earlier one). */
  seedLegacyKey(userId: string, key: string): void;
}

/** In-memory credentials. `seedKeys` maps a user id to that user's legacy access key. */
export function createMemoryCredentials(
  seedKeys: Readonly<Record<string, string>> = {},
): MemoryCredentials {
  const tokens: StoredToken[] = [];
  const keys = new Map<string, StoredLegacyKey>();
  const seedLegacyKey = (userId: string, key: string): void => {
    keys.set(lower(userId), {
      hash: hashCredential(key, "legacy-key"),
      lastFour: lastFourOf(key.toLowerCase()),
      revokedHash: null,
    });
  };
  for (const [userId, key] of Object.entries(seedKeys)) seedLegacyKey(userId, key);

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
      for (const [userId, key] of keys) {
        if (key.hash === hash)
          return Promise.resolve({ userId, revoked: key.revokedHash === hash });
      }
      return Promise.resolve(null);
    },
    legacyKeyOf: (userId) => {
      const key = keys.get(lower(userId));
      return Promise.resolve(
        key ? { lastFour: key.lastFour, revoked: key.revokedHash === key.hash } : null,
      );
    },
    revokeLegacyKey: (userId, _at) => {
      const key = keys.get(lower(userId));
      if (!key) return Promise.resolve(false);
      key.revokedHash = key.hash;
      return Promise.resolve(true);
    },
  };
  return { store, seedLegacyKey };
}
