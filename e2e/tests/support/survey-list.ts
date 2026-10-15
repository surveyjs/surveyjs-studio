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

/** The one row whose name equals `name` exactly. */
export function surveyRow(page: Page, name: string): Locator {
  return surveyRows(page).filter({ has: surveysNamed(page, name) });
}

/** The "…" trigger of a row. It is CSS-hidden until the row is hovered, so hover the row first. */
export function menuTrigger(row: Locator): Locator {
  return row.getByRole("button", { name: "Survey actions" });
}

/** Hovers the row, opens its menu and returns the popup. */
export async function openRowMenu(row: Locator): Promise<Locator> {
  await row.hover();
  await menuTrigger(row).click();
  const popup = row.locator(".v2-class---drop-down-menu--popup-menu").first();
  await expect(popup).toBeVisible();
  return popup;
}

/** The menu's own entries, in order: its links and its flyout triggers, not the flyouts' contents. */
export function menuEntries(popup: Locator): Locator {
  return popup.locator(":scope > ul > li > a, :scope > ul > li > div > span");
}

/** Opens a flyout ("Survey IDs", "Move to Project") of an open menu and returns its links. */
export async function openFlyout(popup: Locator, name: string): Promise<Locator> {
  const trigger = popup.getByRole("button", { name, exact: true });
  const flyout = trigger
    .locator("xpath=..")
    .locator(".v2-class---my-surveys-page__move-to-project-menu");
  // A click opens it for good (aria-expanded); hover alone also shows it, but only while the pointer
  // stays over it, and it may flip sides on entering.
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(flyout).toBeVisible();
  return flyout;
}

/** Picks a menu item by its text. */
export async function pickMenuItem(popup: Locator, name: string): Promise<void> {
  await popup.getByRole("link", { name, exact: true }).click();
}

/**
 * Answers the next native confirm and returns its message once it has been answered. Call it before
 * the click that raises the dialog, and await the result after the click.
 */
export function answerNextConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", (dialog) => {
      const message = dialog.message();
      void (accept ? dialog.accept() : dialog.dismiss()).then(() => resolve(message));
    });
  });
}

/** Replaces `navigator.clipboard.writeText` with a recorder: values go to `globalThis.copiedValues`. */
export async function recordClipboard(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    (globalThis as unknown as { copiedValues: string[] }).copiedValues = copied;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copied.push(value);
          return Promise.resolve();
        },
      },
    });
  });
}

/** The values recorded by `recordClipboard`. */
export function copiedValues(page: Page): Promise<string[]> {
  return page.evaluate(() => (globalThis as unknown as { copiedValues: string[] }).copiedValues);
}

/** The survey as the API answers it. */
export interface ApiSurvey {
  readonly id: string;
  readonly name: string;
  readonly projectId: string | null;
  readonly postId: string;
  readonly resultId: string;
  readonly published: boolean;
  readonly archived: boolean;
}

async function csrfHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === "msid_csrf");
  expect(csrf).toBeDefined();
  return { "X-CSRF-Token": decodeURIComponent(csrf?.value ?? "") };
}

/** Creates a survey through the API; the page must be signed in. */
export async function createSurveyViaApi(
  page: Page,
  name: string,
  projectId: string | null = null,
): Promise<ApiSurvey> {
  const response = await page.request.post("/api/v1/surveys", {
    headers: await csrfHeaders(page),
    data: { name, projectId },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as ApiSurvey;
}

/** The survey with this id, or null. */
export async function getSurveyViaApi(page: Page, id: string): Promise<ApiSurvey | null> {
  const response = await page.request.get(`/api/v1/surveys/${id}`);
  return response.status() === 200 ? ((await response.json()) as ApiSurvey) : null;
}

/** The surveys of a scope (the newest 200, active and archived) whose name equals `name`. */
export async function findSurveysViaApi(
  page: Page,
  name: string,
  projectId: string | null = null,
): Promise<ApiSurvey[]> {
  const scope = projectId ?? "personal";
  const found: ApiSurvey[] = [];
  for (const archived of [false, true]) {
    const response = await page.request.get(
      `/api/v1/surveys?project=${scope}&archived=${archived}&limit=200`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { items: ApiSurvey[] };
    found.push(...body.items.filter((survey) => survey.name === name));
  }
  return found;
}

/** Archives and deletes a survey the test created; a survey that is already gone is fine. */
export async function discardSurveyViaApi(page: Page, id: string): Promise<void> {
  const headers = await csrfHeaders(page);
  await page.request.patch(`/api/v1/surveys/${id}`, {
    headers: { ...headers, "Content-Type": "application/merge-patch+json" },
    data: { archived: true },
  });
  await page.request.delete(`/api/v1/surveys/${id}`, { headers });
}
