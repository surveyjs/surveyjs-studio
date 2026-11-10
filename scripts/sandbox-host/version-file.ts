// The sandbox build's version.json: which commit, which seed data version and which base path are
// live. Only Node built-ins and a minimal plugin type (the root has no vite): web's Docker build
// installs just the web workspace.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO_ROOT = new URL("../../", import.meta.url);
const SEED = new URL("web/src/sandbox/seed.json", REPO_ROOT);

export function versionFileContent(commit: string, dataVersion: number, base: string): string {
  return JSON.stringify({ commit, dataVersion, base }) + "\n";
}

/** SANDBOX_COMMIT if set, else the git head, else "unknown" (no git, no checkout). Trimmed. */
export function resolveCommit(env: NodeJS.ProcessEnv, gitHead: () => string): string {
  const fromEnv = env["SANDBOX_COMMIT"]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return gitHead().trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function gitHead(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** The part of a Vite plugin this one uses; Vite's own `Plugin` accepts it. */
export interface VersionFilePlugin {
  name: string;
  generateBundle(this: {
    emitFile(file: { type: "asset"; fileName: string; source: string }): string;
  }): void;
}

export interface VersionFileOptions {
  /** Vite's `base` (base-path.ts). */
  readonly base: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly gitHead?: () => string;
}

/**
 * Emits version.json: the commit, the seed's data version (a reset offer keys on it) and the base
 * path the build was made for (`pnpm sandbox:serve` refuses a build for another base).
 */
export function sandboxVersionPlugin({
  base,
  env = process.env,
  gitHead: head = gitHead,
}: VersionFileOptions): VersionFilePlugin {
  return {
    name: "sandbox-version-file",
    generateBundle() {
      const { version } = JSON.parse(readFileSync(SEED, "utf8")) as { version: number };
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: versionFileContent(resolveCommit(env, head), version, base),
      });
    },
  };
}
