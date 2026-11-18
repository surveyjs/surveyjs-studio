import { randomUUID } from "node:crypto";
import sql from "mssql";
import type { TableClient } from "@azure/data-tables";
import { describe, expect, it } from "vitest";
import { hashCredential } from "../credentials/format.js";
import { localTableClient } from "../legacy/local-clients.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureCredentialStore } from "./azure-legacy/credentials.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import { describeCredentialStoreSuite } from "./suite/credential-store-suite.js";
import { describeLicenceNoticeSuite } from "./suite/licence-notice-suite.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

// Runs in the `providers-azurite` Vitest project: `pnpm test:providers:azurite`. Its global setup
// loads the golden fixtures into the local replica first.
describeProviderSuite("azure-legacy (local replica)", () =>
  Promise.resolve(createAzureLegacyProviders(replicaConfig())),
);

describeLicenceNoticeSuite("azure-legacy (local replica)", (now) =>
  Promise.resolve(
    createAzureLegacyProviders(replicaConfig(), { accountNotices: "surveyjs-licenses", now }),
  ),
);

// The suite's users are random ids, so the helper gives each seeded key a Users row of its own on
// the replica (test code only: the replica config is local by construction, and the fixtures are
// reloaded afterwards). Production code never writes the site's key.
describeCredentialStoreSuite("azure-legacy (local replica)", async () => {
  const config = replicaConfig();
  const providers = createAzureLegacyProviders(config);
  const pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
  return {
    store: providers.credentials,
    seedsLegacyKeys: true,
    seedLegacyKey: async (userId, key) => {
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, userId)
        .input("key", sql.VarChar(200), key.toLowerCase())
        .query(
          "MERGE Users AS u USING (SELECT @id AS id) AS s ON u.id = s.id " +
            "WHEN MATCHED THEN UPDATE SET accesskey = @key " +
            "WHEN NOT MATCHED THEN INSERT (id, blocked, accesskey) VALUES (@id, 0, @key);",
        );
    },
    newProjectId: () => Promise.resolve(randomUUID()),
    close: async () => {
      try {
        await providers.close();
        await pool.close();
      } finally {
        await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
      }
    },
  };
});

describe("azure-legacy access keys (local replica)", () => {
  // The replica answers by its collation; the production answer is recorded in the private notes.
  it("finds a fixture user's key given in upper case exactly when the collation ignores case", async () => {
    const config = replicaConfig();
    const pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
    try {
      const collation = (
        await pool
          .request()
          .query<{ c: string }>(
            "SELECT CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS varchar(100)) AS c",
          )
      ).recordset[0]?.c;
      const found = await pool
        .request()
        .input("key", sql.VarChar(200), "ACCESS-KEY-1")
        .query<{ id: string }>("SELECT id FROM Users WHERE accesskey = @key");
      expect(found.recordset.length > 0).toBe(/_CI_/i.test(collation ?? ""));
    } finally {
      await pool.close();
    }
  });
});

