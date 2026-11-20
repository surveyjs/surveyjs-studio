import { describe, expect, it } from "vitest";
import { viewStateOf } from "./view-state.js";

describe("viewStateOf", () => {
  it("parses a JSON object", () => {
    expect(viewStateOf(' {\n "b": 1, "a": [2] }\n')).toEqual({ b: 1, a: [2] });
  });

  it.each(["[1]", '"x"', "5", "null", "not json", ""])("is null for %j", (text) => {
    expect(viewStateOf(text)).toBeNull();
  });
});
