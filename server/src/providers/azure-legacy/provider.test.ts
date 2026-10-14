import { afterAll, describe, expect, it } from "vitest";
import type { LegacyConfig } from "../../config.js";
import { createAzureLegacyProviders } from "./index.js";

// Nothing listens on port 1: any call that reached SQL or storage would fail.
const SECRET = "Unreachable-Secret-77";
const STORAGE =
  `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=${Buffer.from(SECRET).toString("base64")};` +
  "BlobEndpoint=http://127.0.0.1:1/devstoreaccount1;TableEndpoint=http://127.0.0.1:1/devstoreaccount1;";
const unreachable: LegacyConfig = {
  sqlConnectionString: `Server=127.0.0.1,1;Database=d;User Id=sa;Password=${SECRET};Connect Timeout=2`,
  surveysStorageConnectionString: STORAGE,
  resultsStorageConnectionString: STORAGE,
};

describe("azure-legacy provider without a reachable store", () => {
  const providers = createAzureLegacyProviders(unreachable, { readyTimeoutMs: 3_000 });
  afterAll(() => providers.close());

  it.each(["", "survey-1", "not-a-guid", "12345678-1234-1234-1234-1234567890a", "' OR 1=1 --"])(
    "answers a non-GUID id %j without a query",
    async (id) => {
      expect(await providers.surveys.getSurvey(id)).toBeNull();
      expect(await providers.surveys.listSurveys({ kind: "personal", userId: id })).toEqual([]);
      expect(await providers.surveys.listSurveys({ kind: "project", projectId: id })).toEqual([]);
      expect(await providers.directory.getUser(id)).toBeNull();
      expect(await providers.directory.listUserProjects(id)).toEqual([]);
    },
  );

  it("answers an empty or over-long email without a query", async () => {
    expect(await providers.directory.findUserByEmail("")).toBeNull();
    expect(await providers.directory.findUserByEmail(`${"a".repeat(200)}@example.com`)).toBeNull();
  });

  it("ready resolves false instead of throwing", async () => {
    expect(await providers.ready()).toBe(false);
  });

  it("reports a failed query without any connection-string value", async () => {
    const error = await providers.surveys.getSurvey("22222222-0000-4000-8000-000000000001").then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^Legacy SQL survey lookup failed/);
    expect(message).not.toContain("127.0.0.1");
    expect(message).not.toContain(SECRET);
    expect((error as Error).cause).toBeUndefined();
  });

  it("names the variable, not the value, for an invalid storage connection string", () => {
    const create = () =>
      createAzureLegacyProviders({
        ...unreachable,
        resultsStorageConnectionString: `nonsense ${SECRET}`,
      });
    expect(create).toThrow(/LEGACY_RESULTS_STORAGE_CONNECTION_STRING/);
    expect(create).not.toThrow(new RegExp(SECRET));
  });
});
