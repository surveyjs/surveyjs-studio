import { describe, expect, it } from "vitest";
import { corsDecision } from "./cors.js";

const origin = "https://app.example.com";

describe("corsDecision", () => {
  it("allows any origin on a public GET", () => {
    expect(corsDecision({ method: "GET", path: "/api/v1/public/surveys/s1", origin })).toEqual({
      allowOrigin: "*",
      preflight: false,
    });
  });

  it("allows any origin on a bearer GET", () => {
    expect(
      corsDecision({
        method: "GET",
        path: "/api/v1/surveys",
        origin,
        authorization: "Bearer msk_abc",
      }),
    ).toEqual({ allowOrigin: "*", preflight: false });
  });

  it("gives a cookie GET with a foreign origin nothing", () => {
    expect(corsDecision({ method: "GET", path: "/api/v1/me", origin })).toEqual({
      allowOrigin: null,
      preflight: false,
    });
  });

  it("gives a non-bearer Authorization header nothing", () => {
    expect(
      corsDecision({ method: "GET", path: "/api/v1/me", origin, authorization: "Basic abc" })
        .allowOrigin,
    ).toBeNull();
  });

  it("allows a preflight that asks for the Authorization header", () => {
    expect(
      corsDecision({
        method: "OPTIONS",
        path: "/api/v1/surveys",
        origin,
        requestHeaders: "Content-Type, Authorization",
      }),
    ).toEqual({ allowOrigin: "*", preflight: true });
  });

  it("allows a public preflight without it", () => {
    expect(
      corsDecision({
        method: "OPTIONS",
        path: "/api/v1/public/surveys/s1/responses",
        origin,
        requestHeaders: "content-type",
      }),
    ).toEqual({ allowOrigin: "*", preflight: true });
  });

  it("refuses a preflight on a cookie-only route without authorization", () => {
    expect(
      corsDecision({
        method: "OPTIONS",
        path: "/api/v1/surveys",
        origin,
        requestHeaders: "content-type, x-csrf-token",
      }),
    ).toEqual({ allowOrigin: null, preflight: true });
  });

  it("gives a request without Origin nothing", () => {
    expect(
      corsDecision({ method: "GET", path: "/api/v1/public/surveys/s1" }).allowOrigin,
    ).toBeNull();
    expect(
      corsDecision({ method: "OPTIONS", path: "/api/v1/public/x", requestHeaders: "authorization" })
        .allowOrigin,
    ).toBeNull();
  });

  it("gives paths outside the API nothing", () => {
    expect(
      corsDecision({
        method: "OPTIONS",
        path: "/healthz",
        origin,
        requestHeaders: "authorization",
      }).allowOrigin,
    ).toBeNull();
    expect(
      corsDecision({ method: "GET", path: "/api/v1publicity", origin, authorization: "Bearer x" })
        .allowOrigin,
    ).toBeNull();
  });
});
