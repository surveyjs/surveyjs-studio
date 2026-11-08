import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type { Security } from "../contract.js";
import { AppError } from "../errors.js";
import { CSRF_COOKIE, parseCookies, SESSION_COOKIE } from "./cookies.js";
import { csrfTokensMatch } from "./csrf.js";
import type { InstanceRole } from "../providers/types.js";
import type { SessionCheck } from "./session-check.js";
import { decodeSession, type Clock } from "./session.js";

/** The signed-in user, as handlers see it. */
export interface RequestUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  /** A local account's instance role (USER_DIRECTORY=local), from the session check. */
  readonly instanceRole?: InstanceRole;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the authentication hook when the operation can use a session and has one; null elsewhere. */
    user: RequestUser | null;
  }
}

export interface AuthenticationOptions {
  /** Secret: never log or echo. */
  readonly sessionSecret: string;
  readonly now?: Clock;
  /**
   * USER_DIRECTORY=local: each session is checked against its account (status, epoch, forced
   * password change; ADR 0026). Absent for the other directories.
   */
  readonly sessionCheck?: SessionCheck;
}

/**
 * How an operation's security requirements are met in Phase 1 (`bearerAuth` is P1: never).
 * `optional`: a session requirement next to the empty one (`logout`). Without a valid session the
 * call is anonymous; with one, the session's rules (CSRF) apply.
 */
export type AccessRule =
  | { readonly kind: "public" }
  | { readonly kind: "session"; readonly csrf: boolean }
  | { readonly kind: "optional"; readonly csrf: boolean }
  | { readonly kind: "never" };

const SESSION_SCHEMES = new Set(["cookieAuth", "csrfToken"]);

export function accessRule(security: Security): AccessRule {
  if (security.length === 0) return { kind: "public" };
  const anonymous = security.some((requirement) => requirement.length === 0);
  const usable = security.filter(
    (requirement) =>
      requirement.includes("cookieAuth") && requirement.every((name) => SESSION_SCHEMES.has(name)),
  );
  if (usable.length === 0) return { kind: anonymous ? "public" : "never" };
  // CSRF is needed only when every requirement the session can meet asks for it.
  const csrf = usable.every((requirement) => requirement.includes("csrfToken"));
  return { kind: anonymous ? "optional" : "session", csrf };
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
  operationId = "",
): onRequestAsyncHookHandler | undefined {
  const rule = accessRule(security);
  if (rule.kind === "public") return undefined;
  // Async, so a throw becomes the error response.
  return async (request) => {
    if (rule.kind === "never") throw unauthenticated();
    const cookies = parseCookies(request.headers.cookie);
    // A missing, tampered or expired `msid` is no session.
    const session = decodeSession(options.sessionSecret, cookies[SESSION_COOKIE], options.now);
    if (!session) {
      if (rule.kind === "optional") return;
      throw unauthenticated();
    }
    let instanceRole: InstanceRole | undefined;
    if (options.sessionCheck) {
      try {
        instanceRole = (await options.sessionCheck.check(session, operationId)).instanceRole;
      } catch (error) {
        // An ended session is no session where none is needed (logout).
        if (rule.kind === "optional") return;
        throw error;
      }
    }
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
      ...(instanceRole && { instanceRole }),
    };
  };
}

/** The signed-in user of an operation that needs a session. */
export function requireUser(request: FastifyRequest): RequestUser {
  if (!request.user) throw unauthenticated();
  return request.user;
}
