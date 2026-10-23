import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createMemoryProviders } from "../providers/memory.js";
import { isServerPath, registerWebApp } from "./static.js";

const INDEX = "<!doctype html><title>My Surveys</title>";
// Beside the web root, never inside it: a traversal that reaches it leaks this marker.
const OUTSIDE = '{"name":"outside-the-web-root"}';
const IMMUTABLE = "public, max-age=31536000, immutable";

let base: string;
let webRoot: string;
let app: FastifyInstance | undefined;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "my-surveys-web-"));
  webRoot = join(base, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await mkdir(join(webRoot, ".vite"));
  await writeFile(join(webRoot, "index.html"), INDEX);
  await writeFile(join(webRoot, "assets", "app-abc123.js"), "console.log('app');");
  await writeFile(join(webRoot, ".vite", "manifest.json"), '{"index.html":{}}');
  await writeFile(join(webRoot, "robots.txt"), "User-agent: *\n");
  await writeFile(join(base, "package.json"), OUTSIDE);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({ NODE_ENV: "test", IDENTITY_PROVIDER: "dev", ...env });
  app = await buildApp(config, createMemoryProviders());
  return app;
}

const withWebRoot = () => start({ WEB_ROOT: webRoot });

function csp(res: { headers: Record<string, unknown> }): string {
  return String(res.headers["content-security-policy"]);
}

describe("isServerPath", () => {
  it.each([
    "/api",
    "/api/",
    "/api/v1/config",
    "/api/docs",
    "/__dev",
    "/__dev/sign-in",
    "/healthz",
    "/healthz/",
    "/readyz",
  ])("%s is a server path", (pathname) => {
    expect(isServerPath(pathname)).toBe(true);
  });

  it.each(["/", "/apiX", "/apis/x", "/s/abc", "/healthzz", "/__devx", "/assets/api"])(
    "%s is not a server path",
    (pathname) => {
      expect(isServerPath(pathname)).toBe(false);
    },
  );
});

