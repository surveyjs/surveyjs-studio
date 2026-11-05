import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { startOAuthStub, type OAuthStub } from "../../server/src/testing/oauth-stub.js";

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
    /**
     * The first admin's email and password with `CONFORMANCE_AUTH=password` (the server creates
     * that admin from ADMIN_EMAIL and ADMIN_PASSWORD); null otherwise: the password tests skip.
     */
    passwordAdmin: { email: string; password: string } | null;
    /**
     * With `CONFORMANCE_AUTH=oauth`: the OAuth stub the server signs in with, the domain of
     * SIGN_UP_DOMAINS, and a second server on its own database with `OPEN_SIGN_UP=on`; null
     * otherwise: oauth.test.ts skips.
     */
    oauth: { stubUrl: string; signUpDomain: string; openSignUpBaseUrl: string } | null;
    /**
     * True with `CONFORMANCE_PROVIDER=sandbox`: no server runs; the sandbox's mock handlers answer
     * under msw/node (src/sandbox-setup.ts) and a session is the `msid` cookie, set without HTTP.
     */
    sandbox: boolean;
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

// The password run's first admin (CONFORMANCE_AUTH=password): synthetic local-only test values.
const PASSWORD_ADMIN = {
  email: "first-admin@example.com",
  password: "conformance first admin password",
};

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
  "SURVEYJS_IMAGE_LICENSE_KEY",
  "BRAND_NAME",
  "BRAND_LOGO_URL",
  "BRAND_ACCENT_COLOR",
  "TERMS_URL",
  "PRIVACY_URL",
  "BRANDING",
  "STORAGE_PROVIDER",
  "MEMORY_SEED",
  "DATABASE_URL",
  "SQLITE_PATH",
  "FILE_STORE",
  "FILES_PATH",
  "S3_BUCKET",
  "S3_REGION",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_ALLOW_HTTP",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
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
  "SESSION_SECRET_FILE",
  "SESSION_MAX_AGE_SECONDS",
  "OIDC_ISSUER_URL",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "OIDC_DISCOVERY",
  "OIDC_SCOPES",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "FACEBOOK_CLIENT_ID",
  "FACEBOOK_CLIENT_SECRET",
  "SIGN_UP_DOMAINS",
  "OPEN_SIGN_UP",
  "OAUTH_STUB_URL",
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

// The OAuth run (CONFORMANCE_AUTH=oauth): SIGN_UP_DOMAINS, and the stub's client ids (any value;
// the stub's client secrets are its documented test values `stub-secret-<provider>`).
const SIGN_UP_DOMAIN = "allowed.example";

/** The OAuth stub of `CONFORMANCE_AUTH=oauth`, started in setup(). */
let oauthStub: OAuthStub | null = null;

/**
 * `CONFORMANCE_PROVIDER=azure-legacy` runs the reference server on the legacy stores and signs in
 * through the mock OIDC server: the three `LEGACY_*` connection strings and the `OIDC_*` settings are
 * forwarded from this process (`pnpm test:conformance:azurite` reads them from docker/azurite.env).
 * Default: memory, with every app variable stripped.
 */
