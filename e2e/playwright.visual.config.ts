import { defineConfig } from "@playwright/test";

import { stripAppVariables } from "./app-variables.mjs";
import { memoryServerEnv } from "./playwright.config.js";
import { VISUAL_PROJECTS } from "./visual/support/browser.js";
import { SNAPSHOT_PATH_TEMPLATE } from "./visual/support/paths.js";

// The visual run has its own server and preview (ports 3002 and 5175, memory provider), so its data
// is fresh on every run and never touches the functional e2e servers. See docs/testing.md > Visual parity.
stripAppVariables(process.env);

// `--self`: the baselines are throwaway app screenshots in a git-ignored folder.
const self = process.env["VISUAL_BASELINES"] === "self";

export default defineConfig({
  testDir: "visual/tests",
  snapshotPathTemplate: self
    ? SNAPSHOT_PATH_TEMPLATE.replace("/baselines/", "/.self-baselines/")
    : SNAPSHOT_PATH_TEMPLATE,
  // The runner passes --update-snapshots=all only in the first pass of `--self`.
  updateSnapshots: "none",
  fullyParallel: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env["CI"],
  reporter: [["list"], ["html", { outputFolder: "visual-report", open: "never" }]],
  use: { baseURL: "http://localhost:5175", trace: "retain-on-failure" },
  projects: [
    {
      name: "visual-data",
      testMatch: "visual-data.setup.ts",
      use: { ...VISUAL_PROJECTS[0]?.use },
    },
    ...VISUAL_PROJECTS.map((project) => ({
      name: project.name,
      testMatch: "visual.spec.ts",
      dependencies: ["visual-data"],
      use: { ...project.use, storageState: "visual/.state/erin.json" },
    })),
  ],
  webServer: [
    {
      command: "pnpm --filter @my-surveys/server start",
      url: "http://127.0.0.1:3002/readyz",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...memoryServerEnv, PORT: "3002", PUBLIC_BASE_URL: "http://localhost:5175" },
    },
    {
      command: "pnpm --filter @my-surveys/web exec vite preview --port 5175 --strictPort",
      url: "http://localhost:5175/",
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PROXY_TARGET: "http://127.0.0.1:3002" },
    },
  ],
});
