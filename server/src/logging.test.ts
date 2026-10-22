import { describe, expect, it, vi } from "vitest";

const DRIVER_MESSAGE = vi.hoisted(
  () => "Login failed; Password=canary-secret; AccountKey=canary-key",
);

vi.mock("mssql", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof import("mssql") }>();
  class FailingPool extends actual.default.ConnectionPool {
    override connect(): never {
      return Promise.reject(new Error(DRIVER_MESSAGE)) as never;
    }
  }
  return { ...actual, default: { ...actual.default, ConnectionPool: FailingPool } };
});
import { buildApp } from "./app.js";
import { transactionOf } from "./auth/testing.js";
import { loadConfig } from "./config.js";
import { redactUrl, startupSummary } from "./logging.js";
import { createAzureLegacyProviders } from "./providers/azure-legacy/index.js";
import type { ProviderSet } from "./providers/index.js";
import { createProviders } from "./providers/index.js";
import { ownerUser } from "./providers/suite/expected.js";

describe("redactUrl", () => {
  it("replaces the values of code and state", () => {
    expect(redactUrl("/api/v1/auth/callback?code=c-1&state=s-1&x=1")).toBe(
      "/api/v1/auth/callback?code=[redacted]&state=[redacted]&x=1",
    );
  });

  it("redacts clientId", () => {
    expect(redactUrl("/api/v1/public/surveys/s?clientId=abc&x=1")).toBe(
      "/api/v1/public/surveys/s?clientId=[redacted]&x=1",
    );
  });

  it("also finds percent-encoded names, and keeps other URLs as they are", () => {
    expect(redactUrl("/cb?co%64e=c-1&%73tate")).toBe("/cb?co%64e=[redacted]&%73tate=[redacted]");
    expect(redactUrl("/surveys?view=1&codes=2")).toBe("/surveys?view=1&codes=2");
    expect(redactUrl("/surveys")).toBe("/surveys");
    expect(redactUrl("/x?%E0%A4%A=1")).toBe("/x?%E0%A4%A=1");
  });
});

