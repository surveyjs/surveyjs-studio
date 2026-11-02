import { createHmac } from "node:crypto";
import { calculatePKCECodeChallenge } from "openid-client";
import type { OAuthClient } from "../../config.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "../identity.js";
import type { FacebookEndpoints } from "./endpoints.js";
import { CALLBACK_PATH } from "./oidc.js";
import { asSignInError, authorizationCode, readJson, signInFailed } from "./sign-in-error.js";

export interface FacebookIdentityOptions {
  readonly client: OAuthClient;
  readonly publicBaseUrl: string;
  readonly endpoints: FacebookEndpoints;
}

const TIMEOUT_MS = 10_000;
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

/**
 * Facebook Login (authorization code flow, state and PKCE). The identity comes from the Graph API
 * `/me?fields=id,name,email`, called with `appsecret_proof`. Meta returns only a confirmed email
 * address, so an `email` counts as verified. Tokens are discarded after the callback.
 */
export function createFacebookIdentityProvider(options: FacebookIdentityOptions): IdentityProvider {
  const { client, publicBaseUrl, endpoints } = options;
  const redirectUri = publicUrl(publicBaseUrl, CALLBACK_PATH);
  const graph = endpoints.graph.replace(/\/+$/, "");

  /** A Graph answer. A 5xx is the server's fault; an error answer to the code exchange is the sign-in's. */
  async function graphJson(url: URL, exchange: boolean): Promise<Record<string, unknown>> {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status >= 500) throw new Error(`Facebook answered ${response.status}`);
    const body = await readJson(response);
    if (body.error !== undefined) {
      // An invalid or reused code (OAuth `invalid_grant`, Graph error code 100) is the sign-in's
      // fault; a rejected client secret and the like are the server's.
      const { error } = body;
      const invalidCode =
        error === "invalid_grant" ||
        (typeof error === "object" && error !== null && (error as { code?: unknown }).code === 100);
      if (exchange && invalidCode) throw signInFailed();
      throw new Error(`Facebook refused the request (${response.status})`);
    }
    return body;
  }

  return {
    authorizationUrl: async ({ state, codeVerifier }) => {
      const url = new URL(endpoints.authorize);
      url.searchParams.set("client_id", client.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", "email");
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("code_challenge", await calculatePKCECodeChallenge(codeVerifier));
      url.searchParams.set("code_challenge_method", "S256");
      return url;
    },

    finishSignIn: async (callback, { state, codeVerifier }): Promise<IdentityClaims> => {
      const code = authorizationCode(callback, state);
      try {
        const tokenUrl = new URL(`${graph}/oauth/access_token`);
        tokenUrl.searchParams.set("client_id", client.clientId);
        tokenUrl.searchParams.set("client_secret", client.clientSecret);
        tokenUrl.searchParams.set("redirect_uri", redirectUri);
        tokenUrl.searchParams.set("code", code);
        tokenUrl.searchParams.set("code_verifier", codeVerifier);
        const accessToken = text((await graphJson(tokenUrl, true)).access_token);
        if (!accessToken) throw new Error("Facebook sent no access token");

        const meUrl = new URL(`${graph}/me`);
        meUrl.searchParams.set("fields", "id,name,email");
        meUrl.searchParams.set("access_token", accessToken);
        meUrl.searchParams.set(
          "appsecret_proof",
          createHmac("sha256", client.clientSecret).update(accessToken).digest("hex"),
        );
        const me = await graphJson(meUrl, false);
        const id = text(me.id);
        if (!id) throw new Error("Facebook sent no user id");
        const email = text(me.email);
        const name = text(me.name);
        return {
          sub: id,
          ...(email && { email }),
          emailVerified: email !== undefined,
          ...(name && { name }),
        };
      } catch (error) {
        throw asSignInError(error);
      }
    },

    endSessionUrl: () => Promise.resolve(publicUrl(publicBaseUrl, "/")),
  };
}
