import type { AppConfig } from "../config.js";

/** Sealed session (`msid-session-v1`). */
export const SESSION_COOKIE = "msid";
/** Readable copy of the session's CSRF token (double-submit). */
export const CSRF_COOKIE = "msid_csrf";
/**
 * Prefix of the sealed sign-in transaction cookies (`msid-auth-v1`), sent only to the sign-in
 * endpoints. Each sign-in has its own cookie, `msid_auth_<first 16 characters of state>`, so
 * sign-ins started in several tabs do not overwrite each other.
 */
export const TRANSACTION_COOKIE_PREFIX = "msid_auth_";
export const TRANSACTION_COOKIE_PATH = "/api/v1/auth";
export const TRANSACTION_MAX_AGE_SECONDS = 600;

const STATE_KEY = /^[A-Za-z0-9_-]{16}/;
const TRANSACTION_COOKIE_NAME = /^msid_auth_[A-Za-z0-9_-]{16}$/;

/**
 * The transaction cookie name for a sign-in's `state`, or null when the state cannot name one
 * (shorter than 16 characters, or not base64url). Safe to call with any query value.
 */
export function transactionCookieName(state: string): string | null {
  const key = STATE_KEY.exec(state)?.[0];
  return key === undefined ? null : TRANSACTION_COOKIE_PREFIX + key;
}

/** The names of the well-formed transaction cookies among a request's cookies. */
export function transactionCookieNames(cookies: Record<string, string>): string[] {
  return Object.keys(cookies).filter((name) => TRANSACTION_COOKIE_NAME.test(name));
}

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

/** `name` comes from `transactionCookieName`. */
export function transactionCookie(config: CookieConfig, name: string, sealed: string): string {
  return serialize(config, name, sealed, {
    path: TRANSACTION_COOKIE_PATH,
    maxAge: TRANSACTION_MAX_AGE_SECONDS,
    httpOnly: true,
  });
}

/** `name` comes from `transactionCookieName` or `transactionCookieNames`. */
export function clearTransactionCookie(config: CookieConfig, name: string): string {
  return serialize(config, name, "", {
    path: TRANSACTION_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
  });
}

/** Clears the session cookies and the given transaction cookies. */
export function clearAllCookies(
  config: CookieConfig,
  transactionNames: readonly string[] = [],
): string[] {
  return [
    serialize(config, SESSION_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true }),
    serialize(config, CSRF_COOKIE, "", { path: "/", maxAge: 0, httpOnly: false }),
    ...transactionNames.map((name) => clearTransactionCookie(config, name)),
  ];
}
