import { describe, expect, it } from "vitest";
import { surveyListParams, surveyListSearch, validateSurveyListSearch } from "./search";

describe("validateSurveyListSearch", () => {
  it("accepts an empty search and applies defaults in the params", () => {
    expect(validateSurveyListSearch({})).toEqual({});
    expect(surveyListParams({})).toEqual({ project: "personal", archived: false });
  });

  it.each([
    ["personal", "personal"],
    ["  abc ", "abc"],
    [123, "123"],
  ])("keeps project %j as %j", (project, expected) => {
    expect(validateSurveyListSearch({ project })).toEqual({ project: expected });
  });

  it.each([[""], ["   "], ["x".repeat(65)], [{}], [null], [true]])(
    "drops project %j",
    (project) => {
      expect(validateSurveyListSearch({ project })).toEqual({});
    },
  );

  it("keeps a project of 64 characters", () => {
    const project = "x".repeat(64);
    expect(validateSurveyListSearch({ project })).toEqual({ project });
  });

  it.each([
    [true, true],
    ["true", true],
    [false, false],
    ["false", false],
  ])("reads archived %j as %j", (archived, expected) => {
    expect(validateSurveyListSearch({ archived })).toEqual({ archived: expected });
  });

  it.each([["yes"], [1], [null]])("drops archived %j", (archived) => {
    expect(validateSurveyListSearch({ archived })).toEqual({});
  });

  it("keeps the Step 3 deep link as it is", () => {
    expect(validateSurveyListSearch({ project: "personal", archived: "true" })).toEqual({
      project: "personal",
      archived: true,
    });
  });
});

describe("surveyListSearch", () => {
  it("omits defaults", () => {
    expect(surveyListSearch({ project: "personal", archived: false })).toEqual({});
  });

  it("keeps non-default values", () => {
    expect(surveyListSearch({ project: "personal", archived: true })).toEqual({ archived: true });
    expect(surveyListSearch({ project: "p1", archived: false })).toEqual({ project: "p1" });
    expect(surveyListSearch({ project: "p1", archived: true })).toEqual({
      project: "p1",
      archived: true,
    });
  });
});
