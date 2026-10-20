import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { FEEDBACK_NAME, PROJECT_NAME, type VisualStates } from "../data-set.js";
import { LIVE_ORIGIN, SCREENS } from "../manifest.js";
import type { VisualIds } from "../support/paths.js";
import { compareNames, expectedScopes } from "../support/preconditions.js";
import { openScreen, screenshotOptions } from "../support/screen.js";
import { guardLiveContext } from "./route-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const STATES_FILE = resolve(here, "../baselines/states.json");
const FIX_MESSAGE =
  "Fix these in the dedicated account (pnpm visual:capture --checklist) and run again.";

const LIST_ITEM = ".v2-class---my-surveys-page__list-item";
const SURVEY_NAME = ".v2-class---my-surveys-page__survey-name";
const CONTEXT_BUTTON = ".v2-class---my-surveys-page__survey-context-menu-button";
const HISTORY_ITEM = ".my-surveys-history-item";

test.describe.configure({ mode: "serial" });

let ids: VisualIds = {};

/** The same safeguards `openScreen` sets, for the pages the preconditions read. */
async function prepare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("isInformedAboutCookieAndPolicies", "true");
      localStorage.setItem("isTourRejected", "true");
      localStorage.setItem("expiredNotificationDateTime", "seen");
      localStorage.setItem("expiresSoonNotificationDateTime", "seen");
    } catch {
      // storage can be blocked
    }
  });
}

async function listNames(page: Page, path: string): Promise<string[]> {
  await page.goto(`${LIVE_ORIGIN}${path}`);
  await page.locator(".v2-class---my-surveys-page").first().waitFor({ state: "visible" });
  // An empty list has no rows: give a slow page a moment, then read what is there.
  await page
    .locator(LIST_ITEM)
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {
      // no rows: compareNames reports the missing names
    });
  return (await page.locator(`${LIST_ITEM} ${SURVEY_NAME}`).allInnerTexts()).map((text) =>
    text.trim(),
  );
}

