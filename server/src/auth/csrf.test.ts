import { describe, expect, it } from "vitest";
import { csrfTokensMatch, generateCsrfToken } from "./csrf.js";

describe("generateCsrfToken", () => {
  it("returns 32 random bytes as base64url", () => {
    const token = generateCsrfToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(generateCsrfToken()).not.toBe(token);
  });
});

describe("csrfTokensMatch", () => {
  const token = generateCsrfToken();

  it("accepts equal header, cookie and session values", () => {
    expect(csrfTokensMatch(token, token, token)).toBe(true);
  });

  it.each([
    ["header", [undefined, "t", "t"]],
    ["cookie", ["t", undefined, "t"]],
    ["session", ["t", "t", undefined]],
  ] as const)("rejects a missing %s", (_name, [header, cookie, session]) => {
    expect(csrfTokensMatch(header, cookie, session)).toBe(false);
  });

  it("rejects empty values, even when all three are empty", () => {
    expect(csrfTokensMatch("", "", "")).toBe(false);
  });

  it.each([
    ["header", ["x", "t", "t"]],
    ["cookie", ["t", "x", "t"]],
    ["session", ["t", "t", "x"]],
  ] as const)("rejects a different %s", (_name, [header, cookie, session]) => {
    expect(csrfTokensMatch(header, cookie, session)).toBe(false);
  });

  it("rejects values of different lengths without throwing", () => {
    expect(csrfTokensMatch(token, token, `${token}x`)).toBe(false);
    expect(csrfTokensMatch(token.slice(1), token, token)).toBe(false);
    expect(csrfTokensMatch(token, token.slice(0, 5), token)).toBe(false);
  });
});
