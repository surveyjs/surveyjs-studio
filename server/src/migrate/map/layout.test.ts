import { describe, expect, it } from "vitest";
import { answerNamesOf, layoutPrivateNames } from "./layout.js";

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

describe("layoutPrivateNames", () => {
  it("treats no text and empty text as no layout, bad text as unreadable, and removes a BOM", () => {
    expect(layoutPrivateNames(null, ["a"])).toEqual([]);
    expect(layoutPrivateNames("", ["a"])).toEqual([]);
    expect(layoutPrivateNames("nope", ["a"])).toBeNull();
    expect(layoutPrivateNames("[]", ["a"])).toBeNull();
    expect(layoutPrivateNames('\uFEFF{"columns":[{"name":"a","visibility":1}]}', [])).toEqual([
      "a",
      "HappendAt",
      "InstanceId",
    ]);
  });
});
