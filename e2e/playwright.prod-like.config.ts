// Prod-like mode (`pnpm e2e:prod-like`): the Azurite mode's specs against the production image in
// the mode 1 configuration, which the prod-like stack runs at http://localhost:8080 with
// NODE_ENV=production (docker/compose.prod-like.yaml with the docker/compose.prod-like.e2e.yaml
// override). Nothing is built or started here: the stack runs already. It is the one run on the
// production image with production's settings; Azurite mode runs the same specs on a test server.
import type { PlaywrightTestConfig } from "@playwright/test";
import { ports } from "./ports.mjs";

// The specs read E2E_MODE (the mock OIDC sign-in form); set before the shared config loads.
process.env["E2E_MODE"] = "azurite";

const base = (await import("./playwright.config.js")).default;
const azurite = base.projects?.find((project) => project.name === "azurite-chromium");
if (!azurite) throw new Error("playwright.config.ts has no azurite-chromium project");

const config: PlaywrightTestConfig = {
  ...base,
  webServer: undefined,
  globalTeardown: undefined,
  use: { ...base.use, baseURL: `http://localhost:${ports.prodLike}` },
  projects: [{ ...azurite, name: "prod-like-chromium" }],
};

export default config;
