import { describe, expect, it } from "vitest";
import { extractGuide } from "./extract.js";

const fence = "```";
const sample = (...parts: string[]) => parts.join("\n");

const a = sample(
  "<!-- file: web/src/shell/example/A.tsx -->",
  "",
  `${fence}tsx`,
  "export const a = 1;",
  fence,
);
const b = sample(
  "<!-- file: web/src/shell/example/B.test.tsx -->",
  `${fence}tsx`,
  "export const b = 2;",
  "",
  fence,
);
const patch = sample(
  "<!-- patch -->",
  "",
  `${fence}diff`,
  "--- a/x",
  "+++ b/x",
  "@@ -1 +1 @@",
  "-1",
  "+2",
  fence,
);

describe("extractGuide", () => {
  it("extracts the file blocks and the patch verbatim", () => {
    const guide = sample("# Guide", "", "Text.", "", a, "", "More text.", "", b, "", patch, "");
    expect(extractGuide(guide)).toEqual({
      files: [
        { path: "web/src/shell/example/A.tsx", content: "export const a = 1;\n" },
        { path: "web/src/shell/example/B.test.tsx", content: "export const b = 2;\n\n" },
      ],
      patch: "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-1\n+2\n",
    });
  });

  it("throws when a file comment is not followed by a fence", () => {
    const guide = sample("<!-- file: web/src/shell/example/A.tsx -->", "", "Just text.", "", patch);
    expect(() => extractGuide(guide)).toThrow(/not followed by a code block/);
  });

  it("throws for a file outside web/src/shell/example/", () => {
    const bad = a.replace("web/src/shell/example/A.tsx", "server/x.ts");
    expect(() => extractGuide(sample(bad, "", patch))).toThrow(/web\/src\/shell\/example\//);
  });

  it("throws for a path that climbs out of the example folder", () => {
    const bad = a.replace("example/A.tsx", "example/../../../../server/x.ts");
    expect(() => extractGuide(sample(bad, "", patch))).toThrow(/web\/src\/shell\/example\//);
  });

  it("throws when there is no patch or more than one", () => {
    expect(() => extractGuide(a)).toThrow(/patch/);
    expect(() => extractGuide(sample(a, patch, patch))).toThrow(/patch/);
  });
});
