// The bridge (ADR 0035, ADR 0039): answers on the old API's host as the old API does, through
// Studio's public API, and forwards everything else to the old service.
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { sendEmpty } from "./answers.js";
import { registerCors } from "./cors.js";
import { createForwarder, MAX_HEADER_BYTES, plainAddress, type Forwarder } from "./forward.js";
import type { BridgeSettings } from "./settings.js";
import { studioClient, StudioFailure, type StudioClient } from "./studio.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Studio's public API on behalf of this request's caller. */
    readonly studio: StudioClient;
  }
}

export interface BridgeDeps {
  /** For calls to Studio (tests). */
  fetch?: typeof fetch;
  /** The clock (the `getSurvey` cache). */
  now?: () => number;
  logger?: FastifyServerOptions["logger"];
  /** How long the old service may send nothing on a forwarded request (tests). */
  forwardTimeoutMs?: number;
}

/** Hands the request to the old service; never throws (a failure is an empty 500). */
function forward(forwarder: Forwarder, request: FastifyRequest, reply: FastifyReply): void {
  try {
    reply.hijack();
    forwarder.forward(request.raw, reply.raw, {
      peer: plainAddress(request.raw.socket.remoteAddress),
      cors: request.headers.origin !== undefined,
      log: request.log,
    });
  } catch (error) {
    request.log.error({ err: error }, "forwarding failed");
    const res = reply.raw;
    if (res.headersSent || res.destroyed) res.destroy();
    else res.writeHead(500, { "content-length": "0" }).end();
  }
}

/** Aborted when the caller goes away before its answer is complete: its Studio calls stop. */
const callerGone = new WeakMap<object, AbortSignal>();

export function buildBridge(settings: BridgeSettings, deps: BridgeDeps = {}): FastifyInstance {
  const forwarder = createForwarder(settings.legacyUrl, deps.forwardTimeoutMs);
  const fetchImpl = deps.fetch ?? fetch;

  const app = Fastify({
    logger: deps.logger ?? false,
    routerOptions: {
      // The old API's routing: any letter case, one trailing slash or none.
      caseSensitive: false,
      ignoreTrailingSlash: true,
      // As Studio's: a client ID or question name in a path segment must route.
      maxParamLength: 1024,
    },
    // The old actions answer only their own methods; HEAD goes to the old service like any
    // other method an action does not take.
    exposeHeadRoutes: false,
    // `app.close()` closes idle keep-alive sockets and waits for requests in flight.
    forceCloseConnections: "idle",
    // Empty trusts nobody: `request.ip` is the socket's peer, whatever X-Forwarded-For says.
    ...(settings.trustProxy.length > 0 && { trustProxy: [...settings.trustProxy] }),
    // A path the router cannot take (malformed escapes, an over-long segment) is not an action's.
    // forward() never throws: this handler runs outside Fastify's error handling.
    frameworkErrors: (_error, request, reply) => forward(forwarder, request, reply),
    // A request (headers and body) must arrive within 5 minutes, Node's own default, which Fastify
    // turns off; long enough for a slow upload, and no connection waits forever.
    requestTimeout: 300_000,
    http: {
      // The old host accepted 32 KB of request headers (Node's default is 16 KB).
      maxHeaderSize: MAX_HEADER_BYTES,
      // Node checks the timeout every 30 s; its headers timeout must not exceed the request one.
      connectionsCheckingInterval: 30_000,
      headersTimeout: 60_000,
    },
  });

  app.decorateRequest("studio", {
    getter(this: FastifyRequest): StudioClient {
      return studioClient(settings, plainAddress(this.ip), fetchImpl, callerGone.get(this.raw));
    },
  });

  registerCors(app);

  // Before body parsing, so a forwarded body is streamed untouched.
  app.addHook("onRequest", async (request, reply) => {
    if (request.is404) {
      forward(forwarder, request, reply);
      return reply;
    }
    const controller = new AbortController();
    callerGone.set(request.raw, controller.signal);
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort(new Error("the caller went away"));
    });
    return undefined;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof StudioFailure) {
      if (error.status === 500) request.log.error({ err: error }, "Studio call failed");
      return sendEmpty(reply, error.status);
    }
    request.log.error({ err: error }, "unexpected error");
    return sendEmpty(reply, 500);
  });

  app.addHook("onClose", async () => forwarder.close());

  return app;
}
