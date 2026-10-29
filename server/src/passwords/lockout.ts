/**
 * The per-account sign-in back-off (spec: exponential after 5 failures). Kept per lower-cased
 * email in process memory, for known and unknown emails alike, so an answer never shows whether an
 * email exists. It resets on restart; the per-address rate limit still applies (ADR 0026).
 */

export interface LockoutOptions {
  readonly now?: () => number;
  /**
   * Emails remembered at most. Default 10,000. The oldest one that is not locked is dropped first,
   * so failures for other emails cannot push a locked one out.
   */
  readonly maxEntries?: number;
}

export interface Lockout {
  /** Seconds until the email may try again; 0 when it may now. */
  retryAfterSeconds(email: string): number;
  /**
   * Starts an attempt: the seconds to wait when the email is locked (nothing is counted then), else
   * 0, and the attempt already counts as a failure until `succeeded`. Counting it before the
   * password is checked means attempts that run at the same time cannot all pass the lock.
   */
  begin(email: string): number;
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

  const retryAfterSeconds = (email: string): number => {
    const entry = current(email);
    if (!entry) return 0;
    return Math.max(0, Math.ceil((entry.lockedUntil - now()) / 1000));
  };

  /**
   * Drops entries down to `maxEntries`: the oldest unlocked one but `kept` (the email just
   * counted) first, else the oldest.
   */
  const trim = (kept: string) => {
    while (entries.size > maxEntries) {
      let drop: string | undefined;
      for (const [key, entry] of entries) {
        if (key !== kept && entry.lockedUntil <= now()) {
          drop = key;
          break;
        }
      }
      entries.delete(drop ?? (entries.keys().next().value as string));
    }
  };

  const failed = (email: string): void => {
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
    trim(key);
  };

  return {
    retryAfterSeconds,
    begin: (email) => {
      const wait = retryAfterSeconds(email);
      if (wait === 0) failed(email);
      return wait;
    },
    failed,
    succeeded: (email) => {
      entries.delete(email.toLowerCase());
    },
  };
}
