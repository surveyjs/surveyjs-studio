import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveCommit, sandboxVersionPlugin, versionFileContent } from "./version-file.js";

describe("versionFileContent", () => {
  it("is the commit, the data version and the base path as one JSON line", () => {
    expect(versionFileContent("abc123", 1, "/")).toBe(
      '{"commit":"abc123","dataVersion":1,"base":"/"}\n',
    );
  });
});

describe("resolveCommit", () => {
  it("prefers SANDBOX_COMMIT", () => {
    expect(resolveCommit({ SANDBOX_COMMIT: "x" }, () => "y")).toBe("x");
  });

  it("trims SANDBOX_COMMIT", () => {
    expect(resolveCommit({ SANDBOX_COMMIT: " abc\n" }, () => "y")).toBe("abc");
  });

  it("falls back to the git head when SANDBOX_COMMIT is blank", () => {
    expect(resolveCommit({ SANDBOX_COMMIT: "  \n" }, () => "y")).toBe("y");
  });

  it("falls back to the git head, trimmed", () => {
    expect(resolveCommit({}, () => "y")).toBe("y");
    expect(resolveCommit({}, () => " y\n")).toBe("y");
  });

  it("is 'unknown' when git fails or answers nothing", () => {
    expect(
      resolveCommit({}, () => {
        throw new Error("no git");
      }),
    ).toBe("unknown");
    expect(resolveCommit({}, () => "")).toBe("unknown");
  });
});

describe("sandboxVersionPlugin", () => {
  const seedVersion = (
    JSON.parse(
      readFileSync(new URL("../../web/src/sandbox/seed.json", import.meta.url), "utf8"),
    ) as { version: number }
  ).version;

  function emitted(base: string, env: NodeJS.ProcessEnv) {
    const files: { type: string; fileName: string; source: string }[] = [];
    const plugin = sandboxVersionPlugin({ base, env, gitHead: () => "from-git" });
    plugin.generateBundle.call({
      emitFile: (file) => {
        files.push(file);
        return file.fileName;
      },
    });
    return files;
  }

  it("emits version.json with the commit, the seed's data version and the base", () => {
    expect(emitted("/", { SANDBOX_COMMIT: "abc" })).toEqual([
      {
        type: "asset",
        fileName: "version.json",
        source: `{"commit":"abc","dataVersion":${seedVersion},"base":"/"}\n`,
      },
    ]);
  });

  it("names the git head without SANDBOX_COMMIT, and a sub-path base", () => {
    const [file] = emitted("/studio/", {});
    expect(JSON.parse(file?.source ?? "")).toEqual({
      commit: "from-git",
      dataVersion: seedVersion,
      base: "/studio/",
    });
  });
});
