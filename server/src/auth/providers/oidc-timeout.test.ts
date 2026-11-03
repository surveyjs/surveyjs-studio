import * as client from "openid-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../config.js";
import { startOAuthStub, type OAuthStub } from "../../testing/oauth-stub.js";
import { createSignInProviders } from "./index.js";
import { transaction } from "./stub-flow.js";

// The real discovery, watched: its options and the configuration it resolves.
vi.mock("openid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openid-client")>();
  return { ...actual, discovery: vi.fn(actual.discovery) };
});

let stub: OAuthStub | undefined;
afterEach(async () => {
  await stub?.close();
  stub = undefined;
  vi.mocked(client.discovery).mockClear();
});

describe("the OpenID providers' time-out", () => {
  it("gives Google and surveyjs.io 10 seconds per call, like GitHub and Facebook", async () => {
    stub = await startOAuthStub();
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_BASE_URL: "http://localhost:5173",
      USER_DIRECTORY: "local",
      AUTH_METHODS: "password,surveyjs,google",
      OAUTH_STUB_URL: stub.url,
      OIDC_ISSUER_URL: `${stub.url}/surveyjs`,
      OIDC_CLIENT_ID: "s-client",
      OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
      GOOGLE_CLIENT_ID: "g-client",
      GOOGLE_CLIENT_SECRET: "stub-secret-google",
    });
    const { byMethod } = await createSignInProviders(config);
    for (const method of ["surveyjs", "google"] as const) {
      await byMethod.get(method)?.authorizationUrl(transaction);
    }

    const discoveries = vi.mocked(client.discovery).mock;
    expect(discoveries.calls).toHaveLength(2);
    for (const [index, call] of discoveries.calls.entries()) {
      expect(call[4]?.timeout).toBe(10);
      const resolved = (await discoveries.results[index]?.value) as client.Configuration;
      expect(resolved.timeout).toBe(10);
    }
  });
});
