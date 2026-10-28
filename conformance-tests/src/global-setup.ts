import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /** Server origin under test, without `/api/v1`. */
    baseUrl: string;
    /** True when the suite started the reference server (memory or the image), not `CONFORMANCE_BASE_URL`. */
    ownsServer: boolean;
    /** `surveyjs-api` when the reference server runs against the user-API stub, else `default`. */
    userDirectory: "default" | "surveyjs-api";
    /**
     * The `whsec_` secret the server checks account-deleted webhooks with; null when unknown (an
     * external server without `CONFORMANCE_WEBHOOK_SECRET`): the webhook tests skip.
     */
    webhookSecret: string | null;
  }
}

const READY_TIMEOUT_MS = 30_000;
// The image's first start on the replica opens the SQL pool and the storage clients.
const IMAGE_READY_TIMEOUT_MS = 60_000;

// The image target (CONFORMANCE_IMAGE): the container's name, and the local-only session secret of
// a NODE_ENV=production server (production requires one).
const IMAGE_CONTAINER = "surveyjs-studio-conformance";
const IMAGE_SESSION_SECRET = "conformance-local-only-session-secret-not-a-real-value";

// The user-API mode (CONFORMANCE_USER_DIRECTORY=surveyjs-api): a synthetic token for the local stub.
const USER_API_TOKEN = "conformance-user-api-token";

// The reference server's account-deleted webhook secret: a synthetic test value (the base64 of
// the 34-byte text `my-surveys-conformance-webhook-key`).
const WEBHOOK_SECRET = "whsec_bXktc3VydmV5cy1jb25mb3JtYW5jZS13ZWJob29rLWtleQ==";

// Every variable of the server's environment table (server/src/config.ts). The reference
// server must see only the explicit values set below, never the developer's shell.
// Keep in sync with server/src/config.ts and with e2e/app-variables.mjs (each package
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
  "MEMORY_SEED",
  "DATABASE_URL",
  "SQLITE_PATH",
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
  "LIMIT_MAX_DOCUMENT_BYTES",
  "API_DOCS",
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  "IDENTITY_PROVIDER",
  "SESSION_SECRET",
  "SESSION_MAX_AGE_SECONDS",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISCOVERY",
  "OIDC_SCOPES",
  "SIGN_IN_RATE_LIMIT",
  "TRUST_PROXY",
  "PUBLIC_RATE_LIMIT",
  "PUBLIC_FILE_RATE_LIMIT",
  "ACCOUNT_NOTICES",
  "USER_DIRECTORY",
  "USER_API_URL",
  "USER_API_TOKEN",
  "ACCOUNT_WEBHOOK_SECRET",
  "SHELL_LINKS",
  "WEB_ROOT",
  "READ_ONLY",
  "REQUEST_TIMEOUT_SECONDS",
];

const legacyVariables = [
  "LEGACY_SQL_CONNECTION_STRING",
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
  "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
] as const;

// The mock OIDC server of docker/compose.azurite.yaml (settings in docker/azurite.env).
const oidcVariables = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const;
// Forwarded when set (the mock needs the openid scope).
const optionalOidcVariables = ["OIDC_DISCOVERY", "OIDC_SCOPES"] as const;

/**
 * `CONFORMANCE_PROVIDER=azure-legacy` runs the reference server on the legacy stores and signs in
 * through the mock OIDC server: the three `LEGACY_*` connection strings and the `OIDC_*` settings are
 * forwarded from this process (`pnpm test:conformance:azurite` reads them from docker/azurite.env).
 * Default: memory, with every app variable stripped.
 */
function providerEnv(): Record<string, string> {
  const provider = process.env.CONFORMANCE_PROVIDER?.trim() || "memory";
  if (provider === "memory") {
    // The dev identity provider signs in as a user of the seed (see /__dev/sign-in).
    return { STORAGE_PROVIDER: "memory", IDENTITY_PROVIDER: "dev", MEMORY_SEED: "legacy-fixtures" };
  }
  if (provider !== "azure-legacy") {
    throw new Error(`CONFORMANCE_PROVIDER must be memory or azure-legacy, got "${provider}"`);
  }
  const env: Record<string, string> = { STORAGE_PROVIDER: "azure-legacy" };
  const missing: string[] = [];
  for (const name of [...legacyVariables, ...oidcVariables]) {
    const value = process.env[name];
    if (value?.trim()) env[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`CONFORMANCE_PROVIDER=azure-legacy needs ${missing.join(", ")}`);
  }
  for (const name of optionalOidcVariables) {
    const value = process.env[name];
    if (value?.trim()) env[name] = value;
  }
  return env;
}

