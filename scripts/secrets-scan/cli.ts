// `pnpm scan:secrets [--all-refs | --staged] [--report <path>]`: Gitleaks over the repository's git history,
// in Docker (args.ts). `--staged` scans the staged changes, for the pre-commit hook: it uses a gitleaks binary
// on PATH or else Docker, and skips with a warning when neither exists (runner.ts). Exit 0 when no leaks are
// found, 1 when some are, 2 on usage errors. The report keeps only redacted matches; do not commit it.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { dockerUser, gitleaksArgs, parseScanArgs } from "./args.js";
import {
  SKIP_WARNING,
  WORKTREE_WARNING,
  chooseRunner,
  exitOutcome,
  gitleaksNativeArgs,
  isLinkedWorktree,
} from "./runner.js";

function gitOut(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

const parsed = parseScanArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(
    `${parsed.message}\nUsage: pnpm scan:secrets [--all-refs | --staged] [--report <path>]`,
  );
  process.exit(2);
}

const runner = chooseRunner({
  staged: parsed.staged,
  hasGitleaks:
    parsed.staged && spawnSync("gitleaks", ["version"], { stdio: "ignore" }).status === 0,
  // A hung daemon counts as unavailable.
  dockerWorks:
    parsed.staged && spawnSync("docker", ["info"], { stdio: "ignore", timeout: 5000 }).status === 0,
  linkedWorktree:
    parsed.staged &&
    isLinkedWorktree(
      // Resolved by hand: older git has no --path-format. Both may be relative to the working directory.
      resolve(gitOut(["rev-parse", "--git-dir"]) || "."),
      resolve(gitOut(["rev-parse", "--git-common-dir"]) || "."),
    ),
});

if (runner === "skip" || runner === "skip-worktree") {
  console.warn(runner === "skip" ? SKIP_WARNING : WORKTREE_WARNING);
  process.exit(0);
}

const result =
  runner === "gitleaks"
    ? spawnSync("gitleaks", gitleaksNativeArgs(), { stdio: "inherit", cwd: resolve(".") })
    : spawnSync(
        "docker",
        gitleaksArgs({
          repo: resolve("."),
          reportPath: parsed.reportPath === null ? null : resolve(parsed.reportPath),
          allRefs: parsed.allRefs,
          staged: parsed.staged,
          user: dockerUser(
            process.platform,
            process.getuid?.bind(process),
            process.getgid?.bind(process),
          ),
        }),
        // Git Bash would otherwise rewrite /repo and /out into Windows paths.
        { stdio: "inherit", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
      );
if (result.error) {
  console.error(`Cannot run ${runner}: ${result.error.message}`);
  process.exit(1);
}
const outcome = exitOutcome({ staged: parsed.staged, runner, status: result.status });
if (outcome.warning !== null) console.warn(outcome.warning);
process.exit(outcome.code);
