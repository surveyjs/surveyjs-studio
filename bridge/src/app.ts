// The bridge (ADR 0035, ADR 0039): answers on the old API's host as the old API does, through
// Studio's public API, and forwards everything else to the old service.
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { createRegistry } from "@surveyjs-studio/metrics";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { registerActions } from "./actions/index.js";
import { sendEmpty } from "./answers.js";
import { registerCors } from "./cors.js";
import { createForwarder, MAX_HEADER_BYTES, plainAddress, type Forwarder } from "./forward.js";
import { withoutKey } from "./key.js";
import {
  createBridgeMetrics,
  observeRequests,
  observeUnrouted,
  type BridgeMetrics,
} from "./metrics.js";
import type { BridgeSettings } from "./settings.js";
import { studioClient, StudioFailure, type StudioClient } from "./studio.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Studio's public API on behalf of this request's caller. */
    readonly studio: StudioClient;
    /** As `studio`, for reading a file: its bytes may take `BRIDGE_FILE_TIMEOUT_MS` to stream. */
    readonly studioFiles: StudioClient;
    /** Aborted when the caller goes away before its answer is complete. */
    readonly callerGone: AbortSignal;
    /** The caller's address, for Studio's `X-Forwarded-For`; `""` when unknown. */
    readonly callerIp: string;
  }
}

export interface BridgeDeps {
  /** For calls to Studio (tests). */
  fetch?: typeof fetch;
  logger?: FastifyServerOptions["logger"];
  /** How long the old service may send nothing on a forwarded request (tests). */
  forwardTimeoutMs?: number;
  /** Whether to register the old API's actions (default true; tests of the skeleton add their own). */
  actions?: boolean;
  /** Where requests are counted (main.ts serves their registry); a private set when absent. */
  metrics?: BridgeMetrics;
}

/**
 * Each connection's peer address, taken when it is accepted: a destroyed socket no longer knows
 * it, and a request forwarded without it would carry only the caller's own X-Forwarded-For.
 */
const peers = new WeakMap<Socket, string>();

/** The connection's peer, or `undefined` when it is unknown or no answer can be written any more. */
function livePeer(request: FastifyRequest): string | undefined {
  const socket = request.raw.socket;
  if (socket.destroyed || !socket.writable) return undefined;
  const peer = peers.get(socket);
  return peer === undefined || peer === "" ? undefined : peer;
}

/**
 * The logger's options, with request URLs logged without the `accessKey` value: the key is a
 * credential and never reaches the logs. The fields are otherwise Fastify's own (without the
 * rarely sent `Accept-Version`).
 */
function loggerOptions(logger: BridgeDeps["logger"]): FastifyServerOptions["logger"] {
  if (logger === undefined || logger === false) return false;
  const options = logger === true ? {} : logger;
  return {
    ...options,
    serializers: {
      ...options.serializers,
      req: (request: FastifyRequest) => ({
        method: request.method,
        url: withoutKey(request.url),
        host: request.host,
        remoteAddress: request.ip,
        remotePort: request.socket.remotePort,
      }),
    },
  };
}

