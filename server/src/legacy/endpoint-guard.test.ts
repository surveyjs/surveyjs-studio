import { describe, expect, it } from "vitest";
import {
  assertLocalClientUrl,
  assertLocalEndpoints,
  findNonLocalVariables,
} from "./endpoint-guard.js";

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

  it.each([
    ["Server local, Data Source remote", "Server=localhost;Data Source=remote.example.com"],
    ["Data Source local, Server remote", "Data Source=127.0.0.1;Server=remote.example.com"],
    ["Server local, Address remote", "Server=127.0.0.1,1433;Address=remote.example.com"],
    ["Server local, Addr remote", "Server=127.0.0.1;Addr=tcp:remote.example.com,1433"],
    ["Server local, Network Address remote", "Server=::1;Network Address=remote.example.com"],
    ["the same key twice, remote first", "Server=remote.example.com;Server=localhost"],
    [
      "a quoted value hiding a second Server key",
      "Server=remote.example.com;Password='a;Server=localhost;'",
    ],
  ])("refuses a SQL string with conflicting server keys: %s", (_name, value) => {
    const env = { ...local, LEGACY_SQL_CONNECTION_STRING: `${value};Database=d` };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SQL_CONNECTION_STRING"]);
  });

  it("accepts a SQL string whose server keys are all local", () => {
    const env = {
      ...local,
      LEGACY_SQL_CONNECTION_STRING:
        "Server=localhost,14333;Data Source=127.0.0.1,14333;Address=[::1];Database=d",
    };
    expect(findNonLocalVariables(env)).toEqual([]);
  });

  it("refuses a SQL string without any server key", () => {
    const env = { ...local, LEGACY_SQL_CONNECTION_STRING: "Database=d;User Id=sa" };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SQL_CONNECTION_STRING"]);
  });

  it("refuses a non-local Data Source SQL string", () => {
    const env = {
      ...local,
      LEGACY_SQL_CONNECTION_STRING: "Data Source=db.example.net,1433;Database=d",
    };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SQL_CONNECTION_STRING"]);
  });
});

// Inputs that the storage SDKs read differently from a naive parser. Each one sends at least one
// SDK client to a real Azure account (local-clients.test.ts shows the URLs the SDKs resolve).
const PROD = "DefaultEndpointsProtocol=https;AccountName=prodacct;AccountKey=a2V5";
const LOCAL_BLOB = "http://127.0.0.1:10000/devstoreaccount1";
const LOCAL_TABLE = "http://127.0.0.1:10002/devstoreaccount1";

const STORAGE_BYPASS_INPUTS: [name: string, value: string][] = [
  [
    "remote endpoints first, local duplicates after",
    `${PROD};BlobEndpoint=https://prodacct.blob.core.windows.net/;` +
      `TableEndpoint=https://prodacct.table.core.windows.net;` +
      `BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`,
  ],
  [
    "lower-case endpoint keys next to a real account",
    `${PROD};EndpointSuffix=core.windows.net;blobendpoint=${LOCAL_BLOB};tableendpoint=${LOCAL_TABLE}`,
  ],
  [
    "a real account string with UseDevelopmentStorage=true appended",
    `${PROD};EndpointSuffix=core.windows.net;UseDevelopmentStorage=true`,
  ],
];

describe("storage endpoint guard reads the string the way the SDKs do", () => {
  it.each(STORAGE_BYPASS_INPUTS)("refuses %s", (_name, value) => {
    const env = { ...local, LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: value };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"]);
    expect(() => assertLocalEndpoints(env)).toThrow(/LEGACY_SURVEYS_STORAGE_CONNECTION_STRING/);
    expect(() => assertLocalEndpoints(env)).not.toThrow(/prodacct/);
  });

  it.each([
    [
      "duplicated local endpoint keys",
      `BlobEndpoint=${LOCAL_BLOB};BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`,
    ],
    ["an upper-case endpoint key", `BLOBENDPOINT=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`],
    [
      "a key that only starts with an endpoint name",
      `BlobEndpointX=a;BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`,
    ],
    ["a space before the equals sign", `BlobEndpoint =${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`],
    [
      "UseDevelopmentStorage=true next to local endpoints",
      `UseDevelopmentStorage=true;BlobEndpoint=${LOCAL_BLOB};TableEndpoint=${LOCAL_TABLE}`,
    ],
    [
      "UseDevelopmentStorage=true with a proxy",
      "UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://proxy.example.com",
    ],
    ["a lower-case emulator flag", "usedevelopmentstorage=true"],
  ])("refuses %s", (_name, value) => {
    const env = { ...local, LEGACY_RESULTS_STORAGE_CONNECTION_STRING: value };
    expect(findNonLocalVariables(env)).toEqual(["LEGACY_RESULTS_STORAGE_CONNECTION_STRING"]);
  });

  it.each(["UseDevelopmentStorage=true", " UseDevelopmentStorage=true; "])(
    "accepts the emulator flag alone: %j",
    (value) => {
      const env = { ...local, LEGACY_RESULTS_STORAGE_CONNECTION_STRING: value };
      expect(findNonLocalVariables(env)).toEqual([]);
    },
  );
});

describe("assertLocalClientUrl", () => {
  it.each([
    "http://127.0.0.1:10000/devstoreaccount1",
    "http://localhost:10002/devstoreaccount1",
    "http://[::1]:10002/devstoreaccount1",
  ])("accepts %s", (url) => {
    expect(() =>
      assertLocalClientUrl(url, "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING"),
    ).not.toThrow();
  });

  it.each([
    "https://prodacct.blob.core.windows.net/",
    "https://prodacct.table.core.windows.net?sv=2020&sig=secret",
    "http://localhost@prodacct.blob.core.windows.net/",
    "not a url",
  ])("refuses %s and names the variable, not the value", (url) => {
    const run = () => assertLocalClientUrl(url, "LEGACY_RESULTS_STORAGE_CONNECTION_STRING");
    expect(run).toThrow(/LEGACY_RESULTS_STORAGE_CONNECTION_STRING/);
    expect(run).not.toThrow(/prodacct|secret|not a url/);
  });
});
