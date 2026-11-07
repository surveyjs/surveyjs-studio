import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as prettier from "prettier";
import { afterEach, describe, expect, it } from "vitest";
import { compactRow, compactTables, mergeMarkdown } from "./markdown-tables.mjs";

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

  it("uses the plain merge for a file Prettier ignores", async () => {
    const padded = "| A    | B |\n| ---- | - |\n| long | x |\n";
    const paths = files(padded, padded.replace("x", "y"), padded);
    expect(await mergeMarkdown({ ...paths, path: "plan.md", root })).toBe(0);
    expect(readFileSync(paths.current, "utf8")).toBe(padded.replace("x", "y"));
  });
});
