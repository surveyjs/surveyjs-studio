import { describe, expect, it } from "vitest";
import {
  SKIP_WARNING,
  DOCKER_WARNING,
  WORKTREE_WARNING,
  chooseRunner,
  exitOutcome,
  gitleaksNativeArgs,
  isLinkedWorktree,
} from "./runner.js";

describe("chooseRunner", () => {
  const base = { staged: true, hasGitleaks: false, dockerWorks: true, linkedWorktree: false };
  it("prefers a gitleaks binary on PATH", () => {
    expect(chooseRunner({ ...base, hasGitleaks: true })).toBe("gitleaks");
  });
  it("uses Docker when there is no binary and docker info works", () => {
    expect(chooseRunner(base)).toBe("docker");
  });
  it("skips with a warning in staged mode when neither is available", () => {
    expect(chooseRunner({ ...base, dockerWorks: false })).toBe("skip");
  });
  it("keeps failing on missing Docker in the other modes", () => {
    expect(chooseRunner({ ...base, staged: false, dockerWorks: false })).toBe("docker");
  });
  it("skips under Docker in a linked worktree, whose .git points outside the mount", () => {
    expect(chooseRunner({ ...base, linkedWorktree: true })).toBe("skip-worktree");
  });
  it("still uses a gitleaks binary in a linked worktree", () => {
    expect(chooseRunner({ ...base, linkedWorktree: true, hasGitleaks: true })).toBe("gitleaks");
  });
  it("does not use a PATH binary for the other modes", () => {
    expect(chooseRunner({ ...base, staged: false, hasGitleaks: true })).toBe("docker");
  });
});

describe("gitleaksNativeArgs", () => {
  it("is the staged scan from the repo root", () => {
    expect(gitleaksNativeArgs()).toEqual([
      "git",
      "--pre-commit",
      "--staged",
      "--redact",
      "--gitleaks-ignore-path=.gitleaksignore",
      "--config=.gitleaks.toml",
      "--no-banner",
      "--verbose",
    ]);
  });
});

describe("SKIP_WARNING", () => {
  it("is one line", () => {
    expect(SKIP_WARNING).toBe(
      "secrets scan skipped: neither gitleaks nor Docker is available; CI will scan",
    );
  });
});

describe("isLinkedWorktree", () => {
  it("is true when the git dir is not the common dir", () => {
    expect(isLinkedWorktree("/r/.git/worktrees/w", "/r/.git")).toBe(true);
  });
  it("is false for a normal checkout, however the paths are spelled", () => {
    expect(isLinkedWorktree("/r/.git", "/r/.git")).toBe(false);
    expect(isLinkedWorktree("C:\\r\\.git", "C:/r/.git/")).toBe(false);
  });
});

describe("exitOutcome", () => {
  const docker = { staged: true, runner: "docker" as const };
  it("passes a clean scan and a finding through", () => {
    expect(exitOutcome({ ...docker, status: 0 })).toEqual({ code: 0, warning: null });
    expect(exitOutcome({ ...docker, status: 1 })).toEqual({ code: 1, warning: null });
  });
  it("treats docker run's own failures (125, 126, 127) as a skip in staged mode", () => {
    for (const status of [125, 126, 127])
      expect(exitOutcome({ ...docker, status })).toEqual({ code: 0, warning: DOCKER_WARNING });
  });
  it("keeps those codes as failures outside staged mode and for a gitleaks binary", () => {
    expect(exitOutcome({ staged: false, runner: "docker", status: 125 })).toEqual({
      code: 125,
      warning: null,
    });
    expect(exitOutcome({ staged: true, runner: "gitleaks", status: 127 })).toEqual({
      code: 127,
      warning: null,
    });
  });
  it("fails when the process was killed", () => {
    expect(exitOutcome({ ...docker, status: null })).toEqual({ code: 1, warning: null });
  });
});

describe("warnings", () => {
  it("are one line each", () => {
    for (const w of [DOCKER_WARNING, WORKTREE_WARNING]) {
      expect(w).not.toContain("\n");
      expect(w).toMatch(/^secrets scan skipped: .*CI will scan$/);
    }
  });
});
