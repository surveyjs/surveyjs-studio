import { describe, expect, it } from "vitest";
import {
  CHECK_NAMES,
  RESOURCE_PREFIX,
  backupFolderName,
  missingFromNotices,
  parseCheckArgs,
  redactLogLine,
  resourceName,
} from "./checks.js";

describe("parseCheckArgs", () => {
  it("runs every check on the image by default", () => {
    expect(parseCheckArgs(["--image", "surveyjs-studio:self-hosted"])).toEqual({
      ok: true,
      options: { image: "surveyjs-studio:self-hosted", previous: null, only: [...CHECK_NAMES] },
    });
  });

  it("takes --previous and --only, in the order of the checks", () => {
    const parsed = parseCheckArgs([
      "--image",
      "a:1",
      "--previous",
      "ghcr.io/surveyjs/surveyjs-studio:1.0.0",
      "--only",
      "upgrade,non-root",
    ]);
    expect(parsed).toEqual({
      ok: true,
      options: {
        image: "a:1",
        previous: "ghcr.io/surveyjs/surveyjs-studio:1.0.0",
        only: ["non-root", "upgrade"],
      },
    });
  });

  it("ignores the -- that pnpm passes", () => {
    expect(parseCheckArgs(["--", "--image", "a:1", "--only", "secrets"])).toMatchObject({
      ok: true,
      options: { only: ["secrets"] },
    });
  });

  it("refuses an unknown check with exit 2 and lists the names", () => {
    const parsed = parseCheckArgs(["--image", "a:1", "--only", "setup,nope"]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.exitCode).toBe(2);
    expect(parsed.message).toContain('Unknown check "nope"');
    expect(parsed.message).toContain("non-root, setup, offline, backup, upgrade, secrets");
  });

  it("needs --image", () => {
    expect(parseCheckArgs([])).toMatchObject({ ok: false, exitCode: 2 });
    expect(parseCheckArgs(["--only", "setup"])).toMatchObject({ ok: false, exitCode: 2 });
  });

  it("refuses an empty --only, an unknown option and a value that is not an image name", () => {
    expect(parseCheckArgs(["--image", "a:1", "--only", ""])).toMatchObject({ exitCode: 2 });
    expect(parseCheckArgs(["--image", "a:1", "--fast"])).toMatchObject({ exitCode: 2 });
    expect(parseCheckArgs(["--image", "-e X"])).toMatchObject({ exitCode: 2 });
    expect(parseCheckArgs(["--image", "a:1", "--previous", "a b"])).toMatchObject({ exitCode: 2 });
  });

  it("answers --help with exit 0 and the usage", () => {
    const parsed = parseCheckArgs(["--help"]);
    expect(parsed).toMatchObject({ ok: false, exitCode: 0 });
    if (!parsed.ok) expect(parsed.message).toContain("pnpm image:checks --image <tag>");
  });
});

describe("backupFolderName", () => {
  const output = [
    "Backed up to /backups/surveyjs-studio-20261030-101112",
    "Database: migration 4",
    "Files: 0 files, 0 bytes",
    "",
  ].join("\n");

  it("takes the folder's name from backup's output", () => {
    expect(backupFolderName(output)).toBe("surveyjs-studio-20261030-101112");
  });

  it("copes with Windows line ends", () => {
    expect(backupFolderName(output.replaceAll("\n", "\r\n"))).toBe(
      "surveyjs-studio-20261030-101112",
    );
  });

  it("is null without the line, or for a name that is not a plain folder name", () => {
    expect(backupFolderName("Error: there is no database at /data/x.db\n")).toBeNull();
    expect(backupFolderName("Backed up to /backups/\n")).toBeNull();
    expect(backupFolderName("Backed up to /backups/a b\n")).toBeNull();
  });
});

describe("resourceName", () => {
  it("starts every name with the prefix the cleanup removes", () => {
    expect(RESOURCE_PREFIX).toBe("surveyjs-studio-check-");
    expect(resourceName("k3x9", "backup-data")).toBe("surveyjs-studio-check-k3x9-backup-data");
  });

  it("refuses a part Docker would not take as a name", () => {
    expect(() => resourceName("k3x9", "a b")).toThrow();
    expect(() => resourceName("", "data")).toThrow();
  });
});

describe("redactLogLine", () => {
  it("hides the setup link's token", () => {
    expect(
      redactLogLine('{"msg":"Open http://localhost:8080/set-password?setup=AbC-d_9 to start"}'),
    ).toBe('{"msg":"Open http://localhost:8080/set-password?setup=<redacted> to start"}');
  });
});

describe("notices check", () => {
  it("is one of the checks, last", () => {
    expect(CHECK_NAMES[CHECK_NAMES.length - 1]).toBe("notices");
    expect(parseCheckArgs(["--image", "a:1", "--only", "notices"])).toMatchObject({
      ok: true,
      options: { only: ["notices"] },
    });
  });

  it("names the packages the notice must list that it does not", () => {
    expect(missingFromNotices("## survey-core@3.2.2\n## react@19.3.0\n")).toEqual([]);
    expect(missingFromNotices("## survey-core@3.2.2\n")).toEqual(["react@"]);
    expect(missingFromNotices("")).toEqual(["survey-core@", "react@"]);
  });
});
