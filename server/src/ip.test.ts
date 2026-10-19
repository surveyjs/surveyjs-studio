import { describe, expect, it } from "vitest";
import { respondentIp, truncatedIp } from "./ip.js";

describe("respondentIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["::FFFF:203.0.113.7", "203.0.113.7"],
    ["2001:db8::1", "2001:db8::1"],
    ["::ffff:abcd", "::ffff:abcd"],
  ])("%s -> %s", (input, expected) => {
    expect(respondentIp(input)).toBe(expected);
  });
});

describe("truncatedIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.0"],
    ["::ffff:203.0.113.7", "203.0.113.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::"],
    ["2001:0DB8::1", "2001:db8:0::"],
    ["::1", "0:0:0::"],
    ["fe80::1%eth0", "fe80:0:0::"],
    ["64:ff9b::192.0.2.1", "64:ff9b:0::"],
    ["garbage", "unknown"],
    ["", "unknown"],
  ])("%s -> %s", (input, expected) => {
    expect(truncatedIp(input)).toBe(expected);
  });
});
