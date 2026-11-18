import { randomUUID } from "node:crypto";
import sql from "mssql";
import { describe, expect, it } from "vitest";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
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
