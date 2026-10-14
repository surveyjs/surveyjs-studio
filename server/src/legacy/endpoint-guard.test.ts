import { describe, expect, it } from "vitest";
import { assertLocalEndpoints, findNonLocalVariables } from "./endpoint-guard.js";

const AZURITE =
  "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;" +
  "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;" +
  "TableEndpoint=http://localhost:10002/devstoreaccount1;";
const SQL = "Server=127.0.0.1,14333;Database=surveyjs_legacy;User Id=sa;Password=x";

const local = {
  LEGACY_SQL_CONNECTION_STRING: SQL,
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: AZURITE,
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
};

describe("legacy loader endpoint guard", () => {
  it("accepts local endpoints", () => {
    expect(findNonLocalVariables(local)).toEqual([]);
    expect(() => assertLocalEndpoints(local)).not.toThrow();
  });

  it.each(["127.0.0.1", "localhost", "[::1]", "LOCALHOST"])("accepts SQL host %s", (host) => {
    const env = {
      ...local,
      LEGACY_SQL_CONNECTION_STRING: `Data Source=tcp:${host},1433;Database=d`,
    };
    expect(findNonLocalVariables(env)).toEqual([]);
  });

  it("refuses a remote SQL server and names the variable, not the value", () => {
    const env = {
      ...local,
      LEGACY_SQL_CONNECTION_STRING:
        "Server=tcp:prod-sql.database.windows.net,1433;Database=d;User Id=u;Password=SuperSecret1",
    };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SQL_CONNECTION_STRING"]);
    expect(() => assertLocalEndpoints(env)).toThrow(/LEGACY_SQL_CONNECTION_STRING/);
    try {
      assertLocalEndpoints(env);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain("prod-sql");
      expect(message).not.toContain("SuperSecret1");
    }
  });

  it("refuses a real storage account (no endpoints, account name only)", () => {
    const env = {
      ...local,
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING:
        "DefaultEndpointsProtocol=https;AccountName=realaccount;AccountKey=c2VjcmV0;EndpointSuffix=core.windows.net",
    };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_RESULTS_STORAGE_CONNECTION_STRING"]);
  });

  it("refuses when any one endpoint of a string is remote (mixed)", () => {
    const env = {
      ...local,
      LEGACY_SURVEYS_STORAGE_CONNECTION_STRING:
        "BlobEndpoint=http://127.0.0.1:10000/a;TableEndpoint=https://acct.table.core.windows.net/",
    };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"]);
  });

  it("refuses when a variable is missing or blank, and lists every offender", () => {
    const env = {
      LEGACY_SQL_CONNECTION_STRING: " ",
      LEGACY_RESULTS_STORAGE_CONNECTION_STRING: "x",
    };
    expect(findNonLocalVariables(env)).toEqual([
      "LEGACY_SQL_CONNECTION_STRING",
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    ]);
  });

  it.each([
    [
      "only BlobEndpoint local",
      "AccountName=real;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:10000/x",
    ],
    [
      "only TableEndpoint local",
      "AccountName=real;AccountKey=a2V5;TableEndpoint=http://127.0.0.1:10002/x",
    ],
    [
      "a remote QueueEndpoint next to local ones",
      "BlobEndpoint=http://127.0.0.1:1/x;TableEndpoint=http://127.0.0.1:2/x;QueueEndpoint=https://a.queue.core.windows.net",
    ],
    [
      "a look-alike host",
      "BlobEndpoint=http://localhost.evil.com:1/x;TableEndpoint=http://127.0.0.1:2/x",
    ],
    [
      "a userinfo spoof",
      "BlobEndpoint=http://localhost@evil.com/x;TableEndpoint=http://127.0.0.1:2/x",
    ],
  ])("refuses a storage string with %s", (_name, value) => {
    const env = { ...local, LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: value };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"]);
  });

  it("accepts a storage string with both endpoints local", () => {
    const value =
      "AccountName=a;AccountKey=a2V5;BlobEndpoint=http://127.0.0.1:1/a;TableEndpoint=http://[::1]:2/a";
    const env = { ...local, LEGACY_RESULTS_STORAGE_CONNECTION_STRING: value };
    expect(findNonLocalVariables(env)).toEqual([]);
  });

  it("refuses a non-local Data Source SQL string", () => {
    const env = {
      ...local,
      LEGACY_SQL_CONNECTION_STRING: "Data Source=db.example.net,1433;Database=d",
    };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SQL_CONNECTION_STRING"]);
  });
});
