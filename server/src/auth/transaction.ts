import { randomBytes } from "node:crypto";
import { EXTERNAL_METHODS, type ExternalMethod } from "../config.js";
import { TRANSACTION_MAX_AGE_SECONDS } from "./cookies.js";
import { seal, unseal } from "./seal.js";
import type { Clock } from "./session.js";

/** What the identity provider needs to start and finish one sign-in. */
export interface SignInParameters {
  readonly state: string;
  readonly nonce: string;
  /** PKCE (S256) code verifier. */
  readonly codeVerifier: string;
}

/** The sealed content of the `msid_auth` cookie, between `login` and `loginCallback`. */
export interface SignInTransaction extends SignInParameters {
  /** The validated, normalised path to open after sign-in. */
  readonly returnTo: string;
  /** The sign-in method `login?provider=` started; absent: the primary provider finishes it. */
  readonly provider?: ExternalMethod;
  /** Absolute expiry, epoch seconds (the cookie's Max-Age, enforced on the server too). */
  readonly exp: number;
}

const random = () => randomBytes(32).toString("base64url");

export function createTransaction(
  returnTo: string,
  provider: ExternalMethod | undefined,
  now: Clock = Date.now,
): SignInTransaction {
  return {
    state: random(),
    nonce: random(),
    codeVerifier: random(),
    returnTo,
    ...(provider && { provider }),
    exp: Math.floor(now() / 1000) + TRANSACTION_MAX_AGE_SECONDS,
  };
}

export function encodeTransaction(secret: string, tx: SignInTransaction): string {
  return seal("msid-auth-v1", secret, JSON.stringify(tx));
}

/** The transaction, or null when the value is missing, invalid, tampered with or expired. */
export function decodeTransaction(
  secret: string,
  value: string | undefined,
  now: Clock = Date.now,
): SignInTransaction | null {
  if (!value) return null;
  const json = unseal("msid-auth-v1", secret, value);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { state, nonce, codeVerifier, returnTo, exp, provider } = parsed as Record<string, unknown>;
  const strings = [state, nonce, codeVerifier, returnTo];
  if (!strings.every((text) => typeof text === "string" && text !== "")) return null;
  if (provider !== undefined && !(EXTERNAL_METHODS as readonly unknown[]).includes(provider)) {
    return null;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (Math.floor(now() / 1000) >= exp) return null;
  return {
    state: state as string,
    nonce: nonce as string,
    codeVerifier: codeVerifier as string,
    returnTo: returnTo as string,
    ...(provider !== undefined && { provider: provider as ExternalMethod }),
    exp,
  };
}
