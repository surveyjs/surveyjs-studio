import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type BuildOptions } from "./app.js";
import { loadConfig } from "./config.js";
import { newFileId } from "./domain/file-id.js";
import { AppError } from "./errors.js";
import { createProviders, type ProviderSet } from "./providers/index.js";
import { createMemoryProviders } from "./providers/memory.js";

const config = loadConfig({
  NODE_ENV: "test",
  IDENTITY_PROVIDER: "dev",
  LIMIT_MAX_RESPONSE_BYTES: "64",
});
let app: FastifyInstance | undefined;

async function start(providers?: ProviderSet): Promise<FastifyInstance> {
  app = await buildApp(config, providers ?? (await createProviders(config)));
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("health", () => {
  it("GET /healthz answers 200 ok", async () => {
    const res = await (await start()).inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz answers 200 when providers are ready", async () => {
    const res = await (await start()).inject("/readyz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /readyz answers 503 when providers are not ready", async () => {
    const notReady: ProviderSet = {
      ...createMemoryProviders(),
      name: "down",
      ready: () => Promise.resolve(false),
      close: () => Promise.resolve(),
    };
    const res = await (await start(notReady)).inject("/readyz");
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "unavailable" });
  });

  it("closes providers when the app closes", async () => {
    let closed = false;
    const spy: ProviderSet = {
      ...createMemoryProviders(),
      name: "spy",
      ready: () => Promise.resolve(true),
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    await (await start(spy)).close();
    expect(closed).toBe(true);
  });

  it("echoes or generates a request id", async () => {
    const instance = await start();
    const generated = await instance.inject("/healthz");
    expect(generated.headers["x-request-id"]).toBeTruthy();
    const echoed = await instance.inject({ url: "/healthz", headers: { "x-request-id": "abc-1" } });
    expect(echoed.headers["x-request-id"]).toBe("abc-1");
  });
});

describe("Problem responses", () => {
  it("malformed URLs answer 400 bad-request problem+json", async () => {
    const res = await (await start()).inject("/%zz");
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "bad-request", status: 400 });
  });

  it("small JSON bodies are accepted", async () => {
    const instance = await start();
    instance.post("/t/ok", () => ({ ok: true }));
    const res = await instance.inject({ method: "POST", url: "/t/ok", payload: { a: 1 } });
    expect(res.statusCode).toBe(200);
  });

  it("unknown routes answer 404 problem+json", async () => {
    const res = await (await start()).inject("/nope");
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({
      type: "https://my-surveys.surveyjs.io/problems/not-found",
      status: 404,
      code: "not-found",
    });
  });

  it("AppError thrown by a route is rendered as its Problem", async () => {
    const instance = await start();
    instance.get("/t/app-error", () => {
      throw new AppError({ code: "forbidden", status: 403, title: "Forbidden" });
    });
    const res = await instance.inject("/t/app-error");
    expect(res.statusCode).toBe(403);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ code: "forbidden" });
  });

  it("unexpected errors answer 500 without leaking the message", async () => {
    const instance = await start();
    instance.get("/t/boom", () => {
      throw new Error("secret internals");
    });
    const res = await instance.inject("/t/boom");
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "internal-error", status: 500 });
    expect(res.body).not.toContain("secret");
  });

  it("body schema violations answer 422 validation-failed with pointers", async () => {
    const instance = await start();
    instance.post(
      "/t/body",
      {
        schema: {
          body: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
        },
      },
      () => ({}),
    );
    const res = await instance.inject({ method: "POST", url: "/t/body", payload: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: "validation-failed", errors: [{ pointer: "/name" }] });
  });

  it("querystring schema violations answer 400 bad-request", async () => {
    const instance = await start();
    instance.get(
      "/t/query",
      {
        schema: {
          querystring: { type: "object", properties: { limit: { type: "integer", maximum: 5 } } },
        },
      },
      () => ({}),
    );
    const res = await instance.inject("/t/query?limit=9");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request", errors: [{ pointer: "/limit" }] });
  });

  it("malformed JSON answers 400 bad-request", async () => {
    const instance = await start();
    instance.post("/t/json", () => ({}));
    const res = await instance.inject({
      method: "POST",
      url: "/t/json",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "bad-request" });
  });

  it("oversized bodies answer 413 payload-too-large", async () => {
    const instance = await start();
    instance.post("/t/json", () => ({}));
    const res = await instance.inject({
      method: "POST",
      url: "/t/json",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ pad: "x".repeat(200) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: "payload-too-large" });
  });

  it("unsupported content types answer 415", async () => {
    const instance = await start();
    instance.post("/t/json", () => ({}));
    const res = await instance.inject({
      method: "POST",
      url: "/t/json",
      headers: { "content-type": "application/x-weird" },
      payload: "abc",
    });
    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ code: "unsupported-media-type" });
  });
});

describe("security headers", () => {
  const API_HEADERS = {
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
  };

  /** The app with the dev identity provider and `env` on top. */
  async function serve(
    env: Record<string, string> = {},
    options: BuildOptions = {},
    providers?: ProviderSet,
  ): Promise<FastifyInstance> {
    const own = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev", ...env });
    app = await buildApp(own, providers ?? (await createProviders(own)), options);
    return app;
  }

  it.each([
    ["an API answer", "/api/v1/config", 200],
    ["an unknown path", "/no-such-page", 404],
    ["the health check", "/healthz", 200],
    ["a 401 problem", "/api/v1/me", 401],
  ])("are on %s, without HSTS over http", async (_, url, status) => {
    const res = await (await serve()).inject(url);
    expect(res.statusCode).toBe(status);
    expect(res.headers).toMatchObject(API_HEADERS);
    expect(res.headers).not.toHaveProperty("strict-transport-security");
  });

  it("let the API reference run its script but forbid framing it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "my-surveys-headers-"));
    try {
      const docsFile = join(dir, "reference.html");
      await writeFile(docsFile, "<!doctype html><title>API</title>");
      const res = await (
        await serve({ API_DOCS: "true" }, { apiDocsPath: docsFile })
      ).inject("/api/docs");
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("add HSTS when PUBLIC_BASE_URL is https", async () => {
    const res = await (
      await serve({
        PUBLIC_BASE_URL: "https://surveys.example.com",
        SESSION_SECRET: "a-test-session-secret-of-32-characters",
      })
    ).inject("/api/v1/config");
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000");
  });

  it("keep the dev sign-in page's own CSP and referrer policy", async () => {
    const res = await (await serve()).inject("/__dev/sign-in?state=abc");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("keep a file download's own CSP", async () => {
    const providers = createMemoryProviders();
    const surveyId = "cccccccc-0000-4000-8000-00000000000a";
    const id = newFileId(surveyId);
    await providers.files.putFile(
      {
        id,
        surveyId,
        kind: "response",
        name: "a.txt",
        contentType: "application/octet-stream",
        size: 1,
        createdAt: "2026-10-15T08:30:00.000Z",
      },
      Buffer.from("a"),
    );
    const res = await (await serve({}, {}, providers)).inject(`/api/v1/public/files/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    );
  });
});
