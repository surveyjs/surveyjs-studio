import { defineConfig } from "@playwright/test";

import { VISUAL_PROJECTS } from "./visual/support/browser.js";
import { SNAPSHOT_PATH_TEMPLATE } from "./visual/support/paths.js";

// The baseline capture: a person runs it against the live surveyjs.io (`pnpm visual:capture`), signs
// in once in a headed browser, and gets the baselines in update mode. Read only; no server is started.
// See docs/testing.md > Visual parity > Capturing baselines.
const STORAGE_STATE = "visual/.auth/surveyjs-io.json";

// serviceWorkers "block": context.route does not see requests a Service Worker handles, so the write guard needs them off.
export default defineConfig({
  testDir: "visual/capture",
  snapshotPathTemplate: SNAPSHOT_PATH_TEMPLATE,
  updateSnapshots: "all",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  // Traces, screenshots and diffs of failed captures show live pages of the account: they go to the
  // git-ignored visual/.auth/ folder, which the runner deletes with the sign-in state.
  outputDir: "visual/.auth/test-results",
  projects: [
    ...VISUAL_PROJECTS.map((project) => ({
      name: `signin-${project.name}`,
      testMatch: "sign-in.setup.ts",
      timeout: 15 * 60_000,
      use: { ...project.use, headless: false, serviceWorkers: "block" as const },
    })),
    ...VISUAL_PROJECTS.map((project) => ({
      name: project.name,
      testMatch: "capture.spec.ts",
      dependencies: [`signin-${project.name}`],
      use: { ...project.use, storageState: STORAGE_STATE, serviceWorkers: "block" as const },
    })),
  ],
});
