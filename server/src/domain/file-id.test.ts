import { describe, expect, it } from "vitest";
import { FILE_ID_PATTERN, newFileId, surveyIdOfFile } from "./file-id.js";

const SURVEY = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const fixed = (size: number) => new Uint8Array(size).fill(0xab);

describe("newFileId", () => {
  it("is the survey's 32 hex digits then the random bytes as hex", () => {
    expect(newFileId(SURVEY, fixed)).toBe(`0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d${"ab".repeat(16)}`);
  });

  it("lower-cases an upper-case survey GUID", () => {
    expect(newFileId(SURVEY.toUpperCase(), fixed)).toBe(newFileId(SURVEY, fixed));
  });

  it("has 64 lower-case hex characters by default and differs between calls", () => {
    const a = newFileId(SURVEY);
    expect(a).toMatch(FILE_ID_PATTERN);
    expect(newFileId(SURVEY)).not.toBe(a);
  });

  it("throws for a survey id that is not a GUID", () => {
    expect(() => newFileId("not-a-guid")).toThrow();
    expect(() => newFileId("")).toThrow();
  });
});

describe("surveyIdOfFile", () => {
  it("round-trips to the dashed lower-case GUID", () => {
    expect(surveyIdOfFile(newFileId(SURVEY))).toBe(SURVEY);
  });

  it("accepts an upper-case id", () => {
    expect(surveyIdOfFile(newFileId(SURVEY, fixed).toUpperCase())).toBe(SURVEY);
  });

  it("is null for ids that are not 64 hex digits", () => {
    const id = newFileId(SURVEY);
    expect(surveyIdOfFile(id.slice(1))).toBeNull();
    expect(surveyIdOfFile(`${id}0`)).toBeNull();
    expect(surveyIdOfFile(`g${id.slice(1)}`)).toBeNull();
    expect(surveyIdOfFile("")).toBeNull();
  });
});
