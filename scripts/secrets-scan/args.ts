// The `docker run` arguments (without the leading `docker`) of the secrets scan, and the CLI's own flags.
export const GITLEAKS_IMAGE =
  "zricethezav/gitleaks:v8.24.0@sha256:2bcceac45179b3a91bff11a824d0fb952585b429e54fc928728b1d4d5c3e5176";

export interface ScanOptions {
  repo: string;
  /** Where the JSON report goes; null for no report file. */
  reportPath: string | null;
  /** Scan every ref (all branches and tags) instead of the checked-out history. */
  allRefs: boolean;
  /** Scan the staged changes (the pre-commit hook) instead of history. Never writes a report. */
  staged: boolean;
  /** `uid:gid` for `docker run --user`, so git in the container can read a mount another user owns; null for none. */
  user: string | null;
}

/** The `--user` value on a non-Windows host (as CI does); null on Windows or when the ids are unavailable. */
export function dockerUser(
  platform: string,
  getuid: (() => number) | undefined,
  getgid: (() => number) | undefined,
): string | null {
  if (platform === "win32" || getuid === undefined || getgid === undefined) return null;
  return `${getuid()}:${getgid()}`;
}

function splitPath(path: string): { dir: string; file: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { dir: path.slice(0, Math.max(cut, 0)) || ".", file: path.slice(cut + 1) };
}

export function gitleaksArgs({ repo, reportPath, allRefs, staged, user }: ScanOptions): string[] {
  const args = ["run", "--rm"];
  if (user !== null) args.push("--user", user);
  args.push("-v", `${repo}:/repo:ro`);
  if (reportPath !== null && !staged) {
    const { dir } = splitPath(reportPath);
    args.push("-v", `${dir}:/out`);
  }
  args.push(GITLEAKS_IMAGE, "git", "/repo");
  if (staged) args.push("--pre-commit", "--staged", "--verbose");
  // gitleaks without --log-opts already walks every ref (`git log -p -U0 --full-history --all`), so
  // the checked-out history is HEAD explicitly.
  else args.push(allRefs ? "--log-opts=--all" : "--log-opts=HEAD");
  args.push(
    "--redact",
    "--gitleaks-ignore-path=/repo/.gitleaksignore",
    "--config=/repo/.gitleaks.toml",
    "--no-banner",
  );
  if (reportPath !== null && !staged) {
    args.push("--report-format", "json", "--report-path", `/out/${splitPath(reportPath).file}`);
  }
  return args;
}

export type ParsedScanArgs =
  | { ok: true; allRefs: boolean; staged: boolean; reportPath: string | null }
  | { ok: false; message: string };

export function parseScanArgs(argv: string[]): ParsedScanArgs {
  let allRefs = false;
  let staged = false;
  let reportPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--")
      continue; // pnpm forwards the separator from the script
    else if (arg === "--all-refs") allRefs = true;
    else if (arg === "--staged") staged = true;
    else if (arg === "--report") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--"))
        return { ok: false, message: "--report needs a file path." };
      reportPath = value;
    } else return { ok: false, message: `Unknown argument ${arg}.` };
  }
  if (staged && (allRefs || reportPath !== null))
    return { ok: false, message: "--staged cannot be combined with --all-refs or --report." };
  return { ok: true, allRefs, staged, reportPath };
}
