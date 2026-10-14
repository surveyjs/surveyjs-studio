import { describe, expect, it } from "vitest";
import {
  clearAllCookies,
  clearTransactionCookie,
  parseCookies,
  sessionCookies,
  transactionCookie,
} from "./cookies.js";

describe("parseCookies", () => {
  it("reads name=value pairs", () => {
    expect(parseCookies("msid=v1.a.b; msid_csrf=xyz")).toEqual({
      msid: "v1.a.b",
      msid_csrf: "xyz",
    });
  });

  it("keeps the first of repeated names and skips malformed pairs", () => {
    expect(parseCookies("a=1;; junk ; =2; a=3;b=")).toEqual({ a: "1", b: "" });
  });

  it("reads nothing from a missing header", () => {
    expect(parseCookies(undefined)).toEqual({});
  });

  it("is not fooled by inherited property names", () => {
    expect(parseCookies("constructor=1").constructor).toBe("1");
    expect(parseCookies("").toString).toBeUndefined();
  });
});

describe("cookie attributes", () => {
  const http = { publicBaseUrl: "http://localhost:5173", sessionMaxAgeSeconds: 43200 };
  const https = { ...http, publicBaseUrl: "https://surveys.example.com" };

  it("sets msid HttpOnly and msid_csrf readable, for the whole site", () => {
    expect(sessionCookies(http, { session: "S", csrf: "C" })).toEqual([
      "msid=S; Path=/; Max-Age=43200; SameSite=Lax; HttpOnly",
      "msid_csrf=C; Path=/; Max-Age=43200; SameSite=Lax",
    ]);
  });

  it("adds Secure when the public origin is https", () => {
    for (const cookie of sessionCookies(https, { session: "S", csrf: "C" })) {
      expect(cookie).toMatch(/; Secure$/);
    }
    expect(transactionCookie(https, "T")).toMatch(/; Secure$/);
  });

  it("scopes msid_auth to the sign-in endpoints for ten minutes", () => {
    expect(transactionCookie(http, "T")).toBe(
      "msid_auth=T; Path=/api/v1/auth; Max-Age=600; SameSite=Lax; HttpOnly",
    );
  });

  it("clears msid_auth on its own path", () => {
    expect(clearTransactionCookie(http)).toBe(
      "msid_auth=; Path=/api/v1/auth; Max-Age=0; SameSite=Lax; HttpOnly",
    );
  });

  it("clears every sign-in cookie with Max-Age=0 on its own path", () => {
    expect(clearAllCookies(http)).toEqual([
      "msid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly",
      "msid_csrf=; Path=/; Max-Age=0; SameSite=Lax",
      "msid_auth=; Path=/api/v1/auth; Max-Age=0; SameSite=Lax; HttpOnly",
    ]);
  });
});