function providerEnv(): Record<string, string> {
  const provider = conformanceProvider();
  if (provider === "sandbox") throw new Error("CONFORMANCE_PROVIDER=sandbox starts no server");
  if (provider === "memory") {
    // The dev identity provider signs in as a user of the seed (see /__dev/sign-in).
    return { STORAGE_PROVIDER: "memory", IDENTITY_PROVIDER: "dev", MEMORY_SEED: "legacy-fixtures" };
  }
  if (provider === "sqlite" || provider === "postgres") {
    if (sqlDatabase === null) throw new Error("the SQL database is prepared in setup()");
    // Users and projects come from the memory fallback's seed until self-hosted Step 4.
    return { IDENTITY_PROVIDER: "dev", MEMORY_SEED: "legacy-fixtures", ...sqlDatabase.env };
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

const PROVIDERS = ["memory", "azure-legacy", "sqlite", "postgres", "sandbox"] as const;
type ConformanceProvider = (typeof PROVIDERS)[number];

/** `CONFORMANCE_PROVIDER`, default memory. */
function conformanceProvider(): ConformanceProvider {
  const provider = process.env.CONFORMANCE_PROVIDER?.trim() || "memory";
  const known = PROVIDERS.find((name) => name === provider);
  if (known === undefined) {
    throw new Error(`CONFORMANCE_PROVIDER must be ${PROVIDERS.join(", ")}, got "${provider}"`);
  }
  return known;
}

/** The run's own database for `CONFORMANCE_PROVIDER=sqlite|postgres`; set in setup(). */
let sqlDatabase: { env: Record<string, string>; drop: () => Promise<void> } | null = null;

/** The S3 settings forwarded with `CONFORMANCE_FILE_STORE=s3` (from docker/s3.env). */
const s3Variables = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

/**
 * Where the run's server keeps file bytes: a new temporary folder (`FILE_STORE=local`), or with
 * `CONFORMANCE_FILE_STORE=s3` a new bucket on the local S3 server (`pnpm s3:up`), made and removed
 * by the server's `s3:bucket` command. `clean` is this process's environment without app variables.
 */
function prepareFiles(clean: NodeJS.ProcessEnv): { env: Record<string, string>; drop: () => void } {
  const store = process.env.CONFORMANCE_FILE_STORE?.trim() || "local";
  if (store === "local") {
    const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-conformance-files-"));
    return {
      env: { FILE_STORE: "local", FILES_PATH: dir },
      drop: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    };
  }
  if (store !== "s3") {
    throw new Error(`CONFORMANCE_FILE_STORE must be local or s3, got "${store}"`);
  }
  const s3: Record<string, string> = {};
  for (const name of s3Variables) {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`CONFORMANCE_FILE_STORE=s3 needs ${name} (docker/s3.env)`);
    s3[name] = value;
  }
  const bucket = `conformance-${randomBytes(5).toString("hex")}`;
  const bucketCommand = (command: "create" | "remove") => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/src/cli/s3-bucket.ts", command, bucket],
      { cwd: repoRoot, env: { ...clean, ...s3 }, encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        `s3:bucket ${command} failed (exit ${String(result.status)}):\n${result.stderr}`,
      );
    }
  };
  bucketCommand("create");
  return {
    env: { FILE_STORE: "s3", S3_BUCKET: bucket, ...s3 },
    drop: () => bucketCommand("remove"),
  };
}

/**
 * A new database for the run: a SQLite file in a temporary folder, or a new database on the
 * PostgreSQL server of `DATABASE_URL` (`pnpm test:conformance:postgres` reads docker/postgres.env).
 * The server's `pnpm seed` migrates it and loads the golden fixtures before the server starts.
 */