/**
 * `CONFORMANCE_USER_DIRECTORY=surveyjs-api` points the reference server at the user-API stub (the
 * stub is started first; `stubUrl` is its address) and turns the licence notices on.
 */
function userDirectoryEnv(stubUrl: string | null): Record<string, string> {
  if (stubUrl === null) return {};
  return {
    USER_DIRECTORY: "surveyjs-api",
    USER_API_URL: stubUrl,
    USER_API_TOKEN,
    ACCOUNT_NOTICES: "surveyjs-licenses",
  };
}

/** `CONFORMANCE_READ_ONLY=true` runs the reference server with `READ_ONLY=true`. */
function readOnlyEnv(): Record<string, string> {
  const value = process.env.CONFORMANCE_READ_ONLY?.trim() || "false";
  if (value !== "true" && value !== "false") {
    throw new Error(`CONFORMANCE_READ_ONLY must be true or false, got "${value}"`);
  }
  return value === "true" ? { READ_ONLY: "true" } : {};
}

function serverEnv(port: number, stubUrl: string | null): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of appVariables) delete env[name];
  return {
    ...env,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: String(port),
    LOG_LEVEL: "warn",
    // Sign-in redirects (and the OIDC redirect_uri) point at the server under test.
    PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    // The suite signs in many times from one IP; the limit itself is tested in the server tests.
    SIGN_IN_RATE_LIMIT: "100000",
    // The suite reaches the server from loopback; the rate-limit test sends its own X-Forwarded-For.
    TRUST_PROXY: "127.0.0.1,::1",
    // The suite reads public surveys many times from one IP; the limits are tested in the server tests.
    PUBLIC_RATE_LIMIT: "300",
    PUBLIC_FILE_RATE_LIMIT: "10000",
    // Small, so the 413 test stays cheap (it reads the limit from /config).
    LIMIT_MAX_DOCUMENT_BYTES: "262144",
    // Small, so the quota tests stay cheap (they read the limit from /config).
    LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "65536",
    // Small, so the 413 test stays cheap (it reads the limit from /config).
    LIMIT_MAX_FILE_BYTES: "65536",
    // The account-deleted webhook tests sign with the same secret.
    ACCOUNT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...providerEnv(),
    ...userDirectoryEnv(stubUrl),
    ...readOnlyEnv(),
  };
}
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `CONFORMANCE_IMAGE=<tag>` runs the reference server as that image of the production build
 * (`docker build -t surveyjs-studio:ci .`) instead of tsx, with the same settings. It uses
 * `docker run --network host`, so it works on Linux only (CI). Null when unset.
 */
function imageTag(): string | null {
  const tag = process.env.CONFORMANCE_IMAGE?.trim();
  if (!tag) return null;
  if (!/^\w[\w./:@-]*$/.test(tag)) {
    throw new Error(`CONFORMANCE_IMAGE is not an image name: "${tag}"`);
  }
  if (process.platform !== "linux") {
    throw new Error(
      `CONFORMANCE_IMAGE is Linux only (CI): it runs the image with docker run --network host, which does not reach the host's ports on ${process.platform}. Run the suite without it.`,
    );
  }
  return tag;
}

/**
 * The image's settings: those of `serverEnv`, with NODE_ENV=development on memory (the dev sign-in
 * is refused in production) and NODE_ENV=production elsewhere, as in a deployment. Unlike
 * `NODE_ENV=test`, both keep the server's log, which `docker logs` saves.
 */
function imageEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (env.STORAGE_PROVIDER === "memory") return { ...env, NODE_ENV: "development" };
  return { ...env, NODE_ENV: "production", SESSION_SECRET: IMAGE_SESSION_SECRET };
}

