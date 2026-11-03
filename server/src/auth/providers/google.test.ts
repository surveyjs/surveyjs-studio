import { afterEach, describe, expect, it } from "vitest";
import { startOAuthStub, type OAuthStub } from "../../testing/oauth-stub.js";
import { googleIssuer } from "./endpoints.js";
import { createOidcIdentityProvider, verifiedUnlessFalse } from "./oidc.js";
import { authorizeAtStub, PUBLIC_BASE_URL, transaction } from "./stub-flow.js";

let stub: OAuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
});

async function google() {
  stub ??= await startOAuthStub();
  return createOidcIdentityProvider({
    oidc: {
      issuerUrl: googleIssuer(stub.url),
      clientId: "g-client",
      clientSecret: "stub-secret-google",
      discovery: "openid-configuration",
      scopes: "openid email profile",
    },
    publicBaseUrl: PUBLIC_BASE_URL,
    emailVerified: (userInfo) => userInfo.email_verified === true,
  });
}

describe("Google as an OpenID provider", () => {
  it("sends the openid scope, a nonce, state and PKCE", async () => {
    const url = await (await google()).authorizationUrl(transaction);
    expect(url.origin + url.pathname).toBe(`${stub?.url}/google/authorize`);
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBe("nonce-1");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("validates the ID token with its nonce and reads the email_verified claim", async () => {
    const provider = await google();
    const verified = await provider.finishSignIn(await authorizeAtStub(provider), transaction);
    expect(verified).toMatchObject({
      sub: "u-42",
      email: "ada@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
    });
    const unverified = await provider.finishSignIn(
      await authorizeAtStub(provider, { verified: false }),
      transaction,
    );
    expect(unverified.emailVerified).toBe(false);
  });

  it("answers 400 when the nonce does not match the transaction", async () => {
    const provider = await google();
    const callback = await authorizeAtStub(provider);
    await expect(
      provider.finishSignIn(callback, { ...transaction, nonce: "another" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("the surveyjs.io email rule", () => {
  it("verifies unless UserInfo says email_verified: false", async () => {
    stub = await startOAuthStub();
    const provider = createOidcIdentityProvider({
      oidc: {
        issuerUrl: `${stub.url}/surveyjs`,
        clientId: "s-client",
        clientSecret: "stub-secret-surveyjs",
        discovery: "oauth-authorization-server",
        scopes: "profile email",
      },
      publicBaseUrl: PUBLIC_BASE_URL,
      emailVerified: verifiedUnlessFalse,
    });
    const verified = await provider.finishSignIn(await authorizeAtStub(provider), transaction);
    expect(verified.emailVerified).toBe(true);
    const unverified = await provider.finishSignIn(
      await authorizeAtStub(provider, { verified: false }),
      transaction,
    );
    expect(unverified.emailVerified).toBe(false);
  });
});
