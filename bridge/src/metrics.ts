// The bridge's metrics and its request log line (ADR 0041 points 4 and 5). Every label value comes
// from a bounded set: no key, ID, path or address.
import {
  Counter,
  DURATION_BUCKETS,
  Gauge,
  Histogram,
  statusLabel,
  trackRequests,
} from "@surveyjs-studio/metrics";
import type { Registry } from "@surveyjs-studio/metrics";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { keyHashPrefix } from "./callers.js";
import { isPreflight } from "./cors.js";
import { keyOf } from "./key.js";

/** How a `getSurvey` definition was read (`definitionText`). */
export type CacheResult = "hit" | "miss" | "stale" | "none";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The old action a route serves (the mapping table's name); the metrics' `action` label. */
    action?: string;
  }
  interface FastifyRequest {
    /** What the request's handling noted for its log line. */
    readonly observed: { cache?: CacheResult };
  }
}

export interface BridgeMetrics {
  /** Requests by action, method and status (`none`: no answer was started). */
  readonly requests: Counter<string>;
  /** Request duration in seconds by action and method. */
  readonly duration: Histogram<string>;
  /** Calls to Studio by operation (`<METHOD> <schema path>`) and status (or `timeout`, `network`, `aborted`). */
  readonly studioCalls: Counter<string>;
  /** Studio call duration in seconds, until its answer's headers, by operation. */
  readonly studioDuration: Histogram<string>;
  /** `getSurvey` definition reads by cache result. */
  readonly cache: Counter<string>;
  /** Forwarded requests without a complete answer, by reason. */
  readonly forwardFailures: Counter<string>;
  /** `upload` requests being read or answered. */
  readonly uploads: Gauge;
}

export function createBridgeMetrics(registry: Registry): BridgeMetrics {
  const registers = [registry];
  return {
    requests: new Counter({
      name: "surveyjs_bridge_requests_total",
      help: "Requests by old action, method and status",
      labelNames: ["action", "method", "status"],
      registers,
    }),
    duration: new Histogram({
      name: "surveyjs_bridge_request_duration_seconds",
      help: "Request duration by old action and method",
      labelNames: ["action", "method"],
      buckets: [...DURATION_BUCKETS],
      registers,
    }),
    studioCalls: new Counter({
      name: "surveyjs_bridge_studio_calls_total",
      help: "Calls to Studio by operation and status (timeout, network or aborted when none came)",
      labelNames: ["operation", "status"],
      registers,
    }),
    studioDuration: new Histogram({
      name: "surveyjs_bridge_studio_call_duration_seconds",
      help: "Studio call duration until its answer's headers, by operation",
      labelNames: ["operation"],
      buckets: [...DURATION_BUCKETS],
      registers,
    }),
    cache: new Counter({
      name: "surveyjs_bridge_survey_cache_total",
      help: "getSurvey definition reads by cache result (hit, miss, stale, none)",
      labelNames: ["result"],
      registers,
    }),
    forwardFailures: new Counter({
      name: "surveyjs_bridge_forward_failures_total",
      help: "Forwarded requests the old service did not answer completely, by reason",
      labelNames: ["reason"],
      registers,
    }),
    uploads: new Gauge({
      name: "surveyjs_bridge_uploads_in_progress",
      help: "upload requests in progress",
      registers,
    }),
  };
}

/** Requests the router refused before routing (`observeUnrouted`): no hook, CORS included, ran. */
const unrouted = new WeakSet<FastifyRequest>();

/**
 * The `action` label: `preflight` for a CORS preflight the bridge answers itself (cors.ts, before
 * routing), the route's old action, or `forwarded` for any path the bridge forwards.
 */
function actionOf(request: FastifyRequest): string {
  if (unrouted.has(request)) return "forwarded";
  if (isPreflight(request)) return "preflight";
  return (request.routeOptions.config as { action?: string } | undefined)?.action ?? "forwarded";
}

function labelsOf(request: FastifyRequest): { action: string; method: string } {
  return { action: actionOf(request), method: request.method };
}

/** Each request's `observed` notes. */
const observed = new WeakMap<FastifyRequest, { cache?: CacheResult }>();

/**
 * The request's log line, written once its answer is done or abandoned: action, method, status,
 * milliseconds, the cache result, the key's hash prefix (only with a key), and for a forwarded
 * request (not a preflight) its path without the query. Never the key, the query or the caller's address.
 */
function logRequest(request: FastifyRequest, reply: FastifyReply, startedAt: bigint): void {
  const action = actionOf(request);
  const key = keyOf(request);
  // Not `request.observed`: a request the router refused is not of the decorated class.
  const cache = observed.get(request)?.cache;
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
  request.log.info(
    {
      action,
      method: request.method,
      status: statusLabel(reply.raw),
      ms: Math.round(ms * 10) / 10,
      ...(cache !== undefined && { cache }),
      ...(key !== undefined && { key: keyHashPrefix(key) }),
      ...(action === "forwarded" && { path: (request.raw.url ?? "").split("?")[0] }),
    },
    "request",
  );
}

/**
 * Counts, times and logs every request that reaches the hooks (call before any other `onRequest`
 * hook, so a request another hook answers is counted too), and gives requests `observed`.
 */
export function observeRequests(app: FastifyInstance, metrics: BridgeMetrics): void {
  app.decorateRequest("observed", {
    getter(this: FastifyRequest): { cache?: CacheResult } {
      let notes = observed.get(this);
      if (notes === undefined) {
        notes = {};
        observed.set(this, notes);
      }
      return notes;
    },
  });
  trackRequests(app, metrics, labelsOf);
  app.addHook("onRequest", (request, reply, done) => {
    const startedAt = process.hrtime.bigint();
    reply.raw.once("close", () => logRequest(request, reply, startedAt));
    done();
  });
}

/**
 * As `observeRequests`, for one request no hook sees: one the router refused before routing
 * (Fastify's `frameworkErrors`), which the bridge forwards.
 */
export function observeUnrouted(
  request: FastifyRequest,
  reply: FastifyReply,
  metrics: BridgeMetrics,
): void {
  unrouted.add(request);
  const startedAt = process.hrtime.bigint();
  reply.raw.once("close", () => {
    const labels = labelsOf(request);
    metrics.requests.inc({ ...labels, status: statusLabel(reply.raw) });
    metrics.duration.observe(labels, Number(process.hrtime.bigint() - startedAt) / 1e9);
    logRequest(request, reply, startedAt);
  });
}
