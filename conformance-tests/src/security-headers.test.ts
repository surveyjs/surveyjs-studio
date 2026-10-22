import { describe, expect, it } from "vitest";
import { baseUrl, call } from "./harness.js";

/** R18: the headers every server answer carries; HSTS only when the server is reached over https. */
function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  if (baseUrl.startsWith("https:")) {
    expect(response.headers.get("strict-transport-security")).toContain("max-age=");
  }
}

describe(`security headers of the server at ${baseUrl}`, () => {
  it("are on an API answer", async () => {
    const response = await call("GET", "/config");
    expect(response.status).toBe(200);
    expectSecurityHeaders(response);
  });

  it("are on a problem answer", async () => {
    const response = await call("GET", "/me");
    expect(response.status).toBe(401);
    expectSecurityHeaders(response);
  });

  it("are on an unknown path", async () => {
    const response = await fetch(`${baseUrl}/no-such-page`);
    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
  });
});
