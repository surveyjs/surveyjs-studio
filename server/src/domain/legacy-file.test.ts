import { describe, expect, it } from "vitest";
import { surveyIdOfFile } from "./file-id.js";
import { isLegacyFileName, legacyContentType, legacyFileRecord } from "./legacy-file.js";

describe("isLegacyFileName", () => {
  it.each([
    "0b5c7c6e-0000-4000-8000-a00000000001",
    "0b5c7c6e-0000-4000-8000-a00000000002.PNG",
    "my-surveys-survey-preview-image-0b5c7c6e-0000-4000-8000-a00000000001",
    "a_b.c",
    ".hidden",
    "x".repeat(100),
  ])("accepts %j", (name) => {
    expect(isLegacyFileName(name)).toBe(true);
  });

  it.each([
    "",
    ".",
    "..",
    "...",
    "../x",
    "a/b",
    "a\\b",
    "a b",
    "dxsimage:x",
    "a\u0000b",
    "ü.png",
    "x".repeat(101),
  ])("refuses %j", (name) => {
    expect(isLegacyFileName(name)).toBe(false);
  });
});

describe("legacyContentType", () => {
  it.each([
    ["a.png", "image/png"],
    ["a.PNG", "image/png"],
    ["a.Jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.bmp", "image/bmp"],
    ["a.svg", "image/svg+xml"],
    ["a.pdf", "application/pdf"],
    ["a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["a.tar.zip", "application/x-zip-compressed"],
    ["0b5c7c6e-0000-4000-8000-a00000000001", "application/octet-stream"],
    ["a.", "application/octet-stream"],
    ["a.html", "application/octet-stream"],
    ["a.js", "application/octet-stream"],
    ["a.unknown", "application/octet-stream"],
    ["a.constructor", "application/octet-stream"],
    ["a.__proto__", "application/octet-stream"],
  ])("%s is %s", (name, type) => {
    expect(legacyContentType(name)).toBe(type);
  });
});

describe("legacyFileRecord", () => {
  it("belongs to the all-zero survey, with an id of its kind and name", () => {
    const record = legacyFileRecord("response", "a.png", 12);
    expect(record).toEqual({
      id: expect.stringMatching(/^0{32}[0-9a-f]{32}$/) as string,
      surveyId: "00000000-0000-0000-0000-000000000000",
      kind: "response",
      name: "a.png",
      contentType: "image/png",
      size: 12,
      createdAt: "1970-01-01T00:00:00.000Z",
    });
    expect(surveyIdOfFile(record.id)).toBe(record.surveyId);
    expect(legacyFileRecord("response", "a.png", 1).id).toBe(record.id);
    expect(legacyFileRecord("asset", "a.png", 12).id).not.toBe(record.id);
    expect(legacyFileRecord("response", "A.png", 12).id).not.toBe(record.id);
  });
});