/** Hands the request to the old service; never throws (a failure is an empty 500). */
function forward(forwarder: Forwarder, request: FastifyRequest, reply: FastifyReply): void {
  try {
    reply.hijack();
    const peer = livePeer(request);
    if (peer === undefined) {
      // Nobody can receive an answer, and the chain would lack the caller's address.
      reply.raw.destroy();
      return;
    }
    forwarder.forward(request.raw, reply.raw, {
      peer,
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

const STATUS_LINES = {
  400: "HTTP/1.1 400 Bad Request",
  408: "HTTP/1.1 408 Request Timeout",
  431: "HTTP/1.1 431 Request Header Fields Too Large",
} as const;

/** An empty 400 (431 for headers over the limit, 408 for a request too slow), then close. */
function answerClientError(error: Error & { code?: string }, socket: Duplex): void {
  if (error.code === "ECONNRESET" || !socket.writable) {
    socket.destroy();
    return;
  }
  const status =
    error.code === "HPE_HEADER_OVERFLOW"
      ? 431
      : error.code === "ERR_HTTP_REQUEST_TIMEOUT"
        ? 408
        : 400;
  socket.end(`${STATUS_LINES[status]}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
}

/** Aborted when the caller goes away before its answer is complete: its Studio calls stop. */
const callerGone = new WeakMap<object, AbortSignal>();

export function buildBridge(settings: BridgeSettings, deps: BridgeDeps = {}): FastifyInstance {
  const metrics =
    deps.metrics ??
    createBridgeMetrics(createRegistry({ prefix: "surveyjs_bridge_", processMetrics: false }));
  const forwarder = createForwarder(settings.legacyUrl, {
    ...(deps.forwardTimeoutMs !== undefined && { timeoutMs: deps.forwardTimeoutMs }),
    onFailure: (reason) => metrics.forwardFailures.inc({ reason }),
  });
  const fetchImpl = deps.fetch ?? fetch;

  const app = Fastify({
    logger: loggerOptions(deps.logger),
    // Each request is logged once, when its answer closes (metrics.ts), without its query.
    logController: new LogController({ disableRequestLogging: true }),
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
    // forward() never throws: this handler runs outside Fastify's error handling. No hook sees
    // such a request: it is counted here.
    frameworkErrors: (_error, request, reply) => {
      observeUnrouted(request, reply, metrics);
      forward(forwarder, request, reply);
    },
    // A request Node's parser refuses: an empty answer, as the bridge's other errors.
    clientErrorHandler: answerClientError,
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

  app.server.on("connection", (socket: Socket) => {
    peers.set(socket, plainAddress(socket.remoteAddress));
  });

  // Without trusted proxies the caller is the connection's peer, as taken on accept.
  const callerOf = (request: FastifyRequest): string =>
    settings.trustProxy.length > 0
      ? plainAddress(request.ip)
      : (peers.get(request.raw.socket) ?? "");
  app.decorateRequest("callerIp", {
    getter(this: FastifyRequest): string {
      return callerOf(this);
    },
  });
  app.decorateRequest("studio", {
    getter(this: FastifyRequest): StudioClient {
      return studioClient(settings, callerOf(this), fetchImpl, {
        callerGone: callerGone.get(this.raw),
        metrics,
      });
    },
  });
  app.decorateRequest("callerGone", {
    getter(this: FastifyRequest): AbortSignal {
      return callerGone.get(this.raw) ?? new AbortController().signal;
    },
  });
  app.decorateRequest("studioFiles", {
    getter(this: FastifyRequest): StudioClient {
      return studioClient(settings, callerOf(this), fetchImpl, {
        callerGone: callerGone.get(this.raw),
        bodyTimeoutMs: settings.fileTimeoutMs,
        metrics,
      });
    },
  });

  // First: a request another hook answers (a preflight, a forwarded path) is counted too.
  observeRequests(app, metrics);
  registerCors(app);

  // Before body parsing, so a forwarded body is streamed untouched.
  app.addHook("onRequest", async (request, reply) => {
    if (request.is404) {
      forward(forwarder, request, reply);
      return reply;
    }
    const controller = new AbortController();
    callerGone.set(request.raw, controller.signal);
    if (request.raw.socket.destroyed) controller.abort(new Error("the caller went away"));
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort(new Error("the caller went away"));
    });
    return undefined;
  });

  app.setErrorHandler((error, request, reply) => {
    // The caller left, which aborted its Studio calls: there is nobody to answer.
    if (callerGone.get(request.raw)?.aborted === true || reply.raw.destroyed) {
      request.log.debug({ err: error }, "the caller went away");
      reply.hijack();
      return;
    }
    if (error instanceof StudioFailure) {
      if (error.status === 500) request.log.error({ err: error }, "Studio call failed");
      return sendEmpty(reply, error.status);
    }
    request.log.error({ err: error }, "unexpected error");
    return sendEmpty(reply, 500);
  });

  if (deps.actions !== false) {
    registerActions(app, settings, {
      studioFetch: fetchImpl,
      metrics,
      forward: (request, reply) => forward(forwarder, request, reply),
    });
  }

  app.addHook("onClose", async () => forwarder.close());

  return app;
}
