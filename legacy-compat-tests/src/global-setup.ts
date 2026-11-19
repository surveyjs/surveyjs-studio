// Starts what the suite talks to: Studio's server in the hosted edition (memory, or the Azure legacy
// provider on the local replica), the bridge in front of it, and a stub of the old service the
// bridge forwards to. With COMPAT_BASE_URL and COMPAT_STUDIO_URL set, nothing is started: the suite
// runs against those.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";
import { ENV_VARIABLES } from "../../server/src/config.js";
import { startOAuthStub } from "../../server/src/testing/oauth-stub.js";

declare module "vitest" {
  export interface ProvidedContext {
    /** The bridge's origin (the old API's host), without a trailing slash. */
    baseUrl: string;
    /** Studio's API base URL, with `/api/v1`. */
    studioUrl: string;
    /** Studio's storage provider: `memory` or `azure-legacy`. */
    provider: "memory" | "azure-legacy";
    /** The old-service stub's origin; null when the suite did not start the bridge. */
    legacyStubUrl: string | null;
  }
}

const READY_TIMEOUT_MS = 30_000;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Studio's settings. Only the hosted edition routes the operations the bridge calls (ADR 0039).
 * The bridge is Studio's only caller of the public operations here, so the public rate limits are
 * far above what the suite sends; `TRUST_PROXY` trusts the bridge (on
 * loopback), so Studio takes the caller from the bridge's `X-Forwarded-For`. The response and
 * file limits are small, so the "too large" cases stay cheap.
 */
const STUDIO_SETTINGS: Readonly<Record<string, string>> = {
  NODE_ENV: "test",
  APP_EDITION: "hosted",
  LOG_LEVEL: "warn",
  SIGN_IN_RATE_LIMIT: "100000",
  TRUST_PROXY: "127.0.0.1,::1",
  PUBLIC_RATE_LIMIT: "100000",
  PUBLIC_FILE_RATE_LIMIT: "100000",
  PUBLIC_SUMMARY_RATE_LIMIT: "100000",
  LIMIT_MAX_RESPONSE_BYTES: "65536",
  LIMIT_MAX_FILE_BYTES: "65536",
};

const LEGACY_VARIABLES = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
] as const;
const OPTIONAL_OIDC_VARIABLES = ["OIDC_DISCOVERY", "OIDC_SCOPES"] as const;

/** `COMPAT_PROVIDER`: `memory` (default) or `azure-legacy` (`pnpm test:compat:azurite`). */
function compatProvider(): "memory" | "azure-legacy" {
  const value = process.env.COMPAT_PROVIDER?.trim() || "memory";
  if (value !== "memory" && value !== "azure-legacy") {
    throw new Error(`COMPAT_PROVIDER must be memory or azure-legacy, got "${value}"`);
  }
  return value;
}

/**
 * The storage settings of the provider: the legacy fixtures in memory, or the local replica. The
 * hosted edition refuses the dev sign-in, so in memory the owner signs in to Studio through the
 * OAuth stub playing surveyjs.io (`oauthStubUrl`); on the replica through the mock OIDC server.
 */
