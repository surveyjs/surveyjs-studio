import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

import { appVariables, stripAppVariables } from "./app-variables.mjs";
import { imageTag, isImageTarget } from "./image-target.mjs";
import { ports } from "./ports.mjs";

type WebServers = Extract<PlaywrightTestConfig["webServer"], unknown[]>;

// Playwright merges webServer.env onto process.env and cannot unset keys, so
// strip every app variable (server env table and Vite's) from this process
// first; the servers then see only the explicit values below. The list lives in
// e2e/app-variables.mjs; keep it in sync with server/src/config.ts and
// conformance-tests/src/global-setup.ts (same approach there).
stripAppVariables(process.env);

// Every server is started fresh (reuseExistingServer: false), so Playwright fails with
// "... is already used" when something else holds one of the ports below. `pnpm e2e` checks them
// first (scripts/ports.mjs) and names the process.

// Two modes, because two server configurations cannot share port 3000:
// - memory (default): the dev identity provider; all specs on Chromium, Firefox and WebKit.
// - azurite (E2E_MODE=azurite, `pnpm e2e:azurite`): the azure-legacy provider on the local replica
//   and the mock OIDC server (`pnpm demo:azurite:up` first); the sign-in, survey list, survey actions,
//   editor, history, uploads, run, results, results-details, projects and xss specs, on Chromium.
// - sqlite (E2E_MODE=sqlite, `pnpm e2e:sqlite`): the sqlite provider on a new database file seeded
//   with the golden fixtures, files on local disk, and the dev sign-in; the survey list, editor,
//   history, upload and run specs, on Chromium.
// - postgres (E2E_MODE=postgres, `pnpm e2e:postgres`): the postgres provider on a new database
//   (`pnpm postgres:up` first) with files in a new bucket of the local S3 server (`pnpm s3:up`),
//   seeded the same way; every functional spec but the licence notices
//   (which need the second server), on Chromium.
const azurite = process.env["E2E_MODE"] === "azurite";
const sqlite = process.env["E2E_MODE"] === "sqlite";
const postgres = process.env["E2E_MODE"] === "postgres";

// Two targets: the source (default; tsx server and `vite preview`) or the production image
// (E2E_TARGET=image, CI only: see e2e/image-target.mjs and the webServers below).
const imageTarget = isImageTarget(process.env);

const serverEnv = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  // Sign-in redirects must come back to the browser-visible (Vite) origin.
  PUBLIC_BASE_URL: `http://localhost:${ports.web}`,
  APP_EDITION: "self-hosted",
  APP_SHELL: "surveyjs-site",
  LOG_LEVEL: "warn",
  // All browsers and workers sign in from one IP; the limit itself is covered by server tests.
  SIGN_IN_RATE_LIMIT: "100000",
  // All browsers and workers share one IP; the limits are covered by server tests.
  PUBLIC_RATE_LIMIT: "100000",
  PUBLIC_FILE_RATE_LIMIT: "100000",
  // Small, so the quota test sends little.
  LIMIT_MAX_ASSET_BYTES_PER_SURVEY: "1048576",
};

export const memoryServerEnv = {
  ...serverEnv,
  STORAGE_PROVIDER: "memory",
  IDENTITY_PROVIDER: "dev",
  MEMORY_SEED: "legacy-fixtures",
};

const serverCommand = "pnpm --filter @surveyjs-studio/server start";

// The web app is built by the `e2e` scripts before Playwright starts; the previews only serve it.
const preview = (port: number) =>
  `pnpm --filter @surveyjs-studio/web exec vite preview --port ${port} --strictPort`;

const memoryWebServers: WebServers = [
  {
    command: serverCommand,
    url: `http://127.0.0.1:${ports.server}/readyz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...memoryServerEnv, PORT: String(ports.server) },
  },
  {
    command: preview(ports.web),
    url: `http://localhost:${ports.web}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_API_PROXY_TARGET: `http://127.0.0.1:${ports.server}` },
  },
  // The licence-notice spec: a second server that always shows the expired-licence dialog, behind
  // its own preview whose proxy points at it (E2E_API_PROXY_TARGET, see web/vite.config.ts).
  {
    command: serverCommand,
    url: `http://127.0.0.1:${ports.licenceServer}/readyz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...memoryServerEnv,
      PORT: String(ports.licenceServer),
      PUBLIC_BASE_URL: `http://localhost:${ports.licenceWeb}`,
      ACCOUNT_NOTICES: "license-expired",
    },
  },
  {
    command: preview(ports.licenceWeb),
    url: `http://localhost:${ports.licenceWeb}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_API_PROXY_TARGET: `http://127.0.0.1:${ports.licenceServer}` },
  },
];

const azuriteWebServers: WebServers = [
  {
    // The replica's and the mock OIDC server's local-only settings come from docker/azurite.env.
    command:
      "pnpm --filter @surveyjs-studio/server exec node --env-file=../docker/azurite.env --import tsx src/main.ts",
    url: `http://127.0.0.1:${ports.server}/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...serverEnv, PORT: String(ports.server) },
  },
  {
    command: preview(ports.web),
    url: `http://localhost:${ports.web}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_API_PROXY_TARGET: `http://127.0.0.1:${ports.server}` },
  },
];

