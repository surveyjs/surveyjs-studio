import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Runs the pinned Redocly CLI with the update notice (an npm registry lookup) suppressed.
// Done here rather than in package.json scripts so it works the same on Windows and Linux.
// Telemetry is switched off in redocly.yaml.
const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "node_modules", "@redocly", "cli", "bin", "cli.js");

export function redocly(args: readonly string[]): void {
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, REDOCLY_SUPPRESS_UPDATE_NOTICE: "true", REDOCLY_TELEMETRY: "off" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    redocly(process.argv.slice(2));
  } catch {
    process.exitCode = 1;
  }
}
