import { describe, expect, it } from "vitest";
import { canonicalJson, checksum, expectedKey, sameNames } from "./compare.js";

describe("compare", () => {
  it("writes canonical JSON with sorted keys at every depth, array order kept", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
    expect(checksum({ x: 1, y: 2 })).toBe(checksum({ y: 2, x: 1 }));
    expect(checksum([1, 2])).not.toBe(checksum([2, 1]));
  });

  it("expects the mapper's key, unrevoked, and none without one", () => {
    const key = { userId: "u", keyHash: "h", lastFour: "abcd", createdAt: "t" };
    expect(expectedKey(key)).toEqual({ lastFour: "abcd", revoked: false });
    expect(expectedKey(undefined)).toBeNull();
  });

  it("compares name lists as sets", () => {
    expect(sameNames(["a", "b"], ["b", "a", "a"])).toBe(true);
    expect(sameNames(["a"], ["a", "b"])).toBe(false);
  });
});
