import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
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

async function start(
  env: Record<string, string>,
  lines?: string[],
): Promise<{
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
  app = await buildApp(
    config,
    providers,
    lines ? { logStream: { write: (line) => lines.push(line) } } : {},
  );
  return { server: app, config, stubUrl: stub.url, providers };
}

interface Person {
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly verified?: boolean;
}

/**
 * Starts a sign-in with `login` (`query`) and answers the stub's authorize form at `authorizePath`
 * as `person` (`deny` presses Deny): the callback URL the stub sends the browser to, and the
 * transaction cookie.
 */
async function authorizeAtStub(
  server: FastifyInstance,
  person: Person,
  {
    query = "?provider=github",
    authorizePath = "/github/login/oauth/authorize",
    deny = false,
  } = {},
): Promise<{ back: URL; cookie: string }> {
  const login = await server.inject(`/api/v1/auth/login${query}`);
  const form = new URLSearchParams(new URL(String(login.headers.location)).searchParams);
  form.set("sub", person.sub);
  form.set("email", person.email);
  form.set("name", person.name ?? "Ada");
  if (person.verified ?? true) form.set("email_verified", "on");
  if (deny) form.set("deny", "1");
  const authorize = await fetch(`${stub?.url}${authorizePath}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "manual",
  });
  return {
    back: new URL(authorize.headers.get("location") ?? ""),
    cookie: transactionOf(login).cookie,
  };
}

/** Opens the callback the stub sent the browser to. */
const callbackOf = (server: FastifyInstance, { back, cookie }: { back: URL; cookie: string }) =>
  server.inject({ url: back.pathname + back.search, headers: { cookie } });

/** Signs in with GitHub at the stub as `person`; the callback's response. */
async function signInWithGithub(server: FastifyInstance, person: Person) {
  return callbackOf(server, await authorizeAtStub(server, person));
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

  it("lets a user disabled by an admin in through none of their sign-ins, and ends the sessions", async () => {
    const { server, providers } = await start({
      AUTH_METHODS: "password,github,google,facebook",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "stub-secret-google",
      FACEBOOK_CLIENT_ID: "fb-client",
      FACEBOOK_CLIENT_SECRET: "stub-secret-facebook",
    });
    const accounts = providers.accounts;
    if (!accounts) throw new Error("no local accounts");
    const account = await accounts.createAccount(newAccount("dan@example.com"));
    const dan = { sub: "dan-1", email: "dan@example.com" };
    const viaGoogle = { query: "?provider=google", authorizePath: "/google/authorize" };
    const viaFacebook = { query: "?provider=facebook", authorizePath: "/facebook/dialog/oauth" };
    // Two identities linked by the verified email, each with a session.
    const github = await signInWithGithub(server, dan);
    const google = await callbackOf(server, await authorizeAtStub(server, dan, viaGoogle));
    expect((await accounts.listIdentities(account.user.id)).map((link) => link.provider)).toEqual([
      "github",
      "google",
    ]);

    await accounts.updateAccount(account.user.id, { status: "disabled" });
    // The linked identities, and a third provider with the same verified email: all refused.
    const attempts = [
      ["github", await signInWithGithub(server, dan)],
      ["google", await callbackOf(server, await authorizeAtStub(server, dan, viaGoogle))],
      ["facebook", await callbackOf(server, await authorizeAtStub(server, dan, viaFacebook))],
    ] as const;
    for (const [provider, callback] of attempts) {
      expect(String(callback.headers.location)).toBe(
        `${PUBLIC_BASE_URL}/sign-in/refused?reason=disabled&provider=${provider}`,
      );
      expect(cookieValue(callback, "msid")).toBeUndefined();
    }
    // Nothing new was linked, and the sessions from before have ended.
    expect(await accounts.listIdentities(account.user.id)).toHaveLength(2);
    for (const before of [github, google]) {
      const me = await server.inject({
        url: "/api/v1/me",
        headers: { cookie: `msid=${cookieValue(before, "msid")}` },
      });
      expect(me.statusCode).toBe(401);
    }
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

  it("signs the first admin of an instance without passwords in by the verified ADMIN_EMAIL", async () => {
    const { server, providers } = await start({
      AUTH_METHODS: "github",
      ADMIN_EMAIL: "root@example.com",
    });
    const accounts = providers.accounts;
    if (!accounts) throw new Error("no local accounts");
    const admin = await accounts.accountByEmail("root@example.com");
    expect(admin).toMatchObject({ instanceRole: "admin", status: "active", passwordHash: null });

    const callback = await signInWithGithub(server, { sub: "42", email: "Root@Example.com" });
    expect(String(callback.headers.location)).toBe(`${PUBLIC_BASE_URL}/`);
    const cookie = `msid=${cookieValue(callback, "msid") ?? ""}; msid_csrf=${cookieValue(callback, "msid_csrf") ?? ""}`;
    const me = await server.inject({ url: "/api/v1/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      id: admin?.user.id,
      instanceRole: "admin",
      mustChangePassword: false,
      hasPassword: false,
    });
    const users = await server.inject({ url: "/api/v1/admin/users", headers: { cookie } });
    expect(users.statusCode).toBe(200);
    expect((await accounts.accountByIdentity("github", "42"))?.user.id).toBe(admin?.user.id);
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

  it("surveyjs.io alone: login goes to its issuer, and the callback reaches a local account", async () => {
    const { server, stubUrl, providers, config } = await start({
      AUTH_METHODS: "surveyjs",
      OIDC_ISSUER_URL: "STUB/surveyjs",
      OIDC_CLIENT_ID: "s-client",
      OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
      ADMIN_EMAIL: "root@example.com",
    });
    const { accounts, invitations, projects } = providers;
    if (!accounts || !invitations) throw new Error("no local accounts");
    const root = await accounts.accountByEmail("root@example.com");
    const projectId = randomUUID();
    await projects.createProject({
      id: projectId,
      name: "Invited to",
      creatorId: root?.user.id ?? "",
      createdAt: CREATED_AT,
    });
    await invitations.addInvitation({
      projectId,
      email: "kim@example.com",
      role: "user",
      invitedBy: root?.user.id ?? "",
      createdAt: CREATED_AT,
    });

    const login = await server.inject("/api/v1/auth/login");
    expect(String(login.headers.location).startsWith(`${stubUrl}/surveyjs/authorize?`)).toBe(true);
    const callback = await callbackOf(
      server,
      await authorizeAtStub(
        server,
        { sub: "s-30", email: "kim@example.com", name: "Kim" },
        { query: "", authorizePath: "/surveyjs/authorize" },
      ),
    );
    expect(String(callback.headers.location)).toBe(`${PUBLIC_BASE_URL}/`);
    const kim = await accounts.accountByEmail("kim@example.com");
    expect(kim).toMatchObject({ instanceRole: "user", status: "active", passwordHash: null });
    expect(decodeSession(config.sessionSecret, cookieValue(callback, "msid"))).toMatchObject({
      sub: kim?.user.id,
      email: "kim@example.com",
    });
    expect((await accounts.accountByIdentity("surveyjs", "s-30"))?.user.id).toBe(kim?.user.id);
    expect(await projects.getUserProject(kim?.user.id ?? "", projectId)).not.toBeNull();
  });

  it("READ_ONLY=true: a linked identity signs in; linking goes to the refused page, no session", async () => {
    const { server, providers } = await start({
      AUTH_METHODS: "password,github",
      READ_ONLY: "true",
    });
    const accounts = providers.accounts;
    if (!accounts) throw new Error("no local accounts");
    const linked = await accounts.createAccount(newAccount("fay@example.com"));
    await accounts.linkIdentity({
      provider: "github",
      subject: "12",
      userId: linked.user.id,
      email: "fay@example.com",
      emailVerified: true,
      createdAt: CREATED_AT,
    });
    const signedIn = await signInWithGithub(server, { sub: "12", email: "fay@example.com" });
    expect(signedIn.statusCode).toBe(302);
    expect(cookieValue(signedIn, "msid")).toBeTruthy();
    expect((await accounts.account(linked.user.id))?.lastSignInAt).toBeNull();

    const other = await accounts.createAccount(newAccount("gus@example.com"));
    const refused = await signInWithGithub(server, { sub: "13", email: "gus@example.com" });
    expect(refused.statusCode).toBe(302);
    expect(String(refused.headers.location)).toBe(
      `${PUBLIC_BASE_URL}/sign-in/refused?reason=read-only&provider=github`,
    );
    expect(cookieValue(refused, "msid")).toBeUndefined();
    expect(refused.cookies.find((c) => c.name.startsWith("msid_auth_"))?.value).toBe("");
    expect(await accounts.accountByIdentity("github", "13")).toBeNull();
    expect((await accounts.account(other.user.id))?.status).toBe("active");
  });
});

describe("a provider button's sign-in that fails at the callback", () => {
  /** The response is the refused page for `reason`, with no session and the transaction cleared. */
  function expectRefused(callback: LightMyRequestResponse, reason: string) {
    expect(callback.statusCode).toBe(302);
    expect(String(callback.headers.location)).toBe(
      `${PUBLIC_BASE_URL}/sign-in/refused?reason=${reason}&provider=github`,
    );
    expect(cookieValue(callback, "msid")).toBeUndefined();
    expect(cookieValue(callback, "msid_csrf")).toBeUndefined();
    expect(callback.cookies.find((c) => c.name.startsWith("msid_auth_"))?.value).toBe("");
  }

  it("sends a sign-in cancelled at the provider to the refused page", async () => {
    const { server } = await start({ AUTH_METHODS: "password,github", OPEN_SIGN_UP: "on" });
    const answer = await authorizeAtStub(
      server,
      { sub: "20", email: "hal@example.com" },
      { deny: true },
    );
    expect(answer.back.searchParams.get("error")).toBe("access_denied");
    expect(answer.back.searchParams.has("code")).toBe(false);
    expectRefused(await callbackOf(server, answer), "cancelled");
  });

  it("sends a provider that cannot be reached to the refused page and logs the cause", async () => {
    const lines: string[] = [];
    const { server } = await start({ AUTH_METHODS: "password,github", OPEN_SIGN_UP: "on" }, lines);
    const answer = await authorizeAtStub(server, { sub: "21", email: "ida@example.com" });
    await stub?.close();
    stub = undefined;
    expectRefused(await callbackOf(server, answer), "unavailable");
    const logged = lines
      .map((line) => JSON.parse(line) as { level: number; msg: string; provider?: string })
      .find((line) => line.msg === "sign-in is unavailable");
    expect(logged).toMatchObject({ level: 50, provider: "github" });
    const all = lines.join("\n");
    expect(all).not.toContain("stub-secret-github");
    expect(all).not.toContain(answer.back.searchParams.get("code") ?? "no code");
    expect(all).not.toContain("ida@example.com");
  });

  it("keeps the problem answers of a sign-in without a provider: surveyjs.io alone", async () => {
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
    const hosted = { query: "", authorizePath: "/surveyjs/authorize" };
    const person = { sub: "22", email: "jo@example.com" };

    const denied = await callbackOf(
      app,
      await authorizeAtStub(app, person, { ...hosted, deny: true }),
    );
    expect(denied.statusCode).toBe(400);
    expect(denied.headers["content-type"]).toContain("application/problem+json");
    expect(denied.json()).toMatchObject({ code: "bad-request", title: "Sign-in failed" });
    expect(cookieValue(denied, "msid")).toBeUndefined();

    const answer = await authorizeAtStub(app, person, hosted);
    await stub.close();
    stub = undefined;
    const unreachable = await callbackOf(app, answer);
    expect(unreachable.statusCode).toBe(500);
    expect(unreachable.headers["content-type"]).toContain("application/problem+json");
    expect(unreachable.json()).toMatchObject({ title: "Sign-in is unavailable" });
    expect(cookieValue(unreachable, "msid")).toBeUndefined();
  });
});
