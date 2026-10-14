import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { loadConfig } from "../../config.js";
import { createProviders } from "../../providers/index.js";
import { blockedUser, ownerUser } from "../../providers/suite/expected.js";
import { cookieValue } from "../testing.js";
import { createOidcIdentityProvider } from "./oidc.js";

const CLIENT_ID = "my-surveys-test";
const CLIENT_SECRET = "test-client-secret-value";
const PUBLIC_BASE_URL = "http://localhost:5173";
const REDIRECT_URI = `${PUBLIC_BASE_URL}/api/v1/auth/callback`;

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const token = () => randomBytes(16).toString("hex");

function signJwt(key: KeyObject, kid: string, claims: Record<string, unknown>): string {
  const input = `${base64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }))}.${base64url(JSON.stringify(claims))}`;
  return `${input}.${base64url(sign("sha256", Buffer.from(input), key))}`;
}

interface Grant {
  readonly sub: string;
  readonly nonce: string | null;
  readonly challenge: string;
  readonly redirectUri: string;
}

interface FakeIssuerOptions {
  /**
   * `oauth2` mimics auth.surveyjs.io: RFC 8414 metadata only (no JWKS), an opaque access token,
   * no ID token, identity from UserInfo. `openid` is an OpenID provider: openid-configuration,
   * JWKS and a signed ID token as well.
   */
  readonly kind: "oauth2" | "openid";
  /** The issuer's path: "" (an origin, as auth.surveyjs.io) or e.g. "/fake". */
  readonly path?: string;
  /**
   * Serves RFC 8414 metadata at `{issuer}/.well-known/oauth-authorization-server` (as
   * mock-oauth2-server does) instead of `/.well-known/oauth-authorization-server{path}`.
   */
  readonly metadataUnderIssuerPath?: boolean;
  /** Returns a signed ID token (and publishes a JWKS). Default: `kind === "openid"`. */
  readonly idToken?: boolean;
}

/**
 * A minimal authorization server on 127.0.0.1. Its authorization endpoint signs in `nextSubject`
 * at once; the token endpoint checks the client secret, the redirect URI and PKCE; UserInfo
 * resolves the access token.
 */
class FakeIssuer {
  nextSubject: string = ownerUser.id;
  userInfoClaims: Record<string, unknown> = {
    email: "claimed@example.com",
    name: "Claimed Name",
    picture: "https://idp.example/p.png",
  };
  /** Merged into the next ID tokens (to test validation failures). */
  idTokenOverrides: Record<string, unknown> = {};
  /** Signs ID tokens with a key the JWKS does not publish. */
  signWithUnknownKey = false;
  readonly authorizeRequests: URLSearchParams[] = [];
  readonly tokenRequests: URLSearchParams[] = [];
  private readonly grants = new Map<string, Grant>();
  private readonly accessTokens = new Map<string, string>();
  private readonly key = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly unknownKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
  private readonly server: Server;
  private readonly path: string;
  private port = 0;

  constructor(private readonly options: FakeIssuerOptions) {
    this.path = options.path ?? "";
    this.server = createServer((request, response) => {
      void this.handle(request).then(
        ({ status, headers, body }) => response.writeHead(status, headers).end(body),
        () => response.writeHead(500).end(),
      );
    });
  }

  private get issuesIdTokens(): boolean {
    return this.options.idToken ?? this.options.kind === "openid";
  }

  get issuer(): string {
    return `http://127.0.0.1:${this.port}${this.path}`;
  }

  async listen(port = 0): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
    return this;
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private metadataPath(): string {
    if (this.options.kind === "openid") return `${this.path}/.well-known/openid-configuration`;
    return this.options.metadataUnderIssuerPath
      ? `${this.path}/.well-known/oauth-authorization-server`
      : `/.well-known/oauth-authorization-server${this.path}`;
  }

  private metadata() {
    const common = {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      userinfo_endpoint: `${this.issuer}/userinfo`,
      end_session_endpoint: `${this.issuer}/endsession`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    };
    if (!this.issuesIdTokens) return { ...common, scopes_supported: ["profile", "email"] };
    return {
      ...common,
      jwks_uri: `${this.issuer}/jwks`,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    };
  }

