import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createRegistry } from "@surveyjs-studio/metrics";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createStudioMetrics, operationLabel } from "./metrics.js";
import { createProviders } from "./providers/index.js";

const FEEDBACK = "22222222-0000-4000-8000-a00000000001";

let app: FastifyInstance | undefined;
let webRoot: string | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  if (webRoot) await rm(webRoot, { recursive: true, force: true });
  webRoot = undefined;
});

async function start(env: Record<string, string> = {}) {
  const loaded = loadConfig({
    NODE_ENV: "test",
    IDENTITY_PROVIDER: "dev",
    MEMORY_SEED: "legacy-fixtures",
    ...env,
  });
  // Hosted routes the bridge's operations (set after loading: the dev sign-in refuses it).
  const config = { ...loaded, edition: "hosted" as const };
  const registry = createRegistry({ prefix: "surveyjs_studio_", processMetrics: false });
  const metrics = createStudioMetrics(registry);
  const server = await buildApp(config, await createProviders(config), { metrics });
  app = server;
  return { server, registry };
}

/** The operation label of the request, as the metrics see it once routing is done. */
async function labelOf(server: FastifyInstance, url: string): Promise<string> {
  const seen: string[] = [];
  server.addHook("onResponse", async (request) => void seen.push(operationLabel(request)));
  await server.inject(url);
  return seen[0] ?? "none";
}

describe("operationLabel", () => {
  it("is the operationId of a contract route", async () => {
    const { server } = await start();
    expect(await labelOf(server, `/api/v1/public/surveys/${FEEDBACK}/definition`)).toBe(
      "getPublicDefinition",
    );
  });

  it("is system for the server's own paths", async () => {
    const { server } = await start();
    expect(await labelOf(server, "/healthz")).toBe("system");
  });

  it("is unmatched for a path no route answers, /metrics included", async () => {
    const { server } = await start();
    expect(await labelOf(server, "/api/v1/x")).toBe("unmatched");
  });

  it("is web for a page of the web app", async () => {
    webRoot = await mkdtemp(join(tmpdir(), "studio-metrics-web-"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>x</title>");
    const { server } = await start({ WEB_ROOT: webRoot });
    expect(await labelOf(server, "/projects")).toBe("web");
  });
});

describe("request metrics", () => {
  it("counts a public read by operation, method and status", async () => {
    const { server, registry } = await start();
    const res = await server.inject(`/api/v1/public/surveys/${FEEDBACK}/definition`);
    expect(res.statusCode).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    const text = await registry.metrics();
    expect(text).toContain(
      'surveyjs_studio_http_requests_total{operation="getPublicDefinition",method="GET",status="200"} 1',
    );
    expect(text).toContain("surveyjs_studio_http_request_duration_seconds_bucket");
  });

  it("never answers /metrics on the main port", async () => {
    const { server, registry } = await start();
    const res = await server.inject("/metrics");
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("surveyjs_studio_");
    await new Promise((resolve) => setImmediate(resolve));
    expect(await registry.metrics()).toContain('operation="unmatched"');
  });

  it("defines the store-call histogram for provider timing", async () => {
    const registry = createRegistry({ prefix: "surveyjs_studio_", processMetrics: false });
    const { storeDuration } = createStudioMetrics(registry);
    storeDuration.observe({ store: "surveys", method: "getSurvey", outcome: "ok" }, 0.01);
    expect(await registry.metrics()).toContain(
      'surveyjs_studio_store_call_duration_seconds_count{store="surveys",method="getSurvey",outcome="ok"} 1',
    );
  });
});
