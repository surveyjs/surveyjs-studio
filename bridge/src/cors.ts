// The old API's CORS policy (any origin, any method, any header; no credentials), applied before
// routing as the old pipeline did: a preflight to any path answers 204 here, and every answer the
// bridge makes itself carries `Access-Control-Allow-Origin: *` when the request has an `Origin`.
// Forwarded answers keep the old service's own headers.
import type { FastifyInstance, FastifyRequest } from "fastify";

/** A CORS preflight: `OPTIONS` with an `Origin` and a non-empty `Access-Control-Request-Method`. */
export function isPreflight(request: FastifyRequest): boolean {
  const method = request.headers["access-control-request-method"];
  return (
    request.method === "OPTIONS" &&
    request.headers.origin !== undefined &&
    typeof method === "string" &&
    method !== ""
  );
}

/** Registers the policy; call before any other `onRequest` hook but those that only observe (metrics.ts). */
export function registerCors(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isPreflight(request)) return;
    void reply
      .code(204)
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", request.headers["access-control-request-method"]);
    const requested = (request.headers["access-control-request-headers"] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "");
    if (requested.length > 0)
      void reply.header("access-control-allow-headers", requested.join(","));
    return reply.send();
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (request.headers.origin !== undefined) void reply.header("access-control-allow-origin", "*");
    return payload;
  });
}
