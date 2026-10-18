import { describe, expect, it } from "vitest";
import { createPrivateList, privateNamesOf, withPrivacy } from "./privacy";

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

describe("privateNamesOf", () => {
  it("keeps previous names no permission names, then lists the private ones", () => {
    expect(
      privateNamesOf(
        [
          { name: "a", isPublic: true },
          { name: "b", isPublic: false },
          { name: "c", isPublic: false },
        ],
        ["gone", "a"],
      ),
    ).toEqual(["gone", "b", "c"]);
  });

  it("starts from the previous names when there are no permissions", () => {
    expect(privateNamesOf([], ["x"])).toEqual(["x"]);
  });
});

describe("createPrivateList", () => {
  const panel = (...entries: [string, boolean][]) =>
    entries.map(([name, isPublic]) => ({ name, isPublic }));

  it("keeps a private question that was hidden after it was made private", () => {
    const list = createPrivateList([]);
    expect(list.update(panel(["a", false], ["b", true]))).toEqual(["a"]);
    // "a" is hidden: the panel no longer lists it; "b" is made private next.
    expect(list.update(panel(["b", false]))).toEqual(["a", "b"]);
    expect(list.current()).toEqual(["a", "b"]);
  });

  it("starts from the list at mount and keeps names the panel never knew", () => {
    const list = createPrivateList(["gone"]);
    expect(list.update(panel(["a", false]))).toEqual(["gone", "a"]);
  });

  it("makes a question public again when the panel says so", () => {
    const list = createPrivateList(["a"]);
    expect(list.update(panel(["a", true], ["b", true]))).toEqual([]);
  });
});
