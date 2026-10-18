import { describe, expect, it } from "vitest";
import { reconcileTableState } from "./tableState";

const defaults = { elements: [{ name: "a" }, { name: "b" }, { name: "c" }] };

describe("reconcileTableState", () => {
  it("keeps the saved order and members and appends the new defaults", () => {
    const saved = {
      locale: "",
      pageSize: 10,
      elements: [
        { name: "b", isVisible: false },
        { name: "a", width: 5 },
      ],
    };
    expect(reconcileTableState(saved, defaults)).toEqual({
      locale: "",
      pageSize: 10,
      elements: [{ name: "b", isVisible: false }, { name: "a", width: 5 }, { name: "c" }],
    });
  });

  it("drops a saved element the survey no longer has", () => {
    const result = reconcileTableState({ elements: [{ name: "x" }, { name: "a" }] }, defaults);
    expect(result?.elements.map((e) => e.name)).toEqual(["a", "b", "c"]);
  });

  it("renames displayname to displayName", () => {
    const result = reconcileTableState(
      { elements: [{ name: "a", displayname: "A" }] },
      { elements: [{ name: "a" }] },
    );
    expect(result?.elements).toEqual([{ name: "a", displayName: "A" }]);
  });

  it("lets an existing displayName win", () => {
    const result = reconcileTableState(
      { elements: [{ name: "a", displayname: "old", displayName: "New" }] },
      { elements: [{ name: "a" }] },
    );
    expect(result?.elements).toEqual([{ name: "a", displayName: "New" }]);
  });

  it.each([[null], [[]], [{}], [{ elements: 5 }]])("answers null for %j", (saved) => {
    expect(reconcileTableState(saved, defaults)).toBeNull();
  });

  it("does not change its input", () => {
    const saved = { pageSize: 5, elements: [{ name: "a", displayname: "A" }] };
    const copy = structuredClone(saved);
    reconcileTableState(saved, defaults);
    expect(saved).toEqual(copy);
  });
});
