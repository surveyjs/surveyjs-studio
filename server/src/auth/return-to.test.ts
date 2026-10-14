import { describe, expect, it } from "vitest";
import { validateReturnTo } from "./return-to.js";

const BASE = "https://surveys.example.com";

describe("validateReturnTo", () => {
  it("defaults to / when absent", () => {
    expect(validateReturnTo(undefined, BASE)).toBe("/");
  });

  it.each(["/", "/a", "/a?b=c#d", "/surveys/1/edit?x=1&y=2", "/a//b", "/a%2F%2Fb", "/?next=//x"])(
    "accepts %s",
    (value) => {
      expect(validateReturnTo(value, BASE)).toBe(value);
    },
  );

  it.each([
    ["empty", ""],
    ["relative", "a/b"],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative path", "//evil.com/a"],
    ["backslash", "/\\evil.com"],
    ["absolute URL", "https://evil.com"],
    ["same-origin absolute URL", `${BASE}/a`],
    ["javascript scheme", "javascript:alert(1)"],
    ["CRLF", "/a\r\nSet-Cookie: x=1"],
    ["raw newline", "/a\nb"],
    ["tab", "/\t/evil.com"],
    ["NUL", "/a\u0000b"],
    ["DEL", "/a\u007fb"],
    ["C1 control", "/a\u0085b"],
    ["leading space", " /a"],
    ["over-long", `/${"a".repeat(2048)}`],
  ])("rejects %s", (_name, value) => {
    expect(validateReturnTo(value, BASE)).toBeNull();
  });

  it("accepts a path of exactly 2048 characters", () => {
    const value = `/${"a".repeat(2047)}`;
    expect(validateReturnTo(value, BASE)).toBe(value);
  });

  it("resolves against a base URL with a port or a path", () => {
    expect(validateReturnTo("/a", "http://localhost:5173")).toBe("/a");
    expect(validateReturnTo("/a", "https://a.example/app/")).toBe("/a");
  });
});
