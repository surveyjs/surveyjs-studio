import { describe, expect, it } from "vitest";
import { decodeToken, encodeToken } from "./tokens.js";

describe("encodeToken and decodeToken", () => {
  it("give back the cursor and offset the bridge put in", () => {
    for (const [cursor, offset] of [
      ["eyJ2IjoxfQ", 0],
      ["eyJ2IjoxfQ", 17],
      ["a cursor with spaces & symbols ✓", 999],
    ] as const) {
      expect(decodeToken(encodeToken(cursor, offset))).toEqual({ cursor, offset });
    }
  });

  it("give an offset from the first page for an empty cursor", () => {
    expect(decodeToken(encodeToken("", 5))).toEqual({ offset: 5 });
  });

  it("make tokens that are no decimal and carry no blank", () => {
    const token = encodeToken("cursor", 3);
    expect(token).not.toMatch(/^\s*[+-]?\d+\s*$/);
    expect(token).not.toMatch(/\s/);
  });

  it("read the old offset engine's decimal token as an offset", () => {
    expect(decodeToken("1000")).toEqual({ offset: 1000 });
    expect(decodeToken("0")).toEqual({ offset: 0 });
    expect(decodeToken(" +42\t")).toEqual({ offset: 42 });
    expect(decodeToken("007")).toEqual({ offset: 7 });
  });

  it("start at the first page for a negative or oversized decimal, as the old engine did", () => {
    expect(decodeToken("-5")).toEqual({ offset: 0 });
    expect(decodeToken("2147483647")).toEqual({ offset: 2147483647 });
    expect(decodeToken("2147483648")).toEqual({ offset: 0 });
    expect(decodeToken("99999999999999999999")).toEqual({ offset: 0 });
  });

  it("start at the first page for any token the bridge did not make", () => {
    for (const text of [
      "",
      "   ",
      "1!4!Kg-- 1!48!MDA5MTEyMzQtNWY2Ny00YTVk",
      "1.5",
      "abc",
      "bt1.",
      "bt1.not-base64-json",
      `bt1.${Buffer.from('{"c":1,"o":2}').toString("base64url")}`,
      `bt1.${Buffer.from('{"c":"x","o":-1}').toString("base64url")}`,
      `bt1.${Buffer.from('{"c":"x","o":1.5}').toString("base64url")}`,
      `bt1.${Buffer.from("[]").toString("base64url")}`,
    ]) {
      expect(decodeToken(text), text).toEqual({ offset: 0 });
    }
  });
});
