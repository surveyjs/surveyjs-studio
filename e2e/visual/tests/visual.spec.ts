import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENS, type Screen } from "../manifest.js";
import { openScreen, screenshotOptions } from "../support/screen.js";
import type { VisualIds } from "../support/paths.js";
import { VIEW_404 } from "../../tests/support/results.js";
import { expect, test } from "../../tests/support/test.js";

const here = dirname(fileURLToPath(import.meta.url));
const BRAND_IMAGE = readFileSync(resolve(here, "../support/assets/poweredby.svg"));
const SELF = process.env["VISUAL_BASELINES"] === "self";

// The Form Library's footer asks surveyjs.io for this image (survey-core "poweredby.svg"); it is
// answered here with the legacy site's own file. Nothing else leaves the machine.
const BRAND_IMAGE_URL = "https://surveyjs.io/Content/Images/poweredby.svg";

function isLocal(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function readIds(): VisualIds {
  return JSON.parse(readFileSync(resolve(here, "../.state/app-ids.json"), "utf8")) as VisualIds;
}

// A user without a saved results layout reads 404 view-not-found, which browsers log.
test.use({ expectedErrorResponses: [VIEW_404] });

const groups = ["list", "pages", "results"] as const;

for (const group of groups) {
  test.describe(group, () => {
    for (const screen of SCREENS.filter((item: Screen) => item.group === group)) {
      test(screen.id, async ({ page, context }, testInfo) => {
        test.skip(screen.skip !== undefined, screen.skip ?? "");
        const aborted: string[] = [];
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (isLocal(url)) return route.fallback();
          if (url === BRAND_IMAGE_URL) {
            return route.fulfill({
              status: 200,
              contentType: "image/svg+xml",
              body: BRAND_IMAGE,
            });
          }
          aborted.push(`${route.request().method()} ${url}`);
          return route.abort();
        });

        const baseline = testInfo.snapshotPath(`${screen.id}.png`, { kind: "screenshot" });
        // Declared in the manifest: the screen waits for its first capture, so a missing image is
        // not a failure. The app side is still opened and attached, so it is checked and visible.
        let awaiting = false;
        if (existsSync(baseline)) {
          await testInfo.attach("surveyjs.io (baseline)", {
            path: baseline,
            contentType: "image/png",
          });
        } else if (!SELF && screen.awaitingBaseline !== undefined) {
          awaiting = true;
        } else if (!SELF) {
          throw new Error(
            `Missing surveyjs.io baseline ${baseline}. Baselines are captured by a person: docs/testing.md › Visual parity › Capturing baselines.`,
          );
        }

        const target = await openScreen(page, screen, "app", readIds());
        const options = screenshotOptions(page, screen, "app");
        if (awaiting) {
          await testInfo.attach("app", {
            body: await target.screenshot(options),
            contentType: "image/png",
          });
          expect(aborted, "requests to other hosts were aborted").toEqual([]);
          test.skip(true, `No surveyjs.io baseline yet: ${screen.awaitingBaseline}`);
        }
        try {
          await expect(target).toHaveScreenshot(`${screen.id}.png`, options);
        } finally {
          await testInfo.attach("app", {
            body: await target.screenshot(options),
            contentType: "image/png",
          });
        }
        expect(aborted, "requests to other hosts were aborted").toEqual([]);
      });
    }
  });
}
