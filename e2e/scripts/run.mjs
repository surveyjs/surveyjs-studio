// `pnpm e2e` entry: builds the web app and runs Playwright, both with the app variables of the
// caller's environment stripped (so an exported VITE_API_BASE_URL is not baked into the bundle).
// Arguments are passed to `playwright test`. With E2E_TARGET=image (CI) the image serves its own
// build, so the web app is not built here. The ports of the configuration being run must be free.
import { spawnSync } from "node:child_process";
import { stripAppVariables } from "../app-variables.mjs";
import { isImageTarget } from "../image-target.mjs";
import { functionalPorts, usesAzuriteConfig, usesSqlConfig } from "../ports.mjs";
import { requireFreePorts } from "./ports.mjs";

const env = stripAppVariables({ ...process.env });
const run = (command) => {
  const result = spawnSync(command, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

let imageTarget;
try {
  imageTarget = isImageTarget(env);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
// The mode's config sets E2E_MODE only once Playwright loads it, so the config name counts too.
const sandbox =
  env["E2E_MODE"] === "sandbox" ||
  process.argv.slice(2).some((a) => /playwright\.sandbox\.config/.test(a));
// E2E_SANDBOX_URL names a running host of the sandbox build: nothing is built or started.
const externalSandbox = sandbox && !!env["E2E_SANDBOX_URL"];
// Playwright never reuses a server: a taken port stops the run here, before the build.
if (!externalSandbox)
  await requireFreePorts(
    functionalPorts({
      image: imageTarget,
      azurite: usesAzuriteConfig(process.argv.slice(2)) || env["E2E_MODE"] === "azurite",
      sql:
        usesSqlConfig(process.argv.slice(2)) ||
        ["sqlite", "postgres", "password", "oauth", "self-hosted"].includes(env["E2E_MODE"] ?? ""),
      sandbox,
      oauth:
        env["E2E_MODE"] === "oauth" ||
        process.argv.slice(2).some((a) => /playwright.oauth.config/.test(a)),
    }),
  );
// The sandbox mode serves its own build (`build:sandbox`, into dist-sandbox/) and starts no server.
if (externalSandbox) console.log(`Testing the sandbox at ${env["E2E_SANDBOX_URL"]}`);
else if (sandbox) run("pnpm --filter @surveyjs-studio/web build:sandbox");
else if (!imageTarget) run("pnpm --filter @surveyjs-studio/web build");
run(["playwright test", ...process.argv.slice(2)].join(" "));
