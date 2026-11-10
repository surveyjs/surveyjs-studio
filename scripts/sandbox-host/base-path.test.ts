import { describe, expect, it } from "vitest";
import { sandboxBase } from "./base-path.js";

describe("sandboxBase", () => {
  it.each([[undefined], [""], ["  "], ["/"]])("is / for %j", (value) => {
    expect(sandboxBase(value === undefined ? {} : { SANDBOX_BASE: value })).toBe("/");
  });

  it.each([
    ["studio", "/studio/"],
    ["/studio", "/studio/"],
    ["/studio/", "/studio/"],
    [" /studio/ ", "/studio/"],
    ["/demos/studio-1.0/", "/demos/studio-1.0/"],
  ])("normalises %j to %j", (value, expected) => {
    expect(sandboxBase({ SANDBOX_BASE: value })).toBe(expected);
  });

  it.each([
    ["https://example.test/studio/"],
    ["//studio/"],
    ["/a//b/"],
    ["/../studio/"],
    ["/./"],
    ["/my studio/"],
    ["/studio?x=1"],
    ["/st%20udio/"],
  ])("rejects %j", (value) => {
    expect(() => sandboxBase({ SANDBOX_BASE: value })).toThrow(/SANDBOX_BASE/);
  });
});
