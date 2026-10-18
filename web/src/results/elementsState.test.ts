import { describe, expect, it } from "vitest";
import { reconcileElementsState } from "./elementsState";

const defaults = { elements: [{ name: "a" }, { name: "b" }, { name: "c" }] };

describe("reconcileElementsState", () => {
  it("keeps the saved order and members and appends the new defaults", () => {
    const saved = {
      locale: "",
      pageSize: 10,
      elements: [
        { name: "b", isVisible: false },
        { name: "a", width: 5 },
      ],
    };
    expect(reconcileElementsState(saved, defaults)).toEqual({
      locale: "",
      pageSize: 10,
      elements: [{ name: "b", isVisible: false }, { name: "a", width: 5 }, { name: "c" }],
    });
  });

  it("drops a saved element the survey no longer has", () => {
    const result = reconcileElementsState({ elements: [{ name: "x" }, { name: "a" }] }, defaults);
    expect(result?.elements.map((e) => e.name)).toEqual(["a", "b", "c"]);
  });

  it("renames displayname to displayName", () => {
    const result = reconcileElementsState(
      { elements: [{ name: "a", displayname: "A" }] },
      { elements: [{ name: "a" }] },
    );
    expect(result?.elements).toEqual([{ name: "a", displayName: "A" }]);
  });

  it("lets an existing displayName win", () => {
    const result = reconcileElementsState(
      { elements: [{ name: "a", displayname: "old", displayName: "New" }] },
      { elements: [{ name: "a" }] },
    );
    expect(result?.elements).toEqual([{ name: "a", displayName: "New" }]);
  });

  it.each([[null], [[]], [{}], [{ elements: 5 }]])("answers null for %j", (saved) => {
    expect(reconcileElementsState(saved, defaults)).toBeNull();
  });

  it("does not change its input", () => {
    const saved = { pageSize: 5, elements: [{ name: "a", displayname: "A" }] };
    const copy = structuredClone(saved);
    reconcileElementsState(saved, defaults);
    expect(saved).toEqual(copy);
  });
});

describe("reconcileElementsState for a Summary state", () => {
  // The Dashboard's state: a locale and one element per question, with the chart's settings.
  const summaryDefaults = {
    locale: "",
    elements: [
      { name: "q1", displayName: "Question 1", isVisible: true, isPublic: true, chartType: "bar" },
      { name: "q2", displayName: "Question 2", isVisible: true, isPublic: true, chartType: "bar" },
      { name: "q3", displayName: "Question 3", isVisible: true, isPublic: true, chartType: "bar" },
    ],
  };

  it("shows a question added after the save at the end, in default order", () => {
    const saved = {
      locale: "de",
      elements: [
        {
          name: "q2",
          displayName: "Question 2",
          isVisible: false,
          isPublic: true,
          chartType: "pie",
        },
      ],
    };
    expect(reconcileElementsState(saved, summaryDefaults)).toEqual({
      locale: "de",
      elements: [
        {
          name: "q2",
          displayName: "Question 2",
          isVisible: false,
          isPublic: true,
          chartType: "pie",
        },
        summaryDefaults.elements[0],
        summaryDefaults.elements[2],
      ],
    });
  });

  it("drops a question the survey no longer has and keeps the saved order", () => {
    const saved = {
      locale: "",
      elements: [{ name: "q3" }, { name: "gone", chartType: "pie" }, { name: "q1" }],
    };
    const result = reconcileElementsState(saved, summaryDefaults);
    expect(result?.elements.map((e) => e.name)).toEqual(["q3", "q1", "q2"]);
  });
});
