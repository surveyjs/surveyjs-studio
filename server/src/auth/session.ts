import { seal, unseal } from "./seal.js";

/** The sealed content of the `msid` cookie. Provider tokens are never stored. */
export interface SessionPayload {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  /** Equals the `msid_csrf` cookie value issued with this session. */
  readonly csrf: string;
  /** Absolute expiry, epoch seconds. */
  readonly exp: number;
}

export type Clock = () => number;

export interface SessionUser {
  readonly sub: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string | null;
}

export function createSession(
  user: SessionUser,
  csrf: string,
  maxAgeSeconds: number,
  now: Clock = Date.now,
): SessionPayload {
  return { ...user, csrf, exp: Math.floor(now() / 1000) + maxAgeSeconds };
}

export function encodeSession(secret: string, session: SessionPayload): string {
  return seal("msid-session-v1", secret, JSON.stringify(session));
}

/** The session, or null when the value is missing, invalid, tampered with or expired. */
export function decodeSession(
  secret: string,
  value: string | undefined,
  now: Clock = Date.now,
): SessionPayload | null {
  if (!value) return null;
  const json = unseal("msid-session-v1", secret, value);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const session = asSession(parsed);
  if (session === null || Math.floor(now() / 1000) >= session.exp) return null;
  return session;
}

function asSession(value: unknown): SessionPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { sub, name, email, avatarUrl, csrf, exp } = value as Record<string, unknown>;
  if (typeof sub !== "string" || sub === "") return null;
  if (typeof name !== "string" || typeof email !== "string") return null;
  if (avatarUrl !== null && typeof avatarUrl !== "string") return null;
  if (typeof csrf !== "string" || csrf === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { sub, name, email, avatarUrl, csrf, exp };
}
