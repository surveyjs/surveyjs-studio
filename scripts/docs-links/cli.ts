// `pnpm check:docs-links`: checks the relative links and heading anchors of the public docs (check.ts).
// Exit 0 when every link holds, 1 when one does not. A listed file that does not exist yet is skipped.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkLinks } from "./check.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const LISTED = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/self-hosting.md",
  "docs/operations/going-public.md",
];

function markdownUnder(dir: string): string[] {
  const full = join(root, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

const paths = [...LISTED, ...markdownUnder("docs/customizing")].filter((path) =>
  existsSync(join(root, path)),
);
const files = new Map(paths.map((path) => [path, readFileSync(join(root, path), "utf8")]));

const problems = checkLinks(files, {
  exists: (path) => existsSync(join(root, path)),
  read: (path) => {
    const full = join(root, path);
    return existsSync(full) && statSync(full).isFile() ? readFileSync(full, "utf8") : undefined;
  },
});

for (const { file, link, reason } of problems) {
  console.error(
    `${file}: ${link} (${reason === "missing-file" ? "no such file" : "no such heading"})`,
  );
}
console.log(
  problems.length === 0
    ? `Docs links: ${files.size} files checked, all links hold.`
    : `Docs links: ${problems.length} broken in ${files.size} files.`,
);
process.exit(problems.length === 0 ? 0 : 1);
