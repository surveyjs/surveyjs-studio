import type { AppConfig } from "../config.js";

/** Sealed session (`msid-session-v1`). */
export const SESSION_COOKIE = "msid";
/** Readable copy of the session's CSRF token (double-submit). */
export const CSRF_COOKIE = "msid_csrf";
/** Sealed sign-in transaction (`msid-auth-v1`), sent only to the sign-in endpoints. */
export const TRANSACTION_COOKIE = "msid_auth";
export const TRANSACTION_COOKIE_PATH = "/api/v1/auth";
export const TRANSACTION_MAX_AGE_SECONDS = 600;

type CookieConfig = Pick<AppConfig, "publicBaseUrl" | "sessionMaxAgeSeconds">;

/** Cookie values from a `Cookie` header; the first of a repeated name wins (the most specific path). */
export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const pair of (header ?? "").split(";")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    const name = pair.slice(0, at).trim();
    if (name === "" || name in cookies) continue;
    cookies[name] = pair.slice(at + 1).trim();
  }
  return cookies;
}

interface CookieOptions {
  readonly path: string;
  readonly maxAge: number;
  readonly httpOnly: boolean;
}

/** Our values are base64url and dots only, so they need no encoding. */
function serialize(config: CookieConfig, name: string, value: string, options: CookieOptions) {
  const secure = new URL(config.publicBaseUrl).protocol === "https:";
  return [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    "SameSite=Lax",
    ...(options.httpOnly ? ["HttpOnly"] : []),
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function sessionCookies(
  config: CookieConfig,
  values: { readonly session: string; readonly csrf: string },
): string[] {
  const maxAge = config.sessionMaxAgeSeconds;
  return [
    serialize(config, SESSION_COOKIE, values.session, { path: "/", maxAge, httpOnly: true }),
    serialize(config, CSRF_COOKIE, values.csrf, { path: "/", maxAge, httpOnly: false }),
  ];
}

export function transactionCookie(config: CookieConfig, sealed: string): string {
  return serialize(config, TRANSACTION_COOKIE, sealed, {
    path: TRANSACTION_COOKIE_PATH,
    maxAge: TRANSACTION_MAX_AGE_SECONDS,
    httpOnly: true,
  });
}

export function clearTransactionCookie(config: CookieConfig): string {
  return serialize(config, TRANSACTION_COOKIE, "", {
    path: TRANSACTION_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
  });
}

export function clearAllCookies(config: CookieConfig): string[] {
  return [
    serialize(config, SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true }),
    serialize(config, CSRF_COOKIE, "", { path: "/", maxAge: 0, httpOnly: false }),
    clearTransactionCookie(config),
  ];
}