describe("azure-legacy token revoke and replace races (local replica)", () => {
  const config = replicaConfig();
  const tableOf = () =>
    localTableClient(
      config.surveysStorageConnectionString,
      "mysurveysapitokens",
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    );
  const select = () => Promise.reject(new Error("no SQL in these tests"));
  const AT = "2026-11-02T10:00:00.000Z";
  const hashOf = () => hashCredential(`sjs_${randomUUID()}`, "api-token");
  const token = (creatorId: string, projectId: string | null = null) => ({
    id: randomUUID(),
    creatorId,
    projectId,
    name: "race",
    lastFour: "abcd",
    createdAt: "2026-11-01T10:00:00.000Z",
  });

  /** The table, with `hook` run (once) before the first call of `method` that matches. */
  function interleaved(
    method: string,
    matches: (args: unknown[]) => boolean,
    hook: () => Promise<void>,
  ): TableClient {
    const table = tableOf();
    let done = false;
    return new Proxy(table, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        // Only the watched method becomes async (listEntities returns an iterator, not a promise).
        if (property !== method) return fn.bind(target);
        return async (...args: unknown[]) => {
          if (property === method && !done && matches(args)) {
            done = true;
            await hook();
          }
          return fn.apply(target, args);
        };
      },
    });
  }

  it("a revoke landing between replace's read and its delete leaves no live token", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const oldHash = hashOf();
    const newHash = hashOf();
    await plain.createApiToken(t, oldHash);
    const racing = createAzureCredentialStore({
      table: interleaved(
        "deleteEntity",
        (args) => args[1] === oldHash,
        async () => {
          // The id entry already points at the new record, which this revoke claims.
          expect(await plain.revokeApiToken(t.id, AT)).toBe(true);
        },
      ),
      select,
    });
    expect(await racing.replaceApiTokenHash(t.id, newHash, "new1")).toBe(false);
    expect((await plain.findApiToken(newHash))?.revokedAt).not.toBeNull();
    expect(await plain.findApiToken(oldHash)).toBeNull();
    expect(await plain.listApiTokens({ creatorId: t.creatorId })).toEqual([]);
  });

  it("a revoke of the old hash landing before replace swaps the id entry revokes the new one too", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const oldHash = hashOf();
    const newHash = hashOf();
    await plain.createApiToken(t, oldHash);
    const racing = createAzureCredentialStore({
      table: interleaved(
        "upsertEntity",
        (args) => (args[0] as { partitionKey: string }).partitionKey === "id",
        async () => {
          expect(await plain.revokeApiToken(t.id, AT)).toBe(true);
        },
      ),
      select,
    });
    expect(await racing.replaceApiTokenHash(t.id, newHash, "new1")).toBe(false);
    expect(await plain.findApiToken(newHash)).toMatchObject({ revokedAt: AT });
    expect(await plain.findApiToken(oldHash)).toBeNull();
  });

  it("once a revoke returned true, the old hash is revoked too, whatever a replace in flight does next", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const oldHash = hashOf();
    const newHash = hashOf();
    await plain.createApiToken(t, oldHash);
    let revoked = false;
    let oldAfterRevoke: Awaited<ReturnType<typeof plain.findApiToken>> = null;
    const racing = createAzureCredentialStore({
      table: interleaved(
        "deleteEntity",
        (args) => args[1] === oldHash,
        async () => {
          // The new record is written and the old one not yet deleted.
          revoked = await plain.revokeApiToken(t.id, AT);
          oldAfterRevoke = await plain.findApiToken(oldHash);
        },
      ),
      select,
    });
    expect(await racing.replaceApiTokenHash(t.id, newHash, "new1")).toBe(false);
    expect(revoked).toBe(true);
    expect(oldAfterRevoke).toMatchObject({ revokedAt: AT });
    expect((await plain.findApiToken(newHash))?.revokedAt).not.toBeNull();
    expect(await plain.listApiTokens({ creatorId: t.creatorId })).toEqual([]);
  });

  it("a replace recovers a token a crashed replace left in REPLACING", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const [oldHash, midHash, finalHash] = [hashOf(), hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    const crashing = createAzureCredentialStore({
      table: interleaved(
        "upsertEntity",
        (args) =>
          (args[0] as { partitionKey: string }).partitionKey !== "token" &&
          (args[0] as { hash?: string }).hash === midHash,
        () => Promise.reject(new Error("process died after the delete")),
      ),
      select,
    });
    await expect(crashing.replaceApiTokenHash(t.id, midHash, "mid1")).rejects.toThrow();
    // Old hash dead, the token unusable but not live under either hash.
    expect(await plain.findApiToken(oldHash)).toBeNull();
    expect((await plain.findApiToken(midHash))?.revokedAt).not.toBeNull();
    expect(await plain.replaceApiTokenHash(t.id, finalHash, "fin1")).toBe(true);
    expect(await plain.findApiToken(finalHash)).toMatchObject({
      revokedAt: null,
      lastFour: "fin1",
    });
    expect(await plain.findApiToken(midHash)).toBeNull();
  });

  it("a bulk revoke that meets a concurrent replace still revokes the token under its new hash", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const creatorId = randomUUID();
    const a = token(creatorId);
    const b = token(creatorId, randomUUID());
    const [hashA, hashB, newA] = [hashOf(), hashOf(), hashOf()];
    await plain.createApiToken(a, hashA);
    await plain.createApiToken(b, hashB);
    const racing = createAzureCredentialStore({
      table: interleaved(
        "getEntity",
        (args) => args[0] === "token" && args[1] === hashA,
        async () => {
          expect(await plain.replaceApiTokenHash(a.id, newA, "new1")).toBe(true);
        },
      ),
      select,
    });
    expect(await racing.revokeApiTokensOfCreator(creatorId, AT)).toBe(2);
    expect(await plain.findApiToken(newA)).toMatchObject({ revokedAt: AT });
    expect(await plain.findApiToken(hashB)).toMatchObject({ revokedAt: AT });
    expect(await plain.findApiToken(hashA)).toBeNull();
  });
});
