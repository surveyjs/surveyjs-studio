import { describe, expect, it } from "vitest";
import {
  describeSql,
  describeStorage,
  describeTargets,
  envProblems,
  isLocalHttpsIssuer,
} from "./target.js";

const complete = {
  STORAGE_PROVIDER: "azure-legacy",
  LEGACY_SQL_CONNECTION_STRING:
    "Server=tcp:site.database.windows.net,1433;Database=surveyjs;User Id=app;Password=p@ss;Encrypt=true",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING:
    "DefaultEndpointsProtocol=https;AccountName=surveys;AccountKey=a2V5;EndpointSuffix=core.windows.net",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING:
    "DefaultEndpointsProtocol=https;AccountName=results;AccountKey=a2V5;EndpointSuffix=core.windows.net",
  OIDC_ISSUER_URL: "https://localhost:7100",
  OIDC_CLIENT_ID: "my-surveys",
  OIDC_CLIENT_SECRET: "secret",
  PUBLIC_BASE_URL: "http://localhost:5173",
};

describe("envProblems", () => {
  it("accepts a complete file", () => {
    expect(envProblems(complete)).toEqual([]);
  });

  it("names empty and missing variables without their values", () => {
    expect(
      envProblems({
        ...complete,
        LEGACY_SQL_CONNECTION_STRING: "  ",
        OIDC_CLIENT_SECRET: undefined,
      }),
    ).toEqual(["LEGACY_SQL_CONNECTION_STRING: empty", "OIDC_CLIENT_SECRET: empty"]);
  });

  it("refuses any storage provider but azure-legacy", () => {
    expect(envProblems({ ...complete, STORAGE_PROVIDER: "memory" })).toEqual([
      "STORAGE_PROVIDER: must be azure-legacy",
    ]);
  });
});

describe("describeSql", () => {
  it("names server and database only", () => {
    expect(describeSql(complete.LEGACY_SQL_CONNECTION_STRING)).toBe(
      "site.database.windows.net/surveyjs",
    );
  });

  it("reads the Data Source and Initial Catalog spellings", () => {
    expect(describeSql("Data Source=db.local,14333;Initial Catalog=legacy;Password=x")).toBe(
      "db.local,14333/legacy",
    );
  });
});

describe("describeStorage", () => {
  it("names the account", () => {
    expect(describeStorage(complete.LEGACY_RESULTS_STORAGE_CONNECTION_STRING)).toBe("results");
  });

  it("falls back to the blob endpoint host of a SAS string", () => {
    expect(
      describeStorage("BlobEndpoint=https://acc.blob.core.windows.net/;SharedAccessSignature=sv=x"),
    ).toBe("acc.blob.core.windows.net");
  });
});

describe("describeTargets", () => {
  it("never prints a key or password", () => {
    const text = describeTargets(complete).join("\n");
    expect(text).not.toContain("p@ss");
    expect(text).not.toContain("a2V5");
    expect(text).not.toContain("secret");
  });
});

describe("isLocalHttpsIssuer", () => {
  it.each([
    ["https://localhost:7100", true],
    ["https://127.0.0.1:7100/", true],
    ["http://localhost:5100", false],
    ["https://auth.surveyjs.io", false],
    ["not a url", false],
  ])("%s → %s", (issuer, expected) => {
    expect(isLocalHttpsIssuer(issuer)).toBe(expected);
  });
});
