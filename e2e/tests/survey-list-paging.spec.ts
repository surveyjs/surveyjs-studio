import type { Page } from "@playwright/test";
import { signInAt } from "./support/sign-in.js";
import { loadAllPages, loadMoreButton, surveyRows } from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// Memory mode only (it writes many surveys). Engineering is a scope tests may write to; the other
// browsers fill it at the same time (and the survey actions spec moves surveys through it), so the
// test only makes sure it holds more than one page, with a margin.

const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const PAGE_SIZE = 50;
// The survey actions spec moves surveys into Engineering and out again while this runs.
const MARGIN = 10;

async function activeEngineeringSurveyCount(page: Page): Promise<number> {
  const response = await page.request.get(
    `/api/v1/surveys?project=${ENGINEERING}&archived=false&limit=200`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: unknown[] };
  return body.items.length;
}

/** Creates surveys in Engineering through the API until it holds more than one page. */
async function fillEngineering(page: Page, browserName: string): Promise<void> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "msid_csrf");
  expect(csrf).toBeDefined();
  const headers = { "X-CSRF-Token": decodeURIComponent(csrf?.value ?? "") };
  const missing = PAGE_SIZE + MARGIN + 1 - (await activeEngineeringSurveyCount(page));
  for (let i = 1; i <= missing; i++) {
    const response = await page.request.post("/api/v1/surveys", {
      headers,
      data: { name: `Paging ${browserName} ${i}`, projectId: ENGINEERING },
    });
    expect(response.status()).toBe(201);
  }
  expect(await activeEngineeringSurveyCount(page)).toBeGreaterThan(PAGE_SIZE + MARGIN);
}

test("a list longer than one page loads the rest with Load more", async ({ page, browserName }) => {
  await signInAt(page, "/", "admin");
  await fillEngineering(page, browserName);

  await page.goto(`/?project=${ENGINEERING}`);
  const rows = surveyRows(page);
  const loadMore = loadMoreButton(page);
  await expect(rows).toHaveCount(PAGE_SIZE);
  await expect(loadMore).toBeVisible();

  // Each click must add rows, until the list ends and the button goes.
  await loadAllPages(page);
  await expect(loadMore).toHaveCount(0);
  const texts = await rows.allInnerTexts();
  expect(texts.length).toBeGreaterThan(PAGE_SIZE);
  // A row's text is its name and its two dates; no row may come twice.
  expect(new Set(texts).size).toBe(texts.length);
});
