import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Registry, collectDefaultMetrics } from "prom-client";
import type { Counter, Histogram } from "prom-client";

export type { Counter, Histogram, Registry } from "prom-client";

/** Request-duration histogram buckets, in seconds. */
export const DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30,
];

/**
 * A registry owned by one app (never prom-client's global one). With `processMetrics`, the
 * Node.js process metrics are collected into it under `prefix`.
 */
export function createRegistry(options: { prefix: string; processMetrics: boolean }): Registry {
  const registry = new Registry();
  if (options.processMetrics) collectDefaultMetrics({ register: registry, prefix: options.prefix });
  return registry;
}

/** The `status` label: `String(res.statusCode)` when headers were sent, else `"none"`. */
export function statusLabel(res: ServerResponse): string {
  return res.headersSent ? String(res.statusCode) : "none";
}

/**
 * Times every request from `onRequest` until `reply.raw` emits "close" (so it also counts replies
 * Fastify hijacks, and callers that disconnect before any answer). `labelsOf` is called once, in
 * the close handler, after routing; the `status` label is added here.
 */
export function trackRequests(
  app: FastifyInstance,
  metrics: { requests: Counter<string>; duration: Histogram<string> },
  labelsOf: (request: FastifyRequest) => Record<string, string>,
): void {
  app.addHook("onRequest", (request, reply, done) => {
    const start = process.hrtime.bigint();
    reply.raw.once("close", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const labels = { ...labelsOf(request), status: statusLabel(reply.raw) };
      metrics.requests.inc(labels);
      metrics.duration.observe(labels, seconds);
    });
    done();
  });
}

/**
 * Serves `GET /metrics` of `registry` on its own listener; any other path or method gets an empty
 * 404. `port` 0 picks a free port, reported in the result.
 */
export async function startMetricsServer(
  registry: Registry,
  options: { host: string; port: number },
): Promise<{ port: number; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method !== "GET" || path !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    registry.metrics().then(
      (body) => {
        res.writeHead(200, { "Content-Type": registry.contentType });
        res.end(body);
      },
      () => res.writeHead(500).end(),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
