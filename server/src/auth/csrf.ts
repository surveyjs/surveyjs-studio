import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sameInConstantTime(a: string, b: string): boolean {
  // Digests have equal length, so the comparison leaks neither content nor length.
  const digest = (text: string) => createHash("sha256").update(text).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** True only when the header, the `msid_csrf` cookie and the session's token are present and equal. */
export function csrfTokensMatch(
  header: string | undefined,
  cookie: string | undefined,
  session: string | undefined,
): boolean {
  if (!header || !cookie || !session) return false;
  const headerMatchesCookie = sameInConstantTime(header, cookie);
  const headerMatchesSession = sameInConstantTime(header, session);
  return headerMatchesCookie && headerMatchesSession;
}
