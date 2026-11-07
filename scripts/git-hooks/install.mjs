// `prepare` script: point git at the tracked hooks in .githooks, and define the Markdown merge driver that
// .gitattributes names (scripts/git-merge/markdown-tables.mjs). Does nothing, and never fails, outside this
// repository's git work tree, in CI, or without git (the Docker image build has no .git and no git binary).
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installDriver } from "../git-merge/markdown-tables.mjs";

const HOOKS_DIR = ".githooks";

/** CI counts as set when non-empty and not `false`. @param {string | undefined} ci */
export function isCiSet(ci) {
  return ci !== undefined && ci !== "" && ci.toLowerCase() !== "false";
}

/** @param {string} a @param {string} b @param {string} platform */
export function samePath(a, b, platform) {
  /** @param {string} p */
  const norm = (p) => {
    const q = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return platform === "win32" ? q.toLowerCase() : q;
  };
  return norm(a) === norm(b);
}

/**
 * @param {{ hasGit: boolean, inWorkTree: boolean, ci: string | undefined, atPackageRoot: boolean, currentHooksPath: string | null }} probes
 * @returns {{ action: "install" | "none" } | { action: "keep", message: string }}
 */
export function decideHooks({ hasGit, inWorkTree, ci, atPackageRoot, currentHooksPath }) {
  if (!hasGit || !inWorkTree || !atPackageRoot || isCiSet(ci)) return { action: "none" };
  if (currentHooksPath === null || currentHooksPath === "") return { action: "install" };
  if (currentHooksPath === HOOKS_DIR) return { action: "none" };
  return {
    action: "keep",
    message: `git hooks: core.hooksPath is already "${currentHooksPath}"; not changing it. The pre-commit secrets scan is off; set it to ${HOOKS_DIR} to enable it.`,
  };
}

/** @param {string} root */
const currentHooksPathIsOurs = (root) =>
  git(["config", "--get", "core.hooksPath"], root) === HOOKS_DIR;

/** @param {string[]} args @param {string} cwd */
function git(args, cwd) {
  const result = spawnSync("git", args, { encoding: "utf8", cwd });
  return result.error || result.status !== 0 ? null : result.stdout.trim();
}

export function installHooks() {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const hasGit = git(["--version"], root) !== null;
    const toplevel = hasGit ? git(["rev-parse", "--show-toplevel"], root) : null;
    const decision = decideHooks({
      hasGit,
      inWorkTree: toplevel !== null,
      ci: process.env.CI,
      atPackageRoot: toplevel !== null && samePath(toplevel, root, process.platform),
      currentHooksPath: hasGit ? git(["config", "--get", "core.hooksPath"], root) : null,
    });
    if (decision.action === "keep") console.warn(decision.message);
    else if (
      decision.action === "install" &&
      git(["config", "core.hooksPath", HOOKS_DIR], root) === null
    )
      console.warn("git hooks: could not set core.hooksPath; the pre-commit secrets scan is off.");
    // The merge driver does not depend on core.hooksPath: define it wherever the hooks could be installed.
    if (decision.action !== "none" || currentHooksPathIsOurs(root)) {
      if (!installDriver(root))
        console.warn("git merge: could not define the markdown-tables merge driver.");
    }
  } catch (error) {
    // never fail an install
    console.warn(`git hooks: not installed (${error instanceof Error ? error.message : error}).`);
  }
}

// Run directly (`node scripts/git-hooks/install.mjs`); `prepare` imports and calls installHooks() instead.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) installHooks();
