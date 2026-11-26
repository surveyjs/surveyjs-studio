import { describe, expect, it } from "vitest";
import { answerNamesOf } from "./layout.js";

describe("answerNamesOf", () => {
  it("lists each question's key, and the comment name for a question with a comment area", () => {
    const definition = {
      commentSuffix: "_c",
      pages: [
        {
          elements: [
            { type: "text", name: "a" },
            {
              type: "panel",
              elements: [{ type: "comment", name: "b", valueName: "bv", hasComment: true }],
            },
            { type: "html", name: "h" },
          ],
        },
      ],
    };
    expect(answerNamesOf(definition)).toEqual(["a", "bv", "bv_c"]);
  });

  it("is empty for an empty definition", () => {
    expect(answerNamesOf({})).toEqual([]);
  });
});
