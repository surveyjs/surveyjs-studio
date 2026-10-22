import { describe, expect, it } from "vitest";
import { compareNames, expectedScopes } from "./preconditions.js";

describe("compareNames", () => {
  const expected = ["Customer feedback", "Event registration", "Product poll"];

  it("gives nothing for equal lists", () => {
    expect(compareNames("Personal active", expected, [...expected])).toEqual([]);
  });

  it("reports a missing name", () => {
    expect(
      compareNames("Personal active", expected, ["Customer feedback", "Product poll"]),
    ).toEqual(['Personal active: missing "Event registration"']);
  });

  it("reports an extra name", () => {
    expect(compareNames("Personal active", expected, [...expected, "Other"])).toEqual([
      'Personal active: unexpected "Other"',
    ]);
  });

  it("reports an extra duplicate of an expected name", () => {
    expect(compareNames("Personal archived", ["a", "b"], ["a", "b", "b"])).toEqual([
      'Personal archived: duplicate "b"',
    ]);
  });

  it("reports a repeated name that takes the place of another", () => {
    expect(compareNames("Personal archived", ["a", "b"], ["a", "a"])).toEqual([
      'Personal archived: missing "b"',
      'Personal archived: duplicate "a"',
    ]);
  });

  it("reports a swapped pair once per misplaced position", () => {
    expect(
      compareNames("Personal active", expected, [
        "Product poll",
        "Event registration",
        "Customer feedback",
      ]),
    ).toEqual([
      'Personal active: expected "Customer feedback" first, found "Product poll"',
      'Personal active: expected "Product poll" third, found "Customer feedback"',
    ]);
  });
});

describe("expectedScopes", () => {
  it("lists the data set's scopes in order", () => {
    expect(expectedScopes()).toEqual([
      {
        label: "Personal active",
        names: ["Customer feedback", "Event registration", "Product poll"],
      },
      { label: "Personal archived", names: ["Old poll"] },
      { label: "Project Visual project", names: ["Team retro"] },
    ]);
  });
});
