import { describe, expect, it } from "vitest";
import { anchorsOf, checkLinks, githubSlug } from "./check.js";

describe("githubSlug", () => {
  it.each([
    [
      "Mode 1.1: hosted, side by side with the old section",
      "mode-11-hosted-side-by-side-with-the-old-section",
    ],
    ["The sandbox (`studio.demos.surveyjs.io`)", "the-sandbox-studiodemossurveyjsio"],
    ["Q&A", "qa"],
    ["Keeping a fork up to date", "keeping-a-fork-up-to-date"],
    ["`BRANDING=off`", "brandingoff"],
    ["snake_case stays", "snake_case-stays"],
  ])("%s -> %s", (heading, slug) => {
    expect(githubSlug(heading)).toBe(slug);
  });
});

describe("anchorsOf", () => {
  it("numbers repeated headings", () => {
    const anchors = anchorsOf("# Setup\n\n## Setup\n\n## Setup\n");
    expect([...anchors]).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("skips headings inside code fences", () => {
    expect([...anchorsOf("# Real\n\n```sh\n# comment\n```\n")]).toEqual(["real"]);
  });
});

describe("checkLinks", () => {
  const files = new Map([
    ["docs/a.md", "# A\n\n## Google\n"],
    ["docs/b.md", "# B\n"],
  ]);

  it("passes links to files and headings that exist", () => {
    const withLinks = new Map(files).set(
      "docs/c.md",
      "[a](a.md) [g](a.md#google) [self](#c) [dir](../docs/) [x](a.md?x=1#google)\n\n# C\n",
    );
    expect(checkLinks(withLinks, { exists: (path) => path === "docs" })).toEqual([]);
  });

  it("finds a missing file and a missing anchor", () => {
    const withLinks = new Map(files).set(
      "docs/c.md",
      "[a](nope.md) [b](b.md#absent) [s](#absent) [up](../README.md)\n",
    );
    expect(checkLinks(withLinks, { exists: () => false })).toEqual([
      { file: "docs/c.md", link: "nope.md", reason: "missing-file" },
      { file: "docs/c.md", link: "b.md#absent", reason: "missing-anchor" },
      { file: "docs/c.md", link: "#absent", reason: "missing-anchor" },
      { file: "docs/c.md", link: "../README.md", reason: "missing-file" },
    ]);
  });

  it("ignores http, https and mailto links and anything in code", () => {
    const text = [
      "[w](https://example.com/x) [h](http://example.com) [m](mailto:a@example.com)",
      "`[inline](gone.md)`",
      "```md",
      "[fenced](gone.md)",
      "```",
      "",
    ].join("\n");
    expect(checkLinks(new Map([["docs/c.md", text]]))).toEqual([]);
  });

  it("reads a link whose text holds code, and one with a title", () => {
    const text = '[`code`](gone.md) [t](b.md "Title")\n';
    expect(checkLinks(new Map([...files, ["docs/c.md", text]]))).toEqual([
      { file: "docs/c.md", link: "gone.md", reason: "missing-file" },
    ]);
  });

  it("matches going-public and sign-in style anchors", () => {
    const target = "## The sandbox (`studio.demos.surveyjs.io`)\n\n## Q&A\n\n## Google\n";
    const source =
      "[a](t.md#the-sandbox-studiodemossurveyjsio) [b](t.md#qa) [c](t.md#google) [d](t.md#sandbox)\n";
    const result = checkLinks(
      new Map([
        ["docs/t.md", target],
        ["docs/s.md", source],
      ]),
    );
    expect(result).toEqual([{ file: "docs/s.md", link: "t.md#sandbox", reason: "missing-anchor" }]);
  });
});
