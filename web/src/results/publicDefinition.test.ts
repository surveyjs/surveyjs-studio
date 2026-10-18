import { describe, expect, it } from "vitest";
import { withoutQuestions } from "./publicDefinition";

describe("withoutQuestions", () => {
  it("drops the named questions from pages and panels and leaves the input alone", () => {
    const definition = {
      title: "T",
      pages: [
        {
          name: "p1",
          elements: [
            { type: "text", name: "q1" },
            { type: "text", name: "q2" },
            {
              type: "panel",
              name: "box",
              elements: [
                { type: "text", name: "q2" },
                { type: "text", name: "q3" },
              ],
            },
          ],
        },
      ],
      elements: [
        { type: "text", name: "q2" },
        { type: "text", name: "q4" },
      ],
    };
    const copy = JSON.parse(JSON.stringify(definition));
    expect(withoutQuestions(definition, ["q2"])).toEqual({
      title: "T",
      pages: [
        {
          name: "p1",
          elements: [
            { type: "text", name: "q1" },
            { type: "panel", name: "box", elements: [{ type: "text", name: "q3" }] },
          ],
        },
      ],
      elements: [{ type: "text", name: "q4" }],
    });
    expect(definition).toEqual(copy);
  });

  it("returns the definition as is when nothing is private", () => {
    const definition = { elements: [{ type: "text", name: "q1" }] };
    expect(withoutQuestions(definition, [])).toEqual(definition);
  });
});
