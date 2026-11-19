import { describe, expect, it } from "vitest";
import { credentialKind, hashCredential, lastFour, newApiTokenValue } from "./format.js";

describe("credential values", () => {
  it("makes sjs_ + 43 base64url characters", () => {
    expect(newApiTokenValue()).toMatch(/^sjs_[A-Za-z0-9_-]{43}$/);
    expect(newApiTokenValue()).not.toBe(newApiTokenValue());
  });
  it("tells the kinds apart by the prefix only", () => {
    expect(credentialKind("sjs_abc")).toBe("api-token");
    expect(credentialKind("0123456789abcdef0123456789abcdef")).toBe("legacy-key");
    expect(credentialKind("anything")).toBe("legacy-key");
  });
  it("hashes legacy keys without regard to case, tokens exactly", () => {
    expect(hashCredential("ABCDEF", "legacy-key")).toBe(hashCredential("abcdef", "legacy-key"));
    expect(hashCredential("sjs_A", "api-token")).not.toBe(hashCredential("sjs_a", "api-token"));
    expect(hashCredential("x", "api-token")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("keeps the last four characters", () => {
    expect(lastFour("sjs_abcdWXYZ")).toBe("WXYZ");
  });
});
