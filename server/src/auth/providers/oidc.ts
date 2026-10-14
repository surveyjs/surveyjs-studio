import * as client from "openid-client";
import type { OidcConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "../identity.js";
import type { SignInParameters } from "../transaction.js";

/** Where the identity provider sends the browser back (the `loginCallback` operation). */
export const CALLBACK_PATH = "/api/v1/auth/callback";

export interface OidcIdentityOptions {
  readonly oidc: OidcConfig;
  /** The browser-visible origin: the `redirect_uri` and `post_logout_redirect_uri` are built on it. */
  readonly publicBaseUrl: string;
}

function unavailable(cause: unknown): AppError {
  return new AppError({
    code: "internal-error",
    status: 500,
    title: "Sign-in is unavailable",
    detail:
      "The identity provider could not be reached or gave an unexpected answer. Try again later.",
    cause,
  });
}

/** Failures of the token response that mean "this sign-in is not valid", not "the server is broken". */
const INVALID_SIGN_IN_CODES = new Set([
  "OAUTH_INVALID_RESPONSE", // includes a bad ID token signature
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED", // iss, aud, nonce
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED", // exp, iat
  "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED",
  "OAUTH_KEY_SELECTION_FAILED",
]);

/**
 * A bad, expired or reused code, an error sent back by the identity provider, or an ID token that
 * fails validation answers `400`. Anything else (network, timeout, a rejected client secret) is a
 * server fault: `500`, logged with its cause.
 */
function signInError(error: unknown): AppError {
  const invalid =
    error instanceof client.AuthorizationResponseError ||
    (error instanceof client.ResponseBodyError && error.error === "invalid_grant") ||
    (error instanceof client.ClientError && INVALID_SIGN_IN_CODES.has(error.code ?? ""));
  if (!invalid) return unavailable(error);
  return new AppError({
    code: "bad-request",
    status: 400,
    title: "Sign-in failed",
    detail: "The sign-in could not be completed. Sign in again.",
  });
}

const optionalString = (value: unknown) =>
  typeof value === "string" && value !== "" ? value : undefined;

/**
 * The `surveyjs-oidc` identity provider (auth.surveyjs.io, or the mock OIDC server in Azurite
 * mode): authorization code flow with PKCE (S256), `state` and `nonce`, and a validated ID token.
 * The client authenticates with its secret (`client_secret_post`).
 *
 * Discovery is lazy: done on the first sign-in, cached, and retried after a failure, so start-up
 * and `/readyz` never depend on the issuer. Provider tokens are discarded after the callback; only
 * the ID token's claims are returned.
 */
export function createOidcIdentityProvider(options: OidcIdentityOptions): IdentityProvider {
  const { oidc, publicBaseUrl } = options;
  const redirectUri = publicUrl(publicBaseUrl, CALLBACK_PATH);
  const postLogoutRedirectUri = publicUrl(publicBaseUrl, "/");
  const issuerUrl = new URL(oidc.issuerUrl);

  let discovered: Promise<client.Configuration> | undefined;
  const configuration = (): Promise<client.Configuration> => {
    discovered ??= client
      .discovery(issuerUrl, oidc.clientId, undefined, client.ClientSecretPost(oidc.clientSecret), {
        execute: [
          // Also check the ID token's signature against the issuer's JWKS (not only TLS).
          client.enableNonRepudiationChecks,
          // Plain http only when the issuer is configured so (the local mock OIDC server).
          ...(issuerUrl.protocol === "http:" ? [client.allowInsecureRequests] : []),
        ],
      })
      .catch((error: unknown) => {
        discovered = undefined;
        throw unavailable(error);
      });
    return discovered;
  };

  return {
    authorizationUrl: async ({ state, nonce, codeVerifier }: SignInParameters) =>
      client.buildAuthorizationUrl(await configuration(), {
        redirect_uri: redirectUri,
        scope: oidc.scopes,
        state,
        nonce,
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      }),

    finishSignIn: async (callback, { state, nonce, codeVerifier }): Promise<IdentityClaims> => {
      const config = await configuration();
      let claims: client.IDToken | undefined;
      try {
        const tokens = await client.authorizationCodeGrant(config, callback, {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          expectedNonce: nonce,
          idTokenExpected: true,
        });
        claims = tokens.claims();
      } catch (error) {
        throw signInError(error);
      }
      if (!claims) throw unavailable(new Error("the token response has no ID token"));
      const email = optionalString(claims.email);
      const name = optionalString(claims.name);
      const picture = optionalString(claims.picture);
      return {
        sub: claims.sub,
        ...(email && { email }),
        ...(name && { name }),
        ...(picture && { picture }),
      };
    },

    // The local sign-out has happened by now: when the issuer cannot say where to end its own
    // session (unreachable, or no end_session_endpoint), the browser just goes back to the site.
    endSessionUrl: async () => {
      try {
        const url = client.buildEndSessionUrl(await configuration(), {
          post_logout_redirect_uri: postLogoutRedirectUri,
        });
        return url.href;
      } catch {
        return postLogoutRedirectUri;
      }
    },
  };
}
