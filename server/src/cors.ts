import type { FastifyInstance } from "fastify";
import { requestPathname } from "./web/static.js";

/** ADR 0037 point 7: CORS is for the public operations and bearer requests, never for cookies. */
const API_PREFIX = "/api/v1/";
const PUBLIC_PREFIX = "/api/v1/public/";

const ALLOWED_REQUEST_HEADERS =
  "Authorization, Content-Type, Idempotency-Key, If-Match, If-None-Match";
const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE";
const EXPOSED_HEADERS = "ETag, Location, Retry-After, Content-Disposition";
const MAX_AGE_SECONDS = "600";

export interface CorsRequest {
  readonly method: string;
  /** The URL path, without the query. */
  readonly path: string;
  readonly origin?: string | undefined;
  readonly authorization?: string | undefined;
  /** `Access-Control-Request-Headers` of a preflight. */
  readonly requestHeaders?: string | undefined;
}

export interface CorsDecision {
  /** The `Access-Control-Allow-Origin` value; null: no CORS headers. */
  readonly allowOrigin: "*" | null;
  readonly preflight: boolean;
}

function isBearer(authorization: string | undefined): boolean {
  return authorization !== undefined && /^bearer(\s|$)/i.test(authorization.trim());
}

/**
 * Whether and how a request is answered with CORS headers: `*` for the public operations and for
 * bearer requests (no credentials are ever allowed); nothing for cookie requests, requests
 * without `Origin` and paths outside the API. A preflight is allowed on a public path or when it
 * asks to send `Authorization`.
 */
export function corsDecision(request: CorsRequest): CorsDecision {
  const preflight = request.method.toUpperCase() === "OPTIONS";
  const none: CorsDecision = { allowOrigin: null, preflight };
  if (!request.origin || !request.path.startsWith(API_PREFIX)) return none;
  const isPublic = request.path.startsWith(PUBLIC_PREFIX);
  if (preflight) {
    const asksForAuthorization = (request.requestHeaders ?? "")
      .split(",")
      .some((name) => name.trim().toLowerCase() === "authorization");
    return isPublic || asksForAuthorization ? { allowOrigin: "*", preflight } : none;
  }
  return isPublic || isBearer(request.authorization) ? { allowOrigin: "*", preflight } : none;
}

/** Registers the hooks; call it before the API routes. */
export function registerCors(app: FastifyInstance): void {
  app.addHook("onRequest", (request, reply, done) => {
    const path = requestPathname(request.url);
    const decision = corsDecision({
      method: request.method,
      path,
      origin: request.headers.origin,
      authorization: request.headers.authorization,
      requestHeaders: headerValue(request.headers["access-control-request-headers"]),
    });
    if (decision.preflight && decision.allowOrigin !== null) {
      void reply
        .code(204)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", ALLOWED_METHODS)
        .header("access-control-allow-headers", ALLOWED_REQUEST_HEADERS)
        .header("access-control-max-age", MAX_AGE_SECONDS)
        .header("vary", "Origin")
        .send();
      return;
    }
    done();
  });
  app.addHook("onSend", (request, reply, payload, done) => {
    const path = requestPathname(request.url);
    if (path.startsWith(API_PREFIX)) {
      void reply.header("vary", appendVary(reply.getHeader("vary")));
      const decision = corsDecision({
        method: request.method,
        path,
        origin: request.headers.origin,
        authorization: request.headers.authorization,
        requestHeaders: headerValue(request.headers["access-control-request-headers"]),
      });
      if (decision.allowOrigin !== null && !decision.preflight) {
        void reply
          .header("access-control-allow-origin", decision.allowOrigin)
          .header("access-control-expose-headers", EXPOSED_HEADERS);
      }
    }
    done(null, payload);
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

function appendVary(current: unknown): string {
  const existing = Array.isArray(current)
    ? current.join(", ")
    : typeof current === "string"
      ? current
      : "";
  if (existing === "") return "Origin";
  return /(^|,\s*)(origin|\*)\s*(,|$)/i.test(existing) ? existing : `${existing}, Origin`;
}