// The server seeds its new database (`seed` migrates it first), then starts on it. The users and
// files come from the memory provider's seed until self-hosted Steps 3 and 4. The database is made
// by playwright.sqlite.config.ts (E2E_SQLITE_DIR) or playwright.postgres.config.ts (E2E_DATABASE_URL).
const sqlWebServers = (): WebServers => [
  {
    command:
      "pnpm --filter @surveyjs-studio/server exec node --import tsx src/cli/db.ts seed && " +
      serverCommand,
    url: `http://127.0.0.1:${ports.server}/readyz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...memoryServerEnv,
      ...(sqlite
        ? {
            STORAGE_PROVIDER: "sqlite",
            SQLITE_PATH: join(process.env["E2E_SQLITE_DIR"] ?? "", "e2e.db"),
            FILE_STORE: "local",
            FILES_PATH: join(process.env["E2E_SQLITE_DIR"] ?? "", "files"),
          }
        : {
            STORAGE_PROVIDER: "postgres",
            DATABASE_URL: process.env["E2E_DATABASE_URL"] ?? "",
            ...JSON.parse(process.env["E2E_S3_SETTINGS"] ?? "{}"),
          }),
      PORT: String(ports.server),
    },
  },
  {
    command: preview(ports.web),
    url: `http://localhost:${ports.web}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { E2E_API_PROXY_TARGET: `http://127.0.0.1:${ports.server}` },
  },
];

// The image target: one container per server and preview pair, listening on the preview's port and
// serving the web app from the image's WEB_ROOT. `--network host` (Linux only) lets the container
// reach the replica and the mock OIDC server on the host's loopback ports, as the tsx server does.
// Values go in the docker client's environment and are passed by name (`-e NAME`), so none is on
// the command line. A container of an earlier run with the same name is removed first; the global
// teardown saves the logs and removes the containers.
function imageWebServer(name: string, port: number, env: Record<string, string>) {
  const passed = Object.keys(env).map((variable) => `-e ${variable}`);
  const run = ["docker run", `--name ${name}`, "--network host", ...passed, imageTag(process.env)];
  return {
    command: `docker rm -f ${name} >/dev/null 2>&1; exec ${run.join(" ")}`,
    url: `http://127.0.0.1:${port}/readyz`,
    reuseExistingServer: false,
    timeout: 120_000,
    // The docker client passes SIGTERM to the server, which shuts down cleanly.
    gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
    env,
  };
}

// The image runs on `localhost` (both loopback addresses), where the browsers open the app.
const imageServerEnv = (port: number) => ({
  ...serverEnv,
  HOST: "localhost",
  PORT: String(port),
  PUBLIC_BASE_URL: `http://localhost:${port}`,
});

// Built only for the image target (it reads docker/azurite.env and checks E2E_IMAGE).
function imageWebServers(): WebServers {
  if (!azurite) {
    // The dev sign-in is refused under NODE_ENV=production (the image's default), so development.
    return [
      imageWebServer("surveyjs-studio-e2e-memory-5173", ports.web, {
        ...memoryServerEnv,
        ...imageServerEnv(ports.web),
        NODE_ENV: "development",
      }),
      // The licence-notice server (see memoryWebServers).
      imageWebServer("surveyjs-studio-e2e-memory-5174", ports.licenceWeb, {
        ...memoryServerEnv,
        ...imageServerEnv(ports.licenceWeb),
        NODE_ENV: "development",
        ACCOUNT_NOTICES: "license-expired",
      }),
    ];
  }
  // docker/azurite.env is read here, because `docker run --env-file` would keep its quotes in the
  // values. Only the app's variables are passed (not the SQL Server container's password), and the
  // explicit values win over the file, as with `node --env-file`.
  const file = parseEnv(readFileSync(new URL("../docker/azurite.env", import.meta.url), "utf8"));
  const azuriteEnv = Object.fromEntries(
    Object.entries(file).filter(([name]) => appVariables.includes(name)),
  ) as Record<string, string>;
  return [
    // NODE_ENV stays production, as in a deployment, so the server needs a session secret.
    imageWebServer("surveyjs-studio-e2e-azurite-5173", ports.web, {
      ...azuriteEnv,
      ...imageServerEnv(ports.web),
      NODE_ENV: "production",
      SESSION_SECRET: "e2e-local-only-session-secret-not-a-real-value",
    }),
  ];
}

// The surveyjs-site header shows the account name only from this width up.
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  // Sign-in is several redirects and a large bundle; the browsers run side by side on one machine.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["line"], ["html", { open: "never" }]] : "list",
  // A fixed locale and time zone, so the list's dates read the same on every machine.
  use: {
    baseURL: `http://localhost:${ports.web}`,
    trace: "retain-on-failure",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: sqlite
    ? [
        {
          name: "sqlite-chromium",
          testMatch: [
            "survey-list.spec.ts",
            "survey-list-paging.spec.ts",
            "editor.spec.ts",
            "history.spec.ts",
            "uploads.spec.ts",
            "run.spec.ts",
          ],
          use: { ...devices["Desktop Chrome"], viewport },
        },
      ]
    : postgres
      ? [
          {
            name: "postgres-chromium",
            testIgnore: ["notices.spec.ts"],
            use: { ...devices["Desktop Chrome"], viewport },
          },
        ]
      : azurite
        ? [
            {
              name: "azurite-chromium",
              testMatch: [
                "sign-in.spec.ts",
                "survey-list.spec.ts",
                "survey-actions.spec.ts",
                "editor.spec.ts",
                "history.spec.ts",
                "uploads.spec.ts",
                "run.spec.ts",
                "results.spec.ts",
                "results-details.spec.ts",
                "projects.spec.ts",
                "xss.spec.ts",
              ],
              use: { ...devices["Desktop Chrome"], viewport },
            },
          ]
        : [
            { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
            { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
            { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
          ],
  webServer: imageTarget
    ? imageWebServers()
    : sqlite || postgres
      ? sqlWebServers()
      : azurite
        ? azuriteWebServers
        : memoryWebServers,
  ...(imageTarget && { globalTeardown: "./image-teardown.mjs" }),
});
