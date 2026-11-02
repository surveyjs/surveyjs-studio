import { calculatePKCECodeChallenge } from "openid-client";
import type { OAuthClient } from "../../config.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "../identity.js";
import type { GithubEndpoints } from "./endpoints.js";
import { CALLBACK_PATH } from "./oidc.js";
import { asSignInError, authorizationCode, readJson, signInFailed } from "./sign-in-error.js";

export interface GithubIdentityOptions {
  readonly client: OAuthClient;
  readonly publicBaseUrl: string;
  readonly endpoints: GithubEndpoints;
}

const TIMEOUT_MS = 10_000;
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * GitHub sign-in (OAuth 2.0 authorization code flow, state and PKCE). The identity comes from
 * `GET /user` (id, name, avatar) and `GET /user/emails`: the primary address and whether GitHub
 * verified it. Tokens are discarded after the callback.
 */
export function createGithubIdentityProvider(options: GithubIdentityOptions): IdentityProvider {
  const { client, publicBaseUrl, endpoints } = options;
  const redirectUri = publicUrl(publicBaseUrl, CALLBACK_PATH);
  const api = endpoints.api.replace(/\/+$/, "");

  async function getJson(path: string, accessToken: string): Promise<unknown> {
    const response = await fetch(`${api}${path}`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return response.json();
  }

  async function exchange(code: string, codeVerifier: string): Promise<string> {
    const response = await fetch(endpoints.token, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status >= 500) throw new Error(`GitHub answered ${response.status}`);
    const body = await readJson(response);
    // A bad or reused code is a 200 (or 4xx) with an `error` field.
    if (typeof body.error === "string") {
      if (["bad_verification_code", "invalid_grant", "access_denied"].includes(body.error)) {
        throw signInFailed();
      }
      throw new Error(`GitHub refused the token request: ${body.error}`);
    }
    const accessToken = text(body.access_token);
    if (!accessToken) throw new Error("GitHub sent no access token");
    return accessToken;
  }

  return {
    authorizationUrl: async ({ state, codeVerifier }) => {
      const url = new URL(endpoints.authorize);
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "read:user user:email");
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", await calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      return url;
    },

    finishSignIn: async (callback, { state, codeVerifier }): Promise<IdentityClaims> => {
      const code = authorizationCode(callback, state);
      try {
        const accessToken = await exchange(code, codeVerifier);
        const user = await getJson("/user", accessToken);
        const emails = await getJson("/user/emails", accessToken);
        if (typeof user !== "object" || user === null || !Array.isArray(emails)) {
          throw new Error("GitHub answered with an unexpected shape");
        }
        const { id, name: fullName, login, avatar_url: avatar } = user as Record<string, unknown>;
        if (typeof id !== "number" && typeof id !== "string") {
          throw new Error("GitHub sent no user id");
        }
        const primary = (emails as Record<string, unknown>[]).find(
          (entry) => entry.primary === true,
        );
        const email = text(primary?.email);
        const name = text(fullName) ?? text(login);
        const picture = text(avatar);
        return {
          sub: String(id),
          ...(email && { email }),
          emailVerified: email !== undefined && primary?.verified === true,
          ...(name && { name }),
          ...(picture && { picture }),
        };
      } catch (error) {
        throw asSignInError(error);
      }
    },

    // GitHub has no single sign-out: only the local session ends.
    endSessionUrl: () => Promise.resolve(publicUrl(publicBaseUrl, "/")),
  };
}
