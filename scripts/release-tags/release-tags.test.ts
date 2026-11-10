import { describe, expect, it } from "vitest";
import { previousRelease, previousReleases, releaseTags } from "./release-tags.js";

describe("releaseTags", () => {
  it("moves the minor line and latest for a release on master", () => {
    expect(releaseTags("refs/tags/v1.2.3", { onMaster: true })).toEqual([
      "v1.2.3",
      "v1.2",
      "latest",
    ]);
  });

  it("moves the minor line but not latest for a release off master", () => {
    expect(releaseTags("refs/tags/v1.2.3", { onMaster: false })).toEqual(["v1.2.3", "v1.2"]);
  });

  it("moves no other tag for a pre-release", () => {
    expect(releaseTags("refs/tags/v1.2.3-rc.1", { onMaster: true })).toEqual(["v1.2.3-rc.1"]);
  });

  it.each([
    "refs/heads/master",
    "refs/tags/1.2.3",
    "refs/tags/v1.2",
    "v1.2.3",
    "refs/tags/v1.2.3.4",
    "",
  ])("returns null for %j", (ref) => {
    expect(releaseTags(ref, { onMaster: true })).toBeNull();
  });
});

describe("previousRelease", () => {
  it("is the highest release below the current one, skipping pre-releases", () => {
    expect(previousRelease(["v1.0.0", "v1.1.0", "v1.1.1-rc.1", "v2.0.0"], "v2.0.0")).toBe("v1.1.0");
  });

  it("is null for the first release", () => {
    expect(previousRelease(["v1.0.0"], "v1.0.0")).toBeNull();
  });

  it("compares the numbers, not the text", () => {
    expect(previousRelease(["v1.9.0", "v1.10.0", "v1.2.0", "v1.11.0"], "v1.11.0")).toBe("v1.10.0");
  });

  it("is the release below a pre-release of the next one", () => {
    expect(previousRelease(["v1.0.0", "v1.1.0", "v2.0.0-rc.1"], "v2.0.0-rc.1")).toBe("v1.1.0");
  });

  it("ignores tags that are not releases", () => {
    expect(previousRelease(["1.5.0", "v1.4", "latest", "v1.0.0"], "v2.0.0")).toBe("v1.0.0");
  });
});

describe("previousReleases", () => {
  it("lists every release below the current one, highest first, without pre-releases", () => {
    expect(
      previousReleases(
        ["v1.0.0", "v1.10.0", "v1.2.0", "v1.1.1-rc.1", "v2.0.0", "v3.0.0"],
        "v2.0.0",
      ),
    ).toEqual(["v1.10.0", "v1.2.0", "v1.0.0"]);
  });

  it("is empty for the first release", () => {
    expect(previousReleases(["v1.0.0"], "v1.0.0")).toEqual([]);
  });

  it("lists the releases below a pre-release of the next one", () => {
    expect(previousReleases(["v1.0.0", "v1.1.0", "v2.0.0-rc.1"], "v2.0.0-rc.1")).toEqual([
      "v1.1.0",
      "v1.0.0",
    ]);
  });

  it("ignores tags that are not releases", () => {
    expect(previousReleases(["1.5.0", "v1.4", "latest", "v1.0.0"], "v2.0.0")).toEqual(["v1.0.0"]);
  });
});
