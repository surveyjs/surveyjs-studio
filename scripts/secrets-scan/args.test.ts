import { describe, expect, it } from "vitest";
import { gitleaksArgs, parseScanArgs } from "./args.js";

describe("gitleaksArgs", () => {
  const base = { repo: "C:\\Work\\x", reportPath: null, allRefs: true };

  it("mounts the repository at /repo read-only", () => {
    const args = gitleaksArgs(base);
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-v"]);
    expect(args).toContain("C:\\Work\\x:/repo:ro");
  });

  it("runs the pinned image on the mounted history with redaction and the ignore file", () => {
    const args = gitleaksArgs(base);
    expect(args).toContain("zricethezav/gitleaks:v8.24.0");
    expect(
      args.slice(
        args.indexOf("zricethezav/gitleaks:v8.24.0") + 1,
        args.indexOf("zricethezav/gitleaks:v8.24.0") + 3,
      ),
    ).toEqual(["git", "/repo"]);
    expect(args).toContain("--log-opts=--all");
    expect(args).toContain("--redact");
    expect(args).toContain("--gitleaks-ignore-path=/repo/.gitleaksignore");
    expect(args).not.toContain("--report-path");
  });

  it("scans the checked-out history only without allRefs", () => {
    expect(gitleaksArgs({ ...base, allRefs: false }).some((a) => a.startsWith("--log-opts"))).toBe(
      false,
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