/** Saves `docker logs` of the image container to docker-logs/ (CI uploads it on failure), then removes it. */
function removeImageContainer(): void {
  const logs = spawnSync("docker", ["logs", IMAGE_CONTAINER], { encoding: "utf8" });
  if (logs.status === 0) {
    const dir = `${repoRoot}docker-logs`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${IMAGE_CONTAINER}.log`, `${logs.stdout}${logs.stderr}`);
  }
  spawnSync("docker", ["rm", "-f", IMAGE_CONTAINER], { stdio: "ignore" });
}

/**
 * Starts the image in the foreground (its output is collected like the tsx server's). The values
 * stay in the docker client's environment and are passed by name (`-e NAME`), so none is on the
 * command line.
 */
function spawnImage(image: string, env: NodeJS.ProcessEnv): ChildProcess {
  spawnSync("docker", ["rm", "-f", IMAGE_CONTAINER], { stdio: "ignore" });
  const passed = appVariables
    .filter((name) => env[name] !== undefined)
    .flatMap((name) => ["-e", name]);
  return spawn(
    "docker",
    ["run", "--name", IMAGE_CONTAINER, "--network", "host", ...passed, image],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
}

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

/** The mode of `CONFORMANCE_USER_DIRECTORY`: `default` or `surveyjs-api`. */
function userDirectoryMode(): "default" | "surveyjs-api" {
  const mode = process.env.CONFORMANCE_USER_DIRECTORY?.trim() || "default";
  if (mode !== "default" && mode !== "surveyjs-api") {
    throw new Error(`CONFORMANCE_USER_DIRECTORY must be default or surveyjs-api, got "${mode}"`);
  }
  return mode;
}

/** Waits until `url` answers 200, the child exits or the deadline passes; throws with the output. */
async function waitFor200(
  child: ChildProcess,
  url: string,
  what: string,
  output: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`${what} failed to start: exited with code ${child.exitCode}
${output()}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} failed to start: ${url} not ready after ${READY_TIMEOUT_MS} ms
${output()}`);
    }
    try {
      if ((await fetch(url)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Runs the user-API stub (server/src/users/surveyjs-api/stub-cli.ts) on a free port. */
async function startUserApiStub(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "server/src/users/surveyjs-api/stub-cli.ts",
      "--",
      "--port",
      String(port),
      "--token",
      USER_API_TOKEN,
    ],
    { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const stop = () => killTree(child);
  try {
    await waitFor200(child, `${url}/healthz`, "User API stub", () => output);
  } catch (error) {
    stop();
    throw error;
  }
  return { url, stop };
}

async function startReferenceServer(
  stubUrl: string | null,
  image: string | null,
): Promise<{ baseUrl: string; stop: () => void }> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const command = "pnpm --filter @surveyjs-studio/server start";
  // On Windows `pnpm` is a .cmd shim, so it needs a shell (the command has no user input).
  const child =
    image === null
      ? spawn(command, {
          cwd: repoRoot,
          shell: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: serverEnv(port, stubUrl),
        })
      : spawnImage(image, imageEnv(serverEnv(port, stubUrl)));
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const stop = () => {
    if (image !== null) removeImageContainer();
    killTree(child);
  };

  const timeout = image === null ? READY_TIMEOUT_MS : IMAGE_READY_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  try {
    for (;;) {
      if (child.exitCode !== null) throw new Error(`exited with code ${child.exitCode}`);
      if (Date.now() > deadline) throw new Error(`/readyz not ready after ${timeout} ms`);
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

/**
 * Uses `CONFORMANCE_BASE_URL` if set; otherwise runs the reference server for the suite (as the
 * `CONFORMANCE_IMAGE` image when that is set).
 */
export async function setup(project: TestProject): Promise<(() => void) | void> {
  const external = process.env.CONFORMANCE_BASE_URL?.trim();
  const mode = userDirectoryMode();
  if (external) {
    if (mode !== "default") {
      throw new Error("CONFORMANCE_USER_DIRECTORY cannot be used with CONFORMANCE_BASE_URL");
    }
    if (process.env.CONFORMANCE_IMAGE?.trim()) {
      throw new Error("CONFORMANCE_IMAGE cannot be used with CONFORMANCE_BASE_URL");
    }
    project.provide("baseUrl", external.replace(/\/+$/, ""));
    project.provide("ownsServer", false);
    project.provide("userDirectory", "default");
    project.provide("webhookSecret", process.env.CONFORMANCE_WEBHOOK_SECRET?.trim() || null);
    return;
  }
  const image = imageTag();
  const stub = mode === "surveyjs-api" ? await startUserApiStub() : null;
  let server: { baseUrl: string; stop: () => void };
  try {
    server = await startReferenceServer(stub?.url ?? null, image);
  } catch (error) {
    stub?.stop();
    throw error;
  }
  project.provide("baseUrl", server.baseUrl);
  project.provide("ownsServer", true);
  project.provide("userDirectory", mode);
  project.provide("webhookSecret", WEBHOOK_SECRET);
  return () => {
    server.stop();
    stub?.stop();
  };
}
