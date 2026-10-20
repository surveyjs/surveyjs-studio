// `pnpm visual:capture` entry (a person runs it, never CI): signs in to surveyjs.io in a headed
// browser, then captures the baselines read only. The sign-in state is deleted at the end unless
// `--keep-sign-in` is given. Exit codes: Playwright's, or 2 when refused.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripAppVariables } from "../app-variables.mjs";

const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

if (process.env["CI"]) {
  console.error("pnpm visual:capture is run by a person, never in CI.");
  process.exit(2);
}

if (args.includes("--checklist")) {
  const result = spawnSync("node --import tsx visual/capture/print-checklist.ts", {
    stdio: "inherit",
    shell: true,
    cwd: e2eDir,
  });
  process.exit(result.status ?? 1);
}

const keepSignIn = args.includes("--keep-sign-in");
const passThrough = args.filter((arg) => arg !== "--keep-sign-in");
const authDir = resolve(e2eDir, "visual/.auth");
const quote = (arg) => (/^[\w./:=@-]+$/.test(arg) ? arg : JSON.stringify(arg));

console.log(
  [
    "What will happen:",
    "- A browser window opens surveyjs.io.",
    "- You sign in yourself, with the dedicated visual account.",
    "- Nothing is changed on the site: the script only reads (any write request is blocked).",
    keepSignIn
      ? "- The sign-in state stays in e2e/visual/.auth/ (--keep-sign-in)."
      : "- The sign-in state is deleted at the end.",
    "",
  ].join("\n"),
);

const cleanup = () => {
  if (!keepSignIn) rmSync(authDir, { recursive: true, force: true });
};

const child = spawn(
  ["playwright test -c playwright.capture.config.ts", ...passThrough.map(quote)].join(" "),
  { stdio: "inherit", shell: true, cwd: e2eDir, env: stripAppVariables({ ...process.env }) },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on("error", (error) => {
  console.error(error);
  cleanup();
  process.exit(1);
});
child.on("close", (code) => {
  cleanup();
  process.exit(code ?? 1);
});
