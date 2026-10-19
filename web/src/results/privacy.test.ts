import { describe, expect, it } from "vitest";
import {
  applyPrivacyChange,
  combinePrivacyChanges,
  createPrivacyTracker,
  withPrivacy,
} from "./privacy";

describe("withPrivacy", () => {
  it("sets isPublic from the private names and keeps everything else", () => {
    const state = {
      locale: "",
      elements: [
        { name: "a", isVisible: false },
        { name: "b", isPublic: false },
      ],
    };

    expect(withPrivacy(state, ["a"])).toEqual({
      locale: "",
      elements: [
        { name: "a", isVisible: false, isPublic: false },
        { name: "b", isPublic: true },
      ],
    });
    expect(state.elements[0]).toEqual({ name: "a", isVisible: false });
    expect(state.elements[1]).toEqual({ name: "b", isPublic: false });
  });
});

describe("applyPrivacyChange", () => {
  it("removes the names made public, appends the ones made private and keeps the rest", () => {
    expect(
      applyPrivacyChange(["other", "a", "b"], { madePrivate: ["c", "b"], madePublic: ["a"] }),
    ).toEqual(["other", "b", "c"]);
  });

  it("leaves the input alone", () => {
    const names = ["a"];
    applyPrivacyChange(names, { madePrivate: ["b"], madePublic: ["a"] });
    expect(names).toEqual(["a"]);
  });
});

describe("combinePrivacyChanges", () => {
  it("lets the newer change win for a name both touch", () => {
    expect(
      combinePrivacyChanges(
        { madePrivate: ["a", "b"], madePublic: ["c"] },
        { madePrivate: ["c"], madePublic: ["a"] },
      ),
    ).toEqual({ madePrivate: ["b", "c"], madePublic: ["a"] });
  });
});

describe("createPrivacyTracker", () => {
  const panel = (...entries: [string, boolean][]) =>
    entries.map(([name, isPublic]) => ({ name, isPublic }));

  it("reports only the names whose isPublic flipped", () => {
    const tracker = createPrivacyTracker(["a"]);
    expect(tracker.change(panel(["a", false], ["b", false], ["c", true]))).toEqual({
      madePrivate: ["b"],
      madePublic: [],
    });
    expect(tracker.change(panel(["a", true], ["b", false], ["c", true]))).toEqual({
      madePrivate: [],
      madePublic: ["a"],
    });
    expect(tracker.current()).toEqual(["b"]);
  });

  it("keeps a private question that was hidden after it was made private", () => {
    const tracker = createPrivacyTracker([]);
    expect(tracker.change(panel(["a", false], ["b", true]))).toEqual({
      madePrivate: ["a"],
      madePublic: [],
    });
    // "a" is hidden: the panel no longer lists it; "b" is made private next.
    expect(tracker.change(panel(["b", false]))).toEqual({ madePrivate: ["b"], madePublic: [] });
    expect(tracker.current()).toEqual(["a", "b"]);
  });

  it("starts from the list at mount and keeps names the panel never knew", () => {
    const tracker = createPrivacyTracker(["gone"]);
    tracker.change(panel(["a", false]));
    expect(tracker.current()).toEqual(["gone", "a"]);
  });
});
