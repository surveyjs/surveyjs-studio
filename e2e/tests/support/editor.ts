import type { Locator, Page, Response } from "@playwright/test";
import { api } from "./api.js";
import { sandboxMode } from "./sandbox.js";
import { csrfHeaders, discardSurveyViaApi } from "./survey-list.js";
import { expect } from "./test.js";

/** A survey document as the API answers it, with its ETag. */
export interface ApiDocument {
  readonly content: Record<string, unknown>;
  readonly etag: string;
}

export type DocumentKind = "definition" | "theme";

/** A unique survey name for one test in one browser. */
export function uniqueSurveyName(prefix: string, browserName: string): string {
  return `${prefix} ${browserName} ${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Runs `body`, then removes the surveys with these ids (archive, then delete). On the sandbox each
 * test starts from the seed in a browser context of its own, so nothing is left to remove.
 */
export async function withCleanup(
  page: Page,
  ids: readonly string[],
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } finally {
    if (!sandboxMode) for (const id of ids) await discardSurveyViaApi(page, id);
  }
}

/** The editor's save status, at the left of the bottom bar. */
export function editorStatus(page: Page): Locator {
  return page.locator("#edit-survey-change-name-container").getByRole("status");
}

/** The survey name in the editor's bottom bar. */
export function footerName(page: Page): Locator {
  return page.locator(
    "#edit-survey-change-name-container .v2-class---my-surveys-page__survey-name",
  );
}

/** The Survey Creator on the editor page. */
export function creator(page: Page): Locator {
  return page.locator("#creator .svc-creator");
}

/** The questions the designer shows. */
export function designerQuestions(page: Page): Locator {
  return page.locator(".svc-question__content");
}

/** Opens the editor of a survey and waits for the Creator and the save status. */
export async function openEditor(page: Page, surveyId: string): Promise<void> {
  await page.goto(`/surveys/${surveyId}/edit`);
  await expectEditorReady(page);
}

/** Waits until the editor page shows the Creator and its first status. */
export async function expectEditorReady(page: Page): Promise<void> {
  // The Creator is a large chunk to load and parse; with several browsers side by side on one
  // machine, Firefox may need more than the default 10 s.
  await expect(creator(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("tab", { name: "Designer" })).toBeVisible();
  await expect(editorStatus(page)).not.toHaveText("");
}

/** Whether a response answers a PUT of one of the survey's documents. */
export function isDocumentSave(response: Response, surveyId: string, kind: DocumentKind): boolean {
  return (
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname === `/api/v1/surveys/${surveyId}/${kind}`
  );
}

/**
 * Runs `change` (an edit in the Creator) and waits until it is saved: the PUT of `kind` answers 204
 * and the status reads "All changes saved".
 */
export async function expectSaved(
  page: Page,
  surveyId: string,
  kind: DocumentKind,
  change: () => Promise<void>,
): Promise<void> {
  const saved = page.waitForResponse(
    (response) => isDocumentSave(response, surveyId, kind) && response.status() === 204,
  );
  await change();
  await saved;
  await expect(editorStatus(page)).toHaveText("All changes saved");
}

/** Adds a question on the designer through its "Add Question" button (the default type). */
export async function addQuestion(page: Page): Promise<void> {
  const questions = designerQuestions(page);
  const before = await questions.count();
  await page.locator(".svc-add-new-question-action").getByText("Add Question").first().click();
  await expect(questions).toHaveCount(before + 1);
}

/** Selects one of the Creator's tabs, through the tab bar's "More" menu when it is hidden there. */
export async function openTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  // The tab bar first renders every tab, transparent (opacity 0), and only after a resize
  // observation and an animation frame moves the tabs that do not fit into "More". Whether a tab
  // shows is known only once the bar is opaque: a tab seen before can be gone by the click.
  await expect(page.locator(".svc-tabbed-menu")).toHaveCSS("opacity", "1");
  if (!(await tab.isVisible())) {
    await page.locator(".svc-tabbed-menu-dots").getByRole("button", { name: "More" }).click();
    await page
      .locator(".svc-tabbed-menu-item__popup")
      .getByText(name, { exact: true })
      .first()
      .click();
  } else {
    await tab.click();
  }
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** A survey document through the API; the page must be signed in. */
export async function getDocumentViaApi(
  page: Page,
  surveyId: string,
  kind: DocumentKind,
): Promise<ApiDocument> {
  const response = await api(page).get(`/api/v1/surveys/${surveyId}/${kind}`);
  expect(response.status()).toBe(200);
  const etag = response.headers()["etag"];
  expect(etag).toBeTruthy();
  return { content: (await response.json()) as Record<string, unknown>, etag: etag ?? "" };
}

/** Replaces a survey's definition through the API (test set-up), with its current ETag. */
export async function putDefinitionViaApi(
  page: Page,
  surveyId: string,
  definition: Record<string, unknown>,
): Promise<void> {
  const { etag } = await getDocumentViaApi(page, surveyId, "definition");
  const response = await api(page).put(`/api/v1/surveys/${surveyId}/definition`, {
    headers: { ...(await csrfHeaders(page)), "If-Match": etag },
    data: definition,
  });
  expect(response.status()).toBe(204);
}

/** The names of the questions of a stored definition, page by page. */
export function questionNames(definition: Record<string, unknown>): string[] {
  const pages = (definition["pages"] ?? []) as { elements?: { name: string }[] }[];
  return pages.flatMap((page) => (page.elements ?? []).map((element) => element.name));
}
