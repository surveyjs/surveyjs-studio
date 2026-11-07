import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as prettier from "prettier";
import { afterEach, describe, expect, it } from "vitest";
import {
  compactRow,
  compactTables,
  mergeMarkdown,
  resolveRowInsertions,
} from "./markdown-tables.mjs";

const root = resolve(import.meta.dirname, "..", "..");

describe("compactRow", () => {
  it("drops the padding around cells", () => {
    expect(compactRow("| `pnpm demo`      | Starts the demo     |")).toBe(
      "| `pnpm demo` | Starts the demo |",
    );
    expect(compactRow("|      right |   |")).toBe("| right | |");
  });
  it("shortens the delimiter row and keeps its alignment", () => {
    expect(compactRow("| :------- | -------: | :----: | ---- |")).toBe(
      "| :--- | ---: | :---: | --- |",
    );
  });
  it("keeps an escaped pipe and the indentation of a table in a list", () => {
    expect(compactRow("  | a \\|  b   | c   |")).toBe("  | a \\|  b | c |");
  });
});

describe("compactTables", () => {
  it("leaves text and fenced code alone", () => {
    const text = [
      "Some  text | with a pipe.",
      "",
      "| A    | B   |",
      "| ---- | --- |",
      "| long | x   |",
      "",
      "```text",
      "| kept    | as is |",
      "```",
      "",
      "~~~~",
      "```",
      "| still   | code |",
      "~~~~",
      "| after  | y |",
    ].join("\n");
    expect(compactTables(text)).toBe(
      [
        "Some  text | with a pipe.",
        "",
        "| A | B |",
        "| --- | --- |",
        "| long | x |",
        "",
        "```text",
        "| kept    | as is |",
        "```",
        "",
        "~~~~",
        "```",
        "| still   | code |",
        "~~~~",
        "| after | y |",
      ].join("\n"),
    );
  });
});

describe("resolveRowInsertions", () => {
  const conflict = (ours: string[], base: string[], theirs: string[]) =>
    [
      "before",
      "<<<<<<< ours",
      ...ours,
      "||||||| base",
      ...base,
      "=======",
      ...theirs,
      ">>>>>>> theirs",
      "after",
    ].join("\n");

  it("keeps rows both sides added at the same place, ours first", () => {
    expect(resolveRowInsertions(conflict(["| 0025 | a |"], [], ["| 0032 | b |"]))).toEqual({
      text: "before\n| 0025 | a |\n| 0032 | b |\nafter",
      conflicts: 0,
    });
  });

  it("writes the rows both sides added alike once", () => {
    const { text } = resolveRowInsertions(
      conflict(["| x |", "| 0025 |", "| y |"], [], ["| x |", "| 0032 |", "| y |"]),
    );
    expect(text).toBe("before\n| x |\n| 0025 |\n| 0032 |\n| y |\nafter");
  });

  it("leaves a changed row, or added text, as a conflict without its base section", () => {
    expect(resolveRowInsertions(conflict(["| a | 1 |"], ["| a |"], ["| a | 2 |"]))).toEqual({
      text: "before\n<<<<<<< ours\n| a | 1 |\n=======\n| a | 2 |\n>>>>>>> theirs\nafter",
      conflicts: 1,
    });
    expect(resolveRowInsertions(conflict(["Ours."], [], ["| b |"])).conflicts).toBe(1);
  });

  it("follows the marker size git passes", () => {
    const text = [
      "<<<<<<<<< ours",
      "| a |",
      "|||||||||",
      "=========",
      "| b |",
      ">>>>>>>>> theirs",
    ].join("\n");
    expect(resolveRowInsertions(text, "9")).toEqual({ text: "| a |\n| b |", conflicts: 0 });
  });
});

