import { randomUUID } from "node:crypto";
import sql from "mssql";
import type { TableClient } from "@azure/data-tables";
import { describe, expect, it } from "vitest";
import { hashCredential } from "../credentials/format.js";
import { localTableClient } from "../legacy/local-clients.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureCredentialStore } from "./azure-legacy/credentials.js";
import { readLegacyFixtures } from "./azure-legacy/fixtures.js";
import { createAzureLegacyProviders } from "./azure-legacy/index.js";
import { createStubShareReader } from "./azure-legacy/legacy-shares-stub.js";
import { describeCredentialStoreSuite } from "./suite/credential-store-suite.js";
import { describeLicenceNoticeSuite } from "./suite/licence-notice-suite.js";
import { surveyCampaign, surveyFeedback } from "./suite/expected.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

// Runs in the `providers-azurite` Vitest project: `pnpm test:providers:azurite`. Its global setup
// loads the golden fixtures into the local replica first. Azurite has no file service: the legacy
// file shares are a stub over the fixtures' share files.
describeProviderSuite("azure-legacy (local replica)", async () =>
  createAzureLegacyProviders(replicaConfig(), {
    legacyShares: createStubShareReader((await readLegacyFixtures()).files),
  }),
);

describe("azure-legacy private questions of the fixtures (local replica)", () => {
  it("reads fixture 01 by the old rule: with both settings, the submit time and id join", async () => {
    const providers = createAzureLegacyProviders(replicaConfig());
    try {
      expect(await providers.views.getPrivateQuestions(surveyFeedback.id)).toEqual([
        "receipt",
        "HappendAt",
        "InstanceId",
      ]);
      expect(await providers.views.getResultsPrivacy!(surveyFeedback.id)).toEqual({
        privateQuestions: ["receipt", "HappendAt", "InstanceId"],
        publicOnly: ["satisfaction"],
        lockedQuestions: [],
      });
      expect(await providers.views.getPrivateQuestions(surveyCampaign.id)).toEqual([]);
    } finally {
      await providers.close();
    }
  });
});

describeLicenceNoticeSuite("azure-legacy (local replica)", (now) =>
  Promise.resolve(
    createAzureLegacyProviders(replicaConfig(), { accountNotices: "surveyjs-licenses", now }),
  ),
);

// The suite's users are random ids, so the helper gives each seeded key a site user row of its own on
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