  private async handle(
    request: IncomingMessage,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    const url = new URL(request.url ?? "/", this.issuer);
    const json = (status: number, value: unknown) => ({
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(value),
    });
    if (url.pathname === this.metadataPath()) return json(200, this.metadata());
    switch (url.pathname) {
      case `${this.path}/jwks`:
        if (!this.issuesIdTokens) break;
        return json(200, {
          keys: [{ ...this.key.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256" }],
        });
      case `${this.path}/authorize`: {
        const query = url.searchParams;
        this.authorizeRequests.push(query);
        const code = token();
        this.grants.set(code, {
          sub: this.nextSubject,
          nonce: query.get("nonce"),
          challenge: query.get("code_challenge") ?? "",
          redirectUri: query.get("redirect_uri") ?? "",
        });
        const target = new URL(query.get("redirect_uri") ?? "");
        target.searchParams.set("code", code);
        target.searchParams.set("state", query.get("state") ?? "");
        return { status: 302, headers: { location: target.href }, body: "" };
      }
      case `${this.path}/token`:
        return this.token(new URLSearchParams(await text(request)), json);
      case `${this.path}/userinfo`: {
        const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
        const sub = this.accessTokens.get(bearer);
        if (sub === undefined) return { status: 401, headers: {}, body: "" };
        return json(200, { sub, id: sub, ...this.userInfoClaims });
      }
    }
    return json(404, { error: "not_found" });
  }

  private token(
    form: URLSearchParams,
    json: (
      status: number,
      value: unknown,
    ) => { status: number; headers: Record<string, string>; body: string },
  ) {
    this.tokenRequests.push(form);
    if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
      return json(401, { error: "invalid_client" });
    }
    const code = form.get("code") ?? "";
    const grant = this.grants.get(code);
    this.grants.delete(code);
    const valid =
      form.get("grant_type") === "authorization_code" &&
      grant !== undefined &&
      form.get("redirect_uri") === grant.redirectUri &&
      s256(form.get("code_verifier") ?? "") === grant.challenge;
    if (!valid) return json(400, { error: "invalid_grant" });
    const accessToken = token();
    this.accessTokens.set(accessToken, grant.sub);
    const response = { access_token: accessToken, token_type: "Bearer", expires_in: 300 };
    if (!this.issuesIdTokens) return json(200, { ...response, scope: "profile email" });
    const now = Math.floor(Date.now() / 1000);
    const key = this.signWithUnknownKey ? this.unknownKey : this.key;
    const idToken = signJwt(key.privateKey, "k1", {
      iss: this.issuer,
      sub: grant.sub,
      aud: CLIENT_ID,
      iat: now,
      exp: now + 300,
      ...(grant.nonce !== null && { nonce: grant.nonce }),
      ...this.idTokenOverrides,
    });
    return json(200, { ...response, id_token: idToken });
  }
}

async function text(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

let app: FastifyInstance | undefined;
let issuer: FakeIssuer | undefined;

async function start(
  issuerUrl: string,
  discovery: "oauth-authorization-server" | "openid-configuration" = "oauth-authorization-server",
): Promise<FastifyInstance> {
  const config = loadConfig({
    NODE_ENV: "test",
    MEMORY_SEED: "legacy-fixtures",
    PUBLIC_BASE_URL,
    OIDC_ISSUER_URL: issuerUrl,
    OIDC_CLIENT_ID: CLIENT_ID,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_DISCOVERY: discovery,
  });
  app = await buildApp(config, await createProviders(config));
  return app;
}

async function startWithIssuer(
  options: FakeIssuerOptions = { kind: "oauth2" },
): Promise<{ server: FastifyInstance; fake: FakeIssuer }> {
  issuer = await new FakeIssuer(options).listen();
  const discovery = options.kind === "openid" ? "openid-configuration" : undefined;
  return { server: await start(issuer.issuer, discovery), fake: issuer };
}

afterEach(async () => {
  await app?.close();
  await issuer?.close();
  app = undefined;
  issuer = undefined;
});

/** `login`, then the browser's trip through the issuer; returns the callback response. */
async function signInThroughIssuer(server: FastifyInstance, returnTo = "/") {
  const login = await server.inject(`/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  expect(login.statusCode).toBe(302);
  const authorize = await fetch(String(login.headers.location), { redirect: "manual" });
  const callbackUrl = new URL(authorize.headers.get("location") ?? "");
  expect(callbackUrl.origin + callbackUrl.pathname).toBe(REDIRECT_URI);
  return server.inject({
    url: callbackUrl.pathname + callbackUrl.search,
    headers: { cookie: `msid_auth=${cookieValue(login, "msid_auth") ?? ""}` },
  });
}

function sessionHeaders(callback: Awaited<ReturnType<typeof signInThroughIssuer>>) {
  const msid = cookieValue(callback, "msid") ?? "";
  const csrf = cookieValue(callback, "msid_csrf") ?? "";
  return { cookie: `msid=${msid}; msid_csrf=${csrf}`, "x-csrf-token": csrf };
}

const params = { state: "state-1", nonce: "nonce-1", codeVerifier: "v".repeat(43) };

describe("surveyjs-oidc provider against an auth.surveyjs.io-like server (OAuth 2.0 + UserInfo)", () => {
  it("builds the authorization URL: code flow, PKCE S256, state, OAuth scopes, no nonce", async () => {
    issuer = await new FakeIssuer({ kind: "oauth2" }).listen();
    const provider = createOidcIdentityProvider({
      oidc: {
        issuerUrl: issuer.issuer,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        discovery: "oauth-authorization-server",
        scopes: "profile email",
      },
      publicBaseUrl: PUBLIC_BASE_URL,
    });
    const url = await provider.authorizationUrl(params);
    expect(url.origin + url.pathname).toBe(`${issuer.issuer}/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: "profile email",
      state: "state-1",
      code_challenge: s256(params.codeVerifier),
      code_challenge_method: "S256",
    });
  });

  it("signs in with the UserInfo identity, uses the directory's user, and logs out at end_session_endpoint", async () => {
    const { server, fake } = await startWithIssuer();
    const callback = await signInThroughIssuer(server, "/surveys?view=1");
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${PUBLIC_BASE_URL}/surveys?view=1`);
    // The token request authenticated the client and sent the PKCE verifier.
    expect(fake.tokenRequests).toHaveLength(1);
    expect(fake.tokenRequests[0]?.get("code_verifier")).toBeTruthy();

    const headers = sessionHeaders(callback);
    const me = await server.inject({ url: "/api/v1/me", headers });
    expect(me.json()).toEqual({
      id: ownerUser.id,
      displayName: "Olivia Owner",
      email: "owner@example.com",
      avatarUrl: "https://idp.example/p.png",
      notices: [],
    });

    const logout = await server.inject({ method: "POST", url: "/api/v1/auth/logout", headers });
    expect(logout.statusCode).toBe(200);
    const redirect = new URL((logout.json() as { redirectUrl: string }).redirectUrl);
    expect(redirect.origin + redirect.pathname).toBe(`${fake.issuer}/endsession`);
    expect(Object.fromEntries(redirect.searchParams)).toEqual({
      client_id: CLIENT_ID,
      post_logout_redirect_uri: `${PUBLIC_BASE_URL}/`,
    });
  });

  it("uses the UserInfo claims for a user the directory does not know", async () => {
    const { server, fake } = await startWithIssuer();
    fake.nextSubject = "someone-new";
    const callback = await signInThroughIssuer(server);
    const me = await server.inject({ url: "/api/v1/me", headers: sessionHeaders(callback) });
    expect(me.json()).toMatchObject({
      id: "someone-new",
      displayName: "Claimed Name",
      email: "claimed@example.com",
    });
  });

  it("a blocked user gets 403 forbidden", async () => {
    const { server, fake } = await startWithIssuer();
    fake.nextSubject = blockedUser.id;
    const callback = await signInThroughIssuer(server);
    expect(callback.statusCode).toBe(403);
    expect(cookieValue(callback, "msid")).toBeUndefined();
  });

  it("rejects an unknown code with 400 bad-request", async () => {
    const { server } = await startWithIssuer();
    const login = await server.inject("/api/v1/auth/login");
    const state = new URL(String(login.headers.location)).searchParams.get("state") ?? "";
    const callback = await server.inject({
      url: `/api/v1/auth/callback?code=unknown&state=${encodeURIComponent(state)}`,
      headers: { cookie: `msid_auth=${cookieValue(login, "msid_auth") ?? ""}` },
    });
    expect(callback.statusCode).toBe(400);
    expect(callback.json()).toMatchObject({ code: "bad-request" });
  });

  it("validates an ID token it did not ask for (as the mock OIDC server sends) and matches UserInfo", async () => {
    const { server, fake } = await startWithIssuer({ kind: "oauth2", idToken: true });
    expect((await signInThroughIssuer(server)).statusCode).toBe(302);
    fake.idTokenOverrides = { sub: "someone-else" };
    expect((await signInThroughIssuer(server)).statusCode).toBe(400);
    fake.idTokenOverrides = {};
    fake.signWithUnknownKey = true;
    expect((await signInThroughIssuer(server)).statusCode).toBe(400);
  });

  it("finds RFC 8414 metadata under the issuer path too (as mock-oauth2-server serves it)", async () => {
    const { server } = await startWithIssuer({
      kind: "oauth2",
      path: "/fake",
      metadataUnderIssuerPath: true,
    });
    expect((await signInThroughIssuer(server)).statusCode).toBe(302);
  });

  it("an unreachable issuer does not fail start-up or /readyz; login answers 500 internal-error", async () => {
    const server = await start(`http://127.0.0.1:${await freePort()}`);
    expect((await server.inject("/readyz")).statusCode).toBe(200);
    const login = await server.inject("/api/v1/auth/login");
    expect(login.statusCode).toBe(500);
    expect(login.headers["content-type"]).toContain("application/problem+json");
    expect(login.json()).toMatchObject({ code: "internal-error", status: 500 });
    expect(login.body).not.toContain(CLIENT_SECRET);
    expect(login.cookies).toEqual([]);
  });

  it("retries discovery after a failure", async () => {
    const port = await freePort();
    const server = await start(`http://127.0.0.1:${port}`);
    expect((await server.inject("/api/v1/auth/login")).statusCode).toBe(500);
    issuer = await new FakeIssuer({ kind: "oauth2" }).listen(port);
    const login = await server.inject("/api/v1/auth/login");
    expect(login.statusCode).toBe(302);
    expect(String(login.headers.location)).toMatch(new RegExp(`^${issuer.issuer}/authorize\\?`));
  });

  it("logout still answers when the issuer cannot be reached: back to the site", async () => {
    const { server } = await startWithIssuer();
    const headers = sessionHeaders(await signInThroughIssuer(server));
    // A fresh server (no cached discovery) whose issuer is down.
    await server.close();
    const restarted = await start(`http://127.0.0.1:${await freePort()}`);
    const logout = await restarted.inject({ method: "POST", url: "/api/v1/auth/logout", headers });
    expect(logout.statusCode).toBe(200);
    expect(logout.json()).toEqual({ redirectUrl: `${PUBLIC_BASE_URL}/` });
  });
});

