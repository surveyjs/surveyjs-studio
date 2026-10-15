// `pnpm e2e` entry: builds the web app and runs Playwright, both with the app variables of the
// caller's environment stripped (so an exported VITE_API_BASE_URL is not baked into the bundle).
// Arguments are passed to `playwright test`.
import { spawnSync } from "node:child_process";
import { stripAppVariables } from "../app-variables.mjs";

const env = stripAppVariables({ ...process.env });
const run = (command) => {
  const result = spawnSync(command, { stdio: "inherit", shell: true, env });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm --filter @my-surveys/web build");
run(["playwright test", ...process.argv.slice(2)].join(" "));
