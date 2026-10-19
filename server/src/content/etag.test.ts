import { describe, expect, it } from "vitest";
import { formatEtag, ifMatchAllows } from "./etag.js";

const VERSION = "abc-123_XYZ";

describe("formatEtag", () => {
  it("makes a strong tag", () => {
    expect(formatEtag(VERSION)).toBe(`"${VERSION}"`);
  });
});

describe("ifMatchAllows", () => {
  it.each([
    ["the exact tag", `"${VERSION}"`, true],
    ["the tag with spaces around it", `  "${VERSION}"  `, true],
    ["a list containing it", `"other", "${VERSION}" ,"third"`, true],
    ["a list with it first", `"${VERSION}","other"`, true],
    ["*", "*", true],
    ["* with spaces", " * ", true],
    ["a weak tag of the same value", `W/"${VERSION}"`, false],
    ["a list with only a weak match", `"other", W/"${VERSION}"`, false],
    ["an unquoted value", VERSION, false],
    ["another tag", '"other"', false],
    ["an empty header", "", false],
    ["a blank header", "   ", false],
    ["a list ending in a comma", `"${VERSION}",`, false],
    ["a malformed list", `"${VERSION}" junk`, false],
    ["an unterminated tag", `"${VERSION}`, false],
    ["* inside a list", `*, "${VERSION}"`, false],
  ])("%s", (_name, header, expected) => {
    expect(ifMatchAllows(header, VERSION)).toBe(expected);
  });
});
