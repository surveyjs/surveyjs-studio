import { describe, expect, it } from "vitest";
import { canonicalJson, checksum, expectedKey, sameNames } from "./compare.js";
import { changedAfterMarks, markOf } from "./marks.js";

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

describe("changedAfterMarks", () => {
  const marks = { takenAt: "2026-11-25T12:00:00.500Z" };

  it("judges rows by the marks' time and blobs by its second", () => {
    expect(changedAfterMarks(marks, "tables", "2026-11-25T12:00:00.400Z")).toBe(false);
    expect(changedAfterMarks(marks, "tables", "2026-11-25T12:00:00.600Z")).toBe(true);
    // A blob time of the marks' second may be a change after them.
    expect(changedAfterMarks(marks, "blobs", new Date("2026-11-25T12:00:00.000Z"))).toBe(true);
    expect(changedAfterMarks(marks, "blobs", new Date("2026-11-25T11:59:59.000Z"))).toBe(false);
    expect(markOf(marks, "blobs").toISOString()).toBe("2026-11-25T11:59:59.999Z");
    expect(changedAfterMarks(marks, "sql", null)).toBe(false);
  });
});
