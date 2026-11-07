// A git merge driver for Markdown. Prettier pads every table to its widest cell, so a change to one cell can re-pad
// the whole table; two branches that each touch a table then conflict on every row. This driver drops the padding
// from the three versions, runs git's own 3-way merge on them, and formats a clean result with Prettier. Tables then
// conflict only where both sides changed the same row.
//
// .gitattributes routes *.md here (`merge=markdown-tables`); `node scripts/git-merge/markdown-tables.mjs --install`
// defines the driver in .git/config. Without that definition git uses its normal text merge. The driver also falls
// back to the normal merge when Prettier cannot be loaded or ignores the file.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DRIVER_NAME = "markdown-tables";
export const DRIVER_COMMAND = "node scripts/git-merge/markdown-tables.mjs %O %A %B %L %P";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const DELIMITER_ROW = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;

/** One table row without its padding. An unescaped `|` always ends a cell in GFM, even inside a code span. */
export function compactRow(/** @type {string} */ line) {
  if (DELIMITER_ROW.test(line)) return line.replace(/\s*(:?)-+(:?)\s*(?=\|)/g, " $1---$2 ");
  return line.replace(/(?<=\S) {2,}(?=\|)/g, " ").replace(/(?<!\\)\| {2,}/g, "| ");
}

/** The text with every table row outside fenced code blocks compacted. */
export function compactTables(/** @type {string} */ text) {
  /** @type {string | null} */
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line)?.[1];
      if (fence === null && marker !== undefined) {
        fence = marker;
        return line;
      }
      if (fence !== null) {
        const closes =
          marker !== undefined &&
          marker[0] === fence[0] &&
          marker.length >= fence.length &&
          line.trim() === marker;
        if (closes) fence = null;
        return line;
      }
      return TABLE_ROW.test(line) ? compactRow(line) : line;
    })
    .join("\n");
}

/** Prettier from this repository, or null when it is not installed. */
async function loadPrettier(/** @type {string} */ root) {
  try {
    const require = createRequire(join(root, "package.json"));
    const module = await import(pathToFileURL(require.resolve("prettier")).href);
    // The CommonJS entry (what require.resolve finds) has its API on `default` under plain Node.
    return module.default ?? module;
  } catch {
    return null;
  }
}

/** git merge-file on three files; the result goes into `current`. Returns the number of conflicts. */
function mergeFile(
  /** @type {string} */ current,
  /** @type {string} */ base,
  /** @type {string} */ other,
  /** @type {string} */ markerSize,
) {
  const result = spawnSync(
    "git",
    [
      "merge-file",
      `--marker-size=${markerSize}`,
      "-L",
      "ours",
      "-L",
      "base",
      "-L",
      "theirs",
      current,
      base,
      other,
    ],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status === null || result.status < 0 || result.status > 127)
    throw new Error(`git merge-file failed: ${result.stderr}`);
  return result.status;
}

/**
 * Merges `other` into `current` with `base` as the common ancestor, ignoring table padding. `path` is the file's
 * path in the repository, for Prettier's settings and ignore file. Returns the number of conflicts (0 when clean).
 * @param {{ base: string, current: string, other: string, markerSize?: string, path: string, root: string }} args
 */
export async function mergeMarkdown({ base, current, other, markerSize = "7", path, root }) {
  const prettier = await loadPrettier(root);
  const absolute = resolve(root, path);
  const formattable =
    prettier !== null &&
    (await prettier
      .getFileInfo(absolute, { ignorePath: join(root, ".prettierignore") })
      .then((/** @type {{ ignored: boolean }} */ info) => !info.ignored)
      .catch(() => false));
  if (!formattable) return mergeFile(current, base, other, markerSize);

  for (const file of [base, current, other])
    writeFileSync(file, compactTables(readFileSync(file, "utf8")));
  const conflicts = mergeFile(current, base, other, markerSize);
  if (conflicts === 0) {
    const options = (await prettier.resolveConfig(absolute)) ?? {};
    const merged = readFileSync(current, "utf8");
    writeFileSync(current, await prettier.format(merged, { ...options, filepath: absolute }));
  }
  return conflicts;
}

/** Defines the driver in this clone's .git/config. Returns false when git refuses. */
export function installDriver(/** @type {string} */ root) {
  const set = (/** @type {string} */ key, /** @type {string} */ value) =>
    spawnSync("git", ["config", key, value], { cwd: root }).status === 0;
  return (
    set(`merge.${DRIVER_NAME}.name`, "Markdown, ignoring table padding") &&
    set(`merge.${DRIVER_NAME}.driver`, DRIVER_COMMAND)
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = process.cwd();
  const args = process.argv.slice(2);
  if (args[0] === "--install") {
    if (!installDriver(root)) {
      console.error(`could not define the ${DRIVER_NAME} merge driver`);
      process.exitCode = 1;
    }
  } else {
    const [base, current, other, markerSize, path] = args;
    if (!base || !current || !other || !markerSize || !path) {
      console.error(`usage: ${DRIVER_COMMAND} (from .git/config), or --install`);
      process.exit(2);
    }
    try {
      const conflicts = await mergeMarkdown({ base, current, other, markerSize, path, root });
      process.exitCode = conflicts === 0 ? 0 : 1;
    } catch (error) {
      console.error(`${DRIVER_NAME}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 2;
    }
  }
}
