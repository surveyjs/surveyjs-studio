// Which program runs the scan, and what its exit status means. The staged (pre-commit) scan prefers a gitleaks
// binary on PATH, then Docker, and is skipped with a warning when neither works; the other modes need Docker and
// fail without it.
export const SKIP_WARNING =
  "secrets scan skipped: neither gitleaks nor Docker is available; CI will scan";
export const DOCKER_WARNING = "secrets scan skipped: Docker could not run the scan; CI will scan";
export const WORKTREE_WARNING =
  "secrets scan skipped: Docker cannot see a linked worktree's git directory (install gitleaks to scan here); CI will scan";

export type Runner = "gitleaks" | "docker" | "skip" | "skip-worktree";

export function chooseRunner(probes: {
  staged: boolean;
  hasGitleaks: boolean;
  dockerWorks: boolean;
  /** `.git` of a linked worktree points outside the directory Docker mounts. */
  linkedWorktree: boolean;
}): Runner {
  if (!probes.staged) return "docker";
  if (probes.hasGitleaks) return "gitleaks";
  if (!probes.dockerWorks) return "skip";
  return probes.linkedWorktree ? "skip-worktree" : "docker";
}

function normalise(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** `git rev-parse --absolute-git-dir` differs from the common dir inside a linked worktree. */
export function isLinkedWorktree(gitDir: string, commonDir: string): boolean {
  return normalise(gitDir) !== normalise(commonDir);
}

/**
 * The exit code of the scan. `docker run` itself exits 125 (daemon error), 126 or 127 (cannot start the
 * container); in staged mode those are infrastructure failures and skip with a warning. Any other non-zero
 * status, gitleaks' 1 included, blocks: a finding and a gitleaks error cannot be told apart.
 */
export function exitOutcome(run: { staged: boolean; runner: Runner; status: number | null }): {
  code: number;
  warning: string | null;
} {
  if (run.status === null) return { code: 1, warning: null };
  if (run.staged && run.runner === "docker" && [125, 126, 127].includes(run.status))
    return { code: 0, warning: DOCKER_WARNING };
  return { code: run.status, warning: null };
}

/** The gitleaks arguments of the staged scan, run with the repository root as the working directory. */
export function gitleaksNativeArgs(): string[] {
  return [
    "git",
    "--pre-commit",
    "--staged",
    "--redact",
    "--gitleaks-ignore-path=.gitleaksignore",
    "--config=.gitleaks.toml",
    "--no-banner",
    "--verbose", // print each (redacted) finding, so a blocked commit says why
  ];
}
