import { describe, expect, it } from "vitest";
import { shouldInstallHooks } from "./install.mjs";

describe("shouldInstallHooks", () => {
  const ok = { inWorkTree: true, ci: undefined, hasGit: true };
  it("installs inside a work tree with git and no CI", () => {
    expect(shouldInstallHooks(ok)).toBe(true);
  });
  it("does nothing without a work tree, without git, or in CI", () => {
    expect(shouldInstallHooks({ ...ok, inWorkTree: false })).toBe(false);
    expect(shouldInstallHooks({ ...ok, hasGit: false })).toBe(false);
    expect(shouldInstallHooks({ ...ok, ci: "true" })).toBe(false);
  });
  it("treats an empty CI as unset", () => {
    expect(shouldInstallHooks({ ...ok, ci: "" })).toBe(true);
  });
});
