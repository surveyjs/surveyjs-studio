import { describe, expect, it } from "vitest";
import { serverSecurityHeaders } from "./security-headers.js";

describe("serverSecurityHeaders", () => {
  it("gives an API answer a CSP that loads nothing and forbids framing, without HSTS over http", () => {
    expect(serverSecurityHeaders("/api/v1/config", { https: false })).toStrictEqual({
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    });
  });

  it("lets the API reference run its script but still forbids framing, whatever the query", () => {
    expect(
      serverSecurityHeaders("/api/docs?x=1", { https: false })["content-security-policy"],
    ).toBe("frame-ancestors 'none'");
  });

  it("adds HSTS over https", () => {
    expect(
      serverSecurityHeaders("/api/v1/config", { https: true })["strict-transport-security"],
    ).toBe("max-age=31536000");
  });
});
