import { createHash, createHmac, createPublicKey, verify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startOAuthStub, type OAuthStub } from "./oauth-stub.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const REDIRECT = "http://localhost:5173/api/v1/auth/callback";
const VERIFIER = "v".repeat(48);
const s256 = (value: string) => createHash("sha256").update(value).digest("base64url");

let stub: OAuthStub | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await stub?.close();
  stub = undefined;
});

async function start(): Promise<string> {
  stub = await startOAuthStub();
  return stub.url;
}

interface Flow {
  readonly provider: string;
  readonly title: string;
  readonly authorizePath: string;
  readonly tokenPath: string;
}

const google: Flow = {
  provider: "google",
  title: "Google",
  authorizePath: "/google/authorize",
  tokenPath: "/google/token",
};
const surveyjs: Flow = {
  provider: "surveyjs",
  title: "surveyjs.io",
  authorizePath: "/surveyjs/authorize",
  tokenPath: "/surveyjs/token",
};
const github: Flow = {
  provider: "github",
  title: "GitHub",
  authorizePath: "/github/login/oauth/authorize",
  tokenPath: "/github/login/oauth/access_token",
};
const facebook: Flow = {
  provider: "facebook",
  title: "Facebook",
  authorizePath: "/facebook/dialog/oauth",
  tokenPath: "/facebook-graph/oauth/access_token",
};

const identity = { sub: "u-42", email: "ada@example.com", name: "Ada Lovelace" };

/** Fetches the form, posts it and returns the redirect target. */
async function authorize(
  base: string,
  flow: Flow,
  extra: Record<string, string> = {},
  post: Record<string, string> = { ...identity, email_verified: "on" },
): Promise<URL> {
  const query = new URLSearchParams({
    client_id: "any-client",
    redirect_uri: REDIRECT,
    response_type: "code",
    state: "state-1",
    code_challenge: s256(VERIFIER),
    code_challenge_method: "S256",
    ...extra,
  });
  const form = await fetch(`${base}${flow.authorizePath}?${query}`);
  expect(form.status).toBe(200);
  const html = await form.text();
  for (const name of ["sub", "email", "name", "email_verified"]) {
    expect(html).toContain(`name="${name}"`);
  }
  const body = new URLSearchParams(query);
  for (const [key, value] of Object.entries(post)) body.set(key, value);
  const response = await fetch(`${base}${flow.authorizePath}`, {
    method: "POST",
    body,
    redirect: "manual",
  });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "");
}

async function codeOf(base: string, flow: Flow): Promise<string> {
  return (await authorize(base, flow)).searchParams.get("code") ?? "";
}

async function exchange(
  base: string,
  flow: Flow,
  code: string,
  overrides: Record<string, string> = {},
): Promise<Response> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "any-client",
    client_secret: `stub-secret-${flow.provider}`,
    code,
    redirect_uri: REDIRECT,
    code_verifier: VERIFIER,
    ...overrides,
  });
  if (flow.provider === "facebook") return fetch(`${base}${flow.tokenPath}?${params}`);
  return fetch(`${base}${flow.tokenPath}`, {
    method: "POST",
    body: params,
    headers: { accept: "application/json" },
  });
}

