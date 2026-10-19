import { describe, expect, it } from "vitest";
import { formatBytes, remainingQuota } from "./quota.js";

describe("remainingQuota", () => {
  it("is what is left, never below 0", () => {
    expect(remainingQuota(100, 40)).toBe(60);
    expect(remainingQuota(100, 100)).toBe(0);
    expect(remainingQuota(100, 140)).toBe(0);
  });
});

describe("formatBytes", () => {
  it.each([
    [52428800, "50 MB"],
    [1048576, "1 MB"],
    [1572864, "1.5 MB"],
    [10485760, "10 MB"],
    [65536, "64 KB"],
    [1024, "1 KB"],
    [1023, "1023 bytes"],
    [500, "500 bytes"],
  ])("%i → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