describe("request logs", () => {
  it("never contain the sign-in callback's code or state", async () => {
    const lines: string[] = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
      PUBLIC_BASE_URL: "http://localhost:5173",
    });
    const app = await buildApp(config, await createProviders(config), {
      logStream: { write: (line) => lines.push(line) },
    });
    let state: string | undefined;
    try {
      const login = transactionOf(await app.inject("/api/v1/auth/login"));
      state = login.state;
      const callback = await app.inject({
        url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${state}`,
        headers: { cookie: login.cookie },
      });
      expect(callback.statusCode).toBe(302);
    } finally {
      await app.close();
    }
    const logged = lines.join("");
    expect(logged).toContain("/api/v1/auth/callback?code=[redacted]&state=[redacted]");
    expect(logged).not.toContain(ownerUser.id);
    expect(state).toBeTruthy();
    expect(logged).not.toContain(state);
  });
});

describe("public request logs", () => {
  it("redact the client id and truncate the client address", async () => {
    const lines: string[] = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
    });
    const app = await buildApp(config, await createProviders(config), {
      logStream: { write: (line) => lines.push(line) },
    });
    try {
      await app.inject({
        url: "/api/v1/public/surveys/22222222-0000-4000-8000-a00000000001?clientId=secret-client",
        remoteAddress: "203.0.113.9",
      });
    } finally {
      await app.close();
    }
    const logged = lines.join("");
    expect(logged).toContain("clientId=[redacted]");
    expect(logged).toContain('"remoteAddress":"203.0.113.0"');
    expect(logged).not.toContain("secret-client");
    expect(logged).not.toContain("203.0.113.9");
  });
});

const CANARIES = {
  sql: "canary-sql-7f1",
  surveys: "canary-surveys-7f2",
  results: "canary-results-7f3",
  oidc: "canary-oidc-7f4",
  session: "canary-session-secret-7f5-0123456789",
  webhook: "whsec_canary7fcanary7fcanary7fcanary7f",
  token: "canary-user-api-token-7f7",
};

describe("startupSummary", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PUBLIC_BASE_URL: "https://surveys.example.com",
    STORAGE_PROVIDER: "azure-legacy",
    LEGACY_SQL_CONNECTION_STRING: `Server=sql.canary.net;Password=${CANARIES.sql}`,
    LEGACY_SURVEYS_STORAGE_CONNECTION_STRING: `AccountName=a;AccountKey=${CANARIES.surveys}`,
    LEGACY_RESULTS_STORAGE_CONNECTION_STRING: `AccountName=b;AccountKey=${CANARIES.results}`,
    IDENTITY_PROVIDER: "surveyjs-oidc",
    OIDC_ISSUER_URL: "https://auth.example.com",
    OIDC_CLIENT_ID: "client-1",
    OIDC_CLIENT_SECRET: CANARIES.oidc,
    SESSION_SECRET: CANARIES.session,
    ACCOUNT_WEBHOOK_SECRET: CANARIES.webhook,
    USER_DIRECTORY: "surveyjs-api",
    USER_API_URL: "https://api.example.com",
    USER_API_TOKEN: CANARIES.token,
    READ_ONLY: "true",
  });

  it("has exactly the documented keys and values", () => {
    expect(startupSummary(config)).toEqual({
      edition: config.edition,
      shell: config.shell,
      storageProvider: "azure-legacy",
      userDirectory: "surveyjs-api",
      identityProvider: "surveyjs-oidc",
      accountNotices: config.accountNotices,
      readOnly: true,
      webApp: false,
      publicBaseUrl: "https://surveys.example.com",
      nodeEnv: "production",
    });
    expect(startupSummary({ ...config, webRoot: "/srv/web" }).webApp).toBe(true);
  });

  it("carries no secret", () => {
    const text = JSON.stringify(startupSummary(config));
    for (const canary of Object.values(CANARIES)) expect(text).not.toContain(canary);
    expect(text).not.toContain("canary.net");
  });
});

describe("canary run", () => {
  const FAILURE = "Password=canary-secret;AccountKey=canary-key";

  async function run(
    override: (providers: ProviderSet) => ProviderSet | Promise<ProviderSet>,
    requests: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<string[]>,
  ) {
    const lines: string[] = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
    });
    const providers = await override(await createProviders(config));
    const app = await buildApp(config, providers, {
      logStream: { write: (line) => lines.push(line) },
    });
    let bodies: string[];
    try {
      bodies = await requests(app);
    } finally {
      await app.close();
    }
    return { lines, bodies };
  }

  it("keeps a failing read's error text out of the logs, and names the operation", async () => {
    const { lines, bodies } = await run(
      async (providers) => {
        // The real azure-legacy provider over a pool whose connect fails with a driver message that
        // carries the canaries; the users stay in memory so that sign-in works.
        const legacy = createAzureLegacyProviders({
          sqlConnectionString: "Server=localhost;Database=x;User Id=u;Password=p",
          surveysStorageConnectionString: "UseDevelopmentStorage=true",
          resultsStorageConnectionString: "UseDevelopmentStorage=true",
        });
        return { ...providers, surveys: legacy.surveys };
      },
      async (app) => {
        const login = transactionOf(await app.inject("/api/v1/auth/login"));
        const callback = await app.inject({
          url: `/api/v1/auth/callback?code=${ownerUser.id}&state=${login.state}`,
          headers: { cookie: login.cookie },
        });
        const cookie = [callback.headers["set-cookie"]].flat().join(";");
        const response = await app.inject({ url: "/api/v1/surveys", headers: { cookie } });
        expect(response.statusCode).toBe(500);
        return [response.body];
      },
    );
    expect(bodies.join("")).not.toContain("canary");
    const logged = lines.join("");
    expect(logged).not.toContain("canary");
    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "request completed");
    expect(completed.some((entry) => entry.operationId === "listSurveys")).toBe(true);
  });

  it("logs the operationId on a successful contract request", async () => {
    const { lines } = await run(
      (providers) => providers,
      async (app) => {
        const response = await app.inject("/api/v1/public/surveys/nope");
        return [response.body];
      },
    );
    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.msg === "request completed");
    expect(completed).toHaveLength(1);
    expect(typeof completed[0]?.operationId).toBe("string");
  });

  it("keeps a rejecting readiness check's error text out of /readyz and the logs", async () => {
    const { lines, bodies } = await run(
      (providers) => ({
        ...providers,
        ready: () => Promise.reject(new Error(FAILURE)),
      }),
      async (app) => {
        const response = await app.inject("/readyz");
        expect(response.statusCode).toBe(503);
        return [response.body];
      },
    );
    expect(bodies.join("")).not.toContain("canary");
    expect(lines.join("")).not.toContain("canary");
  });
});
