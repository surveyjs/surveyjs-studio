import { Counter, DURATION_BUCKETS, Histogram } from "@surveyjs-studio/metrics";
import type { Registry } from "@surveyjs-studio/metrics";
import type { FastifyRequest } from "fastify";
import type { ProviderSet } from "./providers/types.js";
import { isServerPath, requestPathname } from "./web/static.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** The contract operation a route serves (set in api.ts); the metrics' `operation` label. */
    operationId?: string;
  }
}

/** Studio's metrics (ADR 0041). Label values are bounded: no id, key, path or address. */
export interface StudioMetrics {
  /** Requests by operation, method and status. */
  readonly requests: Counter<string>;
  /** Request duration in seconds by operation and method. */
  readonly duration: Histogram<string>;
  /** Duration of a store call in seconds by store, method and outcome. */
  readonly storeDuration: Histogram<string>;
}

export function createStudioMetrics(registry: Registry): StudioMetrics {
  return {
    requests: new Counter({
      name: "surveyjs_studio_http_requests_total",
      help: "HTTP requests by operation, method and status",
      labelNames: ["operation", "method", "status"],
      registers: [registry],
    }),
    duration: new Histogram({
      name: "surveyjs_studio_http_request_duration_seconds",
      help: "HTTP request duration by operation and method",
      labelNames: ["operation", "method"],
      buckets: [...DURATION_BUCKETS],
      registers: [registry],
    }),
    storeDuration: new Histogram({
      name: "surveyjs_studio_store_call_duration_seconds",
      help: "Store call duration by store, method and outcome",
      labelNames: ["store", "method", "outcome"],
      buckets: [...DURATION_BUCKETS],
      registers: [registry],
    }),
  };
}

/**
 * The `operation` label of a request, from a bounded set: the contract operation's id, `unmatched`
 * (no route answered), `system` (the server's own paths: health, sign-in) or `web` (the web app).
 */
export function operationLabel(request: FastifyRequest): string {
  if (request.is404) return "unmatched";
  const operationId = request.routeOptions.config.operationId;
  if (operationId !== undefined) return operationId;
  return isServerPath(requestPathname(request.url)) ? "system" : "web";
}

const STORE_NAMES = [
  "surveys",
  "users",
  "accounts",
  "invitations",
  "projects",
  "files",
  "results",
  "views",
  "credentials",
  "notices",
] as const;

/**
 * The same provider set with every store's promise-returning calls timed as
 * `store_call_duration_seconds{store,method,outcome}`. Other results (iterators, streams, plain
 * values) pass through unobserved; `name`, `readinessNames`, `ready` and `close` are untouched.
 */
export function instrumentProviders(
  providers: ProviderSet,
  storeDuration: Histogram<"store" | "method" | "outcome">,
): ProviderSet {
  const stores = new Map<PropertyKey, object>();
  for (const name of STORE_NAMES) {
    const store: object | null = providers[name];
    if (store === null) continue;
    stores.set(
      name,
      new Proxy(store, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== "function" || typeof property !== "string") return value;
          return (...args: unknown[]): unknown => {
            const stop = storeDuration.startTimer({ store: name, method: property });
            const result: unknown = (value as (...a: unknown[]) => unknown).apply(target, args);
            if (!isPromise(result)) return result;
            return result.then(
              (resolved: unknown) => {
                stop({ outcome: "ok" });
                return resolved;
              },
              (error: unknown) => {
                stop({ outcome: "error" });
                throw error;
              },
            );
          };
        },
      }),
    );
  }
  // Everything else (name, readinessNames, ready, close, null stores) is the original's.
  return new Proxy(providers, {
    get(target, property) {
      const store = stores.get(property);
      if (store !== undefined) return store;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}
