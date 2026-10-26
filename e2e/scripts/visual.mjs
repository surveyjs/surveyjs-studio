// `pnpm e2e:visual` entry: compares the app with the surveyjs.io baselines (never writes them).
// With `--self` it checks the harness instead: two runs against throwaway app baselines, the second
// of which must pass. Exit codes: 0 pass, 1 failure or missing baselines, 2 refused argument.
// Only --self selects the throwaway baselines: a VISUAL_BASELINES left in the caller's environment is
// removed in normal mode, so the run always compares with the surveyjs.io baselines.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAppVariables } from "../app-variables.mjs";
import { visualPorts } from "../ports.mjs";
import { requireFreePorts } from "./ports.mjs";

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const self = args.includes("--self");
const passThrough = args.filter((arg) => arg !== "--self");

const refused = (arg) =>
  arg === "-u" || arg === "--update-snapshots" || arg.startsWith("--update-snapshots=");
if (passThrough.some(refused)) {
  console.error("Baselines come only from surveyjs.io.");
  process.exit(2);
}

const baselines = resolve(e2eDir, "visual/baselines");
if (!self) {
  const platform = process.platform;
  if (!existsSync(resolve(baselines, "states.json")) || !existsSync(resolve(baselines, platform))) {
    console.error(
      `No surveyjs.io baselines for ${platform}. A SurveyJS team member captures them with pnpm visual:capture (docs/testing.md › Visual parity › Capturing baselines).`,
    );
    process.exit(1);
  }
}

await requireFreePorts(visualPorts);

const baseEnv = stripAppVariables({ ...process.env });
// Windows environment names ignore case, so every spelling goes.
for (const name of Object.keys(baseEnv)) {
  if (name.toUpperCase() === "VISUAL_BASELINES") delete baseEnv[name];
}
const run = (command, extraEnv = {}) => {
  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    cwd: e2eDir,
    env: { ...baseEnv, ...extraEnv },
  });
  return result.status ?? 1;
};
const quote = (arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg));
const playwright = (extra) =>
  ["playwright test -c playwright.visual.config.ts", ...extra, ...passThrough.map(quote)].join(" ");

let status = run("pnpm --filter @surveyjs-studio/web build");
if (status !== 0) process.exit(status);

if (!self) process.exit(run(playwright([])));

rmSync(resolve(e2eDir, "visual/.self-baselines"), { recursive: true, force: true });
const selfEnv = { VISUAL_BASELINES: "self" };
console.log("--self, pass 1: writing throwaway baselines from the app");
status = run(playwright(["--update-snapshots=all"]), selfEnv);
if (status !== 0) process.exit(status);
console.log("--self, pass 2: comparing a fresh server with them");
process.exit(run(playwright([]), selfEnv));
