import { describe, expect, it } from "vitest";
import { appRootUrl, BASE_PATH, underBase } from "./basePath";

describe("underBase", () => {
  it("puts an app path under the base path", () => {
    expect(underBase("/s/abc", "/studio")).toBe("/studio/s/abc");
    expect(underBase("/", "/studio")).toBe("/studio/");
    expect(underBase("/sign-in?returnTo=%2Fprojects", "/demos/studio")).toBe(
      "/demos/studio/sign-in?returnTo=%2Fprojects",
    );
  });

  it("leaves an app path as it is at the root", () => {
    expect(underBase("/s/abc", "")).toBe("/s/abc");
  });

  it.each([
    ["https://surveyjs.io/pricing"],
    ["//evil.example/x"],
    ["/\\evil.example"],
    ["relative/path"],
    ["#anchor"],
    [""],
  ])("leaves %j unchanged", (url) => {
    expect(underBase(url, "/studio")).toBe(url);
  });

  it("uses the build's base path by default: none in the tests", () => {
    expect(BASE_PATH).toBe("");
    expect(underBase("/s/abc")).toBe("/s/abc");
  });
});

describe("appRootUrl", () => {
  it("is the origin and the base path, without a trailing slash", () => {
    expect(appRootUrl("/studio")).toBe(`${window.location.origin}/studio`);
    expect(appRootUrl()).toBe(window.location.origin);
  });
});
