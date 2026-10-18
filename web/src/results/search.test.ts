import { describe, expect, it } from "vitest";
import { resultsSearch, resultsTab, validateResultsSearch } from "./search";

describe("validateResultsSearch", () => {
  it.each(["table", "details", "summary"])("keeps tab %s", (tab) => {
    expect(validateResultsSearch({ tab })).toEqual({ tab });
  });

  it.each([["Table"], ["x"], [1], [[]], [undefined]])("drops the tab %j", (tab) => {
    expect(validateResultsSearch({ tab })).toEqual({});
  });

  it("answers {} when tab is missing and drops other members", () => {
    expect(validateResultsSearch({})).toEqual({});
    expect(validateResultsSearch({ tab: "table", page: 2, q: "x" })).toEqual({ tab: "table" });
  });
});

describe("resultsTab and resultsSearch", () => {
  it("defaults to the summary", () => {
    expect(resultsTab({})).toBe("summary");
    expect(resultsTab({ tab: "details" })).toBe("details");
  });

  it("leaves the summary out of the URL", () => {
    expect(resultsSearch("summary")).toEqual({});
    expect(resultsSearch("details")).toEqual({ tab: "details" });
    expect(resultsSearch("table")).toEqual({ tab: "table" });
  });
});
