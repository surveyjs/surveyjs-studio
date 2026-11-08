import type { AppConfig } from "../config.js";

/** Why a first sign-in may not create an account (D8). */
export type JoinRefusal = "not-invited" | "email-unverified";

export type JoinDecision =
  | { readonly join: true; readonly because: "invited" | "domain" | "open" }
  | { readonly join: false; readonly reason: JoinRefusal };

/**
 * Whether a first sign-in with an external identity may create an account (D3 step 3): only with
 * a verified email, and then when the email is invited, its domain is in SIGN_UP_DOMAINS, or
 * OPEN_SIGN_UP=on. The domain is the part after the last `@`, matched exactly and in any letter
 * case: a subdomain or a lookalike does not match.
 */
export function decideJoin(
  input: {
    readonly email: string | undefined;
    readonly emailVerified: boolean;
    readonly invited: boolean;
  },
  policy: AppConfig["joinPolicy"],
): JoinDecision {
  const { email, emailVerified, invited } = input;
  if (!email || !emailVerified) return { join: false, reason: "email-unverified" };
  if (invited) return { join: true, because: "invited" };
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (email.includes("@") && policy.signUpDomains.includes(domain)) {
    return { join: true, because: "domain" };
  }
  if (policy.openSignUp) return { join: true, because: "open" };
  return { join: false, reason: "not-invited" };
}
