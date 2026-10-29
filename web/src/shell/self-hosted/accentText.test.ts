import { describe, expect, it } from "vitest";
import { accentTextColor, contrastWithWhite } from "./accentText";

describe("accentTextColor", () => {
  it("darkens the default SurveyJS green until text in it reads on white (WCAG AA, 4.5:1)", () => {
    expect(contrastWithWhite("#19b394")).toBeLessThan(4.5);
    const text = accentTextColor("#19b394");
    expect(contrastWithWhite(text)).toBeGreaterThanOrEqual(4.5);
    expect(text).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(["#0a7d4f", "#000", "#1a1a6e"])("keeps %s, dark enough already", (colour) => {
    expect(accentTextColor(colour)).toBe(
      colour.length === 4 ? `#${[...colour.slice(1)].map((c) => c + c).join("")}` : colour,
    );
  });

  it("makes even white readable", () => {
    expect(contrastWithWhite(accentTextColor("#fff"))).toBeGreaterThanOrEqual(4.5);
  });
});
