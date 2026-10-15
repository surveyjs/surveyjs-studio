import type { Middleware } from "openapi-fetch";

const CSRF_COOKIE = "msid_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/** The cookie value, percent-decoded when it can be; a malformed escape leaves it as it is. */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Echoes the readable msid_csrf cookie in X-CSRF-Token on unsafe methods (the server compares both). */
export const csrfMiddleware: Middleware = {
  onRequest({ request }) {
    if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;
    const token = readCookie(CSRF_COOKIE);
    if (token) request.headers.set("X-CSRF-Token", decodeCookieValue(token));
    return request;
  },
};
