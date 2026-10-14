import { defineConfig, devices } from "@playwright/test";

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
// when something else already holds port 3000 or 5173.
const reuseExistingServer = !process.env["CI"];

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? [["line"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:5173", trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter @my-surveys/server start",
      url: "http://127.0.0.1:3000/readyz",
      reuseExistingServer,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        STORAGE_PROVIDER: "memory",
        IDENTITY_PROVIDER: "dev",
        MEMORY_SEED: "legacy-fixtures",
        HOST: "127.0.0.1",
        PORT: "3000",
        APP_EDITION: "self-hosted",
        APP_SHELL: "surveyjs-site",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: "pnpm --filter @my-surveys/web build && pnpm --filter @my-surveys/web preview",
      url: "http://localhost:5173/",
      reuseExistingServer,
      timeout: 180_000,
    },
  ],
});
