import type { Locator, Page, Request, Response } from "@playwright/test";
import { expect, type ExpectedErrorResponse } from "./test.js";

/** "API created": Olivia's survey with 1,500 generated responses. Read only. */
export const LARGE_SURVEY = "22222222-0000-4000-8000-a00000000008";

/** "Customer feedback": Olivia's survey with surveyjs.io's saved layouts and an IP on row 03. Read only. */
export const FEEDBACK_SURVEY = "22222222-0000-4000-8000-a00000000001";

/** A user without a saved layout reads `404 view-not-found`, which browsers log. */
export const VIEW_404: ExpectedErrorResponse = {
  path: /^\/api\/v1\/surveys\/[0-9a-f-]+\/views\/(summary|table)$/,
  status: 404,
};

/** Three questions with a chart each: a choice, a yes/no and a rating. */
export const CHART_DEFINITION = {
  pages: [
    {
      name: "page1",
      elements: [
        { type: "radiogroup", name: "q1", title: "Colour", choices: ["Red", "Blue"] },
        { type: "boolean", name: "q2", title: "Agree" },
        { type: "rating", name: "q3", title: "Score" },
      ],
    },
  ],
};

export type ResultsTabName = "Summary" | "Table" | "Details";

/** Submits a response through the public API (the survey must be published). */
export async function submitViaApi(
  page: Page,
  surveyId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await page.request.post(`/api/v1/public/surveys/${surveyId}/responses`, {
    data: { data },
  });
  expect(response.status()).toBe(201);
}

/** The Summary's question items, in document order. */
export function summaryItems(page: Page): Locator {
  return page.locator("[data-question]");
}

/** The question names of the Summary's items, in document order. */
export function summaryItemNames(page: Page): Promise<string[]> {
  return summaryItems(page).evaluateAll((items) =>
    items.map((item) => item.getAttribute("data-question") ?? ""),
  );
}

/** Records every request that would change a saved layout (non-GET, path with `/views/`). */
export function recordViewWrites(page: Page): Request[] {
  const writes: Request[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && new URL(request.url()).pathname.includes("/views/")) {
      writes.push(request);
    }
  });
  return writes;
}

/**
 * Answers every layout write in the browser with 204, so none reaches the server (for the
 * read-only fixture surveys). Reads go to the server.
 */
export async function keepViewWritesInBrowser(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.includes("/views/"),
    (route) =>
      route.request().method() === "GET" ? route.fallback() : route.fulfill({ status: 204 }),
  );
}

/** Whether a response answers a write of one of the survey's layouts with `204`. */
export function isViewWrite(
  method: "PUT" | "DELETE",
  surveyId: string,
  view: "summary" | "table",
): (response: Response) => boolean {
  const path = `/api/v1/surveys/${surveyId}/views/${view}`;
  return (response) =>
    response.request().method() === method &&
    new URL(response.url()).pathname === path &&
    response.status() === 204;
}

/** Opens one of the results page's tabs and waits until it is the current one. */
export async function openResultsTab(page: Page, name: ResultsTabName): Promise<void> {
  const tab = page.locator(".survey-results-page__tabs").getByRole("link", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-current", "page");
}

/** The results table's column titles that are shown, in order. */
export function tableHeaders(page: Page): Locator {
  return page.locator(".tabulator-col:visible .sa-tabulator-column-title-text");
}

/** One column of the table's rows on the current page, by the column's data key. */
export function tableCells(page: Page, field: string): Locator {
  return page.locator(`.tabulator-row .tabulator-cell[tabulator-field="${field}"]`);
}

/** The public results of a survey that is not shared (or not published) answer 404, which browsers log. */
export const PUBLIC_RESULTS_404: ExpectedErrorResponse = {
  path: /^\/api\/v1\/public\/surveys\/[0-9a-f-]+\/results$/,
  status: 404,
};

/** Whether a request changes the survey's settings (`PATCH /surveys/{id}`). */
export function isSettingsPatch(request: Request, surveyId: string): boolean {
  return (
    request.method() === "PATCH" &&
    new URL(request.url()).pathname === `/api/v1/surveys/${surveyId}`
  );
}

/** Whether a response answers `DELETE /surveys/{id}/results` with `204`. */
export function isResultsDelete(response: Response, surveyId: string): boolean {
  return (
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname === `/api/v1/surveys/${surveyId}/results` &&
    response.status() === 204
  );
}
