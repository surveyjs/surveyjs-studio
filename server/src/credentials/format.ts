import { createHash, randomBytes } from "node:crypto";

export const API_TOKEN_PREFIX = "sjs_";

export type CredentialKind = "api-token" | "legacy-key";

/** `sjs_` plus 32 random bytes as base64url (43 characters). Shown once, never stored. */
export function newApiTokenValue(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** The prefix alone decides the kind; a value is never tried as the other kind. */
export function credentialKind(value: string): CredentialKind {
  return value.startsWith(API_TOKEN_PREFIX) ? "api-token" : "legacy-key";
}

/** SHA-256 hex of the value; legacy keys are compared without regard to case. */
export function hashCredential(value: string, kind: CredentialKind): string {
  const exact = kind === "legacy-key" ? value.toLowerCase() : value;
  return createHash("sha256").update(exact).digest("hex");
}

export function lastFour(value: string): string {
  return value.slice(-4);
}
