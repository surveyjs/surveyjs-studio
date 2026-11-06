// `pnpm test:conformance [--base <url>] [vitest args]`: the conformance suite. Without --base it starts
// the reference server; with it, the suite runs against that server (CONFORMANCE_BASE_URL).
// `reference-env --port <n> --out <file>` writes the reference settings as NAME=value lines for
// `docker run --env-file`. Exit codes: the suite's, or 2 on usage errors.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { referenceEnv } from "../../conformance-tests/src/reference-settings.js";
import { UsageError, parseConformanceArgs } from "./args.js";

function value(args: string[], name: string): string {
  const at = args.indexOf(name);
  const found = at === -1 ? undefined : args[at + 1];
  if (found === undefined || found.startsWith("--")) throw new UsageError(`${name} needs a value`);
  return found;
}

function writeReferenceEnv(args: string[]): void {
  const port = Number(value(args, "--port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UsageError("--port must be a port number");
  }
  const lines = Object.entries(referenceEnv(port)).map(([name, setting]) => `${name}=${setting}`);
  writeFileSync(value(args, "--out"), `${lines.join("\n")}\n`);
}

function runSuite(argv: string[]): number {
  const { baseUrl, rest } = parseConformanceArgs(argv);
  const env = { ...process.env };
  if (baseUrl !== null) env.CONFORMANCE_BASE_URL = baseUrl;
  const pnpmArgs = [
    "--filter",
    "@surveyjs-studio/conformance-tests",
    "test",
    ...(rest.length ? ["--", ...rest] : []),
  ];
  // pnpm is a .cmd shim on Windows, which only a shell runs; there the arguments are quoted into one command.
  const result =
    process.platform === "win32"
      ? spawnSync(["pnpm", ...pnpmArgs.map((arg) => JSON.stringify(arg))].join(" "), {
          stdio: "inherit",
          env,
          shell: true,
        })
      : spawnSync("pnpm", pnpmArgs, { stdio: "inherit", env, shell: false });
  if (result.error) {
    console.error(`Cannot run pnpm: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

try {
  const argv = process.argv.slice(2);
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args[0] === "reference-env") {
    writeReferenceEnv(args.slice(1));
  } else {
    process.exitCode = runSuite(argv);
  }
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(
    `${error.message}\nUsage: pnpm test:conformance [--base <url>] [vitest args]\n       reference-env --port <n> --out <file>`,
  );
  process.exitCode = 2;
}
