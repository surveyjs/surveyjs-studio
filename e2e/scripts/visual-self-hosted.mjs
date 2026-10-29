// `pnpm e2e:visual:self-hosted` entry: builds the web app and compares the self-hosted shell's pages
// with this repository's baselines (e2e/visual-self-hosted/baselines/<platform>/). Arguments go to
// `playwright test`: `--update-snapshots` writes the baselines after a deliberate change of the look.
// The ports 3003 and 5176 must be free.
import { spawnSync } from "node:child_process";
import { stripAppVariables } from "../app-variables.mjs";
import { selfHostedVisualPorts } from "../ports.mjs";
import { requireFreePorts } from "./ports.mjs";

const env = stripAppVariables({ ...process.env });
const run = (command) => {
  const result = spawnSync(command, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

await requireFreePorts(selfHostedVisualPorts);
run("pnpm --filter @surveyjs-studio/web build");
run(
  [
    "playwright test --config playwright.self-hosted-visual.config.ts",
    ...process.argv.slice(2),
  ].join(" "),
);