async function prepareSqlDatabase(
  provider: "sqlite" | "postgres",
): Promise<{ env: Record<string, string>; drop: () => Promise<void> }> {
  let env: Record<string, string>;
  let drop: () => Promise<void>;
  if (provider === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-conformance-"));
    env = { STORAGE_PROVIDER: "sqlite", SQLITE_PATH: join(dir, "conformance.db") };
    drop = () =>
      Promise.resolve(
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
      );
  } else {
    const adminUrl = process.env.DATABASE_URL?.trim();
    if (!adminUrl) throw new Error("CONFORMANCE_PROVIDER=postgres needs DATABASE_URL");
    const name = `conformance_${randomBytes(6).toString("hex")}`;
    const admin = async (statement: string) => {
      const client = new pg.Client({ connectionString: adminUrl });
      await client.connect();
      try {
        await client.query(statement);
      } finally {
        await client.end();
      }
    };
    await admin(`create database ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    env = { STORAGE_PROVIDER: "postgres", DATABASE_URL: url.toString() };
    drop = () => admin(`drop database if exists ${name} with (force)`);
  }
  const clean = { ...process.env };
  for (const name of appVariables) delete clean[name];
  const files = prepareFiles(clean);
  env = { ...env, ...files.env };
  const dropDatabase = drop;
  drop = async () => {
    await dropDatabase();
    files.drop();
  };
  const seeded = spawnSync(process.execPath, ["--import", "tsx", "server/src/cli/db.ts", "seed"], {
    cwd: repoRoot,
    env: { ...clean, ...env },
    encoding: "utf8",
  });
  if (seeded.status !== 0) {
    await drop();
    throw new Error(`pnpm seed failed (exit ${String(seeded.status)}):\n${seeded.stderr}`);
  }
  return { env, drop };
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

/** `CONFORMANCE_AUTH`: `default`, `password` or `oauth`. */
function authMode(): "default" | "password" | "oauth" {
  const mode = process.env.CONFORMANCE_AUTH?.trim() || "default";
  if (mode !== "default" && mode !== "password" && mode !== "oauth") {
    throw new Error(`CONFORMANCE_AUTH must be default, password or oauth, got "${mode}"`);
  }
  return mode;
}

/**
 * `CONFORMANCE_AUTH=password` keeps the users in the local directory (USER_DIRECTORY=local: the
 * seed's users become accounts without a password) and turns password sign-in on, with a first
 * admin from ADMIN_EMAIL and ADMIN_PASSWORD. The dev sign-in still signs the fixture users in, so
 * the whole suite runs on local accounts.
 */
function authEnv(): Record<string, string> {
  const mode = authMode();
  if (mode === "default") return {};
  const password = {
    USER_DIRECTORY: "local",
    AUTH_METHODS: "password",
    ADMIN_EMAIL: PASSWORD_ADMIN.email,
    ADMIN_PASSWORD: PASSWORD_ADMIN.password,
    // The self-hosted look: features.test.ts checks /config and /api/docs in this shell.
    APP_SHELL: "self-hosted",
    BRAND_NAME: "Conformance Surveys",
  };
  return mode === "password" ? password : { ...password, ...oauthEnv() };
}

/**
 * `CONFORMANCE_AUTH=oauth` adds the four OAuth2 methods, all pointed at the OAuth stub (Google,
 * GitHub and Facebook by OAUTH_STUB_URL, surveyjs.io by its issuer URL), and SIGN_UP_DOMAINS.
 * The dev sign-in still signs the fixture users in (the instance admin and the project owners).
 */
function oauthEnv(): Record<string, string> {
  if (oauthStub === null) throw new Error("the OAuth stub is started in setup()");
  const { url } = oauthStub;
  return {
    AUTH_METHODS: "password,surveyjs,google,github,facebook",
    OAUTH_STUB_URL: url,
    GOOGLE_CLIENT_ID: "conformance-google",
    GOOGLE_CLIENT_SECRET: "stub-secret-google",
    GITHUB_CLIENT_ID: "conformance-github",
    GITHUB_CLIENT_SECRET: "stub-secret-github",
    FACEBOOK_CLIENT_ID: "conformance-facebook",
    FACEBOOK_CLIENT_SECRET: "stub-secret-facebook",
    OIDC_ISSUER_URL: `${url}/surveyjs`,
    OIDC_CLIENT_ID: "conformance-surveyjs",
    OIDC_CLIENT_SECRET: "stub-secret-surveyjs",
    SIGN_UP_DOMAINS: SIGN_UP_DOMAIN,
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

function serverEnv(
  port: number,
  stubUrl: string | null,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
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
    ...authEnv(),
    ...readOnlyEnv(),
    ...overrides,
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
  // The SQL providers need the local directory in production, and the dev sign-in is refused there.
  if (["memory", "sqlite", "postgres"].includes(env.STORAGE_PROVIDER ?? "")) {
    return { ...env, NODE_ENV: "development" };
  }
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
  overrides: Record<string, string> = {},
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
          env: serverEnv(port, stubUrl, overrides),
        })
      : spawnImage(image, imageEnv(serverEnv(port, stubUrl, overrides)));
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
export async function setup(project: TestProject): Promise<(() => Promise<void>) | void> {
  const external = process.env.CONFORMANCE_BASE_URL?.trim();
  const mode = userDirectoryMode();
  if (conformanceProvider() === "sandbox") {
    provideSandbox(project, Boolean(external), mode);
    return;
  }
  if (external) {
    if (mode !== "default") {
      throw new Error("CONFORMANCE_USER_DIRECTORY cannot be used with CONFORMANCE_BASE_URL");
    }
    if (process.env.CONFORMANCE_IMAGE?.trim()) {
      throw new Error("CONFORMANCE_IMAGE cannot be used with CONFORMANCE_BASE_URL");
    }
    if (authMode() !== "default") {
      throw new Error("CONFORMANCE_AUTH cannot be used with CONFORMANCE_BASE_URL");
    }
    project.provide("baseUrl", external.replace(/\/+$/, ""));
    project.provide("ownsServer", false);
    project.provide("userDirectory", "default");
    project.provide("webhookSecret", process.env.CONFORMANCE_WEBHOOK_SECRET?.trim() || null);
    project.provide("passwordAdmin", null);
    project.provide("oauth", null);
    project.provide("sandbox", false);
    return;
  }
  const image = imageTag();
  const provider = conformanceProvider();
  if (provider === "sqlite" && image !== null) {
    throw new Error(
      "CONFORMANCE_IMAGE cannot be used with CONFORMANCE_PROVIDER=sqlite: the container cannot see the run's database file",
    );
  }
  const auth = authMode();
  if (auth !== "default" && (provider === "azure-legacy" || mode !== "default")) {
    throw new Error(
      `CONFORMANCE_AUTH=${auth} needs CONFORMANCE_PROVIDER=memory, sqlite or postgres and the default user directory`,
    );
  }
  if (auth === "oauth" && image !== null) {
    throw new Error(
      "CONFORMANCE_IMAGE cannot be used with CONFORMANCE_AUTH=oauth: the run starts two servers",
    );
  }
  if (provider === "sqlite" || provider === "postgres") {
    sqlDatabase = await prepareSqlDatabase(provider);
  }
  const database = sqlDatabase;
  // The OAuth run's second server, OPEN_SIGN_UP=on, gets a database of its own.
  let openDatabase: { env: Record<string, string>; drop: () => Promise<void> } | null = null;
  const stub = mode === "surveyjs-api" ? await startUserApiStub() : null;
  const servers: { baseUrl: string; stop: () => void }[] = [];
  const stopAll = async () => {
    for (const started of servers) started.stop();
    stub?.stop();
    await oauthStub?.close();
    await database?.drop();
    await openDatabase?.drop();
  };
  try {
    if (auth === "oauth") oauthStub = await startOAuthStub();
    servers.push(await startReferenceServer(stub?.url ?? null, image));
    if (auth === "oauth") {
      if (provider === "sqlite" || provider === "postgres") {
        openDatabase = await prepareSqlDatabase(provider);
      }
      servers.push(
        await startReferenceServer(null, image, { ...openDatabase?.env, OPEN_SIGN_UP: "on" }),
      );
    }
  } catch (error) {
    await stopAll();
    throw error;
  }
  const [server, openSignUp] = servers;
  if (!server) throw new Error("the reference server did not start");
  project.provide("baseUrl", server.baseUrl);
  project.provide("ownsServer", true);
  project.provide("userDirectory", mode);
  project.provide("webhookSecret", WEBHOOK_SECRET);
  project.provide("passwordAdmin", auth === "default" ? null : PASSWORD_ADMIN);
  project.provide(
    "oauth",
    oauthStub && openSignUp
      ? {
          stubUrl: oauthStub.url,
          signUpDomain: SIGN_UP_DOMAIN,
          openSignUpBaseUrl: openSignUp.baseUrl,
        }
      : null,
  );
  project.provide("sandbox", false);
  return stopAll;
}

/** The origin the sandbox run's requests go to; msw/node answers them (src/sandbox-setup.ts). */
const SANDBOX_ORIGIN = "http://sandbox.test";

/**
 * `CONFORMANCE_PROVIDER=sandbox` starts no server: each test file's worker registers the sandbox's
 * mock handlers with msw/node (src/sandbox-setup.ts, a `setupFiles` entry of vitest.config.ts).
 * Every option that configures a server is refused.
 */
function provideSandbox(
  project: TestProject,
  external: boolean,
  mode: "default" | "surveyjs-api",
): void {
  const options: [string, boolean][] = [
    ["CONFORMANCE_BASE_URL", external],
    ["CONFORMANCE_IMAGE", Boolean(process.env.CONFORMANCE_IMAGE?.trim())],
    ["CONFORMANCE_USER_DIRECTORY", mode !== "default"],
    ["CONFORMANCE_AUTH", authMode() !== "default"],
    ["CONFORMANCE_READ_ONLY", readOnlyEnv().READ_ONLY !== undefined],
    ["CONFORMANCE_FILE_STORE", Boolean(process.env.CONFORMANCE_FILE_STORE?.trim())],
  ];
  const refused = options.filter(([, set]) => set).map(([name]) => name);
  if (refused.length > 0) {
    throw new Error(`CONFORMANCE_PROVIDER=sandbox cannot be used with ${refused.join(", ")}`);
  }
  project.provide("baseUrl", SANDBOX_ORIGIN);
  project.provide("ownsServer", false);
  project.provide("userDirectory", "default");
  project.provide("webhookSecret", null);
  project.provide("passwordAdmin", null);
  project.provide("oauth", null);
  project.provide("sandbox", true);
}