describe("surveyjs-oidc provider against an OpenID provider (OIDC_DISCOVERY=openid-configuration)", () => {
  it("sends a nonce and the openid scope", async () => {
    const { server, fake } = await startWithIssuer({ kind: "openid", path: "/fake" });
    expect((await signInThroughIssuer(server)).statusCode).toBe(302);
    const query = fake.authorizeRequests[0];
    expect(query?.get("scope")).toBe("openid profile email");
    expect(query?.get("nonce")).toBeTruthy();
    expect(query?.get("code_challenge_method")).toBe("S256");
  });

  it("validates the ID token and takes the identity from UserInfo", async () => {
    const { server } = await startWithIssuer({ kind: "openid", path: "/fake" });
    const callback = await signInThroughIssuer(server);
    expect(callback.statusCode).toBe(302);
    const me = await server.inject({ url: "/api/v1/me", headers: sessionHeaders(callback) });
    expect(me.json()).toMatchObject({ id: ownerUser.id, avatarUrl: "https://idp.example/p.png" });
  });

  it.each([
    [
      "an ID token for another nonce",
      (fake: FakeIssuer) => (fake.idTokenOverrides = { nonce: "x" }),
    ],
    [
      "an ID token from another issuer",
      (fake: FakeIssuer) => (fake.idTokenOverrides = { iss: "x" }),
    ],
    ["an expired ID token", (fake: FakeIssuer) => (fake.idTokenOverrides = { exp: 1_000_000 })],
    ["an ID token with a bad signature", (fake: FakeIssuer) => (fake.signWithUnknownKey = true)],
    [
      "an ID token whose sub differs from UserInfo",
      (fake: FakeIssuer) => (fake.idTokenOverrides = { sub: "someone-else" }),
    ],
  ])("rejects %s with 400 bad-request and no session", async (_name, tamper) => {
    const { server, fake } = await startWithIssuer({ kind: "openid", path: "/fake" });
    tamper(fake);
    const callback = await signInThroughIssuer(server);
    expect(callback.statusCode).toBe(400);
    expect(callback.json()).toMatchObject({ code: "bad-request" });
    expect(cookieValue(callback, "msid")).toBeUndefined();
  });
});
