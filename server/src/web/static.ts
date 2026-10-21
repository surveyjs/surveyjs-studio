import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { isClientRoute } from "./client-routes.js";

/** The server's own paths: never answered from the web root, and they keep the server's headers. */
const SERVER_PREFIXES = ["/api", "/__dev", "/healthz", "/readyz"] as const;

/** Vite's hashed build output: a changed file gets a new name. */
const ASSETS_PREFIX = "/assets/";
const IMMUTABLE = "public, max-age=31536000, immutable";

export function isServerPath(pathname: string): boolean {
  return SERVER_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** The decoded path of a request URL without its query; the raw path when it does not decode. */
export function requestPathname(url: string): string {
  const raw = url.split("?", 1)[0] ?? url;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The file under `root` that `pathname` names, relative to `root`, or null: no dot segment (so
 * no `..`, no `.vite/`), no backslash, only a regular file (never a directory), and the resolved
 * path, symbolic links followed, stays inside the root.
 */
async function fileUnder(root: string, pathname: string): Promise<string | null> {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return null;
  if (segments.some((s) => s.startsWith(".") || s.includes("\\") || s.includes("\0"))) {
    return null;
  }
  const inside = root.endsWith(sep) ? root : `${root}${sep}`;
  const candidate = resolve(root, ...segments);
  if (!candidate.startsWith(inside)) return null;
  const real = await realpath(candidate).catch(() => null);
  if (real === null || !real.startsWith(inside)) return null;
  const info = await stat(real).catch(() => null);
  return info?.isFile() ? segments.join("/") : null;
}

/**
 * Serves the built web app from `webRoot` (ADR 0021) for any `GET` or `HEAD` that no route took
 * and that is not a server path: a file of the root if one exists, otherwise its `index.html`,
 * with 200 on a client route and 404 on anything else. The security headers are set by the
 * app's `onSend` hook.
 */
export async function registerWebApp(app: FastifyInstance, webRoot: string): Promise<void> {
  const root = await realpath(webRoot).catch(() => null);
  const index = root === null ? null : await stat(join(root, "index.html")).catch(() => null);
  if (root === null || !index?.isFile()) {
    throw new Error(`WEB_ROOT: ${webRoot} has no index.html`);
  }

  // `serve: false`: no routes of its own, only `reply.sendFile` (content type, ETag, ranges).
  await app.register(fastifyStatic, {
    root,
    serve: false,
    cacheControl: false,
    dotfiles: "deny",
  });

  app.get("/*", async (request, reply) => {
    const pathname = requestPathname(request.url);
    if (isServerPath(pathname)) return reply.callNotFound();
    const file = await fileUnder(root, pathname);
    if (file !== null) {
      void reply.header(
        "cache-control",
        pathname.startsWith(ASSETS_PREFIX) ? IMMUTABLE : "no-cache",
      );
      return reply.sendFile(file, root);
    }
    // The SPA renders its own "Page not found"; the status tells crawlers and tools the truth.
    const found = isClientRoute(pathname);
    void reply.code(found ? 200 : 404).header("cache-control", "no-cache");
    return reply.sendFile("index.html", root, found ? {} : { etag: false, lastModified: false });
  });
}
