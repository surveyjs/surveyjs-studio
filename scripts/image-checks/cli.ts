// `pnpm image:checks --image <tag> [--previous <tag>] [--only <check>[,<check>]]`: the self-hosted
// image as a self-hosting admin uses it (checks.ts). Prints `PASS <name>`, `FAIL <name>: <reason>`
// or `SKIP <name>: <reason>` per check. Exit 0 when none fails, 1 when one does, 2 on usage errors.
import { randomBytes } from "node:crypto";
import { CHECKS, CheckFailure, Run, parseCheckArgs } from "./checks.js";
import { docker, lastLine } from "./docker.js";

const parsed = parseCheckArgs(process.argv.slice(2));
if (!parsed.ok) {
  (parsed.exitCode === 0 ? console.log : console.error)(parsed.message);
  process.exit(parsed.exitCode);
}
const { options } = parsed;

const run = new Run(randomBytes(3).toString("hex"));

function cleanUp(): boolean {
  const left = run.cleanup();
  for (const resource of left) console.error(`Left behind: ${resource} (remove it by hand)`);
  return left.length === 0;
}

// Ctrl+C (or a stop from CI): nothing of the run may stay behind.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.error(`\nStopped (${signal}): removing the run's containers, volumes and networks.`);
    cleanUp();
    process.exit(130);
  });
}

const present = await docker(["image", "inspect", "-f", "{{.Id}}", options.image]);
if (present.code !== 0) {
  console.error(`Cannot use the image ${options.image}: ${lastLine(present.stderr)}`);
  console.error("Build it first, e.g. pnpm image:build:self-hosted.");
  process.exit(1);
}

console.log(`Image checks of ${options.image} (run ${run.id}): ${options.only.join(", ")}`);
const started = performance.now();
const timings: string[] = [];
let failures = 0;
for (const name of options.only) {
  const checkStarted = performance.now();
  try {
    const result = await CHECKS[name](run, options);
    console.log(result.status === "pass" ? `PASS ${name}` : `SKIP ${name}: ${result.reason}`);
  } catch (error) {
    failures++;
    const reason =
      error instanceof CheckFailure
        ? error.message
        : `unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    console.log(`FAIL ${name}: ${reason}`);
    for (const file of run.saveLogs(name)) console.log(`  log: ${file}`);
  }
  run.cleanup(`${run.prefix}${name}-`);
  timings.push(`${name} ${seconds(checkStarted)}`);
}

const clean = cleanUp();
console.log(`Timings: ${timings.join(", ")}; total ${seconds(started)}`);
process.exit(failures === 0 && clean ? 0 : 1);

function seconds(since: number): string {
  return `${((performance.now() - since) / 1000).toFixed(1)} s`;
}