async function libraryVersions(page: Page, path: string): Promise<Record<string, string | null>> {
  await page.goto(`${LIVE_ORIGIN}${path}`);
  await page.waitForLoadState("load");
  return page.evaluate(() => {
    const read = (name: "Survey" | "SurveyCreatorCore" | "SurveyAnalytics") => {
      const library = (window as unknown as Record<string, { Version?: string } | undefined>)[name];
      return library?.Version ?? null;
    };
    return {
      Survey: read("Survey"),
      SurveyCreatorCore: read("SurveyCreatorCore"),
      SurveyAnalytics: read("SurveyAnalytics"),
    };
  });
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(10 * 60_000);
  const page = await browser.newPage();
  const writes = await guardLiveContext(page.context());
  await prepare(page);
  const problems: string[] = [];
  const attempt = async (what: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      problems.push(`${what}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    }
  };
  const next: VisualIds = {};
  const states: VisualStates = { historyEntries: 0, feedbackPublished: false, liveVersions: {} };
  try {
    const [active, archived, project] = expectedScopes();
    await attempt(active!.label, async () => {
      const names = await listNames(page, "/Service/MySurveys/personal?type=list");
      problems.push(...compareNames(active!.label, active!.names, names));
    });

    // The feedback row's context-menu button carries the ids and the published flag.
    await attempt(`${FEEDBACK_NAME} row`, async () => {
      const button = page
        .locator(`${LIST_ITEM}:has-text("${FEEDBACK_NAME}")`)
        .first()
        .locator(CONTEXT_BUTTON);
      const [surveyId, resultId, published] = await Promise.all([
        button.getAttribute("data-surveyid", { timeout: 5_000 }),
        button.getAttribute("data-resultid", { timeout: 5_000 }),
        button.getAttribute("data-ispublished", { timeout: 5_000 }),
      ]);
      if (surveyId) next.feedbackId = surveyId;
      else problems.push(`${FEEDBACK_NAME}: no survey id found`);
      if (resultId) next.feedbackResultId = resultId;
      else problems.push(`${FEEDBACK_NAME}: no result id found`);
      // Not a problem: on live the flag stays false after Publish; it is recorded in states.json.
      states.feedbackPublished = published?.toLowerCase() === "true";
    });

    // The project selector lists the projects as links /Service/MySurveys/{id}.
    await attempt("Projects", async () => {
      const links = await page.locator('a[href*="/Service/MySurveys/"]').evaluateAll((anchors) =>
        anchors.map((anchor) => ({
          href: anchor.getAttribute("href") ?? "",
          text: (anchor.textContent ?? "").trim(),
        })),
      );
      const found = new Map<string, string>();
      for (const { href, text } of links) {
        const match = /\/Service\/MySurveys\/([^/?#]+)/i.exec(href);
        if (match?.[1] && match[1].toLowerCase() !== "personal" && text) found.set(match[1], text);
      }
      const names = [...found.values()];
      if (names.length !== 1 || names[0] !== PROJECT_NAME) {
        const shown = names.length === 0 ? "none" : names.map((name) => `"${name}"`).join(", ");
        problems.push(`Projects: expected exactly one "${PROJECT_NAME}", found ${shown}`);
      }
      const entry = [...found.entries()].find(([, name]) => name === PROJECT_NAME);
      if (entry) next.projectId = entry[0];
    });

    await attempt(archived!.label, async () => {
      const names = await listNames(page, "/Service/MySurveys/personal?type=archived");
      problems.push(...compareNames(archived!.label, archived!.names, names));
    });
    await attempt(project!.label, async () => {
      if (next.projectId === undefined) return;
      const names = await listNames(page, `/Service/MySurveys/${next.projectId}?type=list`);
      problems.push(...compareNames(project!.label, project!.names, names));
    });

    if (next.feedbackId !== undefined) {
      await attempt("Details total", async () => {
        await page.goto(`${LIVE_ORIGIN}/Service/SurveyResults/${next.feedbackId}#info`);
        const total = page
          .locator('.survey-results-header-line:has-text("Total responses:") span')
          .last();
        await total.waitFor({ state: "visible", timeout: 30_000 });
        try {
          await expect(total).toHaveText("3", { timeout: 30_000 });
        } catch {
          const text = ((await total.textContent()) ?? "").trim();
          problems.push(`Details: total responses is "${text}", expected "3"`);
        }
      });
      // An empty history is not a problem: the count is recorded as 0 (the history screen is skipped).
      await attempt("History", async () => {
        await page.goto(`${LIVE_ORIGIN}/Service/History/${next.feedbackId}`);
        await page.waitForLoadState("load");
        await page
          .locator(HISTORY_ITEM)
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => {
            // no entries: the count below is 0
          });
        states.historyEntries = await page.locator(HISTORY_ITEM).count();
      });
      await attempt("Library versions (editor)", async () => {
        const editor = await libraryVersions(page, `/Service/EditSurvey/${next.feedbackId}`);
        states.liveVersions["Survey"] = editor["Survey"] ?? null;
        states.liveVersions["SurveyCreatorCore"] = editor["SurveyCreatorCore"] ?? null;
      });
      await attempt("Library versions (results)", async () => {
        const results = await libraryVersions(
          page,
          `/Service/SurveyResults/${next.feedbackId}#summary`,
        );
        states.liveVersions["SurveyAnalytics"] = results["SurveyAnalytics"] ?? null;
      });
    }

    if (next.feedbackResultId !== undefined) {
      await attempt("Public results", async () => {
        await page.goto(`${LIVE_ORIGIN}/Results/Survey/${next.feedbackResultId}`);
        const denied = "access is not granted: turn Grant Access on (Details tab)";
        if (/authorizationerror/i.test(page.url())) throw new Error(denied);
        await Promise.race([
          page.locator("[data-question]").first().waitFor({ state: "attached", timeout: 30_000 }),
          page.waitForURL(/authorizationerror/i, { timeout: 30_000 }).then(() => {
            throw new Error(denied);
          }),
        ]);
      });
    }
    if (writes.length > 0) problems.push(`Blocked writes while checking: ${writes.join("; ")}`);
  } finally {
    await page.context().close();
  }

  if (problems.length > 0) {
    throw new Error(
      `The live account is not as the data set needs:\n- ${problems.join("\n- ")}\n${FIX_MESSAGE}`,
    );
  }
  ids = next;

  if (testInfo.project.name === "chromium") {
    const playwrightVersion = (
      createRequire(import.meta.url)("@playwright/test/package.json") as { version: string }
    ).version;
    const output: VisualStates = {
      capturedAt: new Date().toISOString(),
      playwright: playwrightVersion,
      historyEntries: states.historyEntries,
      feedbackPublished: states.feedbackPublished,
      liveVersions: states.liveVersions,
    };
    mkdirSync(dirname(STATES_FILE), { recursive: true });
    writeFileSync(STATES_FILE, `${JSON.stringify(output, null, 2)}\n`);
  }
});

for (const screen of SCREENS) {
  test(screen.id, async ({ page, context }, testInfo) => {
    test.skip(screen.skip !== undefined, screen.skip ?? "");
    const writes = await guardLiveContext(context);
    let failure: unknown;
    try {
      const target = await openScreen(page, screen, "live", ids);
      await expect(target).toHaveScreenshot(
        `${screen.id}.png`,
        screenshotOptions(page, screen, "live"),
      );
    } catch (error) {
      failure = error;
    }
    if (writes.length > 0) {
      // The page tried to change the site: its screenshot may show a failed save, so none is kept.
      rmSync(testInfo.snapshotPath(`${screen.id}.png`, { kind: "screenshot" }), { force: true });
      throw new Error(`The page tried to write to the live site (blocked): ${writes.join("; ")}`);
    }
    if (failure !== undefined) throw failure;
  });
}
