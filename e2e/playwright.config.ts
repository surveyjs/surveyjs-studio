import { defineConfig, devices } from "@playwright/test";

// With reuseExistingServer off (CI), Playwright fails with "... is already used"
// when something else already holds port 3000 or 5173.
const reuseExistingServer = !process.env["CI"];

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? "line" : "list",
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