describe("registerWebApp", () => {
  it("refuses a web root without index.html, naming no file", async () => {
    const empty = await mkdtemp(join(tmpdir(), "my-surveys-empty-"));
    await writeFile(join(empty, "other.html"), "x");
    const bare = (await import("fastify")).default();
    try {
      await expect(registerWebApp(bare, empty)).rejects.toThrow(
        new Error(`WEB_ROOT: ${empty} has no index.html`),
      );
    } finally {
      await bare.close();
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("with WEB_ROOT", () => {
  it.each([
    ["/", "frame-ancestors 'none'"],
    ["/s/abc", "frame-ancestors *"],
    ["/surveys/abc/edit", "frame-ancestors 'none'"],
    ["/projects/", "frame-ancestors 'none'"],
  ])("GET %s answers the index with 200 and the SPA policy (%s)", async (url, ancestors) => {
    const res = await (await withWebRoot()).inject(url);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toBe(INDEX);
    expect(csp(res)).toContain(ancestors);
    expect(csp(res)).toContain("script-src 'self'");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it.each(["/published?id=1", "/no-such-page", "/apiX", "/assets/missing.js"])(
    "GET %s answers the index with 404 and the SPA policy",
    async (url) => {
      const res = await (await withWebRoot()).inject(url);
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.body).toBe(INDEX);
      expect(csp(res)).toContain("frame-ancestors 'none'");
      expect(csp(res)).toContain("script-src 'self'");
      expect(res.headers["cache-control"]).toBe("no-cache");
    },
  );

  it.each(["/no-such-page", "/projects"])(
    "GET %s with a Range header answers the whole index, not a part",
    async (url) => {
      const res = await (await withWebRoot()).inject({ url, headers: { range: "bytes=0-4" } });
      expect(res.statusCode).toBe(url === "/projects" ? 200 : 404);
      expect(res.body).toBe(INDEX);
      expect(res.headers["content-range"]).toBeUndefined();
      expect(res.headers["accept-ranges"]).toBeUndefined();
    },
  );

  it("serves a hashed asset as immutable", async () => {
    const res = await (await withWebRoot()).inject("/assets/app-abc123.js");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.body).toBe("console.log('app');");
    expect(res.headers["cache-control"]).toBe(IMMUTABLE);
  });

  it("serves another file of the root with no-cache and the SPA policy", async () => {
    const res = await (await withWebRoot()).inject("/robots.txt");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/plain/);
    expect(res.body).toBe("User-agent: *\n");
    expect(csp(res)).toContain("script-src 'self'");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it.each(["/.vite/manifest.json", "/.vite/", "/assets/.hidden", "/assets/", "/assets"])(
    "GET %s answers 404 without the file or a listing",
    async (url) => {
      const res = await (await withWebRoot()).inject(url);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('"index.html"');
      expect(res.body).not.toContain("app-abc123");
    },
  );

  it.each([
    "/..%2f..%2fpackage.json",
    "/..%2fpackage.json",
    "/%2e%2e/%2e%2e/package.json",
    "/%2e%2e/package.json",
    "/assets/..%2f..%2fpackage.json",
    "/a%5c..%5c..%5cpackage.json",
    "/..%5cpackage.json",
    "/../package.json",
  ])("GET %s never answers a file outside the root", async (url) => {
    const res = await (await withWebRoot()).inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("outside-the-web-root");
  });

  it("keeps an unknown API path a Problem 404 with the API policy", async () => {
    const res = await (await withWebRoot()).inject("/api/v1/nope");
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(csp(res)).toContain("default-src 'none'");
    expect(res.headers["cache-control"]).toBeUndefined();
  });

  it.each(["/api", "/healthz/", "/__dev/nope"])(
    "keeps %s a Problem 404 with the API policy",
    async (url) => {
      const res = await (await withWebRoot()).inject(url);
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
      expect(csp(res)).toBe("default-src 'none'; frame-ancestors 'none'");
    },
  );

  it("answers the API with the API policy", async () => {
    const res = await (await withWebRoot()).inject("/api/v1/config");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(csp(res)).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("answers /healthz with the API policy", async () => {
    const res = await (await withWebRoot()).inject("/healthz");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(csp(res)).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("leaves /__dev/sign-in to the server: its redirect gets the server policy", async () => {
    const res = await (await withWebRoot()).inject("/__dev/sign-in");
    expect(res.statusCode).toBe(302);
    expect(res.body).not.toBe(INDEX);
    expect(csp(res)).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it("answers POST / with a Problem 404", async () => {
    const res = await (await withWebRoot()).inject({ method: "POST", url: "/" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
  });

  it("answers HEAD / with 200, the SPA policy and no body", async () => {
    const res = await (await withWebRoot()).inject({ method: "HEAD", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(csp(res)).toContain("script-src 'self'");
    expect(res.body).toBe("");
  });

  it("adds HSTS to the SPA's answers over https", async () => {
    const instance = await start({
      WEB_ROOT: webRoot,
      PUBLIC_BASE_URL: "https://surveys.example.com",
      SESSION_SECRET: "a-test-session-secret-of-at-least-32-chars",
    });
    for (const url of ["/", "/assets/app-abc123.js", "/no-such-page"]) {
      const res = await instance.inject(url);
      expect(res.headers["strict-transport-security"]).toBe("max-age=31536000");
    }
  });
});

describe("without WEB_ROOT", () => {
  it.each([
    "/",
    "/s/abc",
    "/surveys/abc/edit",
    "/published?id=1",
    "/assets/app-abc123.js",
    "/robots.txt",
    "/.vite/manifest.json",
    "/assets/",
    "/%2e%2e/%2e%2e/package.json",
  ])("GET %s stays the Problem 404", async (url) => {
    const res = await (await start()).inject(url);
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/^application\/problem\+json/);
    expect(csp(res)).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});
