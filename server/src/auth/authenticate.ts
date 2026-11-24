import type { FastifyRequest, onRequestAsyncHookHandler } from "fastify";
import type { Security } from "../contract.js";
import { AppError } from "../errors.js";
import { CSRF_COOKIE, parseCookies, SESSION_COOKIE } from "./cookies.js";
import { csrfTokensMatch } from "./csrf.js";
import type { InstanceRole } from "../providers/types.js";
import type { SessionCheck } from "./session-check.js";
import { decodeSession, type Clock } from "./session.js";

/** What a request's credential reaches (ADR 0037). */
export type CredentialScope =
  /** A session or a legacy access key: whatever the user can reach. */
  | { readonly kind: "all" }
  /** A Personal API token: the user's personal surveys. */
  | { readonly kind: "personal" }
  /** A project API token: the project, with a project admin's rights. */
  | { readonly kind: "project"; readonly projectId: string };

/** The credential a request was authenticated with. */
export type RequestCredential =
  | { readonly kind: "session" }
  | { readonly kind: "api-token"; readonly id: string }
  | { readonly kind: "legacy-key" };

/** The signed-in user, as handlers see it. */
export interface RequestUser {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
  readonly avatarUrl: string | null;
  /** A local account's instance role (USER_DIRECTORY=local), from the session check. */
  readonly instanceRole?: InstanceRole;
  /** What the credential reaches; a session reaches everything, and a producer must say so. */
  readonly scope: CredentialScope;
  readonly credential?: RequestCredential;
}

/** Turns an `Authorization: Bearer` value into its user; throws `401 unauthenticated`. */
export interface BearerResolver {
  resolve(value: string): Promise<RequestUser>;
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
  /** API tokens and legacy access keys. Absent: every bearer request answers 401. */
  readonly bearer?: BearerResolver;
}

/**
 * How an operation's security requirements are met. `bearer`: the operation also lists
 * `bearerAuth`, so an `Authorization: Bearer` header makes the request a bearer request (the
 * cookie is ignored and CSRF does not apply). `optional`: a session requirement next to the empty
 * one (`logout`). Without a valid session the call is anonymous; with one, the session's rules
 * (CSRF) apply. `bearer-only`: `bearerAuth` alone (`replaceCurrentCredential`); a session is not
 * enough.
 */
export type AccessRule =
  | { readonly kind: "public" }
  | { readonly kind: "session"; readonly csrf: boolean; readonly bearer: boolean }
  | { readonly kind: "optional"; readonly csrf: boolean; readonly bearer: boolean }
  | { readonly kind: "bearer-only" }
  | { readonly kind: "never" };

const SESSION_SCHEMES = new Set(["cookieAuth", "csrfToken"]);

export function accessRule(security: Security): AccessRule {
  if (security.length === 0) return { kind: "public" };
  const anonymous = security.some((requirement) => requirement.length === 0);
  const bearer = security.some(
    (requirement) => requirement.length === 1 && requirement[0] === "bearerAuth",
  );
  const usable = security.filter(
    (requirement) =>
      requirement.includes("cookieAuth") && requirement.every((name) => SESSION_SCHEMES.has(name)),
  );
  // With an anonymous alternative a credential is never required: the operation is public.
  if (usable.length === 0) return { kind: anonymous ? "public" : bearer ? "bearer-only" : "never" };
  // CSRF is needed only when every requirement the session can meet asks for it.
  const csrf = usable.every((requirement) => requirement.includes("csrfToken"));
  return { kind: anonymous ? "optional" : "session", csrf, bearer };
}

/**
 * The value of an `Authorization: Bearer` header (the scheme in any letter case), "" for a
 * malformed one, and undefined when the header is absent or names another scheme.
 */
function bearerValue(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^bearer(?:\s+(.*))?$/is.exec(header.trim());
  if (!match) return undefined;
  const value = match[1] ?? "";
  return /\s/.test(value) ? "" : value;
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
    if (rule.kind === "bearer-only" || rule.bearer) {
      const value = bearerValue(request.headers.authorization);
      if (value !== undefined) {
        if (!options.bearer || value === "") throw unauthenticated();
        request.user = await options.bearer.resolve(value);
        return;
      }
      if (rule.kind === "bearer-only") throw unauthenticated();
    }
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
      scope: { kind: "all" },
      credential: { kind: "session" },
    };
  };
}

/** The signed-in user of an operation that needs a session. */
export function requireUser(request: FastifyRequest): RequestUser {
  if (!request.user) throw unauthenticated();
  return request.user;
}
