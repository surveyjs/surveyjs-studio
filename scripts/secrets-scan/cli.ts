// `pnpm scan:secrets [--all-refs] [--report <path>]`: Gitleaks over the repository's git history, in Docker
// (args.ts). Exit 0 when no leaks are found, 1 when some are, 2 on usage errors. The report keeps only
// redacted matches; do not commit it.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { gitleaksArgs, parseScanArgs } from "./args.js";

const parsed = parseScanArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`${parsed.message}\nUsage: pnpm scan:secrets [--all-refs] [--report <path>]`);
  process.exit(2);
}

const args = gitleaksArgs({
  repo: resolve("."),
  reportPath: parsed.reportPath === null ? null : resolve(parsed.reportPath),
  allRefs: parsed.allRefs,
});
// Git Bash would otherwise rewrite /repo and /out into Windows paths.
const result = spawnSync("docker", args, {
  stdio: "inherit",
  env: { ...process.env, MSYS_NO_PATHCONV: "1" },
});
if (result.error) {
  console.error(`Cannot run docker: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
