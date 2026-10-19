import { describe, expect, it } from "vitest";
import type { SurveyDefinition } from "../domain/types.js";
import { commentSuffixOf, privateKeysOf, questionsOf, withoutKeys } from "./definition.js";

const definition: SurveyDefinition = {
  pages: [
    {
      elements: [
        { type: "text", name: "a" },
        {
          type: "panel",
          name: "p",
          elements: [
            { type: "checkbox", name: "b", showOtherItem: true },
            { type: "panel", elements: [{ type: "text", name: "c", valueName: "cv" }] },
          ],
        },
        { type: "html", name: "h" },
        { type: "image", name: "i" },
        {
          type: "paneldynamic",
          name: "d",
          templateElements: [{ type: "text", name: "inner" }],
        },
        { type: "matrix", name: "m" },
        { type: "text", name: "a" },
      ],
    },
    { elements: [{ type: "comment", name: "e", hasComment: true }] },
  ],
};

describe("questionsOf", () => {
  it("lists the answer-holding questions in definition order, panels flattened", () => {
    const found = questionsOf(definition);
    expect(found.map((question) => question.name)).toStrictEqual(["a", "b", "c", "d", "m", "e"]);
    expect(found.map((question) => question.key)).toStrictEqual(["a", "b", "cv", "d", "m", "e"]);
    expect(
      found.filter((question) => question.hasComment).map((question) => question.name),
    ).toStrictEqual(["b", "e"]);
  });

  it("reads a root with elements and no pages as one page", () => {
    const found = questionsOf({ elements: [{ type: "text", name: "x" }] });
    expect(found.map((question) => question.name)).toStrictEqual(["x"]);
  });

  it("returns nothing for an empty definition", () => {
    expect(questionsOf({})).toStrictEqual([]);
  });
});

describe("commentSuffixOf", () => {
  it("defaults to -Comment", () => {
    expect(commentSuffixOf({})).toBe("-Comment");
  });

  it("uses commentPrefix when commentSuffix is absent", () => {
    expect(commentSuffixOf({ commentPrefix: "_c" })).toBe("_c");
  });

  it("prefers commentSuffix when both are set", () => {
    expect(commentSuffixOf({ commentSuffix: "_s", commentPrefix: "_c" })).toBe("_s");
  });
});

describe("privateKeysOf", () => {
  it("lists the name and the valueName, each with and without the comment suffix", () => {
    expect(privateKeysOf(definition, ["c"])).toStrictEqual(
      new Set(["c", "c-Comment", "cv", "cv-Comment"]),
    );
  });

  it("also strips the default and the older suffixes, which old responses keep", () => {
    const renamed = { ...definition, commentSuffix: "_note", commentPrefix: "-other" };
    expect(privateKeysOf(renamed, ["a"])).toStrictEqual(
      new Set(["a", "a_note", "a-Comment", "a-other"]),
    );
    const older = { ...definition, commentPrefix: "-other" };
    expect(privateKeysOf(older, ["a"])).toStrictEqual(new Set(["a", "a-other", "a-Comment"]));
  });

  it("is empty when no question is private", () => {
    expect(privateKeysOf(definition, [])).toStrictEqual(new Set());
  });
});

describe("withoutKeys", () => {
  it("returns a copy without the keys and leaves the input unchanged", () => {
    const data = { a: 1, c: 2 };
    expect(withoutKeys(data, new Set(["c"]))).toStrictEqual({ a: 1 });
    expect(data).toStrictEqual({ a: 1, c: 2 });
  });

  it("returns the same object when there is nothing to remove", () => {
    const data = { a: 1 };
    expect(withoutKeys(data, new Set())).toBe(data);
  });
});
