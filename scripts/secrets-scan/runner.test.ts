import { describe, expect, it } from "vitest";
import { SKIP_WARNING, chooseRunner, gitleaksNativeArgs } from "./runner.js";

describe("chooseRunner", () => {
  it("prefers a gitleaks binary on PATH", () => {
    expect(chooseRunner({ staged: true, hasGitleaks: true, dockerWorks: true })).toBe("gitleaks");
  });
  it("uses Docker when there is no binary and docker info works", () => {
    expect(chooseRunner({ staged: true, hasGitleaks: false, dockerWorks: true })).toBe("docker");
  });
  it("skips with a warning in staged mode when neither is available", () => {
    expect(chooseRunner({ staged: true, hasGitleaks: false, dockerWorks: false })).toBe("skip");
  });
  it("keeps failing on missing Docker in the other modes", () => {
    expect(chooseRunner({ staged: false, hasGitleaks: false, dockerWorks: false })).toBe("docker");
  });
  it("does not use a PATH binary for the other modes", () => {
    expect(chooseRunner({ staged: false, hasGitleaks: true, dockerWorks: true })).toBe("docker");
  });
});

describe("gitleaksNativeArgs", () => {
  it("is the staged scan from the repo root", () => {
    expect(gitleaksNativeArgs()).toEqual([
      "git",
      "--pre-commit",
      "--staged",
      "--redact",
      "--gitleaks-ignore-path=.gitleaksignore",
      "--no-banner",
      "--verbose",
    ]);
  });
});

describe("SKIP_WARNING", () => {
  it("is one line", () => {
    expect(SKIP_WARNING).toBe(
      "secrets scan skipped: neither gitleaks nor Docker is available; CI will scan",
    );
  });
});
