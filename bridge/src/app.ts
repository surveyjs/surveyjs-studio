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
import { createForwarder, plainAddress, type Forwarder } from "./forward.js";
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

function forward(forwarder: Forwarder, request: FastifyRequest, reply: FastifyReply): void {
  reply.hijack();
  forwarder.forward(request.raw, reply.raw, {
    peer: plainAddress(request.raw.socket.remoteAddress),
    cors: request.headers.origin !== undefined,
    log: request.log,
  });
}

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
    frameworkErrors: (_error, request, reply) => forward(forwarder, request, reply),
  });

  app.decorateRequest("studio", {
    getter(this: FastifyRequest): StudioClient {
      return studioClient(settings, plainAddress(this.ip), fetchImpl);
    },
  });

  registerCors(app);

  // Before body parsing, so a forwarded body is streamed untouched.
  app.addHook("onRequest", async (request, reply) => {
    if (request.is404) {
      forward(forwarder, request, reply);
      return reply;
    }
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
