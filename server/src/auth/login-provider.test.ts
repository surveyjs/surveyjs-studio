import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig, type AppConfig } from "../config.js";
import { createProviders } from "../providers/index.js";
import type { NewLocalAccount, ProviderSet } from "../providers/types.js";
import { ownerUser } from "../providers/suite/expected.js";
import { startOAuthStub, type OAuthStub } from "../testing/oauth-stub.js";
import { parseCookies } from "./cookies.js";
import { decodeSession } from "./session.js";
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
  providers: ProviderSet;
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
  const providers = await createProviders(config);
  app = await buildApp(config, providers);
  return { server: app, config, stubUrl: stub.url, providers };
}

interface Person {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly verified?: boolean;
}

/** Signs in with GitHub at the stub as `person`; the callback's response. */
async function signInWithGithub(server: FastifyInstance, person: Person) {
  const login = await server.inject("/api/v1/auth/login?provider=github");
  const form = new URLSearchParams(new URL(String(login.headers.location)).searchParams);
  form.set("sub", person.sub);
  form.set("email", person.email);
  form.set("name", person.name ?? "Ada");
  if (person.verified ?? true) form.set("email_verified", "on");
  const authorize = await fetch(`${stub?.url}/github/login/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  const back = new URL(authorize.headers.get("location") ?? "");
  return server.inject({
    url: back.pathname + back.search,
    headers: { cookie: transactionOf(login).cookie },
  });
}

const CREATED_AT = "2026-11-01T00:00:00.000Z";

/** A new account of the local directory. */
function newAccount(email: string, over: Partial<NewLocalAccount> = {}): NewLocalAccount {
  return {
    id: randomUUID(),
    email,
    displayName: email,
    instanceRole: "user",
    status: "active",
    passwordHash: null,
    mustChangePassword: false,
    createdAt: CREATED_AT,
    ...over,
  };
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
    const { server } = await start({
      AUTH_METHODS: "password,github",
      SIGN_UP_DOMAINS: "example.com",
    });
    const callback = await signInWithGithub(server, { sub: "7", email: "ada@example.com" });
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

describe("the callback with the local directory", () => {
  it("refuses a stranger: the refused page, no session, the transaction cookie cleared", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github" });
    const callback = await signInWithGithub(server, { sub: "8", email: "stranger@example.net" });
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers.location)).toBe(
      `${PUBLIC_BASE_URL}/sign-in/refused?reason=not-invited&provider=github`,
    );
    expect(cookieValue(callback, "msid")).toBeUndefined();
    expect(cookieValue(callback, "msid_csrf")).toBeUndefined();
    const cleared = callback.cookies.find((cookie) => cookie.name.startsWith("msid_auth_"));
    expect(cleared?.value).toBe("");
  });

  it("refuses a disabled account's linked identity, without a session (Review Focus 4)", async () => {
    const { server, providers } = await start({ AUTH_METHODS: "password,github" });
    const accounts = providers.accounts;
    if (!accounts) throw new Error("no local accounts");
    const account = await accounts.createAccount(newAccount("dora@example.com"));
    const dora = { sub: "9", email: "dora@example.com" };
    expect(cookieValue(await signInWithGithub(server, dora), "msid")).toBeTruthy();
    await accounts.updateAccount(account.user.id, { status: "disabled" });
    const callback = await signInWithGithub(server, dora);
    expect(String(callback.headers.location)).toBe(
      `${PUBLIC_BASE_URL}/sign-in/refused?reason=disabled&provider=github`,
    );
    expect(cookieValue(callback, "msid")).toBeUndefined();
  });

  it("signs in to the local account: its id and epoch, and the session check passes", async () => {
    const { server, config, providers } = await start({ AUTH_METHODS: "password,github" });
    const accounts = providers.accounts;
    if (!accounts) throw new Error("no local accounts");
    const account = await accounts.createAccount(
      newAccount("eve@example.com", { displayName: "Eve Local", passwordHash: "$argon2id$x" }),
    );
    const epoch = await accounts.setPassword(account.user.id, "$argon2id$y", { mustChange: false });
    expect(epoch).toBeGreaterThan(0);
    const callback = await signInWithGithub(server, {
      sub: "10",
      email: "Eve@Example.com",
      name: "Eve at GitHub",
    });
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers.location)).toBe(`${PUBLIC_BASE_URL}/`);
    const value = cookieValue(callback, "msid");
    expect(decodeSession(config.sessionSecret, value)).toMatchObject({
      sub: account.user.id,
      email: "eve@example.com",
      name: "Eve Local",
      epoch,
    });
    const csrf = cookieValue(callback, "msid_csrf") ?? "";
    const me = await server.inject({
      url: "/api/v1/me",
      headers: { cookie: `msid=${value ?? ""}; msid_csrf=${csrf}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: account.user.id, hasPassword: true });
    expect((await accounts.account(account.user.id))?.lastSignInAt).not.toBeNull();
  });

  it("creates an account for an invited email and claims its invitations (Review Focus 3)", async () => {
    const { server, providers } = await start({ AUTH_METHODS: "password,github" });
    const { accounts, invitations, projects } = providers;
    if (!accounts || !invitations) throw new Error("no local accounts");
    const owner = await accounts.createAccount(newAccount("owner@example.com"));
    const projectId = randomUUID();
    await projects.createProject({
      id: projectId,
      name: "Invited to",
      creatorId: owner.user.id,
      createdAt: CREATED_AT,
    });
    await invitations.addInvitation({
      projectId,
      email: "Alice@Example.com",
      role: "user",
      invitedBy: owner.user.id,
      createdAt: CREATED_AT,
    });
    const callback = await signInWithGithub(server, { sub: "11", email: "alice@example.com" });
    expect(cookieValue(callback, "msid")).toBeTruthy();
    const alice = await accounts.accountByEmail("alice@example.com");
    expect(alice).toMatchObject({ status: "active", passwordHash: null });
    expect(await projects.getUserProject(alice?.user.id ?? "", projectId)).not.toBeNull();
    expect(await invitations.hasInvitation("alice@example.com")).toBe(false);
  });
});