describe.each([google, surveyjs, github, facebook])("$provider: sign-in flow", (flow) => {
  it("serves the form with its title and echoes the request as hidden fields, escaped", async () => {
    const base = await start();
    const query = new URLSearchParams({ redirect_uri: REDIRECT, state: '"><script>x</script>' });
    const html = await (await fetch(`${base}${flow.authorizePath}?${query}`)).text();
    expect(html).toContain(`<title>Sign in to the ${flow.title} stub</title>`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toMatch(/name="email_verified"[^>]*checked/);
  });

  it("gives a code with the state, exchanges it once, and refuses a reuse", async () => {
    const base = await start();
    const target = await authorize(base, flow);
    expect(target.origin + target.pathname).toBe(REDIRECT);
    expect(target.searchParams.get("state")).toBe("state-1");
    const code = target.searchParams.get("code") ?? "";
    expect(code).not.toBe("");

    const token = await exchange(base, flow, code);
    expect(token.status).toBe(200);
    expect((await token.json()) as Json).toMatchObject({ access_token: expect.any(String) });

    const again = await exchange(base, flow, code);
    expect(again.status).toBe(400);
    expect((await again.json()) as Json).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses a wrong PKCE verifier and a wrong client secret", async () => {
    const base = await start();
    const bad = await exchange(base, flow, await codeOf(base, flow), {
      code_verifier: "w".repeat(48),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()) as Json).toMatchObject({ error: "invalid_grant" });

    const wrongSecret = await exchange(base, flow, await codeOf(base, flow), {
      client_secret: "nope",
    });
    expect(wrongSecret.status).toBe(401);
    expect((await wrongSecret.json()) as Json).toMatchObject({ error: "invalid_client" });
  });

  it("refuses another redirect_uri and another client id", async () => {
    const base = await start();
    const other = await exchange(base, flow, await codeOf(base, flow), {
      redirect_uri: "http://x/y",
    });
    expect(other.status).toBe(400);
    const client = await exchange(base, flow, await codeOf(base, flow), { client_id: "other" });
    expect(client.status).toBe(400);
  });

  it("redirects with access_denied when the deny button is used", async () => {
    const base = await start();
    const target = await authorize(base, flow, {}, { deny: "1" });
    expect(target.searchParams.get("error")).toBe("access_denied");
    expect(target.searchParams.get("state")).toBe("state-1");
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("expires a code after 60 seconds", async () => {
    const base = await start();
    const code = await codeOf(base, flow);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 61_000 });
    expect((await exchange(base, flow, code)).status).toBe(400);
  });
});

describe("Google", () => {
  it("publishes OpenID metadata and signs an ID token that verifies against the JWKS", async () => {
    const base = await start();
    const metadata = (await (
      await fetch(`${base}/google/.well-known/openid-configuration`)
    ).json()) as Json;
    expect(metadata).toMatchObject({
      issuer: `${base}/google`,
      authorization_endpoint: `${base}/google/authorize`,
      token_endpoint: `${base}/google/token`,
      userinfo_endpoint: `${base}/google/userinfo`,
      jwks_uri: `${base}/google/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata.token_endpoint_auth_methods_supported).toContain("client_secret_post");

    const target = await authorize(base, google, { nonce: "n-1" });
    const token = (await (
      await exchange(base, google, target.searchParams.get("code")!)
    ).json()) as Json;
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBeGreaterThan(0);

    const [header, payload, signature] = (token.id_token as string).split(".") as [
      string,
      string,
      string,
    ];
    const jwks = (await (await fetch(`${base}/google/jwks`)).json()) as Json;
    const kid = JSON.parse(Buffer.from(header, "base64url").toString()).kid;
    const jwk = jwks.keys.find((k: { kid: string }) => k.kid === kid);
    const key = createPublicKey({ key: jwk, format: "jwk" });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        key,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({
      iss: `${base}/google`,
      aud: "any-client",
      sub: "u-42",
      nonce: "n-1",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });
    expect(claims.exp).toBeGreaterThan(claims.iat);

    const info = await fetch(`${base}/google/userinfo`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect((await info.json()) as Json).toMatchObject({ sub: "u-42", email: "ada@example.com" });
  });

  it("refuses a userinfo call without a valid bearer token", async () => {
    const base = await start();
    expect((await fetch(`${base}/google/userinfo`)).status).toBe(401);
  });
});

describe("surveyjs.io", () => {
  it("publishes RFC 8414 metadata and answers UserInfo without an ID token", async () => {
    const base = await start();
    for (const path of [
      "/surveyjs/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/surveyjs",
    ]) {
      expect((await (await fetch(`${base}${path}`)).json()) as Json).toMatchObject({
        issuer: `${base}/surveyjs`,
        token_endpoint: `${base}/surveyjs/token`,
        userinfo_endpoint: `${base}/surveyjs/userinfo`,
      });
    }
    const token = (await (
      await exchange(base, surveyjs, await codeOf(base, surveyjs))
    ).json()) as Json;
    expect(token.id_token).toBeUndefined();
    const info = await fetch(`${base}/surveyjs/userinfo`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    expect((await info.json()) as Json).toEqual({
      sub: "u-42",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada Lovelace",
    });
  });
});

describe("GitHub", () => {
  it("answers /user and /user/emails; the id is the numeric sub", async () => {
    const base = await start();
    const target = await authorize(base, github, {}, { ...identity, sub: "1234" });
    const token = (await (
      await exchange(base, github, target.searchParams.get("code")!)
    ).json()) as Json;
    const headers = { authorization: `Bearer ${token.access_token}` };
    const user = (await (await fetch(`${base}/github-api/user`, { headers })).json()) as Json;
    expect(user).toMatchObject({ id: 1234, name: "Ada Lovelace" });
    expect(user.login).toEqual(expect.any(String));
    expect(user.avatar_url).toEqual(expect.any(String));
    const emails = (await (
      await fetch(`${base}/github-api/user/emails`, { headers })
    ).json()) as Json;
    // The checkbox was not posted, so the email is unverified.
    expect(emails).toEqual([{ email: "ada@example.com", primary: true, verified: false }]);
  });

  it("hashes a non-numeric sub to a stable number and reports a verified email", async () => {
    const base = await start();
    const ids: number[] = [];
    for (let i = 0; i < 2; i++) {
      const token = (await (
        await exchange(base, github, await codeOf(base, github))
      ).json()) as Json;
      const headers = { authorization: `token ${token.access_token}` };
      ids.push(((await (await fetch(`${base}/github-api/user`, { headers })).json()) as Json).id);
      const emails = (await (
        await fetch(`${base}/github-api/user/emails`, { headers })
      ).json()) as Json;
      expect(emails[0].verified).toBe(true);
    }
    expect(ids[0]).toBe(ids[1]);
    expect(Number.isSafeInteger(ids[0])).toBe(true);
  });

  it("answers urlencoded unless JSON is accepted", async () => {
    const base = await start();
    const response = await fetch(`${base}${github.tokenPath}`, {
      method: "POST",
      body: new URLSearchParams({
        client_id: "any-client",
        client_secret: "stub-secret-github",
        code: await codeOf(base, github),
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      }),
    });
    expect(new URLSearchParams(await response.text()).get("access_token")).toBeTruthy();
  });

  it("refuses /user without a valid token", async () => {
    const base = await start();
    expect((await fetch(`${base}/github-api/user`)).status).toBe(401);
  });
});

describe("Facebook", () => {
  async function accessToken(base: string, post?: Record<string, string>): Promise<string> {
    const target = await authorize(base, facebook, {}, post);
    return (
      (await (await exchange(base, facebook, target.searchParams.get("code")!)).json()) as Json
    ).access_token;
  }
  const proof = (token: string) =>
    createHmac("sha256", "stub-secret-facebook").update(token).digest("hex");

  it("answers /me with a valid appsecret_proof and refuses a wrong one", async () => {
    const base = await start();
    const token = await accessToken(base);
    const query = `fields=id,name,email&access_token=${token}`;
    const me = await fetch(`${base}/facebook-graph/me?${query}&appsecret_proof=${proof(token)}`);
    expect((await me.json()) as Json).toEqual({
      id: "u-42",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    const bad = await fetch(`${base}/facebook-graph/me?${query}&appsecret_proof=bad`);
    expect(bad.status).toBe(400);
  });

  it("omits the email when the checkbox is off", async () => {
    const base = await start();
    const token = await accessToken(base, identity);
    const query = `fields=id,name,email&access_token=${token}&appsecret_proof=${proof(token)}`;
    const me = await fetch(`${base}/facebook-graph/me?${query}`);
    expect((await me.json()) as Json).toEqual({ id: "u-42", name: "Ada Lovelace" });
  });
});