describe("azure-legacy token writes under concurrency (local replica)", () => {
  const config = replicaConfig();
  const tableOf = () =>
    localTableClient(
      config.surveysStorageConnectionString,
      "mysurveysapitokens",
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    );
  const select = () => Promise.reject(new Error("no SQL in these tests"));
  const AT = "2026-11-02T10:00:00.000Z";
  const LATER = "2026-11-03T10:00:00.000Z";
  const hashOf = () => hashCredential(`sjs_${randomUUID()}`, "api-token");
  const token = (creatorId: string, projectId: string | null = null) => ({
    id: randomUUID(),
    creatorId,
    projectId,
    name: "race",
    lastFour: "abcd",
    createdAt: "2026-11-01T10:00:00.000Z",
  });

  /** The table, with `hook` run (once) before the `nth` call of `method` (a name or several) that matches. */
  function interleaved(
    method: string | string[],
    matches: (args: unknown[]) => boolean,
    hook: () => Promise<void>,
    nth = 1,
  ): TableClient {
    const table = tableOf();
    const methods = Array.isArray(method) ? method : [method];
    let done = false;
    let seen = 0;
    return new Proxy(table, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (typeof value !== "function") return value;
        const fn = value as (...args: unknown[]) => unknown;
        // Only the watched method becomes async (listEntities returns an iterator, not a promise).
        if (typeof property !== "string" || !methods.includes(property)) return fn.bind(target);
        return async (...args: unknown[]) => {
          if (!done && matches(args) && ++seen === nth) {
            done = true;
            await hook();
          }
          return fn.apply(target, args);
        };
      },
    });
  }

  /** Every table call that writes: the hook runs before the first write of the store under test. */
  const WRITES = [
    "createEntity",
    "upsertEntity",
    "updateEntity",
    "deleteEntity",
    "submitTransaction",
  ];
  const anyCall = () => true;
  type Store = ReturnType<typeof createAzureCredentialStore>;
  const authenticates = async (store: Store, hash: string): Promise<boolean> =>
    (await store.findApiToken(hash))?.revokedAt === null;

  it("two concurrent replaces both succeed one after the other: only the last value authenticates", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const [oldHash, hashA, hashB] = [hashOf(), hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    let second: boolean | undefined;
    const first = createAzureCredentialStore({
      // The first replace has read the token; the second one runs to the end before it writes.
      table: interleaved(WRITES, anyCall, async () => {
        second = await plain.replaceApiTokenHash(t.id, hashB, "bbbb");
      }),
      select,
    });
    expect(await first.replaceApiTokenHash(t.id, hashA, "aaaa")).toBe(true);
    expect(second).toBe(true);
    expect(await plain.findApiToken(oldHash)).toBeNull();
    expect(await plain.findApiToken(hashB)).toBeNull();
    expect(await plain.findApiToken(hashA)).toMatchObject({
      id: t.id,
      lastFour: "aaaa",
      revokedAt: null,
    });
    const listed = await plain.listApiTokens({ creatorId: t.creatorId });
    expect(listed.map((r) => [r.id, r.lastFour])).toEqual([[t.id, "aaaa"]]);
    expect(await plain.revokeApiToken(t.id, AT)).toBe(true);
    expect(await authenticates(plain, hashA)).toBe(false);
  });

  it("replaces running at once all succeed and leave exactly one value that authenticates", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const oldHash = hashOf();
    await plain.createApiToken(t, oldHash);
    const hashes = [hashOf(), hashOf(), hashOf(), hashOf()];
    const results = await Promise.all(
      hashes.map((hash, i) =>
        createAzureCredentialStore({ table: tableOf(), select }).replaceApiTokenHash(
          t.id,
          hash,
          `ccc${i}`,
        ),
      ),
    );
    expect(results).toEqual([true, true, true, true]);
    expect(await plain.findApiToken(oldHash)).toBeNull();
    const found = (await Promise.all(hashes.map((hash) => plain.findApiToken(hash)))).filter(
      (record) => record !== null,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: t.id, revokedAt: null });
    const listed = await plain.listApiTokens({ creatorId: t.creatorId });
    expect(listed.map((r) => r.lastFour)).toEqual([found[0]?.lastFour]);
  });

  it("a revoke between replace's reads and its write: the replace answers false and nothing authenticates", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const [oldHash, newHash] = [hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    let revoked: boolean | undefined;
    const racing = createAzureCredentialStore({
      table: interleaved(WRITES, anyCall, async () => {
        revoked = await plain.revokeApiToken(t.id, AT);
      }),
      select,
    });
    expect(await racing.replaceApiTokenHash(t.id, newHash, "new1")).toBe(false);
    expect(revoked).toBe(true);
    expect(await plain.findApiToken(oldHash)).toMatchObject({ id: t.id, revokedAt: AT });
    expect(await plain.findApiToken(newHash)).toBeNull();
    expect(await plain.listApiTokens({ creatorId: t.creatorId })).toEqual([]);
  });

  it("a replace between revoke's reads and its write: the revoke reaches the new value", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const [oldHash, newHash] = [hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    let replaced: boolean | undefined;
    const racing = createAzureCredentialStore({
      table: interleaved(WRITES, anyCall, async () => {
        replaced = await plain.replaceApiTokenHash(t.id, newHash, "new1");
      }),
      select,
    });
    expect(await racing.revokeApiToken(t.id, AT)).toBe(true);
    expect(replaced).toBe(true);
    expect(await plain.findApiToken(oldHash)).toBeNull();
    expect(await plain.findApiToken(newHash)).toMatchObject({ lastFour: "new1", revokedAt: AT });
    expect(await plain.revokeApiToken(t.id, LATER)).toBe(false);
    expect(await plain.replaceApiTokenHash(t.id, hashOf(), "zzzz")).toBe(false);
  });

  it("a bulk revoke during a replace leaves no value that authenticates", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const creatorId = randomUUID();
    const t = token(creatorId, randomUUID());
    const [oldHash, newHash] = [hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    let count: number | undefined;
    const racing = createAzureCredentialStore({
      table: interleaved(WRITES, anyCall, async () => {
        count = await plain.revokeApiTokensOfCreator(creatorId, AT);
      }),
      select,
    });
    expect(await racing.replaceApiTokenHash(t.id, newHash, "new1")).toBe(false);
    expect(count).toBe(1);
    expect(await authenticates(plain, oldHash)).toBe(false);
    expect(await plain.findApiToken(newHash)).toBeNull();
    expect(await plain.listApiTokens({ projectId: t.projectId as string })).toEqual([]);
  });

  it("a replace during a bulk revoke: the token is revoked under its new value", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const projectId = randomUUID();
    const a = token(randomUUID(), projectId);
    const b = token(randomUUID(), projectId);
    const [hashA, hashB, newA, newB] = [hashOf(), hashOf(), hashOf(), hashOf()];
    await plain.createApiToken(a, hashA);
    await plain.createApiToken(b, hashB);
    const replaced: boolean[] = [];
    const racing = createAzureCredentialStore({
      // The bulk revoke has listed both tokens and read the first one it revokes.
      table: interleaved(WRITES, anyCall, async () => {
        replaced.push(await plain.replaceApiTokenHash(a.id, newA, "new1"));
        replaced.push(await plain.replaceApiTokenHash(b.id, newB, "new2"));
      }),
      select,
    });
    expect(await racing.revokeApiTokensOfProject(projectId, AT)).toBe(2);
    expect(replaced).toEqual([true, true]);
    expect(await plain.findApiToken(hashA)).toBeNull();
    expect(await plain.findApiToken(hashB)).toBeNull();
    expect(await plain.findApiToken(newA)).toMatchObject({ revokedAt: AT });
    expect(await plain.findApiToken(newB)).toMatchObject({ revokedAt: AT });
    expect(await plain.listApiTokens({ projectId })).toEqual([]);
  });

  it("a transaction that fails before it is sent leaves the token at its old value", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID());
    const [oldHash, newHash] = [hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    const failing = createAzureCredentialStore({
      table: interleaved("submitTransaction", anyCall, () =>
        Promise.reject(new Error("connection lost")),
      ),
      select,
    });
    await expect(failing.replaceApiTokenHash(t.id, newHash, "new1")).rejects.toThrow();
    expect(await plain.findApiToken(oldHash)).toMatchObject({ lastFour: "abcd", revokedAt: null });
    expect(await plain.findApiToken(newHash)).toBeNull();
    const listed = await plain.listApiTokens({ creatorId: t.creatorId });
    expect(listed.map((r) => r.lastFour)).toEqual(["abcd"]);
    expect(await plain.replaceApiTokenHash(t.id, newHash, "new1")).toBe(true);
    expect(await plain.findApiToken(oldHash)).toBeNull();
  });

  it("a transaction the table refuses leaves the token at its old value, every write undone", async () => {
    const plain = createAzureCredentialStore({ table: tableOf(), select });
    const t = token(randomUUID(), randomUUID());
    const [oldHash, newHash] = [hashOf(), hashOf()];
    await plain.createApiToken(t, oldHash);
    const failing = createAzureCredentialStore({
      // A record already sits at the new hash, so the transaction's insert fails after its delete
      // of the old record: the service undoes the whole transaction.
      table: interleaved("submitTransaction", anyCall, async () => {
        await tableOf().createEntity({
          partitionKey: "apitokens",
          rowKey: `hash-${newHash}`,
          id: randomUUID(),
          revokedAt: AT,
        });
      }),
      select,
    });
    await expect(failing.replaceApiTokenHash(t.id, newHash, "new1")).rejects.toThrow();
    expect(await plain.findApiToken(oldHash)).toMatchObject({ lastFour: "abcd", revokedAt: null });
    const listed = await plain.listApiTokens({ projectId: t.projectId as string });
    expect(listed.map((r) => r.lastFour)).toEqual(["abcd"]);
    expect(await plain.revokeApiToken(t.id, AT)).toBe(true);
    expect(await plain.findApiToken(oldHash)).toMatchObject({ revokedAt: AT });
  });
});

describe("azure-legacy legacy files (local replica)", () => {
  it("reads no share on the replica, which has no file service: every legacy name is unknown", async () => {
    const providers = createAzureLegacyProviders(replicaConfig());
    try {
      expect(
        await providers.files.getFileByLegacyName("asset", "99999999-0000-4000-8000-a00000000001"),
      ).toBeNull();
      expect(
        await providers.files.getFileByLegacyName(
          "response",
          "99999999-0000-4000-8000-a00000000002.png",
        ),
      ).toBeNull();
    } finally {
      await providers.close();
    }
  });
});
