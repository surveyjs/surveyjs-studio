import { describe, expect, it } from "vitest";
import { privateNamesOf, withPrivacy } from "./privacy";

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
