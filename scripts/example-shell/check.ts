// The check behind `pnpm check:example-shell`: the guide's example shell is applied to a scratch
// copy of the repository, typechecked and tested there. The steps are injected, so the cleanup is
// testable: the scratch worktree is removed whatever happens.
import type { Guide, GuideFile } from "./extract.js";

export interface CheckDeps {
  addWorktree(): string;
  removeWorktree(dir: string): void;
  write(dir: string, file: GuideFile): void;
  applyPatch(dir: string, patch: string): void;
  /** Runs a command in `dir`; returns its exit code. */
  run(dir: string, cmd: string[]): number;
}

const INSTALL = ["pnpm", "install", "--frozen-lockfile"];
const STEPS: string[][] = [
  ["pnpm", "--filter", "@surveyjs-studio/web", "typecheck"],
  ["pnpm", "exec", "vitest", "run", "web/src/shell/example"],
];

/** Returns the exit code: 0 when the guide's code applies, typechecks and passes its test. */
export function runCheck(deps: CheckDeps, guide: Guide): number {
  let dir: string;
  try {
    dir = deps.addWorktree();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  try {
    for (const file of guide.files) deps.write(dir, file);
    deps.applyPatch(dir, guide.patch);
    // The store usually has everything already; fall back to the network when it does not.
    if (deps.run(dir, [...INSTALL, "--offline"]) !== 0) {
      const code = deps.run(dir, INSTALL);
      if (code !== 0) return code;
    }
    for (const step of STEPS) {
      const code = deps.run(dir, step);
      if (code !== 0) return code;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    deps.removeWorktree(dir);
  }
}
