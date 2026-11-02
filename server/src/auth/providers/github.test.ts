import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../../errors.js";
import { startOAuthStub, type OAuthStub } from "../../testing/oauth-stub.js";
import { githubEndpoints } from "./endpoints.js";
import { createGithubIdentityProvider } from "./github.js";
import { authorizeAtStub, CALLBACK_URL, PUBLIC_BASE_URL, transaction } from "./stub-flow.js";

let stub: OAuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

async function provider(secret = "stub-secret-github") {
  stub ??= await startOAuthStub();
  return createGithubIdentityProvider({
    client: { clientId: "gh-client", clientSecret: secret },
    publicBaseUrl: PUBLIC_BASE_URL,
    endpoints: githubEndpoints(stub.url),
  });
}

describe("githubEndpoints", () => {
  it("points at GitHub, or at the stub", () => {
    expect(githubEndpoints(null)).toEqual({
      authorize: "https://github.com/login/oauth/authorize",
      token: "https://github.com/login/oauth/access_token",
      api: "https://api.github.com",
    });
    expect(githubEndpoints("http://127.0.0.1:9").api).toBe("http://127.0.0.1:9/github-api");
  });
});

describe("GitHub identity provider", () => {
  it("builds the authorization URL: scopes, state and PKCE", async () => {
    const url = await (await provider()).authorizationUrl(transaction);
    expect(url.origin + url.pathname).toBe(`${stub?.url}/github/login/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "gh-client",
      redirect_uri: CALLBACK_URL,
      scope: "read:user user:email",
      state: "state-1",
      code_challenge: createHash("sha256").update(transaction.codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    });
  });

  it("signs in with the user and the primary email", async () => {
    const github = await provider();
    const callback = await authorizeAtStub(github);
    const claims = await github.finishSignIn(callback, transaction);
    expect(claims).toMatchObject({
      sub: expect.stringMatching(/^\d+$/) as unknown,
      email: "ada@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
    });
    expect(claims.picture).toContain("/github-api/avatars/");
  });

  it("reports an email GitHub did not verify as unverified", async () => {
    const github = await provider();
    const claims = await github.finishSignIn(
      await authorizeAtStub(github, { sub: "7", verified: false }),
      transaction,
    );
    expect(claims).toMatchObject({ sub: "7", email: "ada@example.com", emailVerified: false });
  });

  it("falls back to the login when the account has no name", async () => {
    const github = await provider();
    const claims = await github.finishSignIn(
      await authorizeAtStub(github, { name: "", email: "grace@example.com" }),
      transaction,
    );
    expect(claims.name).toBe("grace");
  });

  it("answers 400 for a code the provider rejects", async () => {
    const github = await provider();
    const callback = await authorizeAtStub(github);
    callback.searchParams.set("code", "not-a-code");
    await expect(github.finishSignIn(callback, transaction)).rejects.toMatchObject({
      status: 400,
      title: "Sign-in failed",
    });
  });

  it("answers 400 for a reused code and for a denied sign-in", async () => {
    const github = await provider();
    const callback = await authorizeAtStub(github);
    await github.finishSignIn(callback, transaction);
    await expect(github.finishSignIn(callback, transaction)).rejects.toMatchObject({ status: 400 });
    const denied = new URL(`${CALLBACK_URL}?error=access_denied&state=state-1`);
    await expect(github.finishSignIn(denied, transaction)).rejects.toMatchObject({ status: 400 });
  });

  it("answers 400 when the state does not match", async () => {
    const github = await provider();
    const callback = await authorizeAtStub(github);
    await expect(
      github.finishSignIn(callback, { ...transaction, state: "other" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("answers 500 unavailable when the provider cannot be reached, and logs no secret", async () => {
    const github = await provider();
    const callback = await authorizeAtStub(github);
    await stub?.close();
    const error = await github.finishSignIn(callback, transaction).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 500, title: "Sign-in is unavailable" });
    expect(JSON.stringify(error)).not.toContain("stub-secret");
  });

  it("answers 500 when the client secret is rejected", async () => {
    const github = await provider("wrong-secret");
    const callback = await authorizeAtStub(github);
    await expect(github.finishSignIn(callback, transaction)).rejects.toMatchObject({
      status: 500,
    });
  });
});
