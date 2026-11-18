import { odata, type TableClient } from "@azure/data-tables";
import sql from "mssql";
import { hashCredential, lastFour as lastFourOf } from "../../credentials/format.js";
import type { ApiTokenRecord, CredentialStore } from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import { isGuid } from "./mapping.js";
import {
  REVOKED_KEY_PARTITION,
  TOKENS_PARTITION,
  creatorIndex,
  idRow,
  projectIndex,
  recordRow,
  writeApiTokenCreation,
  writeApiTokenHashReplacement,
  writeApiTokenRevocation,
  writeApiTokenRevocations,
  writeApiTokenUse,
  writeLegacyKeyRevocation,
} from "./writes.js";

/** The site's `accesskey` column is varchar(200). */
const MAX_KEY_LENGTH = 200;

interface TokenEntity {
  id: string;
  creatorId: string;
  projectId: string;
  name: string;
  lastFour: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string;
}

const recordOf = (entity: TokenEntity): ApiTokenRecord => ({
  id: entity.id,
  creatorId: entity.creatorId,
  projectId: entity.projectId === "" ? null : entity.projectId,
  name: entity.name,
  lastFour: entity.lastFour,
  createdAt: entity.createdAt,
  lastUsedAt: entity.lastUsedAt === "" ? null : entity.lastUsedAt,
  revokedAt: entity.revokedAt === "" ? null : entity.revokedAt,
});

/** Newest first, then by id. */
const newestFirst = (a: ApiTokenRecord, b: ApiTokenRecord): number =>
  a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1;

/**
 * API tokens and the site's access keys (hosted Step 3, ADR 0037). Tokens live in a table of our
 * own in the surveys account, in one partition (records by hash, rows by id, creator and project
 * indexes: see writes.ts), and revoked site keys as `legacyrevoked/{hash}` entries; the site's key
 * itself is only read from its users, never written. Reads here, writes in writes.ts.
 */
