import { readFile } from "node:fs/promises";
import type { Page, Request } from "@playwright/test";
import { api } from "./support/api.js";
import { putDefinitionViaApi, uniqueSurveyName, withCleanup } from "./support/editor.js";
import {
  CHART_DEFINITION,
  isResultsDelete,
  isSettingsPatch,
  LARGE_SURVEY,
  openResultsTab,
  PUBLIC_RESULTS_404,
  recordViewWrites,
  submitViaApi,
  summaryItemNames,
  summaryItems,
  tableCells,
  tableHeaders,
  VIEW_404,
} from "./support/results.js";
import { FILE_DEFINITION, publishViaApi, routeBrandImage } from "./support/run.js";
import { signInAt } from "./support/sign-in.js";
import { answerNextConfirm, createSurveyViaApi } from "./support/survey-list.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test, watchConsole } from "./support/test.js";
import { chooseFile, paddedPng } from "./support/uploads.js";

// The results page's Details tab and the public results page (US 50-56): totals and dates,
// downloads, Grant Access and the public page, IP capture, Delete Results and file links. Runs in
// memory mode on three browsers and in Azurite mode.
// - "API created" (…a08) and "Customer feedback" (…a01) are read only: no PATCH, submit, delete or
//   privacy toggle goes to them.
// - Every write is on own surveys of Adam in his Personal scope, cleaned up with `withCleanup`.

test.describe.configure({ timeout: 90_000 });

// No user has a saved layout of most surveys: their view reads answer 404.
test.use({ expectedErrorResponses: [VIEW_404] });

test.beforeEach(async ({ page }) => {
  // The cookie banner is fixed to the bottom of the page and could cover a control.
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
  await routeBrandImage(page.context());
});

const RESPONSES = [
  { q1: "Red", q2: true, q3: 3 },
  { q1: "Blue", q2: false, q3: 5 },
  { q1: "Red", q2: true, q3: 4 },
];

/** Signs in as the admin and creates a published survey with this definition. */
async function adminSurvey(
  page: Page,
  prefix: string,
  browserName: string,
  definition: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName(prefix, browserName));
  await putDefinitionViaApi(page, survey.id, definition);
  await publishViaApi(page, survey.id);
  return survey;
}

/** The value of one line of the Details tab's statistics, as shown. */
function statLine(page: Page, label: string) {
  return page
    .locator(".survey-results-header-line")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("span")
    .last();
}

/** Clicks a download link and returns the file's name and bytes. */
async function download(
  page: Page,
  link: "JSON" | "CSV",
): Promise<{ name: string; bytes: Buffer }> {
  const started = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("link", { name: link, exact: true }).click();
  const file = await started;
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}

/** Whether a response is a successful settings save of the survey. */
function isSettingsSaved(
  surveyId: string,
): (response: { request(): Request; status(): number }) => boolean {
  return (response) => isSettingsPatch(response.request(), surveyId) && response.status() === 200;
}

test("the Details tab shows the total and the first and last response times", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
  await signInAt(page, `/surveys/${LARGE_SURVEY}/results?tab=details`);
  await expect(statLine(page, "Total responses:")).toHaveText("1500");
  // Locale formats differ by engine, so the expected text is formatted in the browser.
  const local = (iso: string) => page.evaluate((value) => new Date(value).toLocaleString(), iso);
  await expect(statLine(page, "First response at:")).toHaveText(
    await local("2026-05-01T08:00:00.000Z"),
  );
  await expect(statLine(page, "Last response at:")).toHaveText(
    await local("2026-05-01T20:30:00.000Z"),
  );
});

test("an empty survey shows no times and no Delete Results", async ({ page, browserName }) => {
  const survey = await adminSurvey(page, "Empty details", browserName, CHART_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await page.goto(`/surveys/${survey.id}/results?tab=details`);
    await expect(statLine(page, "Total responses:")).toHaveText("0");
    await expect(page.getByText("First response at:")).toHaveCount(0);
    await expect(page.getByText("Last response at:")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete Results" })).toHaveCount(0);
  });
});

test("all results download as JSON and as CSV", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
  const writes = recordViewWrites(page);
  await signInAt(page, `/surveys/${LARGE_SURVEY}/results?tab=details`);
  await expect(statLine(page, "Total responses:")).toHaveText("1500");

  const json = await download(page, "JSON");
  expect(json.name).toBe("API created.json");
  expect((JSON.parse(json.bytes.toString("utf8")) as unknown[]).length).toBe(1500);

  const csv = await download(page, "CSV");
  expect(csv.name).toBe("API created.csv");
  const text = csv.bytes.toString("utf8");
  expect(text.startsWith("﻿")).toBe(true);
  const records = text
    .slice(1)
    .split("\r\n")
    .filter((line) => line !== "");
  expect(records).toHaveLength(1501);
  expect(records[0]).toBe("Submitted,color,score,subscribe,channels,comment,ClientId");
  expect(writes).toEqual([]);
});

