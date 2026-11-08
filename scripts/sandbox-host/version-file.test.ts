import { describe, expect, it } from "vitest";
import { resolveCommit, versionFileContent } from "./version-file.js";

describe("versionFileContent", () => {
  it("is the commit and the data version as one JSON line", () => {
    expect(versionFileContent("abc123", 1)).toBe('{"commit":"abc123","dataVersion":1}\n');
  });
});

describe("resolveCommit", () => {
  it("prefers SANDBOX_COMMIT", () => {
    expect(resolveCommit({ SANDBOX_COMMIT: "x" }, () => "y")).toBe("x");
  });

  it("falls back to the git head", () => {
    expect(resolveCommit({}, () => "y")).toBe("y");
  });

  it("is 'unknown' when git fails", () => {
    expect(
      resolveCommit({}, () => {
        throw new Error("no git");
      }),
    ).toBe("unknown");
  });
});
