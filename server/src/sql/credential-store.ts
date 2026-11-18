import { GUID } from "../domain/guid.js";
import type { ApiTokenRecord, CredentialStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import { isoOf } from "./values.js";

/** A GUID as stored (lower-case); null for a value that is not a GUID, which no row can have. */
const key = (id: string): string | null => (GUID.test(id) ? id.toLowerCase() : null);

interface TokenRow {
  id: string;
  creator_id: string;
  project_id: string | null;
  name: string;
  last_four: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

const recordOf = (row: TokenRow): ApiTokenRecord => ({
  id: row.id,
  creatorId: row.creator_id,
  projectId: row.project_id,
  name: row.name,
  lastFour: row.last_four,
  createdAt: isoOf(row.created_at),
  lastUsedAt: row.last_used_at === null ? null : isoOf(row.last_used_at),
  revokedAt: row.revoked_at === null ? null : isoOf(row.revoked_at),
});

/**
 * The API tokens in the database's `api_tokens` table. The legacy access keys belong to the hosted
 * provider (hosted Step 8): here no user has one.
 */
export function createSqlCredentialStore(database: SqlDatabase): CredentialStore {
  const { db } = database;

  return {
    createApiToken: async (token, hash) => {
      const id = key(token.id);
      const creatorId = key(token.creatorId);
      const projectId = token.projectId === null ? null : key(token.projectId);
      if (id === null || creatorId === null) throw new Error("Token and creator ids must be GUIDs");
      if (token.projectId !== null && projectId === null)
        throw new Error("A project id must be a GUID");
      await db
        .insertInto("api_tokens")
        .values({
          id,
          creator_id: creatorId,
          project_id: projectId,
          name: token.name,
          token_hash: hash,
          last_four: token.lastFour,
          created_at: isoOf(token.createdAt),
          last_used_at: null,
          revoked_at: null,
        })
        .execute();
    },
    findApiToken: async (hash) => {
      const row = await db
        .selectFrom("api_tokens")
        .selectAll()
        .where("token_hash", "=", hash)
        .executeTakeFirst();
      return row ? recordOf(row) : null;
    },
    listApiTokens: async (scope) => {
      const owner = "creatorId" in scope ? key(scope.creatorId) : key(scope.projectId);
      if (owner === null) return [];
      let query = db.selectFrom("api_tokens").selectAll().where("revoked_at", "is", null);
      query =
        "creatorId" in scope
          ? query.where("creator_id", "=", owner).where("project_id", "is", null)
          : query.where("project_id", "=", owner);
      const rows = await query.execute();
      // Sorted here, as the other stores do: ISO text and GUIDs compare the same in both dialects.
      return rows.map(recordOf).sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
    },
    revokeApiToken: async (id, at) => {
      const tokenId = key(id);
      if (tokenId === null) return false;
      const revoked = await db
        .updateTable("api_tokens")
        .set({ revoked_at: isoOf(at) })
        .where("id", "=", tokenId)
        .where("revoked_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      return revoked !== undefined;
    },
    replaceApiTokenHash: async (id, hash, lastFour) => {
      const tokenId = key(id);
      if (tokenId === null) return false;
      const replaced = await db
        .updateTable("api_tokens")
        .set({ token_hash: hash, last_four: lastFour })
        .where("id", "=", tokenId)
        .where("revoked_at", "is", null)
        .returning("id")
        .executeTakeFirst();
      return replaced !== undefined;
    },
    touchApiToken: async (id, at) => {
      const tokenId = key(id);
      if (tokenId === null) return;
      await db
        .updateTable("api_tokens")
        .set({ last_used_at: isoOf(at) })
        .where("id", "=", tokenId)
        .execute();
    },
    revokeApiTokensOfCreator: async (userId, at) => {
      const creatorId = key(userId);
      if (creatorId === null) return 0;
      const revoked = await db
        .updateTable("api_tokens")
        .set({ revoked_at: isoOf(at) })
        .where("creator_id", "=", creatorId)
        .where("revoked_at", "is", null)
        .returning("id")
        .execute();
      return revoked.length;
    },
    revokeApiTokensOfProject: async (projectId, at) => {
      const id = key(projectId);
      if (id === null) return 0;
      const revoked = await db
        .updateTable("api_tokens")
        .set({ revoked_at: isoOf(at) })
        .where("project_id", "=", id)
        .where("revoked_at", "is", null)
        .returning("id")
        .execute();
      return revoked.length;
    },
    findLegacyKey: () => Promise.resolve(null),
    legacyKeyOf: () => Promise.resolve(null),
    revokeLegacyKey: () => Promise.resolve(false),
  };
}
