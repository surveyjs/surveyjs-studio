import { describe, expect, it } from "vitest";
import {
  HEADER_NORMALIZATIONS,
  KIND_LIMITS,
  LIVE_ORIGIN,
  SCREENS,
  type Adjustment,
  type Screen,
  type SideSpec,
} from "./manifest.js";

const PLACEHOLDERS = new Set(["feedbackId", "feedbackResultId", "projectId"]);
const CATEGORIES = new Set(["departure", "library", "live-data", "rendering"]);
const FORBIDDEN = new Set(["body", "html", "main", "#root", ".svc-creator", ".sa-dashboard"]);

const sides = (screen: Screen): [string, SideSpec][] => [
  ["live", screen.live],
  ["app", screen.app],
];
const adjustments = (spec: SideSpec): Adjustment[] => [...(spec.hide ?? []), ...(spec.mask ?? [])];

describe("the screen manifest", () => {
  it("has 18 screens with unique kebab-case ids", () => {
    expect(SCREENS).toHaveLength(18);
    const ids = SCREENS.map((screen) => screen.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("groups and classifies the screens as the plan does", () => {
    expect(SCREENS.map((s) => [s.id, s.group, s.kind])).toEqual([
      ["list-active", "list", "page"],
      ["list-archived", "list", "page"],
      ["list-project", "list", "page"],
      ["list-project-selector", "list", "page"],
      ["list-row-menu", "list", "page"],
      ["list-row-menu-ids", "list", "page"],
      ["shell-cookie-banner", "list", "element"],
      ["shell-footer", "list", "element"],
      ["editor-designer", "pages", "library"],
      ["editor-embed", "pages", "library"],
      ["history", "pages", "page"],
      ["run", "pages", "library"],
      ["projects", "pages", "element"],
      ["projects-expanded", "pages", "element"],
      ["results-summary", "results", "library"],
      ["results-table", "results", "library"],
      ["results-details", "results", "page"],
      ["public-results", "results", "library"],
    ]);
  });

  it("uses known placeholders in paths that start with /", () => {
    for (const screen of SCREENS) {
      for (const [side, spec] of sides(screen)) {
        expect(spec.path, `${screen.id} ${side}`).toMatch(/^\//);
        for (const match of spec.path.matchAll(/\{(\w+)\}/g)) {
          expect(PLACEHOLDERS.has(match[1] ?? ""), `${screen.id} ${side} {${match[1]}}`).toBe(true);
        }
      }
    }
  });

  it("gives every adjustment and normalization a reason and a category", () => {
    for (const screen of SCREENS) {
      const all = [
        ...sides(screen).flatMap(([, spec]) => adjustments(spec)),
        ...(screen.normalize ?? []),
      ];
      for (const item of all) {
        expect(item.reason.trim(), screen.id).not.toBe("");
        expect(CATEGORIES.has(item.category), screen.id).toBe(true);
      }
    }
    for (const item of HEADER_NORMALIZATIONS) {
      expect(item.reason.trim()).not.toBe("");
      expect(CATEGORIES.has(item.category)).toBe(true);
    }
  });

  it("keeps maxDiffPixelRatio within the kind's cap, above the default only with a reason", () => {
    for (const screen of SCREENS) {
      const limits = KIND_LIMITS[screen.kind];
      expect(screen.maxDiffPixelRatio, screen.id).toBeLessThanOrEqual(limits.cap);
      if (screen.maxDiffPixelRatio > limits.default) {
        expect((screen.thresholdReason ?? "").trim(), screen.id).not.toBe("");
      }
    }
  });

  it("never hides or masks a whole screen", () => {
    for (const screen of SCREENS) {
      for (const [side, spec] of sides(screen)) {
        for (const item of adjustments(spec)) {
          expect(
            FORBIDDEN.has(item.selector.trim()),
            `${screen.id} ${side}: ${item.selector}`,
          ).toBe(false);
        }
      }
    }
  });

  it("normalizes the header on every screen that shows it", () => {
    for (const screen of SCREENS) {
      const showsHeader =
        screen.id !== "run" && screen.id !== "public-results" && !screen.live.target;
      if (screen.id === "public-results") {
        // the live page shows the header, the app page has none: optional header normalizations
        for (const header of HEADER_NORMALIZATIONS) {
          expect(screen.normalize ?? [], screen.id).toContainEqual(
            expect.objectContaining({
              live: header.live,
              app: header.app,
              text: header.text,
              optional: true,
            }),
          );
        }
      }
      if (!showsHeader) continue;
      for (const header of HEADER_NORMALIZATIONS) {
        expect(screen.normalize ?? [], screen.id).toContainEqual(header);
      }
    }
  });

  it("presets the cookie flag everywhere except the banner screen", () => {
    expect(SCREENS.filter((s) => s.cookieBanner === true).map((s) => s.id)).toEqual([
      "shell-cookie-banner",
    ]);
  });

  it("has the thresholds of the plan and the live origin", () => {
    expect(KIND_LIMITS).toEqual({
      page: { default: 0.005, cap: 0.01 },
      element: { default: 0.01, cap: 0.02 },
      library: { default: 0.02, cap: 0.05 },
    });
    expect(LIVE_ORIGIN).toBe("https://surveyjs.io");
  });
});
