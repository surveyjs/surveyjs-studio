// Pulls the example shell out of docs/customizing/shells.md: each `<!-- file: <path> -->` comment
// precedes a fenced block with that file's content, and one `<!-- patch -->` comment precedes the
// `diff` block that adds the shell to the registry.
export interface GuideFile {
  path: string;
  content: string;
}

export interface Guide {
  files: GuideFile[];
  patch: string;
}

const EXAMPLE_DIR = "web/src/shell/example/";
const MARKER = /^<!--\s*(file:\s*(.+?)|patch)\s*-->\s*$/;

/** The block after line `at`: skips blank lines, then reads the fence up to its closing fence. */
function readFence(lines: string[], at: number, what: string): { body: string; next: number } {
  let i = at + 1;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const open = /^(`{3,})/.exec(lines[i] ?? "");
  if (!open) throw new Error(`${what} is not followed by a code block`);
  const close = open[1]!;
  const body: string[] = [];
  for (i++; i < lines.length && lines[i]!.trim() !== close; i++) body.push(lines[i]!);
  if (i >= lines.length) throw new Error(`The code block after ${what} is not closed`);
  return { body: body.map((line) => `${line}\n`).join(""), next: i + 1 };
}

export function extractGuide(markdown: string): Guide {
  const lines = markdown.split(/\r?\n/);
  const files: GuideFile[] = [];
  const patches: string[] = [];
  for (let i = 0; i < lines.length;) {
    const marker = MARKER.exec(lines[i]!);
    if (!marker) {
      i++;
      continue;
    }
    const path = marker[2];
    const { body, next } = readFence(lines, i, marker[0].trim());
    if (path === undefined) {
      patches.push(body);
    } else {
      if (!path.startsWith(EXAMPLE_DIR) || path.split("/").includes("..")) {
        throw new Error(`The file ${path} must be inside ${EXAMPLE_DIR}`);
      }
      files.push({ path, content: body });
    }
    i = next;
  }
  if (patches.length !== 1) {
    throw new Error(`The guide needs exactly one patch block, found ${patches.length}`);
  }
  return { files, patch: patches[0]! };
}
