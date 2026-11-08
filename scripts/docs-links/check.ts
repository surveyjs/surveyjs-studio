// The Markdown link check behind `pnpm check:docs-links`: relative links must reach a file or folder
// that exists, and a `#fragment` must match a heading of the target, slugged as GitHub does.
import { posix } from "node:path";

export interface LinkProblem {
  readonly file: string;
  readonly link: string;
  readonly reason: "missing-file" | "missing-anchor";
}

export interface CheckOptions {
  /** Whether a repo path outside `files` (a file or a folder) exists. Default: nothing does. */
  readonly exists?: (path: string) => boolean;
  /** The text of a Markdown file outside `files`, to check anchors into it. Default: none. */
  readonly read?: (path: string) => string | undefined;
}

/** GitHub's heading anchor: lower case, markup and punctuation dropped, spaces to hyphens. */
export function githubSlug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Text outside code fences, line by line: fenced lines come back empty. */
function proseLines(markdown: string): string[] {
  let fence: string | null = null;
  return markdown.split(/\r?\n/).map((line) => {
    const marker = /^\s{0,3}(```+|~~~+)/.exec(line)?.[1];
    if (fence === null) {
      if (marker) fence = marker[0]!;
      return marker ? "" : line;
    }
    if (marker && marker[0] === fence) fence = null;
    return "";
  });
}

/** Every anchor a file's headings define; a repeated heading gains `-1`, `-2`, and so on. */
export function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const line of proseLines(markdown)) {
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const slug = githubSlug(heading);
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return anchors;
}

/** The link targets of a file, outside code. */
function linksOf(markdown: string): string[] {
  const links: string[] = [];
  for (const line of proseLines(markdown)) {
    const bare = line.replace(/`+[^`]*`+/g, "x");
    for (const match of bare.matchAll(/\]\(\s*(<[^>]*>|[^)\s]*)[^)]*\)/g)) {
      links.push(match[1]!.replace(/^<|>$/g, ""));
    }
  }
  return links;
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Checks the links of `files` (repo path with `/` -> text). A link to a file outside `files` is
 * found through `options`.
 */
export function checkLinks(
  files: ReadonlyMap<string, string>,
  options: CheckOptions = {},
): LinkProblem[] {
  const problems: LinkProblem[] = [];
  const textOf = (path: string): string | undefined => files.get(path) ?? options.read?.(path);
  for (const [file, text] of files) {
    for (const link of linksOf(text)) {
      if (link === "" || EXTERNAL.test(link)) continue;
      const hash = link.indexOf("#");
      const withoutFragment = hash < 0 ? link : link.slice(0, hash);
      const fragment = hash < 0 ? "" : link.slice(hash + 1);
      const target = withoutFragment.replace(/\?.*$/, "");
      const path =
        target === ""
          ? file
          : posix.normalize(posix.join(posix.dirname(file), decode(target))).replace(/\/$/, "");
      const content = textOf(path);
      if (content === undefined && !files.has(path) && !(options.exists?.(path) ?? false)) {
        problems.push({ file, link, reason: "missing-file" });
        continue;
      }
      if (fragment === "" || !path.endsWith(".md") || content === undefined) continue;
      if (!anchorsOf(content).has(decode(fragment).toLowerCase())) {
        problems.push({ file, link, reason: "missing-anchor" });
      }
    }
  }
  return problems;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
