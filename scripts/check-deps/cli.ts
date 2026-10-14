import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDependencies, type Manifest, type PackageJson } from "./check-deps.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Reads the `packages:` list of pnpm-workspace.yaml (plain `- dir` entries only). */
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  let inPackages = false;
  for (const line of readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
    } else if (inPackages) {
      const entry = /^\s+-\s+["']?([^"'#\s]+)["']?\s*(#.*)?$/.exec(line);
      if (entry?.[1]) dirs.push(entry[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return dirs;
}

const manifests: Manifest[] = [".", ...workspaceDirs()].map((dir) => {
  const file = join(root, dir, "package.json");
  return {
    path: relative(root, file).replaceAll("\\", "/"),
    json: JSON.parse(readFileSync(file, "utf8")) as PackageJson,
  };
});

const violations = checkDependencies(manifests);
if (violations.length > 0) {
  for (const v of violations) {
    console.error(`${v.file}: ${v.dependency}@${v.version} violates ${v.rule}`);
  }
  process.exit(1);
}
console.log(`check:deps OK (${manifests.length} manifests)`);
