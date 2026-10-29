function hasControlCharacter(text: string): boolean {
  // C0 controls, DEL and C1 controls: browsers drop some of them, which can turn `/\t/x` into `//x`.
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

/**
 * Where to go after signing in or changing the password: `returnTo` when it is a path of this app,
 * else My Surveys. The same rule as the server's (server/src/auth/return-to.ts): one leading `/`
 * (not `//`, not `/\`), no control characters, and still this origin once the URL is parsed.
 */
export function appPath(returnTo: string | undefined): string {
  if (returnTo === undefined || returnTo.length === 0 || returnTo.length > 2048) return "/";
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.startsWith("/\\")) {
    return "/";
  }
  if (hasControlCharacter(returnTo)) return "/";
  const origin = window.location.origin;
  if (!URL.canParse(returnTo, origin)) return "/";
  const url = new URL(returnTo, origin);
  const path = url.pathname + url.search + url.hash;
  return url.origin !== origin || path.startsWith("//") ? "/" : path;
}

/** A search parameter as the page uses it: a string, or undefined for anything else. */
export const searchText = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
