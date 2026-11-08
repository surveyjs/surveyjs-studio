import { devices, defineConfig } from "@playwright/test";

import { stripAppVariables } from "./app-variables.mjs";
import { memoryServerEnv } from "./playwright.config.js";
import { ports } from "./ports.mjs";
import { brand } from "./tests/support/self-hosted.js";

// The self-hosted shell's visual run (`pnpm e2e:visual:self-hosted`): screenshots of its pages
// compared with this repository's own baselines (visual-self-hosted/baselines/<platform>/), on its
// own server and preview (ports 3003 and 5176, the memory provider, fresh data on every run). Unlike
// the surveyjs.io parity run (playwright.visual.config.ts), the baselines are the app's own: a
// deliberate change of the shell's look updates them with --update-snapshots. See docs/testing.md.
stripAppVariables(process.env);

export default defineConfig({
  testDir: "visual-self-hosted",
  snapshotPathTemplate: "{testDir}/baselines/{platform}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    // Text antialiasing differs a little between runs of one machine; a layout change does not hide
    // in this.
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  forbidOnly: !!process.env["CI"],
  reporter: [["list"], ["html", { outputFolder: "visual-self-hosted-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${ports.selfHostedVisualWeb}`,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @surveyjs-studio/server start",
      url: `http://127.0.0.1:${ports.selfHostedVisualServer}/readyz`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...memoryServerEnv,
        // The self-hosted shell with a brand; local accounts (the Users page) and the dev sign-in.
        APP_SHELL: "self-hosted",
        USER_DIRECTORY: "local",
        AUTH_METHODS: "password",
        BRAND_NAME: brand.name,
        BRAND_ACCENT_COLOR: brand.accentColor,
        TERMS_URL: brand.termsUrl,
        PRIVACY_URL: brand.privacyUrl,
        PORT: String(ports.selfHostedVisualServer),
        PUBLIC_BASE_URL: `http://localhost:${ports.selfHostedVisualWeb}`,
      },
    },
    {
      command: `pnpm --filter @surveyjs-studio/web exec vite preview --port ${ports.selfHostedVisualWeb} --strictPort`,
      url: `http://localhost:${ports.selfHostedVisualWeb}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PROXY_TARGET: `http://127.0.0.1:${ports.selfHostedVisualServer}` },
    },
  ],
});
