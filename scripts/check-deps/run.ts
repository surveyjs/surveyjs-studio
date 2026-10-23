import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dockerfileNodeProblems, dockerignoreProblems } from "./dockerfile.js";
import { checkDependencies, type Manifest, type PackageJson } from "./check-deps.js";

export interface RunResult {
  code: 0 | 1;
  stdout: string[];
  stderr: string[];
}

class UsageError extends Error {}

/** Reads the `packages:` list of pnpm-workspace.yaml (plain block `- dir` entries only). */
export function parseWorkspaceDirs(yaml: string): string[] {
  const dirs: string[] = [];
  let inPackages = false;
  for (const line of yaml.split(/\r?\n/)) {
    if (/^packages:\s*[^\s#]/.test(line)) {
      throw new UsageError(
        "pnpm-workspace.yaml: only block-style `packages:` lists are supported (no flow style)",
      );
    }
    if (/^packages:\s*(#.*)?$/.test(line)) {
      inPackages = true;
    } else if (inPackages) {
      const entry = /^\s+-\s+["']?([^"'#\s]+)["']?\s*(#.*)?$/.exec(line);
      if (entry?.[1]) {
        if (/[*?[\]{}!]/.test(entry[1])) {
          throw new UsageError(
            `pnpm-workspace.yaml: glob entry "${entry[1]}" is not supported; list package directories explicitly`,
          );
        }
        dirs.push(entry[1]);
      } else if (/^\S/.test(line)) {
        inPackages = false;
      }
    }
  }
  return dirs;
}

function readManifest(root: string, dir: string): Manifest {
  const file = join(root, dir, "package.json");
  const path = relative(root, file).replaceAll("\\", "/");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`${path}: cannot read file (does the workspace package exist?)`);
  }
  try {
    return { path, json: JSON.parse(text) as PackageJson };
  } catch {
    throw new UsageError(`${path}: malformed JSON`);
  }
}

function readText(file: string, label: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new UsageError(`${label}: cannot read file`);
  }
}

function readOptional(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

export function run(root: string): RunResult {
  try {
    const workspace = readText(join(root, "pnpm-workspace.yaml"), "pnpm-workspace.yaml");
    const dirs = [".", ...parseWorkspaceDirs(workspace)];
    const manifests = dirs.map((dir) => readManifest(root, dir));
    const violations = checkDependencies(manifests);
    if (violations.length > 0) {
      return {
        code: 1,
        stdout: [],
        stderr: violations.map((v) => `${v.file}: ${v.dependency}@${v.version} violates ${v.rule}`),
      };
    }
    const dockerfile = readOptional(join(root, "Dockerfile"));
    if (dockerfile !== undefined) {
      const dockerignore = readOptional(join(root, ".dockerignore"));
      const problems = [
        ...dockerfileNodeProblems(dockerfile, readText(join(root, ".nvmrc"), ".nvmrc")),
        ...(dockerignore === undefined
          ? [
              ".dockerignore: missing next to the Dockerfile (the build context would hold every file)",
            ]
          : dockerignoreProblems(dockerignore)),
      ];
      if (problems.length > 0) return { code: 1, stdout: [], stderr: problems };
    }
    return { code: 0, stdout: [`check:deps OK (${manifests.length} manifests)`], stderr: [] };
  } catch (error) {
    if (error instanceof UsageError) {
      return { code: 1, stdout: [], stderr: [`check:deps error: ${error.message}`] };
    }
    throw error;
  }
}
