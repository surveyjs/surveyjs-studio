import * as client from "openid-client";
import type { OidcConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import { publicUrl, type IdentityClaims, type IdentityProvider } from "../identity.js";
import type { SignInParameters } from "../transaction.js";
import { unavailable } from "./sign-in-error.js";

/** Where the identity provider sends the browser back (the `loginCallback` operation). */
export const CALLBACK_PATH = "/api/v1/auth/callback";

export interface OidcIdentityOptions {
  readonly oidc: OidcConfig;
  /** The browser-visible origin: the `redirect_uri` and `post_logout_redirect_uri` are built on it. */
  readonly publicBaseUrl: string;
  /**
   * Whether UserInfo vouches for the email address. Default (surveyjs.io): verified unless
   * `email_verified` is `false`. Google: `email_verified === true`.
   */
  readonly emailVerified?: (userInfo: Record<string, unknown>) => boolean;
}

const verifiedUnlessFalse = (userInfo: Record<string, unknown>) =>
  userInfo.email_verified !== false;

/** Failures of the token or UserInfo response that mean "this sign-in is not valid", not "the server is broken". */
const INVALID_SIGN_IN_CODES = new Set([
  "OAUTH_INVALID_RESPONSE", // includes a bad ID token signature
  "OAUTH_JWT_CLAIM_COMPARISON_FAILED", // iss, aud, nonce
  "OAUTH_JWT_TIMESTAMP_CHECK_FAILED", // exp, iat
  "OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED", // UserInfo sub differs from the ID token sub
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
 * The `surveyjs-oidc` identity provider: auth.surveyjs.io (OAuth 2.0 with RFC 8414 metadata, an
 * opaque access token and a UserInfo endpoint, no ID token), the mock OIDC server in Azurite mode,
 * or, with `OIDC_DISCOVERY=openid-configuration`, an OpenID provider.
 *
 * - Authorization code flow with PKCE (S256) and `state`; the client authenticates with its secret
 *   (`client_secret_post`).
 * - The identity always comes from UserInfo. An ID token in the token response is validated
 *   (issuer, audience, expiry, signature, and the nonce in OpenID mode) and its `sub` must equal
 *   the UserInfo `sub`; no ID token is not an error, except in OpenID mode, which sends a nonce
 *   and so requires one.
 * - Discovery is lazy: done on the first sign-in, cached, and retried after a failure, so start-up
 *   and `/readyz` never depend on the issuer. Tokens are discarded after the callback.
 */
export function createOidcIdentityProvider(options: OidcIdentityOptions): IdentityProvider {
  const { oidc, publicBaseUrl } = options;
  const emailVerified = options.emailVerified ?? verifiedUnlessFalse;
  const redirectUri = publicUrl(publicBaseUrl, CALLBACK_PATH);
  const postLogoutRedirectUri = publicUrl(publicBaseUrl, "/");
  const issuerUrl = new URL(oidc.issuerUrl);
  // OpenID mode: an OpenID provider asked for an ID token. Only then is a nonce sent.
  const openId =
    oidc.discovery === "openid-configuration" && oidc.scopes.split(/\s+/).includes("openid");

  const discoveryOptions: client.DiscoveryRequestOptions = {
    ...(oidc.discovery === "oauth-authorization-server" && { algorithm: "oauth2" }),
    execute: [
      // An ID token's signature is checked against the issuer's JWKS (not only TLS).
      client.enableNonRepudiationChecks,
      // Plain http only when the issuer is configured so (the local mock OIDC server).
      ...(issuerUrl.protocol === "http:" ? [client.allowInsecureRequests] : []),
    ],
  };
  const discover = (url: URL) =>
    client.discovery(
      url,
      oidc.clientId,
      undefined,
      client.ClientSecretPost(oidc.clientSecret),
      discoveryOptions,
    );

  /**
   * RFC 8414 places the metadata at `/.well-known/oauth-authorization-server{issuer path}`. Some
   * servers, mock-oauth2-server among them, serve it under the issuer path instead: for an issuer
   * with a path, that location is tried second, and its `issuer` must still match.
   */
  async function discoverAny(): Promise<client.Configuration> {
    try {
      return await discover(issuerUrl);
    } catch (error) {
      if (oidc.discovery !== "oauth-authorization-server" || issuerUrl.pathname === "/") {
        throw error;
      }
      const config = await discover(
        new URL(`${issuerUrl.href.replace(/\/$/, "")}/.well-known/oauth-authorization-server`),
      ).catch(() => Promise.reject(error));
      if (new URL(config.serverMetadata().issuer).href !== issuerUrl.href) throw error;
      return config;
    }
  }

  let discovered: Promise<client.Configuration> | undefined;
  const configuration = (): Promise<client.Configuration> => {
    discovered ??= discoverAny().catch((error: unknown) => {
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
        ...(openId && { nonce }),
        code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: "S256",
      }),

    finishSignIn: async (callback, { state, nonce, codeVerifier }): Promise<IdentityClaims> => {
      const config = await configuration();
      let userInfo: client.UserInfoResponse;
      try {
        const tokens = await client.authorizationCodeGrant(config, callback, {
          pkceCodeVerifier: codeVerifier,
          expectedState: state,
          ...(openId && { expectedNonce: nonce, idTokenExpected: true }),
        });
        const idTokenSub = tokens.claims()?.sub;
        userInfo = await client.fetchUserInfo(
          config,
          tokens.access_token,
          idTokenSub ?? client.skipSubjectCheck,
        );
      } catch (error) {
        throw signInError(error);
      }
      const email = optionalString(userInfo.email);
      const name = optionalString(userInfo.name);
      const picture = optionalString(userInfo.picture);
      return {
        sub: userInfo.sub,
        ...(email && { email }),
        emailVerified: email !== undefined && emailVerified(userInfo),
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
