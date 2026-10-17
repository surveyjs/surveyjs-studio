/** A cookie name the page may write without escaping: no `;`, `,`, `=` or white space. */
const SAFE_NAME = /^[^;,=\s]+$/;

/**
 * The cookie that makes the Form Library show its "already completed" content (S18): the library
 * reads `{cookieName}=true` when the model is created. It is written when the server says this
 * browser's client id has completed the survey. Null for a name the page cannot write safely.
 *
 * Scoped to the run pages (`path=/s`, read at `/s/{id}`): the name comes from the survey's author,
 * so a cookie for the whole site could overwrite one of the app's own (such as `msid_csrf`).
 */
export function completedBeforeCookie(cookieName: string): string | null {
  if (!SAFE_NAME.test(cookieName)) return null;
  return `${cookieName}=true; path=/s; expires=Fri, 31 Dec 9999 23:59:59 GMT`;
}
