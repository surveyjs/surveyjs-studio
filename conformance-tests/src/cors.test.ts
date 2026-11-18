import { describe, expect, it } from "vitest";
import { baseUrl } from "./harness.js";

const origin = "https://app.example.com";

function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    redirect: "manual",
    headers: { origin, ...headers },
  });
}

function expectNoCors(response: Response): void {
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
}

/** ADR 0037 point 7: CORS for the public operations and bearer requests, never for cookies. */
describe(`CORS of the server at ${baseUrl}`, () => {
  it("answers a public operation with Allow-Origin * and no credentials", async () => {
    const response = await request("GET", "/api/v1/public/surveys/no-such-survey");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-expose-headers")).toContain("Retry-After");
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("answers a bearer request with Allow-Origin *, even when it is refused", async () => {
    const response = await request("GET", "/api/v1/me", { authorization: "Bearer msk_unknown" });
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("gives a cookie request no CORS headers, but Vary: Origin", async () => {
    const response = await request("GET", "/api/v1/me");
    expectNoCors(response);
    expect(response.headers.get("vary")).toContain("Origin");
  });

  it("gives a request without Origin no CORS headers", async () => {
    const response = await fetch(`${baseUrl}/api/v1/public/surveys/no-such-survey`);
    expectNoCors(response);
  });

  it("answers a preflight for Authorization", async () => {
    const response = await request("OPTIONS", "/api/v1/surveys", {
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type, idempotency-key",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    const allowed = response.headers.get("access-control-allow-headers") ?? "";
    for (const name of ["Authorization", "Content-Type", "Idempotency-Key", "If-Match"]) {
      expect(allowed).toContain(name);
    }
    expect(response.headers.get("access-control-max-age")).toBe("600");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("answers a public preflight without Authorization", async () => {
    const response = await request("OPTIONS", "/api/v1/public/surveys/s1/responses", {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("gives a cookie-only preflight no CORS headers", async () => {
    const response = await request("OPTIONS", "/api/v1/surveys", {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, x-csrf-token",
    });
    expectNoCors(response);
    expect(response.headers.get("access-control-allow-methods")).toBeNull();
  });

  it("gives a preflight outside the API no CORS headers", async () => {
    const response = await request("OPTIONS", "/healthz", {
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    });
    expectNoCors(response);
  });
});
