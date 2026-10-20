import { describe, expect, it } from "vitest";
import { baselinesRoot, resolvePath, SNAPSHOT_PATH_TEMPLATE, statesFile } from "./paths.js";

describe("resolvePath", () => {
  it("fills every placeholder", () => {
    expect(
      resolvePath("/a/{feedbackId}/b/{projectId}?r={feedbackResultId}", {
        feedbackId: "f1",
        projectId: "p1",
        feedbackResultId: "r1",
      }),
    ).toBe("/a/f1/b/p1?r=r1");
  });

  it("leaves a path without placeholders as it is", () => {
    expect(resolvePath("/projects", {})).toBe("/projects");
  });

  it("refuses a placeholder without an id", () => {
    expect(() => resolvePath("/surveys/{feedbackId}/edit", {})).toThrow(
      "Unknown placeholder {feedbackId} in /surveys/{feedbackId}/edit",
    );
  });
});

describe("baseline locations", () => {
  it("names the snapshot template", () => {
    expect(SNAPSHOT_PATH_TEMPLATE).toBe(
      "{testDir}/../baselines/{platform}/{projectName}/{arg}{ext}",
    );
  });

  it("names both roots and the states file", () => {
    expect(baselinesRoot("live")).toBe("e2e/visual/baselines");
    expect(baselinesRoot("self")).toBe("e2e/visual/.self-baselines");
    expect(statesFile()).toBe("e2e/visual/baselines/states.json");
  });
});
