import { describe, expect, it } from "vitest";
import { GITLEAKS_IMAGE, gitleaksArgs, parseScanArgs } from "./args.js";

describe("gitleaksArgs", () => {
  const base = { repo: "C:\\Work\\x", reportPath: null, allRefs: true };

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
});

describe("parseScanArgs", () => {
  it("defaults to no report and the checked-out history", () => {
    expect(parseScanArgs([])).toEqual({ ok: true, allRefs: false, reportPath: null });
  });
  it("reads --all-refs and --report", () => {
    expect(parseScanArgs(["--all-refs", "--report", "r.json"])).toEqual({
      ok: true,
      allRefs: true,
      reportPath: "r.json",
    });
  });
  it("ignores the -- separator pnpm forwards", () => {
    expect(parseScanArgs(["--", "--all-refs"])).toEqual({
      ok: true,
      allRefs: true,
      reportPath: null,
    });
  });
  it("refuses an unknown flag and a missing report path", () => {
    expect(parseScanArgs(["--x"]).ok).toBe(false);
    expect(parseScanArgs(["--report"]).ok).toBe(false);
  });
});
