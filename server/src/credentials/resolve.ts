import type { BearerResolver, RequestUser } from "../auth/authenticate.js";
import type { User } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { CredentialStore, ProjectStore } from "../providers/types.js";
import { credentialKind, hashCredential } from "./format.js";
import type { OwnerCheck } from "./owner-check.js";

/** Last used is written at most once a minute per token (ADR 0037, point 6). */
const TOUCH_MS = 60_000;

/** `sjs_` plus 43 base64url characters: anything else with the prefix is malformed, never looked up. */
const API_TOKEN = /^sjs_[A-Za-z0-9_-]{43}$/;

export interface BearerResolverOptions {
  readonly credentials: CredentialStore;
  readonly owners: OwnerCheck;
  /** A project token authenticates only while its project exists. */
  readonly projects: Pick<ProjectStore, "getProject">;
  readonly now?: () => number;
  /** Where a failed last-used write is reported; it never fails the request. */
  readonly log?: { warn(details: object, message: string): void };
}

const signedOut = (): AppError =>
  new AppError({ code: "unauthenticated", status: 401, title: "Sign-in required" });

const actingAs = (user: User) => ({
  id: user.id,
  displayName: user.displayName,
  email: user.email,
  // The directory has no avatars.
  avatarUrl: null,
});

/**
 * Turns a bearer value into the user it acts as (ADR 0037, points 1–4). The prefix alone decides
 * the kind: `sjs_` is an API token, looked up by its hash; anything else a legacy access key.
 * Unknown, revoked and malformed values and the credentials of an owner who may not sign in
 * answer `401 unauthenticated`; the value is never logged or echoed.
 */
export function createBearerResolver(options: BearerResolverOptions): BearerResolver {
  const { credentials, owners, projects } = options;
  const now = options.now ?? Date.now;
  /** When this process last wrote each token's last-used time. */
  const touched = new Map<string, number>();

  const touch = async (id: string): Promise<void> => {
    const at = now();
    const last = touched.get(id);
    if (last !== undefined && at - last < TOUCH_MS) return;
    // Expired entries go when the map grows, so it stays about as large as a minute's tokens.
    if (touched.size >= 10_000) {
      for (const [k, v] of touched) if (at - v >= TOUCH_MS) touched.delete(k);
    }
    // Set before the write, so concurrent requests write once.
    touched.set(id, at);
    try {
      await credentials.touchApiToken(id, new Date(at).toISOString());
    } catch (error) {
      options.log?.warn({ err: error, tokenId: id }, "API token last-used time was not written");
    }
  };

  return {
    resolve: async (value): Promise<RequestUser> => {
      const kind = credentialKind(value);
      if (kind === "api-token") {
        if (!API_TOKEN.test(value)) throw signedOut();
        const token = await credentials.findApiToken(hashCredential(value, kind));
        // Any revocation mark, a date or not, stops the token.
        if (!token || token.revokedAt !== null) throw signedOut();
        // A project's deletion revokes its tokens, but on Azure that is best effort (ADR 0037).
        if (token.projectId !== null && !(await projects.getProject(token.projectId))) {
          throw signedOut();
        }
        const user = await owners.owner(token.creatorId);
        await touch(token.id);
        return {
          ...actingAs(user),
          scope:
            token.projectId === null
              ? { kind: "personal" }
              : { kind: "project", projectId: token.projectId },
          credential: { kind: "api-token", id: token.id },
        };
      }
      if (value === "") throw signedOut();
      const key = await credentials.findLegacyKey(value);
      if (!key || key.revoked) throw signedOut();
      const user = await owners.owner(key.userId);
      return {
        ...actingAs(user),
        scope: { kind: "all" },
        credential: { kind: "legacy-key", hash: hashCredential(value, "legacy-key") },
      };
    },
  };
}