export function createAzureCredentialStore(options: {
  readonly table: TableClient;
  /** One parameterised SELECT against the site's database. */
  readonly select: <T>(
    operation: string,
    text: string,
    bind: (request: sql.Request) => sql.Request,
  ) => Promise<T[]>;
}): CredentialStore {
  const { table, select } = options;

  /** The entity, or undefined when it or the table is missing. */
  async function entityOf<T extends object>(
    partition: string,
    row: string,
    operation: string,
  ): Promise<(T & { etag: string }) | undefined> {
    try {
      return await table.getEntity<T>(partition, row);
    } catch (error) {
      if (statusOf(error) === 404) return undefined;
      throw new LegacyStoreError(operation, error);
    }
  }

  async function findApiToken(hash: string): Promise<ApiTokenRecord | null> {
    const entity = await entityOf<TokenEntity>(
      TOKENS_PARTITION,
      recordRow(hash),
      "api token lookup",
    );
    return entity ? recordOf(entity) : null;
  }

  interface IndexRow {
    readonly id: string;
    readonly hash: string;
    /** Creator index rows only. */
    readonly projectId?: string;
  }

  /** The rows of one list index: the row keys that start with `prefix` (built from a GUID). */
  async function indexed(prefix: string): Promise<IndexRow[]> {
    // The first key after every key with this prefix: its last character, one higher.
    const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
    const found: IndexRow[] = [];
    try {
      const rows = table.listEntities<IndexRow>({
        queryOptions: {
          filter: odata`PartitionKey eq ${TOKENS_PARTITION} and RowKey ge ${prefix} and RowKey lt ${end}`,
        },
      });
      for await (const row of rows) found.push(row);
    } catch (error) {
      if (statusOf(error) === 404) return [];
      throw new LegacyStoreError("api token list", error);
    }
    return found;
  }

  /**
   * The token's record. An index row and the record it names change in one transaction, but this
   * reads them apart: when a replace moved the record in between, the id row names its new hash.
   */
  async function currentRecord(row: IndexRow): Promise<ApiTokenRecord | null> {
    let hash = row.hash;
    for (let attempt = 0; attempt < 3; attempt++) {
      const record = await findApiToken(hash);
      if (record !== null) return record;
      const entry = await entityOf<{ hash: string }>(
        TOKENS_PARTITION,
        idRow(row.id),
        "api token list",
      );
      if (entry === undefined || entry.hash === hash) return null;
      hash = entry.hash;
    }
    return null;
  }

  /** The token ids a list index holds. */
  async function idsOf(prefix: string): Promise<string[]> {
    return (await indexed(prefix)).map((row) => row.id);
  }

  /** The site user's key (lower case) and revocation state; null when the user has no key. */
  async function keyOf(userId: string): Promise<{ key: string; revoked: boolean } | null> {
    if (!isGuid(userId)) return null;
    const rows = await select<{ accesskey: string | null }>(
      "access key lookup",
      "SELECT accesskey FROM Users WHERE id = @id",
      (request) => request.input("id", sql.UniqueIdentifier, userId),
    );
    const key = rows[0]?.accesskey?.toLowerCase();
    if (!key) return null;
    return { key, revoked: await isRevoked(hashCredential(key, "legacy-key")) };
  }

  async function isRevoked(hash: string): Promise<boolean> {
    return (
      (await entityOf(REVOKED_KEY_PARTITION, hash, "legacy key revocation lookup")) !== undefined
    );
  }

  return {
    createApiToken: (token, hash) => writeApiTokenCreation(table, token, hash),

    findApiToken,

    async listApiTokens(scope) {
      const creator = "creatorId" in scope;
      const owner = creator ? scope.creatorId : scope.projectId;
      if (!isGuid(owner)) return [];
      const rows = await indexed(creator ? creatorIndex(owner) : projectIndex(owner));
      const records = await Promise.all(
        // A creator's own list leaves out the project tokens the creator made.
        rows.filter((row) => !creator || !row.projectId).map(currentRecord),
      );
      return records
        .filter((record): record is ApiTokenRecord => record !== null && record.revokedAt === null)
        .sort(newestFirst);
    },

    // Token ids are GUIDs; any other id names no token (and could not be a row key).
    revokeApiToken: (id, at) =>
      isGuid(id) ? writeApiTokenRevocation(table, id, at) : Promise.resolve(false),
    replaceApiTokenHash: (id, hash, lastFour) =>
      isGuid(id) ? writeApiTokenHashReplacement(table, id, hash, lastFour) : Promise.resolve(false),
    touchApiToken: (id, at) => (isGuid(id) ? writeApiTokenUse(table, id, at) : Promise.resolve()),
    async revokeApiTokensOfCreator(userId, at) {
      if (!isGuid(userId)) return 0;
      return writeApiTokenRevocations(table, await idsOf(creatorIndex(userId)), at);
    },
    async revokeApiTokensOfProject(projectId, at) {
      if (!isGuid(projectId)) return 0;
      return writeApiTokenRevocations(table, await idsOf(projectIndex(projectId)), at);
    },

    async findLegacyKey(value) {
      // The site keeps keys in lower case and the replica's collation ignores case; the exact
      // comparison below does not depend on the collation (SQL Server also ignores trailing spaces).
      const wanted = value.toLowerCase();
      if (wanted === "" || wanted.length > MAX_KEY_LENGTH) return null;
      const rows = await select<{ id: string; accesskey: string | null }>(
        "access key owner lookup",
        "SELECT id, accesskey FROM Users WHERE accesskey = @key",
        (request) => request.input("key", sql.VarChar(MAX_KEY_LENGTH), wanted),
      );
      const found = rows.find((row) => row.accesskey?.toLowerCase() === wanted);
      if (!found) return null;
      return {
        userId: found.id.toLowerCase(),
        revoked: await isRevoked(hashCredential(wanted, "legacy-key")),
      };
    },

    async legacyKeyOf(userId) {
      const own = await keyOf(userId);
      return own ? { lastFour: lastFourOf(own.key), revoked: own.revoked } : null;
    },

    async revokeLegacyKey(userId, at) {
      const own = await keyOf(userId);
      if (!own) return false;
      await writeLegacyKeyRevocation(table, hashCredential(own.key, "legacy-key"), userId, at);
      return true;
    },
  };
}
