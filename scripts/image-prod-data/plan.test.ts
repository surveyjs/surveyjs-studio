import { describe, expect, it } from "vitest";
import { forwardScript, forwardedPorts, imageEnvProblems } from "./plan.js";

const SQL = "Server=tcp:site.database.windows.net,1433;Database=surveyjs;User Id=app;Password=p@ss";
const STORAGE =
  "DefaultEndpointsProtocol=https;AccountName=surveys;AccountKey=a2V5;EndpointSuffix=core.windows.net";

const complete = {
  STORAGE_PROVIDER: "azure-legacy",
  LEGACY_SQL_CONNECTION_STRING: SQL,
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: STORAGE,
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING: STORAGE,
  OIDC_ISSUER_URL: "https://localhost:7100",
  OIDC_CLIENT_ID: "my-surveys",
  OIDC_CLIENT_SECRET: "secret",
  SESSION_SECRET: "s".repeat(32),
};
const text = "OIDC_ISSUER_URL=https://localhost:7100\n";

/** The replica and the mock of docker/azurite.env, as the launcher test uses them. */
const replica = {
  ...complete,
  LEGACY_SQL_CONNECTION_STRING:
    "Server=127.0.0.1,14333;Database=surveyjs_legacy;User Id=sa;Password=x;Encrypt=true",
  LEGACY_SURVEYS_STORAGE_CONNECTION_STRING:
    "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=a2V5;" +
    "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;",
  LEGACY_RESULTS_STORAGE_CONNECTION_STRING:
    "BlobEndpoint=http://localhost:10000/devstoreaccount1;TableEndpoint=http://localhost:10002/devstoreaccount1",
  OIDC_ISSUER_URL: "http://127.0.0.1:18080/surveyjs",
};

describe("imageEnvProblems", () => {
  it("accepts a complete file", () => {
    expect(imageEnvProblems(complete, text)).toEqual([]);
  });

  it("keeps the dev:prod-data checks", () => {
    expect(imageEnvProblems({ ...complete, OIDC_CLIENT_SECRET: "" }, text)).toEqual([
      "OIDC_CLIENT_SECRET: empty",
    ]);
  });

  it("needs a production session secret", () => {
    const problems = imageEnvProblems({ ...complete, SESSION_SECRET: "short" }, text);
    expect(problems).toEqual([
      "SESSION_SECRET: at least 32 characters (the image runs with NODE_ENV=production)",
    ]);
    expect(problems.join("\n")).not.toContain("short");
  });

  it("refuses the dev sign-in", () => {
    expect(imageEnvProblems({ ...complete, IDENTITY_PROVIDER: "dev" }, text)).toEqual([
      "IDENTITY_PROVIDER: must be surveyjs-oidc",
    ]);
  });

  it("refuses an issuer that is not on this machine", () => {
    expect(
      imageEnvProblems({ ...complete, OIDC_ISSUER_URL: "https://auth.example.com" }, text),
    ).toEqual([
      "OIDC_ISSUER_URL: must be on localhost, 127.0.0.1 or [::1] (the launcher forwards it to this machine)",
    ]);
  });

  it("refuses a local endpoint on the app's own port", () => {
    expect(
      imageEnvProblems({ ...complete, OIDC_ISSUER_URL: "http://localhost:3000/x" }, text),
    ).toEqual(["OIDC_ISSUER_URL: port 3000 is the app's own port"]);
  });

  it("refuses a local named SQL instance without a port", () => {
    const sql = String.raw`Server=localhost\SQLEXPRESS;Database=x`;
    expect(imageEnvProblems({ ...complete, LEGACY_SQL_CONNECTION_STRING: sql }, text)).toEqual([
      "LEGACY_SQL_CONNECTION_STRING: a named instance on this machine needs its port",
    ]);
  });

  it("names values compose would expand, without the value", () => {
    const file = [
      "# a comment with $HOME",
      "LEGACY_SQL_CONNECTION_STRING=Server=x;Password=pa$word",
      'OIDC_CLIENT_SECRET="se${cret}"',
      "export SESSION_SECRET=ab$c",
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING='literal$value'",
    ].join("\r\n");
    const problems = imageEnvProblems(complete, file);
    expect(problems).toEqual([
      "LEGACY_SQL_CONNECTION_STRING: contains $, which docker compose expands; put the value in single quotes",
      "OIDC_CLIENT_SECRET: contains $, which docker compose expands; put the value in single quotes",
      "SESSION_SECRET: contains $, which docker compose expands; put the value in single quotes",
    ]);
    expect(problems.join("\n")).not.toContain("pa$word");
  });
});

describe("forwardedPorts", () => {
  it("forwards the local issuer only when the stores are remote", () => {
    expect(forwardedPorts(complete)).toEqual([7100]);
  });

  it("forwards every endpoint on this machine, once each", () => {
    expect(forwardedPorts(replica)).toEqual([10000, 10002, 14333, 18080]);
  });

  it("uses the default ports", () => {
    expect(
      forwardedPorts({
        ...complete,
        OIDC_ISSUER_URL: "https://[::1]/",
        LEGACY_SQL_CONNECTION_STRING: "Data Source=tcp:LOCALHOST;Initial Catalog=x",
        LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
      }),
    ).toEqual([443, 1433, 10000, 10002]);
  });
});

describe("forwardScript", () => {
  it("listens on both loopback addresses and forwards to the host", () => {
    const script = forwardScript([7100]);
    expect(script.split("\n")).toEqual([
      "trap 'exit 0' TERM INT",
      "socat TCP4-LISTEN:7100,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:7100 &",
      "socat TCP6-LISTEN:7100,bind=[::1],fork,reuseaddr TCP:host.docker.internal:7100 &",
      "wait",
    ]);
    expect(script).not.toContain("$");
  });
});
