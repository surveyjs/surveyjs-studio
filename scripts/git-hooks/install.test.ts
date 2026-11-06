import { describe, expect, it } from "vitest";
import { decideHooks, isCiSet, samePath } from "./install.mjs";

describe("isCiSet", () => {
  it("is set only when non-empty and not false", () => {
    expect(isCiSet("true")).toBe(true);
    expect(isCiSet("1")).toBe(true);
    expect(isCiSet(undefined)).toBe(false);
    expect(isCiSet("")).toBe(false);
    expect(isCiSet("false")).toBe(false);
    expect(isCiSet("FALSE")).toBe(false);
  });
});

describe("samePath", () => {
  it("ignores slash style, a trailing slash and (on win32) case", () => {
    expect(samePath("C:/Work/x", "C:\\Work\\x\\", "win32")).toBe(true);
    expect(samePath("c:/work/x", "C:\\Work\\x", "win32")).toBe(true);
    expect(samePath("/a/b", "/a/B", "linux")).toBe(false);
    expect(samePath("/a", "/a/b", "linux")).toBe(false);
  });
});

describe("decideHooks", () => {
  const ok = {
    hasGit: true,
    inWorkTree: true,
    ci: undefined,
    atPackageRoot: true,
    currentHooksPath: null,
  };
  it("installs inside this work tree with git, no CI and no hooksPath", () => {
    expect(decideHooks(ok)).toEqual({ action: "install" });
  });
  it("does nothing without git, a work tree, at a parent repo, or in CI", () => {
    expect(decideHooks({ ...ok, hasGit: false })).toEqual({ action: "none" });
    expect(decideHooks({ ...ok, inWorkTree: false })).toEqual({ action: "none" });
    expect(decideHooks({ ...ok, atPackageRoot: false })).toEqual({ action: "none" });
    expect(decideHooks({ ...ok, ci: "true" })).toEqual({ action: "none" });
  });
  it("treats an empty or false CI as unset", () => {
    expect(decideHooks({ ...ok, ci: "" }).action).toBe("install");
    expect(decideHooks({ ...ok, ci: "false" }).action).toBe("install");
  });
  it("leaves our own value alone, silently", () => {
    expect(decideHooks({ ...ok, currentHooksPath: ".githooks" })).toEqual({ action: "none" });
  });
  it("keeps a different existing hooksPath and says so in one line", () => {
    const d = decideHooks({ ...ok, currentHooksPath: ".husky" });
    expect(d.action).toBe("keep");
    const message = "message" in d ? d.message : "";
    expect(message).toContain(".husky");
    expect(message).not.toContain("\n");
  });
});
