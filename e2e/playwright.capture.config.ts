import { defineConfig } from "@playwright/test";

import { VISUAL_PROJECTS } from "./visual/support/browser.js";
import { SNAPSHOT_PATH_TEMPLATE } from "./visual/support/paths.js";

// The baseline capture: a person runs it against the live surveyjs.io (`pnpm visual:capture`), signs
// in once in a headed browser, and gets the baselines in update mode. Read only; no server is started.
// See docs/testing.md > Visual parity > Capturing baselines.
const STORAGE_STATE = "visual/.auth/surveyjs-io.json";

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
  projects: [
    ...VISUAL_PROJECTS.map((project) => ({
      name: `signin-${project.name}`,
      testMatch: "sign-in.setup.ts",
      timeout: 15 * 60_000,
      use: { ...project.use, headless: false },
    })),
    ...VISUAL_PROJECTS.map((project) => ({
      name: project.name,
      testMatch: "capture.spec.ts",
      dependencies: [`signin-${project.name}`],
      use: { ...project.use, storageState: STORAGE_STATE },
    })),
  ],
});
