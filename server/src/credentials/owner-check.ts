import type { User } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { LocalAccountStore, UserDirectory } from "../providers/types.js";

/** How long an owner's state is reused before it is read again (as the session check: at most 60 seconds). */
const CACHE_MS = 60_000;

export interface OwnerCheckOptions {
  readonly users: UserDirectory;
  /** The local accounts (USER_DIRECTORY=local): only an active account's credentials work. */
  readonly accounts: LocalAccountStore | null;
  readonly now?: () => number;
}

export interface OwnerCheck {
  /**
   * The user a bearer credential acts as, when they may still use it: known to the directory, not
   * blocked and, with local accounts, active. Throws `401 unauthenticated` otherwise.
   */
  owner(userId: string): Promise<User>;
}

const signedOut = (): AppError =>
  new AppError({ code: "unauthenticated", status: 401, title: "Sign-in required" });

/**
 * The per-request check of a credential's owner (ADR 0037, point 2): a blocked or disabled owner
 * stops all their credentials. Each answer, a refusal too, is reused for at most a minute; a
 * failed lookup is not cached.
 */
export function createOwnerCheck(options: OwnerCheckOptions): OwnerCheck {
  const now = options.now ?? Date.now;
  const cache = new Map<string, { readonly user: User | null; readonly at: number }>();

  const lookUp = async (id: string): Promise<User | null> => {
    const [user, account] = await Promise.all([
      options.users.getUser(id),
      options.accounts ? options.accounts.account(id) : null,
    ]);
    if (!user || user.blocked) return null;
    if (options.accounts && account?.status !== "active") return null;
    return user;
  };

  return {
    owner: async (userId) => {
      const key = userId.toLowerCase();
      const cached = cache.get(key);
      let user: User | null;
      if (cached && now() - cached.at < CACHE_MS) {
        user = cached.user;
      } else {
        user = await lookUp(key);
        // Expired entries go when the map grows, so it stays about as large as a minute's owners.
        if (cache.size >= 10_000) {
          for (const [k, v] of cache) if (now() - v.at >= CACHE_MS) cache.delete(k);
        }
        cache.set(key, { user, at: now() });
      }
      if (!user) throw signedOut();
      return user;
    },
  };
}
