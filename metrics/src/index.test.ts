import { once } from "node:events";
import net from "node:net";
import Fastify from "fastify";
import { Counter, Histogram } from "@prometheus-io/client";
import { afterEach, describe, expect, it } from "vitest";
import { DURATION_BUCKETS, createRegistry, startMetricsServer, trackRequests } from "./index.js";

describe("createRegistry", () => {
  it("exposes process metrics under the prefix when asked", async () => {
    const registry = createRegistry({ prefix: "app_", processMetrics: true });
    expect(await registry.metrics()).toContain("app_process_cpu_seconds_total");
  });

  it("has no process metrics when not asked", async () => {
    const registry = createRegistry({ prefix: "app_", processMetrics: false });
    expect(await registry.metrics()).not.toContain("process_cpu_seconds_total");
  });

  it("does not share metrics between registries", async () => {
    const a = createRegistry({ prefix: "a_", processMetrics: false });
    const b = createRegistry({ prefix: "b_", processMetrics: false });
    new Counter({ name: "a_things_total", help: "x", registers: [a] }).inc();
    expect(await a.metrics()).toContain("a_things_total");
    expect(await b.metrics()).not.toContain("a_things_total");
  });
});

describe("trackRequests", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  async function setup() {
    const registry = createRegistry({ prefix: "t_", processMetrics: false });
    const requests = new Counter({
      name: "t_requests_total",
      help: "x",
      labelNames: ["route", "status"],
      registers: [registry],
    });
    const duration = new Histogram({
      name: "t_duration_seconds",
      help: "x",
      labelNames: ["route"],
      buckets: [...DURATION_BUCKETS],
      registers: [registry],
    });
    const app = Fastify();
    apps.push(app);
    trackRequests(app, { requests, duration }, (request) => ({
      route: request.routeOptions.url ?? "unmatched",
    }));
    return { app, registry };
  }

  it("counts a normal reply", async () => {
    const { app, registry } = await setup();
    app.get("/ok", async () => "ok");
    await app.inject({ method: "GET", url: "/ok" });
    expect(await registry.metrics()).toContain('t_requests_total{route="/ok",status="200"} 1');
  });

  it("counts a hijacked reply written on reply.raw", async () => {
    const { app, registry } = await setup();
    app.get("/fwd", (_request, reply) => {
      reply.hijack();
      reply.raw.writeHead(204);
      reply.raw.end();
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as net.AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/fwd`);
    expect(res.status).toBe(204);
    await expect
      .poll(async () => await registry.metrics())
      .toContain('t_requests_total{route="/fwd",status="204"} 1');
  });

  it('labels a request whose socket closes before any answer status="none"', async () => {
    const { app, registry } = await setup();
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    app.get("/slow", async () => {
      await released;
      return "late";
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as net.AddressInfo;
    const socket = net.connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write("GET /slow HTTP/1.1\r\nHost: x\r\n\r\n");
    await new Promise((resolve) => setTimeout(resolve, 100));
    socket.destroy();
    await expect
      .poll(async () => await registry.metrics())
      .toContain('t_requests_total{route="/slow",status="none"} 1');
    release();
  });
});

describe("startMetricsServer", () => {
  it("serves GET /metrics, 404s everything else, and frees the port on close", async () => {
    const registry = createRegistry({ prefix: "s_", processMetrics: false });
    new Counter({ name: "s_things_total", help: "x", registers: [registry] }).inc();
    const server = await startMetricsServer(registry, { host: "127.0.0.1", port: 0 });
    const base = `http://127.0.0.1:${server.port}`;

    const ok = await fetch(`${base}/metrics`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    expect(await ok.text()).toContain("s_things_total 1");

    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/other"],
      ["POST", "/metrics"],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method });
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }

    await server.close();
    await expect(fetch(`${base}/metrics`)).rejects.toThrow();
  });
});
