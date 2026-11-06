// `prepare` script: point git at the tracked hooks in .githooks. Does nothing, and never fails, outside a git
// work tree, in CI, or without git (the Docker image build has no .git and no git binary).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** @param {{ inWorkTree: boolean, ci: string | undefined, hasGit: boolean }} probes */
export function shouldInstallHooks({ inWorkTree, ci, hasGit }) {
  return hasGit && inWorkTree && !ci;
}

/** @param {string[]} args */
function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

export function installHooks() {
  try {
    const hasGit = git(["--version"]) !== null;
    const inWorkTree = hasGit && git(["rev-parse", "--is-inside-work-tree"]) === "true";
    if (shouldInstallHooks({ hasGit, inWorkTree, ci: process.env.CI })) {
      git(["config", "core.hooksPath", ".githooks"]);
    }
  } catch {
    // never fail an install
  }
}

// Run directly (`node scripts/git-hooks/install.mjs`); `prepare` imports and calls installHooks() instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) installHooks();
