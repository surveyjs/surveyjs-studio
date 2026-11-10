import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startOAuthStub, type OAuthStub } from "../../testing/oauth-stub.js";
import { FACEBOOK_GRAPH_VERSION, facebookEndpoints, googleIssuer } from "./endpoints.js";
import { createFacebookIdentityProvider } from "./facebook.js";
import {
  authorizeAtStub,
  CALLBACK_URL,
  loggedError,
  PUBLIC_BASE_URL,
  transaction,
} from "./stub-flow.js";

let stub: OAuthStub | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await stub?.close();
  stub = undefined;
});

/** Records the status and body of each answer to the code exchange from now on. */
function tokenAnswers(): { status: number; body: unknown }[] {
  const answers: { status: number; body: unknown }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const response = await real(input, init);
    if (new URL(String(input)).pathname.endsWith("/oauth/access_token")) {
      answers.push({ status: response.status, body: await response.clone().json() });
    }
    return response;
  });
  return answers;
}

async function provider(secret = "stub-secret-facebook") {
  stub ??= await startOAuthStub();
  return createFacebookIdentityProvider({
    client: { clientId: "fb-client", clientSecret: secret },
    publicBaseUrl: PUBLIC_BASE_URL,
    endpoints: facebookEndpoints(stub.url),
  });
}

describe("facebookEndpoints and googleIssuer", () => {
  it("point at the real hosts, or at the stub", () => {
    expect(FACEBOOK_GRAPH_VERSION).toBe("v23.0");
    expect(facebookEndpoints(null)).toEqual({
      authorize: "https://www.facebook.com/v23.0/dialog/oauth",
      graph: "https://graph.facebook.com/v23.0",
    });
    expect(facebookEndpoints("http://127.0.0.1:9").graph).toBe("http://127.0.0.1:9/facebook-graph");
    expect(googleIssuer(null)).toBe("https://accounts.google.com");
    expect(googleIssuer("http://127.0.0.1:9")).toBe("http://127.0.0.1:9/google");
  });
});

describe("Facebook identity provider", () => {
  it("builds the authorization URL: scope, state and PKCE", async () => {
    const url = await (await provider()).authorizationUrl(transaction);
    expect(url.origin + url.pathname).toBe(`${stub?.url}/facebook/dialog/oauth`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "fb-client",
      redirect_uri: CALLBACK_URL,
      scope: "email",
      state: "state-1",
      response_type: "code",
      code_challenge: createHash("sha256").update(transaction.codeVerifier).digest("base64url"),
      code_challenge_method: "S256",
    });
  });

  it("signs in with the Graph profile; the stub checks appsecret_proof", async () => {
    const facebook = await provider();
    const claims = await facebook.finishSignIn(await authorizeAtStub(facebook), transaction);
    expect(claims).toEqual({
      sub: "u-42",
      email: "ada@example.com",
      emailVerified: true,
      name: "Ada Lovelace",
    });
  });

  it("has no email, and so no verified email, when Facebook shares none", async () => {
    const facebook = await provider();
    const claims = await facebook.finishSignIn(
      await authorizeAtStub(facebook, { verified: false }),
      transaction,
    );
    expect(claims.email).toBeUndefined();
    expect(claims.emailVerified).toBe(false);
  });

  it("answers 400 for a bad code (Graph error code 100) and for a denied sign-in", async () => {
    const facebook = await provider();
    const callback = await authorizeAtStub(facebook);
    callback.searchParams.set("code", "not-a-code");
    const answers = tokenAnswers();
    await expect(facebook.finishSignIn(callback, transaction)).rejects.toMatchObject({
      status: 400,
      title: "Sign-in failed",
    });
    expect(answers).toMatchObject([
      { status: 400, body: { error: { type: "OAuthException", code: 100 } } },
    ]);
    const denied = new URL(`${CALLBACK_URL}?error=access_denied&state=state-1`);
    await expect(facebook.finishSignIn(denied, transaction)).rejects.toMatchObject({ status: 400 });
  });

  it("answers 500 unavailable when Facebook cannot be reached", async () => {
    const facebook = await provider();
    const callback = await authorizeAtStub(facebook);
    await stub?.close();
    const error = await facebook.finishSignIn(callback, transaction).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 500, title: "Sign-in is unavailable" });
    const logged = await loggedError(error);
    expect(logged).toContain("fetch failed");
    expect(logged).not.toContain("stub-secret");
    expect(logged).not.toContain(callback.searchParams.get("code"));
  });

  it("answers 500 when the client secret is rejected (a Graph error of another code)", async () => {
    const facebook = await provider("wrong-secret");
    const callback = await authorizeAtStub(facebook);
    const answers = tokenAnswers();
    await expect(facebook.finishSignIn(callback, transaction)).rejects.toMatchObject({
      status: 500,
    });
    expect(answers).toMatchObject([{ status: 400, body: { error: { code: 1 } } }]);
  });
});
