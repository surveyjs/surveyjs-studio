import type { Locator, Page } from "@playwright/test";
import { expect } from "./test.js";

/** The rows of the My Surveys list, in display order. */
export function surveyRows(page: Page): Locator {
  return page.locator(".v2-class---my-surveys-page__list-item");
}

/** The survey names of the list, in display order. */
export function surveyNames(page: Page): Locator {
  return page.locator(".v2-class---my-surveys-page__survey-name");
}

/** The list's names that equal `name` exactly. */
export function surveysNamed(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return surveyNames(page).filter({ hasText: new RegExp(`^${escaped}$`) });
}

export function loadMoreButton(page: Page): Locator {
  return page.getByRole("button", { name: "Load more" });
}

/** Checks one row's name and its created and updated dates (as the list prints them). */
export async function expectSurveyRow(
  row: Locator,
  name: string,
  created: string,
  updated: string,
): Promise<void> {
  await expect(row.locator(".v2-class---my-surveys-page__survey-name")).toHaveText(name);
  await expect(row.locator('[title="Created on"]')).toHaveText(created);
  await expect(row.locator('[title="Updated on"]')).toHaveText(updated);
}

/**
 * Clicks "Load more" until the list ends, waiting for each page's rows. The list must be shown.
 * Scopes that tests write to (the outsider's, Engineering) can hold more than one page.
 */
export async function loadAllPages(page: Page): Promise<void> {
  const rows = surveyRows(page);
  const loadMore = loadMoreButton(page);
  while ((await loadMore.count()) > 0) {
    const shown = await rows.count();
    await loadMore.click();
    await expect.poll(() => rows.count()).toBeGreaterThan(shown);
  }
}
