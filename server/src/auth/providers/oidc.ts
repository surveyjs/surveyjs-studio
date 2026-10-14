import type { OidcConfig } from "../../config.js";
import { AppError } from "../../errors.js";
import type { IdentityProvider } from "../identity.js";

function notConfigured(): AppError {
  return new AppError({
    code: "not-implemented",
    status: 501,
    title: "Not implemented",
    detail: "Sign-in with the surveyjs-oidc identity provider is not configured yet.",
  });
}

/**
 * Placeholder for the `surveyjs-oidc` provider until its OIDC client (discovery, code + PKCE
 * exchange, end session) is built. It never contacts the issuer, so the server still starts with
 * the default configuration. `authorizationUrl` sends the browser to the issuer URL with the
 * `state` only; finishing sign-in and signing out answer `501`.
 */
export function createOidcIdentityProvider(oidc: OidcConfig | null): IdentityProvider {
  return {
    authorizationUrl: ({ state }) => {
      if (!oidc) return Promise.reject(notConfigured());
      const url = new URL(oidc.issuerUrl);
      url.searchParams.set("state", state);
      return Promise.resolve(url);
    },
    finishSignIn: () => Promise.reject(notConfigured()),
    endSessionUrl: () => Promise.reject(notConfigured()),
  };
}
