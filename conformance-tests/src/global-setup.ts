import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Server origin under test, without `/api/v1`. */
    baseUrl: string;
  }
}

const READY_TIMEOUT_MS = 30_000;

// Every variable of the server's environment table (server/src/config.ts). The reference
// server must see only the explicit values set below, never the developer's shell.
// Keep in sync with server/src/config.ts and with e2e/playwright.config.ts (each package
// keeps its own copy so none depends on another).
const appVariables = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "LOG_LEVEL",
  "APP_EDITION",
  "APP_SHELL",
  "AUTH_METHODS",
  "SURVEYJS_LICENSE_KEY",
  "STORAGE_PROVIDER",
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
  "API_DOCS",
];

function serverEnv(port: number): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of appVariables) delete env[name];
  return {
    ...env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    STORAGE_PROVIDER: "memory",
    LOG_LEVEL: "warn",
  };
}
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Kills the server and everything it started (pnpm -> tsx -> node). */
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

async function startReferenceServer(): Promise<{ baseUrl: string; stop: () => void }> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const command = "pnpm --filter @my-surveys/server start";
  // On Windows `pnpm` is a .cmd shim, so it needs a shell (the command has no user input).
  const child = spawn(command, {
    cwd: repoRoot,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: serverEnv(port),
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const stop = () => killTree(child);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  try {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`exited with code ${child.exitCode}`);
      if (Date.now() > deadline) throw new Error(`/readyz not ready after ${READY_TIMEOUT_MS} ms`);
      try {
        if ((await fetch(`${baseUrl}/readyz`)).status === 200) break;
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (error) {
    stop();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Reference server failed to start: ${reason}
${output}`,
      { cause: error },
    );
  }
  return { baseUrl, stop };
}

/** Uses `CONFORMANCE_BASE_URL` if set; otherwise runs the reference server for the suite. */
export async function setup(project: TestProject): Promise<(() => void) | void> {
  const external = process.env.CONFORMANCE_BASE_URL?.trim();
  if (external) {
    project.provide("baseUrl", external.replace(/\/+$/, ""));
    return;
  }
  const server = await startReferenceServer();
  project.provide("baseUrl", server.baseUrl);
  return server.stop;
}