test("Grant Access opens the results to signed-out visitors and Disable Access closes them", async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(sandboxMode, notOnSandbox.oneBrowser);
  const survey = await adminSurvey(page, "Public results", browserName, CHART_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    for (const data of RESPONSES) await submitViaApi(page, survey.id, data);
    await page.goto(`/surveys/${survey.id}/results?tab=details`);

    const granted = page.waitForResponse(isSettingsSaved(survey.id));
    await page.getByRole("button", { name: "Grant Access" }).click();
    await granted;
    await expect(
      page.getByText("Your Survey results can be accessible via direct Url."),
    ).toBeVisible();
    const origin = new URL(page.url()).origin;
    await expect(page.getByRole("link", { name: "Go to the results page" })).toHaveAttribute(
      "href",
      `${origin}/results/${survey.id}`,
    );

    // The private Summary's toggle saves the list through exactly one PATCH.
    await openResultsTab(page, "Summary");
    await expect(summaryItems(page).first()).toBeVisible({ timeout: 30_000 });
    const patches: Request[] = [];
    page.on("request", (request) => {
      if (isSettingsPatch(request, survey.id)) patches.push(request);
    });
    const saved = page.waitForResponse(isSettingsSaved(survey.id));
    await page
      .locator('[data-question="q2"]')
      .getByRole("button", { name: "Make private" })
      .click();
    await saved;
    expect(patches).toHaveLength(1);
    expect(patches[0]?.postDataJSON()).toEqual({ settings: { privateResultQuestions: ["q2"] } });

    // A signed-out visitor.
    const context = await browser.newContext({ locale: "en-US", timezoneId: "UTC" });
    await routeBrandImage(context);
    const visitor = await context.newPage();
    const checkConsole = watchConsole(visitor, [PUBLIC_RESULTS_404]);
    try {
      await visitor.goto(`${origin}/results/${survey.id}`);
      await expect(visitor.locator("h1")).toHaveText(survey.name);
      await expect(summaryItems(visitor).first()).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => summaryItemNames(visitor)).toEqual(["q1", "q3"]);

      await visitor.getByRole("link", { name: "Table", exact: true }).click();
      await expect(visitor.locator(".tabulator-row")).toHaveCount(3, { timeout: 30_000 });
      await expect(tableHeaders(visitor).filter({ hasText: "Colour" })).toHaveCount(1);
      await expect(tableHeaders(visitor).filter({ hasText: "Score" })).toHaveCount(1);
      await expect(visitor.locator(".sa-tabulator__downloads-bar")).toHaveCount(0);
      await expect(visitor.getByText("Export As...")).toHaveCount(0);
      await expect(tableHeaders(visitor).filter({ hasText: "Submitted" })).toHaveCount(1);
      await expect(tableHeaders(visitor).filter({ hasText: "Agree" })).toHaveCount(0);

      // Disable Access closes the page.
      await openResultsTab(page, "Details");
      const disabled = page.waitForResponse(isSettingsSaved(survey.id));
      await page.getByRole("button", { name: "Disable Access" }).click();
      await disabled;
      await visitor.reload();
      await expect(visitor.getByText("These survey results are not available.")).toBeVisible();
    } finally {
      checkConsole();
      await context.close();
    }
  });
});

test("saving the respondent IP adds the IPAddress column", async ({ page, browserName }) => {
  test.skip(sandboxMode, notOnSandbox.design("it captures no respondent IP"));
  const survey = await adminSurvey(page, "IP capture", browserName, CHART_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await page.goto(`/surveys/${survey.id}/results?tab=details`);
    const saved = page.waitForResponse(isSettingsSaved(survey.id));
    await page.getByRole("button", { name: "Save Respondent IP in Results" }).click();
    await saved;
    await expect(
      page.getByText(
        "The IP addresses of your respondents are stored along with other answers. Toggle not to store.",
      ),
    ).toBeVisible();

    await submitViaApi(page, survey.id, RESPONSES[0] ?? {});
    await page.goto(`/surveys/${survey.id}/results?tab=table`);
    await expect(tableHeaders(page).filter({ hasText: "IPAddress" })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(tableCells(page, "IPAddress").first()).not.toHaveText("");
  });
});

test("Delete Results removes the responses and their file links", async ({ page, browserName }) => {
  const survey = await adminSurvey(page, "Delete results", browserName, FILE_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    // Answer through the run page with one uploaded file.
    await page.goto(`/s/${survey.id}`);
    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/public/surveys/${survey.id}/files`,
    );
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".sd-file__choose-btn").first().click();
    await chooseFile(await chooser, "doc.png", paddedPng(2_000));
    expect((await uploaded).status()).toBe(201);
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByText("Thank you for completing the survey")).toBeVisible();

    await page.goto(`/surveys/${survey.id}/results?tab=table`);
    const link = tableCells(page, "doc").locator("a[download]");
    await expect(link).toHaveCount(1, { timeout: 30_000 });
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).not.toBe("");
    expect((await api(page).get(href)).status()).toBe(200);

    await openResultsTab(page, "Details");
    await expect(statLine(page, "Total responses:")).toHaveText("1");
    await page.getByRole("button", { name: "Delete Results" }).click();
    await page.getByRole("textbox", { name: "Type the survey name" }).fill(survey.name);
    const confirmed = answerNextConfirm(page, true);
    const deleted = page.waitForResponse((response) => isResultsDelete(response, survey.id));
    await page.getByRole("button", { name: "Clear All Data" }).click();
    expect(await confirmed).toBe("Are you absolutely sure that you want to delete all results ?");
    await deleted;
    await expect(
      page.getByRole("status").filter({ hasText: "All results are deleted." }),
    ).toBeVisible();
    await expect(statLine(page, "Total responses:")).toHaveText("0");

    await openResultsTab(page, "Table");
    await expect(page.locator(".tabulator-row")).toHaveCount(0);
    expect((await api(page).get(href)).status()).toBe(404);
  });
});
