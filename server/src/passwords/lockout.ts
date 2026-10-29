/**
 * The per-account sign-in back-off (spec: exponential after 5 failures). Kept per lower-cased
 * email in process memory, for known and unknown emails alike, so an answer never shows whether an
 * email exists. It resets on restart; the per-address rate limit still applies (ADR 0026).
 */

export interface LockoutOptions {
  readonly now?: () => number;
  /** Emails remembered at most; the oldest is dropped. Default 10,000. */
  readonly maxEntries?: number;
}

export interface Lockout {
  /** Seconds until the email may try again; 0 when it may now. */
  retryAfterSeconds(email: string): number;
  failed(email: string): void;
  succeeded(email: string): void;
}

const FREE_FAILURES = 4;
const FIRST_WAIT_MS = 60_000;
const MAX_WAIT_MS = 60 * 60_000;
const FORGET_AFTER_MS = 24 * 60 * 60_000;

interface Entry {
  failures: number;
  lockedUntil: number;
  lastFailure: number;
}

export function createLockout(options: LockoutOptions = {}): Lockout {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 10_000;
  const entries = new Map<string, Entry>();

  const current = (email: string): Entry | undefined => {
    const key = email.toLowerCase();
    const entry = entries.get(key);
    if (entry && now() - entry.lastFailure > FORGET_AFTER_MS) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    retryAfterSeconds: (email) => {
      const entry = current(email);
      if (!entry) return 0;
      return Math.max(0, Math.ceil((entry.lockedUntil - now()) / 1000));
    },
    failed: (email) => {
      const key = email.toLowerCase();
      const entry = current(email) ?? { failures: 0, lockedUntil: 0, lastFailure: 0 };
      entry.failures += 1;
      entry.lastFailure = now();
      if (entry.failures > FREE_FAILURES) {
        const wait = FIRST_WAIT_MS * 2 ** (entry.failures - FREE_FAILURES - 1);
        entry.lockedUntil = now() + Math.min(wait, MAX_WAIT_MS);
      }
      // Re-inserted, so the map's order is the order of the last failure: the first key is the oldest.
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    },
    succeeded: (email) => {
      entries.delete(email.toLowerCase());
    },
  };
}
