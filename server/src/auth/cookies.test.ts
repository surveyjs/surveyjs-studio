import { describe, expect, it } from "vitest";
import {
  clearAllCookies,
  clearTransactionCookie,
  parseCookies,
  sessionCookies,
  transactionCookie,
  transactionCookieName,
  transactionCookieNames,
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

describe("transaction cookie names", () => {
  it("names the cookie after the first 16 characters of the state", () => {
    expect(transactionCookieName("abcdefghij-_1234rest-of-state")).toBe(
      "msid_auth_abcdefghij-_1234",
    );
  });

  it("names none for a short or non-base64url state", () => {
    for (const state of [
      "",
      "short",
      "abcdefghij;=1234x",
      "abcdefghij\r\n1234x",
      "abc defghij123456",
    ]) {
      expect(transactionCookieName(state)).toBeNull();
    }
  });

  it("finds only well-formed transaction cookies", () => {
    const cookies = parseCookies(
      "msid=s; msid_auth_abcdefghijklmnop=t; msid_auth=old; msid_auth_short=x; msid_auth_ABCDEFGHIJKLMNOP=u",
    );
    expect(transactionCookieNames(cookies)).toEqual([
      "msid_auth_abcdefghijklmnop",
      "msid_auth_ABCDEFGHIJKLMNOP",
    ]);
  });
});

describe("cookie attributes", () => {
  const http = { publicBaseUrl: "http://localhost:5173", sessionMaxAgeSeconds: 43200 };
  const https = { ...http, publicBaseUrl: "https://surveys.example.com" };
  const name = "msid_auth_abcdefghijklmnop";

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
    expect(transactionCookie(https, name, "T")).toMatch(/; Secure$/);
  });

  it("scopes the transaction cookie to the sign-in endpoints for ten minutes", () => {
    expect(transactionCookie(http, name, "T")).toBe(
      "msid_auth_abcdefghijklmnop=T; Path=/api/v1/auth; Max-Age=600; SameSite=Lax; HttpOnly",
    );
  });

  it("clears a transaction cookie on its own path", () => {
    expect(clearTransactionCookie(http, name)).toBe(
      "msid_auth_abcdefghijklmnop=; Path=/api/v1/auth; Max-Age=0; SameSite=Lax; HttpOnly",
    );
  });

  it("clears every sign-in cookie with Max-Age=0 on its own path", () => {
    expect(clearAllCookies(http, [name])).toEqual([
      "msid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly",
      "msid_csrf=; Path=/; Max-Age=0; SameSite=Lax",
      "msid_auth_abcdefghijklmnop=; Path=/api/v1/auth; Max-Age=0; SameSite=Lax; HttpOnly",
    ]);
  });
});
