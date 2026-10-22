import { describe, expect, it } from "vitest";
import { SCREENS } from "../manifest.js";
import { checksOf } from "./screen.js";

describe("checksOf", () => {
  it("leaves the steps out: a step is checked when it runs, and its element may be gone after", () => {
    const embed = SCREENS.find((screen) => screen.id === "editor-embed")!;
    for (const side of ["live", "app"] as const) {
      const checks = checksOf(embed, side);
      expect(checks.some((check) => check.kind === "step")).toBe(false);
      expect(checks.map((check) => check.selector)).not.toContain(
        '.svc-tabbed-menu-item__popup li:has-text("Embed Survey")',
      );
      expect(checks[0]).toMatchObject({ kind: "ready", selector: embed[side].ready });
    }
  });

  it("still lists ready, target, hide, mask and normalization selectors", () => {
    const kinds = new Set(SCREENS.flatMap((s) => checksOf(s, "live").map((c) => c.kind)));
    expect(kinds).toEqual(new Set(["ready", "target", "hide", "mask", "normalize"]));
  });
});
