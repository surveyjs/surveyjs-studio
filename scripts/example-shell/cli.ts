// `pnpm check:example-shell`: applies the example shell in docs/customizing/shells.md to a scratch git
// worktree of HEAD, then typechecks and tests it there (check.ts). The working tree is never touched.
// Exit 0 when it passes, 1 when it does not.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheck, type CheckDeps } from "./check.js";
import { extractGuide } from "./extract.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Runs a command with its output shown; pnpm is a .cmd shim on Windows, which only a shell runs. */
function run(cwd: string, cmd: string[]): number {
  const [file, ...args] = cmd as [string, ...string[]];
  const result =
    process.platform === "win32" && file === "pnpm"
      ? spawnSync([file, ...args.map((arg) => JSON.stringify(arg))].join(" "), {
          cwd,
          stdio: "inherit",
          shell: true,
        })
      : spawnSync(file, args, { cwd, stdio: "inherit" });
  if (result.error) console.error(`Cannot run ${file}: ${result.error.message}`);
  return result.status ?? 1;
}

function git(cwd: string, args: string[], input?: string): void {
  const result = spawnSync("git", args, { cwd, input, stdio: ["pipe", "inherit", "inherit"] });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

const deps: CheckDeps = {
  addWorktree() {
    const dir = join(tmpdir(), `example-shell-${randomBytes(4).toString("hex")}`);
    git(root, ["worktree", "add", "--detach", dir, "HEAD"]);
    return dir;
  },
  removeWorktree(dir) {
    // Cleanup runs after a failure too, so nothing here throws. Git cannot delete a node_modules
    // tree of links on Windows: Node's rmSync can, and `prune` then forgets the worktree.
    const removed = spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: root });
    if (removed.status !== 0) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    spawnSync("git", ["worktree", "prune"], { cwd: root });
    if (existsSync(dir))
      console.error(`Could not remove the scratch worktree ${dir}: remove it by hand.`);
  },
  write(dir, file) {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  },
  applyPatch(dir, patch) {
    git(dir, ["apply", "--whitespace=nowarn", "-"], patch);
  },
  run,
};

const guidePath = process.argv[2] ?? join(root, "docs/customizing/shells.md");
let code: number;
try {
  code = runCheck(deps, extractGuide(readFileSync(guidePath, "utf8")));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  code = 1;
}
console.log(
  code === 0 ? "The example shell builds and passes its test." : "The example shell check failed.",
);
process.exitCode = code;
