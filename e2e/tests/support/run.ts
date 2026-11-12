import type { BrowserContext, Page } from "@playwright/test";
import { api } from "./api.js";
import { getDocumentViaApi } from "./editor.js";
import { csrfHeaders } from "./survey-list.js";
import { expect } from "./test.js";

/** One text question, `q1`, titled `Your name`. */
export const QUESTION_DEFINITION = {
  pages: [{ name: "page1", elements: [{ type: "text", name: "q1", title: "Your name" }] }],
};

/**
 * One File Upload question, `doc`, that asks for its files inline. The run page stores them on the
 * server anyway (S20), so the response keeps their URLs.
 */
export const FILE_DEFINITION = {
  pages: [{ name: "page1", elements: [{ type: "file", name: "doc", storeDataAsText: true }] }],
};

/**
 * Publishes (or, with `false`, unpublishes) a survey through the API; the page must be signed in.
 * A new survey is already published (its legacy flag is empty), so tests that need an unpublished
 * survey unpublish it.
 */
export async function publishViaApi(page: Page, surveyId: string, published = true): Promise<void> {
  const response = await api(page).patch(`/api/v1/surveys/${surveyId}`, {
    headers: { ...(await csrfHeaders(page)), "Content-Type": "application/merge-patch+json" },
    data: { published },
  });
  expect(response.status()).toBe(200);
}

/** Replaces a survey's theme through the API (test set-up), with its current ETag. */
export async function putThemeViaApi(
  page: Page,
  surveyId: string,
  theme: Record<string, unknown>,
): Promise<void> {
  const { etag } = await getDocumentViaApi(page, surveyId, "theme");
  const response = await api(page).put(`/api/v1/surveys/${surveyId}/theme`, {
    headers: { ...(await csrfHeaders(page)), "If-Match": etag },
    data: theme,
  });
  expect(response.status()).toBe(204);
}

/** How many responses the survey has stored; the page must be signed in as someone who sees it. */
export async function responseCount(page: Page, surveyId: string): Promise<number> {
  const response = await api(page).get(`/api/v1/surveys/${surveyId}/results/stats`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { count: number }).count;
}

const BRAND_IMAGE =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';

/**
 * Answers the Form Library's brand footer image (`https://surveyjs.io/…`) locally, so runs stay
 * offline and the console guard quiet. Route a context before it opens the pages that need it.
 */
export async function routeBrandImage(target: Page | BrowserContext): Promise<void> {
  await target.route("https://surveyjs.io/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: BRAND_IMAGE }),
  );
}

/** Whether a requested URL is Survey Creator, Monaco or Dashboard code (the run page loads none). */
export function isCreatorOrDashboardCode(url: string): boolean {
  return (
    /\/assets\/(survey-creator|SurveyEditor|editor\.worker|json\.worker)-[^/]*$/.test(
      new URL(url).pathname,
    ) || /monaco-editor|survey-analytics|dashboard/i.test(url)
  );
}
