import type { FastifyPluginAsync } from "fastify";
import type { SignInParameters, SignInTransaction } from "./transaction.js";

/** The signed-in identity, as the identity provider states it. */
export interface IdentityClaims {
  readonly sub: string;
  readonly email?: string;
  /** Whether the provider vouches for `email` (the rule is the provider's, see ADR 0029). */
  readonly emailVerified?: boolean;
  readonly name?: string;
  readonly picture?: string;
}

/**
 * Where users sign in. The caller creates the parameters and seals them into `msid_auth`; the
 * provider only builds the browser redirect and checks what comes back.
 */
export interface IdentityProvider {
  /** Where to send the browser to sign in (`returnTo`: only the local provider's page uses it). */
  authorizationUrl(params: SignInTransaction): Promise<URL>;
  /** Exchanges the callback parameters for the signed-in identity. Throws a 400 AppError on a bad code. */
  finishSignIn(callback: URL, params: SignInParameters): Promise<IdentityClaims>;
  /** The URL the browser opens after local sign-out. */
  endSessionUrl(): Promise<string>;
  /** Routes the provider serves itself, outside `/api/v1` (the dev sign-in page). */
  readonly routes?: FastifyPluginAsync;
}

/** `PUBLIC_BASE_URL + path`, the browser-visible URL of a path on this server. */
export function publicUrl(publicBaseUrl: string, path: string): string {
  return publicBaseUrl.replace(/\/+$/, "") + path;
}
