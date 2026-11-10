import { BASE_PATH } from "../basePath";

/** An RFC 6265 cookie-name token: no separators, white space, `=`, `;` or non-ASCII characters. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** `value` percent-encoded into a token (`encodeURIComponent` leaves `(` and `)`, which are not). */
const encodeToken = (value: string): string =>
  encodeURIComponent(value).replace(
    /[()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * The name the browser's cookie of "Limit to one response" has on the run page: the survey's
 * `cookieName` when it is a token, else that name percent-encoded (the survey id when it cannot be
 * encoded, such as a lone surrogate). The Form Library writes `{name}=true` itself on every
 * completion, so the name must not be able to carry cookie attributes (`; path=/`, `; domain=`) or
 * overwrite a cookie of the app under another name. The server's one-response rule reads the stored
 * definition, not this name.
 */
export function runCookieName(limitCookie: string, surveyId: string): string {
  if (TOKEN.test(limitCookie)) return limitCookie;
  try {
    return encodeToken(limitCookie);
  } catch {
    return encodeToken(surveyId);
  }
}

/**
 * The cookie that makes the Form Library show its "already completed" content (S18): the library
 * reads `{cookieName}=true` when the model is created. It is written when the server says this
 * browser's client id has completed the survey, under the name `runCookieName` gives. Null for a
 * name that is not a token.
 *
 * Scoped to the run pages (`path=/s`, read at `/s/{id}`), the same scope as the library's own write,
 * which has no `path` and so gets the page's default path, `/s`. Under a base path (a sandbox on a
 * sub-path, basePath.ts) both are `/studio/s`.
 */
export function completedBeforeCookie(
  cookieName: string,
  basePath: string = BASE_PATH,
): string | null {
  if (!TOKEN.test(cookieName)) return null;
  return `${cookieName}=true; path=${basePath}/s; expires=Fri, 31 Dec 9999 23:59:59 GMT`;
}
