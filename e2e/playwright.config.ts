import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

type WebServers = Extract<PlaywrightTestConfig["webServer"], unknown[]>;

// Playwright merges webServer.env onto process.env and cannot unset keys, so
// strip every app variable (server env table and Vite's) from this process
// first; the servers then see only the explicit values below. Keep the list in sync with
// server/src/config.ts and conformance-tests/src/global-setup.ts (same approach there).
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
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
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
  "ACCOUNT_NOTICES",
  "SHELL_LINKS",
];
for (const name of Object.keys(process.env)) {
  if (appVariables.includes(name) || name.startsWith("VITE_")) {
    delete process.env[name];
  }
}

// With reuseExistingServer off (CI), Playwright fails with "... is already used"
// when something else already holds one of the ports below.
const reuseExistingServer = !process.env["CI"];

// Two modes, because two server configurations cannot share port 3000:
// - memory (default): the dev identity provider; all specs on Chromium, Firefox and WebKit.
// - azurite (E2E_MODE=azurite, `pnpm e2e:azurite`): the azure-legacy provider on the local replica
//   and the mock OIDC server (`pnpm demo:azurite:up` first); only the sign-in spec, on Chromium.
const azurite = process.env["E2E_MODE"] === "azurite";

const serverEnv = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  // Sign-in redirects must come back to the browser-visible (Vite) origin.
  PUBLIC_BASE_URL: "http://localhost:5173",
  APP_EDITION: "self-hosted",
  APP_SHELL: "surveyjs-site",
  LOG_LEVEL: "warn",
};

const memoryServerEnv = {
  ...serverEnv,
  STORAGE_PROVIDER: "memory",
  IDENTITY_PROVIDER: "dev",
  MEMORY_SEED: "legacy-fixtures",
};

const serverCommand = "pnpm --filter @my-surveys/server start";

// The web app is built by the `e2e` scripts before Playwright starts; the previews only serve it.
const preview = (port: number) =>
  `pnpm --filter @my-surveys/web exec vite preview --port ${port} --strictPort`;

const memoryWebServers: WebServers = [
  {
    command: serverCommand,
    url: "http://127.0.0.1:3000/readyz",
    reuseExistingServer,
    timeout: 60_000,
    env: { ...memoryServerEnv, PORT: "3000" },
  },
  { command: preview(5173), url: "http://localhost:5173/", reuseExistingServer, timeout: 60_000 },
  // The licence-notice spec: a second server that always shows the expired-licence dialog, behind
  // its own preview whose proxy points at it (E2E_API_PROXY_TARGET, see web/vite.config.ts).
  {
    command: serverCommand,
    url: "http://127.0.0.1:3001/readyz",
    reuseExistingServer,
    timeout: 60_000,
    env: {
      ...memoryServerEnv,
      PORT: "3001",
      PUBLIC_BASE_URL: "http://localhost:5174",
      ACCOUNT_NOTICES: "license-expired",
    },
  },
  {
    command: preview(5174),
    url: "http://localhost:5174/",
    reuseExistingServer,
    timeout: 60_000,
    env: { E2E_API_PROXY_TARGET: "http://127.0.0.1:3001" },
  },
];

const azuriteWebServers: WebServers = [
  {
    // The replica's and the mock OIDC server's local-only settings come from docker/azurite.env.
    command:
      "pnpm --filter @my-surveys/server exec node --env-file=../docker/azurite.env --import tsx src/main.ts",
    url: "http://127.0.0.1:3000/readyz",
    reuseExistingServer,
    timeout: 120_000,
    env: { ...serverEnv, PORT: "3000" },
  },
  { command: preview(5173), url: "http://localhost:5173/", reuseExistingServer, timeout: 60_000 },
];

// The surveyjs-site header shows the account name only from this width up.
const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  // Sign-in is several redirects and a large bundle; the browsers run side by side on one machine.
  expect: { timeout: 10_000 },
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["line"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: azurite
    ? [
        {
          name: "azurite-chromium",
          testMatch: "sign-in.spec.ts",
          use: { ...devices["Desktop Chrome"], viewport },
        },
      ]
    : [
        { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
        { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
        { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
      ],
  webServer: azurite ? azuriteWebServers : memoryWebServers,
});
