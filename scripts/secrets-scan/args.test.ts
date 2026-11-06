import { describe, expect, it } from "vitest";
import { GITLEAKS_IMAGE, dockerUser, gitleaksArgs, parseScanArgs } from "./args.js";

describe("gitleaksArgs", () => {
  const base = { repo: "C:\\Work\\x", reportPath: null, allRefs: true, staged: false, user: null };

  it("mounts the repository at /repo read-only", () => {
    const args = gitleaksArgs(base);
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-v"]);
    expect(args).toContain("C:\\Work\\x:/repo:ro");
  });

  it("runs the pinned image on the mounted history with redaction and the ignore file", () => {
    const args = gitleaksArgs(base);
    expect(args).toContain(GITLEAKS_IMAGE);
    expect(args.slice(args.indexOf(GITLEAKS_IMAGE) + 1, args.indexOf(GITLEAKS_IMAGE) + 3)).toEqual([
      "git",
      "/repo",
    ]);
    expect(args).toContain("--log-opts=--all");
    expect(args).toContain("--redact");
    expect(args).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(args).not.toContain("--report-path");
  });

  it("scans the checked-out history only (HEAD) without allRefs", () => {
    const args = gitleaksArgs({ ...base, allRefs: false });
    expect(args).toContain("--log-opts=HEAD");
    expect(args).not.toContain("--log-opts=--all");
  });

  it("pins the image by tag and digest", () => {
    expect(GITLEAKS_IMAGE).toBe(
      "zricethezav/gitleaks:v8.24.0@sha256:2bcceac45179b3a91bff11a824d0fb952585b429e54fc928728b1d4d5c3e5176",
    );
  });

  it("mounts the report's directory at /out and writes the JSON report there", () => {
    const args = gitleaksArgs({ ...base, reportPath: "C:\\tmp\\scan\\scan.json" });
    expect(args).toContain("C:\\tmp\\scan:/out");
    const at = args.indexOf("--report-format");
    expect(args.slice(at, at + 4)).toEqual([
      "--report-format",
      "json",
      "--report-path",
      "/out/scan.json",
    ]);
  });

  it("handles forward-slash report paths", () => {
    expect(gitleaksArgs({ ...base, reportPath: "/tmp/a/b.json" })).toContain("/tmp/a:/out");
  });

  it("staged mode scans the index with --pre-commit --staged, no --log-opts and no report", () => {
    const args = gitleaksArgs({ ...base, allRefs: false, staged: true });
    expect(args).toContain("--pre-commit");
    expect(args).toContain("--staged");
    expect(args.some((a) => a.startsWith("--log-opts"))).toBe(false);
    expect(args).toContain("--redact");
    expect(args).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(args.some((a) => a.startsWith("--report"))).toBe(false);
    expect(args.some((a) => a.endsWith(":/out"))).toBe(false);
  });

  it("adds --user before the image when a user is given, and not otherwise", () => {
    const args = gitleaksArgs({ ...base, user: "1000:1000" });
    const at = args.indexOf("--user");
    expect(args.slice(at, at + 2)).toEqual(["--user", "1000:1000"]);
    expect(at).toBeLessThan(args.indexOf(GITLEAKS_IMAGE));
    expect(gitleaksArgs(base)).not.toContain("--user");
  });
});

describe("dockerUser", () => {
  it("is null on Windows", () => {
    expect(
      dockerUser(
        "win32",
        () => 1000,
        () => 1000,
      ),
    ).toBeNull();
  });
  it("is uid:gid elsewhere", () => {
    expect(
      dockerUser(
        "linux",
        () => 1001,
        () => 123,
      ),
    ).toBe("1001:123");
    expect(
      dockerUser(
        "darwin",
        () => 501,
        () => 20,
      ),
    ).toBe("501:20");
  });
  it("is null when the ids are unavailable", () => {
    expect(dockerUser("linux", undefined, undefined)).toBeNull();
  });
});

describe("parseScanArgs", () => {
  it("defaults to no report and the checked-out history", () => {
    expect(parseScanArgs([])).toEqual({
      ok: true,
      allRefs: false,
      staged: false,
      reportPath: null,
    });
  });
  it("reads --all-refs and --report", () => {
    expect(parseScanArgs(["--all-refs", "--report", "r.json"])).toEqual({
      ok: true,
      allRefs: true,
      staged: false,
      reportPath: "r.json",
    });
  });
  it("ignores the -- separator pnpm forwards", () => {
    expect(parseScanArgs(["--", "--all-refs"])).toEqual({
      ok: true,
      allRefs: true,
      staged: false,
      reportPath: null,
    });
  });
  it("reads --staged", () => {
    expect(parseScanArgs(["--staged"])).toEqual({
      ok: true,
      allRefs: false,
      staged: true,
      reportPath: null,
    });
  });
  it("refuses --staged with --all-refs or --report", () => {
    const a = parseScanArgs(["--staged", "--all-refs"]);
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.message).toMatch(/--staged/);
    expect(parseScanArgs(["--all-refs", "--staged"]).ok).toBe(false);
    expect(parseScanArgs(["--staged", "--report", "r.json"]).ok).toBe(false);
  });
  it("refuses an unknown flag and a missing report path", () => {
    expect(parseScanArgs(["--x"]).ok).toBe(false);
    expect(parseScanArgs(["--report"]).ok).toBe(false);
  });
});
