import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { transactionOf } from "./auth/testing.js";
import { loadConfig } from "./config.js";
import { redactUrl } from "./logging.js";
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