function providerEnv(
  provider: "memory" | "azure-legacy",
  oauthStubUrl: string | null,
): Record<string, string> {
  if (provider === "memory") {
    if (oauthStubUrl === null) throw new Error("the OAuth stub is started first");
    return {
      STORAGE_PROVIDER: "memory",
      MEMORY_SEED: "legacy-fixtures",
      IDENTITY_PROVIDER: "surveyjs-oidc",
      OIDC_ISSUER_URL: `${oauthStubUrl}/surveyjs`,
      OIDC_CLIENT_ID: "compat-surveyjs",
      // The stub's documented test secret, not a real one.
      OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
    };
  }
  const env: Record<string, string> = { STORAGE_PROVIDER: "azure-legacy" };
  const missing: string[] = [];
  for (const name of LEGACY_VARIABLES) {
    const value = process.env[name]?.trim();
    if (value) env[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(
      `COMPAT_PROVIDER=azure-legacy needs ${missing.join(", ")} (docker/azurite.env)`,
    );
  }
  for (const name of OPTIONAL_OIDC_VARIABLES) {
    const value = process.env[name]?.trim();
    if (value) env[name] = value;
  }
  return env;
}

/** This process's environment without any setting of Studio or the bridge. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of ENV_VARIABLES) delete env[name];
  for (const name of Object.keys(env)) {
    if (name.startsWith("BRIDGE_") || name.startsWith("COMPAT_")) delete env[name];
  }
  return env;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Kills a child and everything it started (pnpm -> tsx -> node). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

/** Runs `node --import tsx <script>` from the repository root, its output kept for errors. */
function startNode(
  script: string,
  env: NodeJS.ProcessEnv,
): { child: ChildProcess; output: () => string } {
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    cwd: repoRoot,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  return { child, output: () => output };
}

/** Waits until `ready()` is true, the child exits or the deadline passes; throws with the output. */
async function waitUntil(
  what: string,
  started: { child: ChildProcess; output: () => string },
  ready: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (started.child.exitCode !== null) {
      throw new Error(`${what} exited with code ${started.child.exitCode}\n${started.output()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} not ready after ${READY_TIMEOUT_MS} ms\n${started.output()}`);
    }
    try {
      if (await ready()) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** How many ports a child is tried on when another process takes its port first. */
const PORT_ATTEMPTS = 3;

/**
 * Starts `script` on a free port and waits until `ready(origin)`. The port is free when chosen but
 * may be taken before the child binds it: a child that fails with `EADDRINUSE` is started again
 * on another port.
 */
async function startOnFreePort(
  what: string,
  script: string,
  env: (port: number, origin: string) => NodeJS.ProcessEnv,
  ready: (origin: string) => Promise<boolean>,
  stops: (() => Promise<void> | void)[],
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    const started = startNode(script, env(port, origin));
    stops.push(() => killTree(started.child));
    try {
      await waitUntil(what, started, () => ready(origin));
      return origin;
    } catch (error) {
      killTree(started.child);
      if (attempt >= PORT_ATTEMPTS || !started.output().includes("EADDRINUSE")) throw error;
    }
  }
}

/**
 * The old service's stand-in: answers every request with `200` and a JSON echo of what reached
 * it (method, path and query as sent, the headers, the body in base64), marked with the header
 * `x-legacy-stub: 1`. The forwarding tests read the echo; the real old service is never called.
 */
async function startLegacyStub(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const echo = JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("base64"),
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "x-legacy-stub": "1",
      });
      res.end(req.method === "HEAD" ? undefined : echo);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export async function setup(project: TestProject): Promise<() => Promise<void>> {
  const provider = compatProvider();
  project.provide("provider", provider);
  const external = process.env.COMPAT_BASE_URL?.trim();
  if (external) {
    const studio = process.env.COMPAT_STUDIO_URL?.trim();
    if (!studio) throw new Error("COMPAT_BASE_URL needs COMPAT_STUDIO_URL (Studio's /api/v1 URL)");
    project.provide("baseUrl", external.replace(/\/+$/, ""));
    project.provide("studioUrl", studio.replace(/\/+$/, ""));
    project.provide("legacyStubUrl", null);
    return () => Promise.resolve();
  }

  const stops: (() => Promise<void> | void)[] = [];
  const stopAll = async () => {
    for (const stop of stops.reverse()) await stop();
  };
  try {
    const stub = await startLegacyStub();
    stops.push(stub.close);
    const oauthStub = provider === "memory" ? await startOAuthStub() : null;
    if (oauthStub !== null) stops.push(() => oauthStub.close());

    const studioOrigin = await startOnFreePort(
      "Studio",
      "server/src/main.ts",
      (port, origin) => ({
        ...cleanEnv(),
        ...STUDIO_SETTINGS,
        ...providerEnv(provider, oauthStub?.url ?? null),
        HOST: "127.0.0.1",
        PORT: String(port),
        PUBLIC_BASE_URL: origin,
      }),
      async (origin) => (await fetch(`${origin}/readyz`)).status === 200,
      stops,
    );

    const bridgeOrigin = await startOnFreePort(
      "The bridge",
      "bridge/src/main.ts",
      (port) => ({
        ...cleanEnv(),
        BRIDGE_STUDIO_URL: `${studioOrigin}/api/v1`,
        BRIDGE_LEGACY_URL: stub.url,
        BRIDGE_HOST: "127.0.0.1",
        BRIDGE_PORT: String(port),
        // The suite stands in for a proxy on loopback: its X-Forwarded-For names the caller, so the
        // IP-capture test can send a caller address of its own.
        BRIDGE_TRUST_PROXY: "127.0.0.1,::1",
      }),
      // Without a survey ID the bridge answers itself, without asking Studio.
      async (origin) => (await fetch(`${origin}/public/Survey/getSurvey`)).status === 400,
      stops,
    );

    project.provide("baseUrl", bridgeOrigin);
    project.provide("studioUrl", `${studioOrigin}/api/v1`);
    project.provide("legacyStubUrl", stub.url);
  } catch (error) {
    await stopAll();
    throw error;
  }
  return stopAll;
}
