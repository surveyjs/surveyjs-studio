import { describe, expect, it } from "vitest";
import { runCheck, type CheckDeps } from "./check.js";

const files = [
  { path: "web/src/shell/example/A.tsx", content: "a" },
  { path: "web/src/shell/example/B.tsx", content: "b" },
];

function fakeDeps(overrides: Partial<CheckDeps> = {}) {
  const calls: string[] = [];
  const deps: CheckDeps = {
    addWorktree: () => (calls.push("add"), "/scratch"),
    removeWorktree: (dir) => void calls.push(`remove ${dir}`),
    write: (_dir, file) => void calls.push(`write ${file.path}`),
    applyPatch: () => void calls.push("apply"),
    run: (_dir, cmd) => (calls.push(`run ${cmd.join(" ")}`), 0),
    ...overrides,
  };
  return { calls, deps };
}

describe("runCheck", () => {
  it("adds, writes, applies, installs, typechecks, tests, then removes", () => {
    const { calls, deps } = fakeDeps();
    expect(runCheck(deps, { files, patch: "p" })).toBe(0);
    expect(calls).toEqual([
      "add",
      "write web/src/shell/example/A.tsx",
      "write web/src/shell/example/B.tsx",
      "apply",
      "run pnpm install --frozen-lockfile --offline",
      "run pnpm --filter @surveyjs-studio/web typecheck",
      "run pnpm exec vitest run web/src/shell/example",
      "remove /scratch",
    ]);
  });

  it("installs without --offline when the offline install fails", () => {
    const { calls, deps } = fakeDeps({
      run: (_dir, cmd) => (calls.push(`run ${cmd.join(" ")}`), cmd.includes("--offline") ? 1 : 0),
    });
    expect(runCheck(deps, { files, patch: "p" })).toBe(0);
    expect(calls).toContain("run pnpm install --frozen-lockfile");
  });

  it("removes the worktree and fails when the patch does not apply", () => {
    const { calls, deps } = fakeDeps({
      applyPatch: () => {
        throw new Error("patch does not apply");
      },
    });
    expect(runCheck(deps, { files, patch: "p" })).not.toBe(0);
    expect(calls.at(-1)).toBe("remove /scratch");
    expect(calls.some((call) => call.startsWith("run "))).toBe(false);
  });

  it("skips the tests when the typecheck fails, and still removes the worktree", () => {
    const { calls, deps } = fakeDeps({
      run: (_dir, cmd) => (calls.push(`run ${cmd.join(" ")}`), cmd.includes("typecheck") ? 1 : 0),
    });
    expect(runCheck(deps, { files, patch: "p" })).toBe(1);
    expect(calls).not.toContain("run pnpm exec vitest run web/src/shell/example");
    expect(calls.at(-1)).toBe("remove /scratch");
  });

  it("removes nothing when the worktree could not be added", () => {
    const { calls, deps } = fakeDeps({
      addWorktree: () => {
        throw new Error("no git");
      },
    });
    expect(runCheck(deps, { files, patch: "p" })).not.toBe(0);
    expect(calls).toEqual([]);
  });
});
