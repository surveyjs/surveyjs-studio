import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import { ownerUser } from "../providers/suite/expected.js";
import { startOAuthStub, type OAuthStub } from "../testing/oauth-stub.js";
import { parseCookies } from "./cookies.js";
import { decodeTransaction } from "./transaction.js";
import { cookieValue, signIn, transactionOf } from "./testing.js";

const PUBLIC_BASE_URL = "http://localhost:5173";

let app: FastifyInstance | undefined;
let stub: OAuthStub | undefined;
afterEach(async () => {
  await app?.close();
  await stub?.close();
  app = undefined;
  stub = undefined;
});

async function start(env: Record<string, string>): Promise<{
  server: FastifyInstance;
  config: AppConfig;
  stubUrl: string;
}> {
  stub = await startOAuthStub();
  const config = loadConfig({
    NODE_ENV: "test",
    PUBLIC_BASE_URL,
    USER_DIRECTORY: "local",
    OAUTH_STUB_URL: stub.url,
    GITHUB_CLIENT_ID: "gh-client",
    GITHUB_CLIENT_SECRET: "stub-secret-github",
    ...Object.fromEntries(
      Object.entries(env).map(([key, value]) => [key, value.replace("STUB", stub?.url ?? "")]),
    ),
  });
  app = await buildApp(config, await createProviders(config));
  return { server: app, config, stubUrl: stub.url };
}

describe("login?provider=", () => {
  it("starts GitHub: a redirect to its authorize URL, the provider sealed in the cookie", async () => {
    const { server, config, stubUrl } = await start({ AUTH_METHODS: "password,github" });
    const res = await server.inject("/api/v1/auth/login?provider=github&returnTo=%2Fx");
    expect(res.statusCode).toBe(302);
    const location = new URL(String(res.headers.location));
    expect(location.origin + location.pathname).toBe(`${stubUrl}/github/login/oauth/authorize`);
    expect(location.searchParams.get("state")).toBeTruthy();
    const { cookie } = transactionOf(res);
    const [name] = cookie.split("=");
    const tx = decodeTransaction(config.sessionSecret, parseCookies(cookie)[name ?? ""]);
    expect(tx).toMatchObject({ provider: "github", returnTo: "/x" });
  });

  it("finishes a sign-in with the provider that started it", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github" });
    const login = await server.inject("/api/v1/auth/login?provider=github");
    const form = new URLSearchParams(new URL(String(login.headers.location)).searchParams);
    form.set("sub", "7");
    form.set("email", "ada@example.com");
    form.set("name", "Ada");
    form.set("email_verified", "on");
    const authorize = await fetch(`${stub?.url}/github/login/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual",
    });
    const back = new URL(authorize.headers.get("location") ?? "");
    const callback = await server.inject({
      url: back.pathname + back.search,
      headers: { cookie: transactionOf(login).cookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(cookieValue(callback, "msid")).toBeTruthy();
  });

  it("answers 400 for a method that is not enabled", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github" });
    const res = await server.inject("/api/v1/auth/login?provider=google");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ detail: "This sign-in method is not enabled." });
    expect(res.cookies).toEqual([]);
  });

  it("answers 400 for a name that is no method", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github" });
    expect((await server.inject("/api/v1/auth/login?provider=x")).statusCode).toBe(400);
  });
});

describe("login without provider", () => {
  it("goes to the sign-in page when passwords are one of several methods", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github" });
    const res = await server.inject("/api/v1/auth/login");
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toBe(`${PUBLIC_BASE_URL}/sign-in?returnTo=%2F`);
  });

  it("goes straight to surveyjs.io when it is the only method", async () => {
    stub = await startOAuthStub();
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_BASE_URL,
      AUTH_METHODS: "surveyjs",
      OIDC_ISSUER_URL: `${stub.url}/surveyjs`,
      OIDC_CLIENT_ID: "s-client",
      OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
    });
    app = await buildApp(config, await createProviders(config));
    const res = await app.inject("/api/v1/auth/login");
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location)).toMatch(new RegExp(`^${stub.url}/surveyjs/authorize\\?`));
  });

  it("starts surveyjs.io with provider=surveyjs under the dev provider, which stays primary", async () => {
    const { server, stubUrl } = await start({
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
      AUTH_METHODS: "password,surveyjs",
      OIDC_ISSUER_URL: "STUB/surveyjs",
      OIDC_CLIENT_ID: "s-client",
      OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
    });
    const plain = await server.inject("/api/v1/auth/login");
    expect(String(plain.headers.location)).toContain("/__dev/sign-in");
    const res = await server.inject("/api/v1/auth/login?provider=surveyjs");
    expect(res.statusCode).toBe(302);
    expect(String(res.headers.location).startsWith(`${stubUrl}/surveyjs/authorize?`)).toBe(true);
    const session = await signIn(server, ownerUser.id);
    expect(session.csrf).toBeTruthy();
  });

  it("finishes with the dev provider, even with another method enabled", async () => {
    const { server } = await start({
      IDENTITY_PROVIDER: "dev",
      MEMORY_SEED: "legacy-fixtures",
      AUTH_METHODS: "password,github",
    });
    const login = await server.inject("/api/v1/auth/login");
    expect(String(login.headers.location)).toContain("/__dev/sign-in");
    const session = await signIn(server, ownerUser.id);
    expect(session.csrf).toBeTruthy();
  });
});
