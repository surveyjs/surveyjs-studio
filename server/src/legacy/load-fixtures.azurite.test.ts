import { TableClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import { beforeAll, describe, expect, it } from "vitest";
import { readLegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { loadLegacyFixtures, type LegacyEnv, type LoadSummary } from "./load-fixtures.js";

/**
 * Needs the local replica: `pnpm demo:azurite:up` (or at least the containers), then
 * `pnpm vitest run --root . server/src/legacy/load-fixtures.azurite.test.ts`.
 * Reads docker/azurite.env unless the variables are already set.
 */
async function replicaEnv(): Promise<LegacyEnv> {
  const { parseEnv } = await import("node:util");
  const { readFile } = await import("node:fs/promises");
  const file = parseEnv(
    await readFile(new URL("../../../docker/azurite.env", import.meta.url), "utf8"),
  );
  const names = [
    "LEGACY_SQL_CONNECTION_STRING",
    "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  ];
  return Object.fromEntries(names.map((name) => [name, process.env[name] ?? file[name]]));
}

describe("legacy fixture loader against the local replica", () => {
  let env: LegacyEnv;
  let first: LoadSummary;
  let second: LoadSummary;

  beforeAll(async () => {
    env = await replicaEnv();
    const quiet = { log: () => undefined };
    first = await loadLegacyFixtures(env, quiet);
    second = await loadLegacyFixtures(env, quiet);
  }, 120_000);

  it("gives the same counts when loaded twice", () => {
    expect(second).toEqual(first);
  });

  it("keeps Edm.Guid and Edm.DateTime on result entities", async () => {
    const fixtures = await readLegacyFixtures();
    const table = fixtures.tables.find(
      (t) => t.account === "results" && /^post(?!delete)/.test(t.name),
    );
    expect(table).toBeDefined();
    const client = TableClient.fromConnectionString(
      env.LEGACY_RESULTS_STORAGE_CONNECTION_STRING ?? "",
      table!.name,
      { allowInsecureConnection: true },
    );
    const raw = table!.entities[0]!;
    const entity = await client.getEntity("*", String(raw.RowKey), {
      disableTypeConversion: true,
    });
    // disableTypeConversion keeps each property as { value, type } with the stored Edm type.
    const stored = entity as Record<string, { value: unknown; type: string }>;
    expect(stored.id?.type).toBe("Guid");
    expect(stored.happendat?.type).toBe("DateTime");
    expect(String(stored.id?.value).toLowerCase()).toBe(String(raw.id).toLowerCase());
    // A boolean stays a boolean.
    const partial = table!.entities.find((e) => e.ispartialcompleted !== undefined)!;
    const partialEntity = await client.getEntity("*", String(partial.RowKey), {
      disableTypeConversion: true,
    });
    expect((partialEntity as Record<string, unknown>).ispartialcompleted).toEqual({
      value: "true",
      type: "Boolean",
    });
  });

  it("writes history blobs as append blobs at surveyjsonhistory/{surveyId}/{pointId}", async () => {
    const fixtures = await readLegacyFixtures();
    const history = fixtures.blobs.find((b) => b.container === "surveyjsonhistory");
    expect(history?.name).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const blob = BlobServiceClient.fromConnectionString(
      env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING ?? "",
    )
      .getContainerClient("surveyjsonhistory")
      .getBlobClient(history!.name);
    const properties = await blob.getProperties();
    expect(properties.blobType).toBe("AppendBlob");
    expect(properties.contentLength).toBe(history!.content.length);
  });

  it("loads the fixture Surveys rows into SQL with typed columns", async () => {
    const fixtures = await readLegacyFixtures();
    const pool = await sql.connect(env.LEGACY_SQL_CONNECTION_STRING ?? "");
    try {
      const count = await pool.request().query("SELECT COUNT(*) AS n FROM Surveys");
      expect(count.recordset[0].n).toBe(fixtures.rawSqlRows.Surveys?.length);
      const row = fixtures.rawSqlRows.Surveys![0]!;
      const read = await pool
        .request()
        .input("id", sql.UniqueIdentifier, row.id)
        .query("SELECT createdat, id FROM Surveys WHERE id = @id");
      expect((read.recordset[0].createdat as Date).toISOString()).toBe(
        new Date(String(row.createdat)).toISOString(),
      );
    } finally {
      await pool.close();
    }
  });
});
