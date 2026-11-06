// Which program runs the scan. The staged (pre-commit) scan prefers a gitleaks binary on PATH, then Docker, and
// is skipped with a warning when neither exists; the other modes need Docker and fail without it.
export const SKIP_WARNING =
  "secrets scan skipped: neither gitleaks nor Docker is available; CI will scan";

export type Runner = "gitleaks" | "docker" | "skip";

export function chooseRunner(probes: {
  staged: boolean;
  hasGitleaks: boolean;
  dockerWorks: boolean;
}): Runner {
  if (!probes.staged) return "docker";
  if (probes.hasGitleaks) return "gitleaks";
  return probes.dockerWorks ? "docker" : "skip";
}

/** The gitleaks arguments of the staged scan, run with the repository root as the working directory. */
export function gitleaksNativeArgs(): string[] {
  return [
    "git",
    "--pre-commit",
    "--staged",
    "--redact",
    "--gitleaks-ignore-path=.gitleaksignore",
    "--no-banner",
    "--verbose", // print each (redacted) finding, so a blocked commit says why
  ];
}
