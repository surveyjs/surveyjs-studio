import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionEntry } from "./mapping.js";

// The migration guide's table of actions must list exactly the bridge's mapping table (ADR 0040
// point 5): the guide and the code say the same. The bare path has no operation and answers every
// method, so its row reads `any` and `none`.

const GUIDE = new URL("../../docs/api/migrating-from-api-surveyjs-io.md", import.meta.url);
const HEADING = "## Every action and its operations";

interface Row {
  action: string;
  methods: string;
  operations: string;
}

/** What the guide's row of an entry must say in its first three columns. */
function expectedRow(entry: ActionEntry): Row {
  const prefix = entry.controller === "public" ? "public/Survey" : "private/Surveys";
  return {
    action: entry.action === "(root)" ? prefix : `${prefix}/${entry.action}`,
    methods: entry.methods.length > 4 ? "any" : entry.methods.join(", "),
    operations: entry.studio.length === 0 ? "none" : entry.studio.join(", "),
  };
}

/** The data rows of the first table under the heading. */
function guideRows(markdown: string): Row[] {
  const start = markdown.indexOf(HEADING);
  expect(start, `the guide has the heading "${HEADING}"`).toBeGreaterThanOrEqual(0);
  const lines: string[] = [];
  for (const line of markdown.slice(start + HEADING.length).split(/\r?\n/)) {
    if (line.startsWith("|")) lines.push(line);
    else if (lines.length > 0) break;
  }
  // The header and the separator line come first.
  return lines.slice(2).map((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/`/g, ""));
    const [action = "", methods = "", operations = ""] = cells;
    return { action, methods, operations };
  });
}

describe("the migration guide", () => {
  it("lists exactly the rows of the bridge's mapping table", async () => {
    const markdown = await readFile(GUIDE, "utf8");
    const rows = guideRows(markdown);
    expect(rows).toEqual(ACTIONS.map(expectedRow));
  });
});
