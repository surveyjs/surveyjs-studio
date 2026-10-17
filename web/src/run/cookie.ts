/** A cookie name the page may write without escaping: no `;`, `,`, `=` or white space. */
const SAFE_NAME = /^[^;,=\s]+$/;

/**
 * The cookie that makes the Form Library show its "already completed" content (S18): the library
 * reads `{cookieName}=true` when the model is created. It is written when the server says this
 * browser's client id has completed the survey. Null for a name the page cannot write safely.
 */
export function completedBeforeCookie(cookieName: string): string | null {
  if (!SAFE_NAME.test(cookieName)) return null;
  return `${cookieName}=true; path=/; expires=Fri, 31 Dec 9999 23:59:59 GMT`;
}