describe("mergeMarkdown", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const table = async (rows: [string, string][]) =>
    prettier.format(
      [
        "# Scripts",
        "",
        "| Script | What it does |",
        "| --- | --- |",
        ...rows.map(([a, b]) => `| ${a} | ${b} |`),
      ].join("\n"),
      {
        ...(await prettier.resolveConfig(join(root, "docs", "x.md"))),
        filepath: join(root, "docs", "x.md"),
      },
    );

  const files = (base: string, ours: string, theirs: string) => {
    const dir = mkdtempSync(join(tmpdir(), "md-merge-"));
    dirs.push(dir);
    const paths = {
      base: join(dir, "base"),
      current: join(dir, "current"),
      other: join(dir, "other"),
    };
    writeFileSync(paths.base, base);
    writeFileSync(paths.current, ours);
    writeFileSync(paths.other, theirs);
    return paths;
  };

  const one: [string, string] = ["`a`", "One"];
  const two: [string, string] = ["`b`", "Two"];
  const three: [string, string] = ["`c`", "Three"];
  const base = [one, two, three];

  it("merges changes to different rows that re-pad the whole table", async () => {
    const ours = await table([["`a`", "One, now with a much longer description"], two, three]);
    const theirs = await table([one, two, ["`a-much-longer-script-name`", "Three"]]);
    const paths = files(await table(base), ours, theirs);

    const plain = files(await table(base), ours, theirs);
    expect(
      spawnSync("git", ["merge-file", plain.current, plain.base, plain.other]).status,
    ).toBeGreaterThan(0);

    expect(await mergeMarkdown({ ...paths, path: "docs/x.md", root })).toBe(0);
    expect(readFileSync(paths.current, "utf8")).toBe(
      await table([
        ["`a`", "One, now with a much longer description"],
        two,
        ["`a-much-longer-script-name`", "Three"],
      ]),
    );
  });

  it("does the same as the command git runs, under plain Node", async () => {
    const ours = await table([["`a`", "One, now with a much longer description"], two, three]);
    const theirs = await table([one, two, ["`a-much-longer-script-name`", "Three"]]);
    const paths = files(await table(base), ours, theirs);
    const script = join(root, "scripts", "git-merge", "markdown-tables.mjs");
    const run = spawnSync(
      process.execPath,
      [script, paths.base, paths.current, paths.other, "7", "docs/x.md"],
      { cwd: root, encoding: "utf8" },
    );
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(readFileSync(paths.current, "utf8")).toContain(
      "| `a-much-longer-script-name` | Three                                   |",
    );
  });

  it("still conflicts when both sides change the same row", async () => {
    const paths = files(
      await table(base),
      await table([one, ["`b`", "Two, ours"], three]),
      await table([one, ["`b`", "Two, theirs"], three]),
    );
    expect(await mergeMarkdown({ ...paths, path: "docs/x.md", root })).toBe(1);
    expect(readFileSync(paths.current, "utf8")).toContain(
      "<<<<<<< ours\n| `b` | Two, ours |\n=======",
    );
  });

  it("keeps the entries both sides added to the end of an index", async () => {
    const index = (rows: [string, string][]) => table(rows);
    const paths = files(
      await index(base),
      await index([...base, ["`d`", "Added on the branch, with a longer text"]]),
      await index([...base, ["`e`", "Added on master"]]),
    );
    expect(await mergeMarkdown({ ...paths, path: "docs/x.md", root })).toBe(0);
    expect(readFileSync(paths.current, "utf8")).toBe(
      await index([
        ...base,
        ["`d`", "Added on the branch, with a longer text"],
        ["`e`", "Added on master"],
      ]),
    );
  });

  it("uses the plain merge for a file Prettier ignores", async () => {
    const padded = "| A    | B |\n| ---- | - |\n| long | x |\n";
    const paths = files(padded, padded.replace("x", "y"), padded);
    expect(await mergeMarkdown({ ...paths, path: "plan.md", root })).toBe(0);
    expect(readFileSync(paths.current, "utf8")).toBe(padded.replace("x", "y"));
  });
});
