import { describe, expect, it } from "vitest";
import { nextNewSurveyName } from "./naming.js";

describe("nextNewSurveyName", () => {
  it.each<[string, readonly string[], string]>([
    ["starts at 1", [], "New Survey 1"],
    ["follows the highest number", ["New Survey 1"], "New Survey 2"],
    ["ignores duplicates", ["New Survey 1", "New Survey 1"], "New Survey 2"],
    ["does not fill gaps", ["New Survey 1", "New Survey 3"], "New Survey 4"],
    ["does not depend on the order", ["New Survey 3", "New Survey 1"], "New Survey 4"],
    ["reads leading zeros", ["New Survey 007"], "New Survey 8"],
    ["counts a number without a space", ["New Survey3"], "New Survey 4"],
    ["counts a plus sign", ["New Survey +6"], "New Survey 7"],
    ["allows white space around the number", ["New Survey 4 ", "New Survey\t5\n"], "New Survey 6"],
    ["never goes below 1", ["New Survey -5", "New Survey 0"], "New Survey 1"],
    [
      "ignores names that do not start with the exact text or do not end in a number",
      ["new survey 9", " New Survey 4", "My New Survey 5", "New Survey 2a", "New Survey"],
      "New Survey 1",
    ],
    ["ignores numbers beyond the 32-bit range", ["New Survey 99999999999"], "New Survey 1"],
    ["ignores 2147483648", ["New Survey 2147483648"], "New Survey 1"],
    ["counts the largest 32-bit number", ["New Survey 2147483647"], "New Survey 2147483648"],
    ["ignores other names", ["Customer feedback", "New Survey 2", "Poll"], "New Survey 3"],
  ])("%s", (_name, names, expected) => {
    expect(nextNewSurveyName(names)).toBe(expected);
  });
});
