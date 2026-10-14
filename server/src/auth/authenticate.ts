import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type { Security } from "../contract.js";
import { AppError } from "../errors.js";
import { CSRF_COOKIE, parseCookies, SESSION_COOKIE } from "./cookies.js";
import { csrfTokensMatch } from "./csrf.js";
import { decodeSession, type Clock } from "./session.js";

/** The signed-in user, as handlers see it. */
export interface RequestUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the authentication hook on operations that need a session; null elsewhere. */
    user: RequestUser | null;
  }
}

export interface AuthenticationOptions {
  /** Secret: never log or echo. */
  readonly sessionSecret: string;
  readonly now?: Clock;
}

/** How an operation's security requirements are met in Phase 1 (`bearerAuth` is P1: never). */
export type AccessRule =
  | { readonly kind: "public" }
  | { readonly kind: "session"; readonly csrf: boolean }
  | { readonly kind: "never" };

const SESSION_SCHEMES = new Set(["cookieAuth", "csrfToken"]);

export function accessRule(security: Security): AccessRule {
  if (security.length === 0 || security.some((requirement) => requirement.length === 0)) {
    return { kind: "public" };
  }
  const usable = security.filter(
    (requirement) =>
      requirement.includes("cookieAuth") && requirement.every((name) => SESSION_SCHEMES.has(name)),
  );
  if (usable.length === 0) return { kind: "never" };
  // CSRF is needed only when every requirement the session can meet asks for it.
  return {
    kind: "session",
    csrf: usable.every((requirement) => requirement.includes("csrfToken")),
  };
}

function unauthenticated(): AppError {
  return new AppError({ code: "unauthenticated", status: 401, title: "Sign-in required" });
}

/**
 * The `onRequest` hook for an operation, or undefined when it is public. Runs before body parsing
 * and validation, so the order is: authentication (401), CSRF (403), validation, handler.
 */
export function authenticationHook(
  security: Security,
  options: AuthenticationOptions,
): onRequestAsyncHookHandler | undefined {
  const rule = accessRule(security);
  if (rule.kind === "public") return undefined;
  // Async, so a throw becomes the error response.
  return async (request) => {
    if (rule.kind === "never") throw unauthenticated();
    const cookies = parseCookies(request.headers.cookie);
    const session = decodeSession(options.sessionSecret, cookies[SESSION_COOKIE], options.now);
    if (!session) throw unauthenticated();
    if (rule.csrf) {
      const header = request.headers["x-csrf-token"];
      const token = typeof header === "string" ? header : undefined;
      if (!csrfTokensMatch(token, cookies[CSRF_COOKIE], session.csrf)) {
        throw new AppError({
          code: "csrf-token-invalid",
          status: 403,
          title: "Invalid CSRF token",
          detail: "Send the value of the msid_csrf cookie in the X-CSRF-Token header.",
        });
      }
    }
    request.user = {
      id: session.sub,
      displayName: session.name,
      email: session.email,
      avatarUrl: session.avatarUrl,
    };
  };
}

/** The signed-in user of an operation that needs a session. */
export function requireUser(request: FastifyRequest): RequestUser {
  if (!request.user) throw unauthenticated();
  return request.user;
}
