import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HISTORY_SAVES, type VisualStates } from "./data-set.js";
import { SCREENS } from "./manifest.js";

// The committed states belong to the committed images: the capture writes both in one run. A states
// file left from an older capture (or restored by a git command while a capture ran, 2026-10-22)
// gives the app's survey another history length than the images show.
const baselines = resolve(dirname(fileURLToPath(import.meta.url)), "baselines");
const states = JSON.parse(readFileSync(resolve(baselines, "states.json"), "utf8")) as VisualStates;

/** Every committed `<platform>/<browser>/history.png`. */
function historyImages(): string[] {
  const found: string[] = [];
  for (const platform of readdirSync(baselines, { withFileTypes: true })) {
    if (!platform.isDirectory()) continue;
    for (const browser of readdirSync(resolve(baselines, platform.name), { withFileTypes: true })) {
      const image = resolve(baselines, platform.name, browser.name, "history.png");
      if (browser.isDirectory() && existsSync(image)) found.push(image);
    }
  }
  return found;
}

describe("the committed capture states", () => {
  it("record when and with which Playwright the capture ran", () => {
    expect(Number.isNaN(Date.parse(states.capturedAt ?? ""))).toBe(false);
    expect(states.playwright).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("record at least the history the capture checklist makes when a history image exists", () => {
    expect(SCREENS.some((screen) => screen.id === "history")).toBe(true);
    expect(historyImages().length).toBeGreaterThan(0);
    // The capture refuses fewer entries, so a smaller count is a states file of another capture.
    expect(states.historyEntries).toBeGreaterThanOrEqual(HISTORY_SAVES);
  });
});
