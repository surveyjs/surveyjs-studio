import { AppError } from "../errors.js";
import type { LocalAccount, LocalAccountStore } from "../providers/types.js";

/** Operations a session that must change its password may still call. */
const WHILE_PASSWORD_CHANGE_REQUIRED: ReadonlySet<string> = new Set([
  "getCurrentUser",
  "changeOwnPassword",
  "logout",
]);

/** How long an account's state is reused before it is read again (spec: at most 60 seconds). */
const CACHE_MS = 60_000;

export interface SessionCheckOptions {
  readonly accounts: LocalAccountStore;
  readonly now?: () => number;
}

export interface SessionCheck {
  /**
   * Resolves when the session's account may call `operationId`: the account is active and the
   * session's epoch (0 when it has none) is the account's. Throws `401 unauthenticated` otherwise,
   * and `401 password-change-required` when the account must change its password and the
   * operation is not one it may call meanwhile (ADR 0026).
   */
  check(
    session: { readonly sub: string; readonly epoch?: number },
    operationId: string,
  ): Promise<void>;
  /** Reads the account again on its next request (after a change made by this server). */
  forget(userId: string): void;
}

const signedOut = (): AppError =>
  new AppError({ code: "unauthenticated", status: 401, title: "Sign-in required" });

/**
 * The per-request check of local accounts' sessions (ADR 0026). The session cookie stays
 * stateless; each request compares its epoch with the account's, which is cached for at most a
 * minute, so a password change, a reset or disabling the user ends other sessions within a minute
 * (at once on this server, which forgets the account when it changes it).
 */
export function createSessionCheck(options: SessionCheckOptions): SessionCheck {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly account: LocalAccount | null; readonly at: number }>();

  const accountOf = async (id: string): Promise<LocalAccount | null> => {
    const key = id.toLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.at < CACHE_MS) return cached.account;
    const account = await options.accounts.account(key);
    cache.set(key, { account, at: now() });
    return account;
  };

  return {
    check: async (session, operationId) => {
      const account = await accountOf(session.sub);
      if (!account || account.status !== "active") throw signedOut();
      if ((session.epoch ?? 0) !== account.sessionEpoch) throw signedOut();
      if (account.mustChangePassword && !WHILE_PASSWORD_CHANGE_REQUIRED.has(operationId)) {
        throw new AppError({
          code: "password-change-required",
          status: 401,
          title: "Password change required",
          detail: "Change your password before you go on.",
        });
      }
    },
    forget: (userId) => {
      cache.delete(userId.toLowerCase());
    },
  };
}
