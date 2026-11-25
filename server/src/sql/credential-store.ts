import { hashCredential } from "../credentials/format.js";
import { sql, type Transaction } from "kysely";
import { GUID } from "../domain/guid.js";
import type { ApiTokenRecord, CredentialStore } from "../providers/types.js";
import type { SqlDatabase } from "./database.js";
import type { DatabaseSchema } from "./schema.js";
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
 * The API tokens in the database's `api_tokens` table and the legacy access keys in
 * `legacy_access_keys` (a user's key is their newest row; a replace names the key it replaces).
 */
export function createSqlCredentialStore(database: SqlDatabase): CredentialStore {
  const { db } = database;

  /**
   * Serializes a revoke and a replace for one user. PostgreSQL runs transactions concurrently, so
   * they take an advisory lock held to the end of the transaction; SQLite allows one writer at a
   * time, so its write transactions already run one after the other and need no lock.
   */
  const lockUser = async (trx: Transaction<DatabaseSchema>, userId: string): Promise<void> => {
    if (database.dialect === "postgres")
      await sql`select pg_advisory_xact_lock(hashtext(${userId}))`.execute(trx);
  };

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
    getApiToken: async (id) => {
      const tokenId = key(id);
      if (tokenId === null) return null;
      const row = await db
        .selectFrom("api_tokens")
        .selectAll()
        .where("id", "=", tokenId)
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
    findLegacyKey: async (value) => {
      const row = await db
        .selectFrom("legacy_access_keys")
        .select(["user_id", "revoked_at"])
        .where("key_hash", "=", hashCredential(value, "legacy-key"))
        .executeTakeFirst();
      return row ? { userId: row.user_id, revoked: row.revoked_at !== null } : null;
    },
    legacyKeyOf: async (userId) => {
      const id = key(userId);
      if (id === null) return null;
      const row = await db
        .selectFrom("legacy_access_keys")
        .selectAll()
        .where("user_id", "=", id)
        .orderBy("created_at", "desc")
        .orderBy("key_hash", "desc")
        .limit(1)
        .executeTakeFirst();
      return row ? { lastFour: row.last_four, revoked: row.revoked_at !== null } : null;
    },
    revokeLegacyKey: async (userId, at) => {
      const id = key(userId);
      if (id === null) return false;
      return db.transaction().execute(async (trx) => {
        await lockUser(trx, id);
        // Every unrevoked row, so a replace that committed first leaves no working key behind.
        await trx
          .updateTable("legacy_access_keys")
          .set({ revoked_at: isoOf(at) })
          .where("user_id", "=", id)
          .where("revoked_at", "is", null)
          .execute();
        // True when the user has a key at all, an already revoked one too.
        const any = await trx
          .selectFrom("legacy_access_keys")
          .select("key_hash")
          .where("user_id", "=", id)
          .limit(1)
          .executeTakeFirst();
        return any !== undefined;
      });
    },
    replaceLegacyKey: async (userId, expectedHash, hash, lastFour, at) => {
      const id = key(userId);
      if (id === null) return false;
      return db.transaction().execute(async (trx) => {
        await lockUser(trx, id);
        // The update is the guard: the key that signed the request must still be unrevoked.
        const revoked = await trx
          .updateTable("legacy_access_keys")
          .set({ revoked_at: isoOf(at) })
          .where("key_hash", "=", expectedHash)
          .where("user_id", "=", id)
          .where("revoked_at", "is", null)
          .returning("key_hash")
          .executeTakeFirst();
        if (!revoked) return false;
        await trx
          .insertInto("legacy_access_keys")
          .values({
            key_hash: hash,
            user_id: id,
            last_four: lastFour,
            created_at: isoOf(at),
            revoked_at: null,
          })
          .execute();
        return true;
      });
    },
  };
}
