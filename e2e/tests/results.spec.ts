import { readFile } from "node:fs/promises";
import type { Download, Page, Response } from "@playwright/test";
import { api } from "./support/api.js";
import { putDefinitionViaApi, uniqueSurveyName, withCleanup } from "./support/editor.js";
import {
  CHART_DEFINITION,
  FEEDBACK_SURVEY,
  isViewWrite,
  keepViewWritesInBrowser,
  LARGE_SURVEY,
  openResultsTab,
  recordViewWrites,
  submitViaApi,
  summaryItemNames,
  summaryItems,
  tableCells,
  tableHeaders,
  VIEW_404,
} from "./support/results.js";
import { isCreatorOrDashboardCode, publishViaApi } from "./support/run.js";
import { signInAt } from "./support/sign-in.js";
import {
  answerNextConfirm,
  createSurveyViaApi,
  openRowMenu,
  surveyRow,
} from "./support/survey-list.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test } from "./support/test.js";

// The results page (US 46-49): the Summary and the Table over every response, saved layouts and
// their reset, the exports and the lazily loaded Dashboard code. Runs in memory mode on three
// browsers and in Azurite mode.
// - "API created" (…a08, 1,500 generated responses) and "Customer feedback" (…a01, surveyjs.io's
//   saved layouts, an IP on row 03) are read only: no response and no layout goes to them. Every
//   layout write a test on them could send is answered in the browser (`keepViewWritesInBrowser`),
//   so none reaches the server; the one PUT the count check sends is fulfilled there and counted.
// - The writable scope is the admin's Personal scope: each test that saves or resets a layout
//   creates its own published survey, answers it through the public API and removes it at the end.

// The large survey is 1,500 responses to read and chart; Firefox on a busy machine needs the time.
test.describe.configure({ timeout: 90_000 });

// No user has a saved layout of most surveys: their view reads answer 404.
test.use({ expectedErrorResponses: [VIEW_404] });

test.beforeEach(async ({ page }) => {
  // The cookie banner is fixed to the bottom of the page and would cover the row menu.
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

const RESPONSES = [
  { q1: "Red", q2: true, q3: 3 },
  { q1: "Blue", q2: false, q3: 5 },
  { q1: "Red", q2: true, q3: 4 },
];

/** Signs in as the admin and creates a published survey with `CHART_DEFINITION` and three responses. */
async function answeredSurvey(page: Page, prefix: string, browserName: string): Promise<string> {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName(prefix, browserName));
  await putDefinitionViaApi(page, survey.id, CHART_DEFINITION);
  await publishViaApi(page, survey.id);
  for (const data of RESPONSES) await submitViaApi(page, survey.id, data);
  return survey.id;
}

/** The Summary shows these items, in this order (a hidden item is not shown). */
async function expectSummaryItems(page: Page, names: readonly string[]): Promise<void> {
  await expect(summaryItems(page).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => summaryItemNames(page)).toEqual(names);
}

/** Picks an item of the table's "Export As..." menu and returns the download it starts. */
async function exportAs(page: Page, caption: "CSV" | "Excel" | "PDF"): Promise<Download> {
  const bar = page.locator(".sa-tabulator__downloads-bar");
  const download = page.waitForEvent("download", { timeout: 60_000 });
  await bar.getByRole("button", { name: "Export As..." }).click();
  // Since survey-analytics 3.2.5 an option's accessible name is "Export as CSV"; its text stays "CSV".
  await bar.getByRole("option", { name: `Export as ${caption}`, exact: true }).click();
  return download;
}

/** The bytes of a finished download. */
async function downloaded(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

/** Resets one layout from the Details tab and checks the question, the DELETE and the done text. */
async function resetFromDetails(page: Page, surveyId: string, view: "summary" | "table") {
  await openResultsTab(page, "Details");
  const confirmed = answerNextConfirm(page, true);
  const deleted = page.waitForResponse(isViewWrite("DELETE", surveyId, view));
  const button = view === "summary" ? "Reset Summary State" : "Reset Table State";
  await page.getByRole("button", { name: button }).click();
  expect(await confirmed).toBe(`Are you absolutely sure that you want to remove ${view} state ?`);
  await deleted;
  await expect(
    page.getByRole("status").filter({ hasText: `The ${view} layout is reset.` }),
  ).toBeVisible();
}

test("the Summary counts every one of 1,500 responses", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
  const pages: Promise<{ items: unknown[]; nextCursor: string | null }>[] = [];
  page.on("response", (response: Response) => {
    if (new URL(response.url()).pathname === `/api/v1/surveys/${LARGE_SURVEY}/results`) {
      pages.push(response.json() as Promise<{ items: unknown[]; nextCursor: string | null }>);
    }
  });
  // The one layout write (the visualizer switch below) is answered here and counted.
  await keepViewWritesInBrowser(page);
  const writes = recordViewWrites(page);

  await signInAt(page, `/surveys/${LARGE_SURVEY}/results`);
  await expectSummaryItems(page, ["color", "score", "subscribe", "channels", "comment"]);
  const bodies = await Promise.all(pages);
  expect(bodies.reduce((sum, body) => sum + body.items.length, 0)).toBe(1500);
  expect(bodies.at(-1)?.nextCursor).toBeNull();
  await expect(page.getByText("displays only the first 1,000 responses")).toHaveCount(0);

  const color = page.locator('[data-question="color"]');
  await color.getByRole("button", { name: "Selected: Bar" }).click();
  await color.getByRole("option", { name: "Table", exact: true }).click();
  for (const choice of ["Red", "Green", "Blue"]) {
    const row = color.locator("tr").filter({ hasText: choice });
    await expect(row.locator("td").last()).toHaveText("500");
  }
  await expect.poll(() => writes.map((request) => request.method())).toEqual(["PUT"]);
  expect(new URL(writes[0]?.url() ?? "").pathname).toBe(
    `/api/v1/surveys/${LARGE_SURVEY}/views/summary`,
  );
  // Nothing was saved on the server.
  const stored = await api(page).get(`/api/v1/surveys/${LARGE_SURVEY}/views/summary`);
  expect(stored.status()).toBe(404);
});

test("a hidden and moved Summary item is kept per user and reset from Details", async ({
  page,
  browserName,
}) => {
  const surveyId = await answeredSurvey(page, "Summary layout", browserName);
  await withCleanup(page, [surveyId], async () => {
    await page.goto(`/surveys/${surveyId}/results`);
    await expectSummaryItems(page, ["q1", "q2", "q3"]);

    const hidden = page.waitForResponse(isViewWrite("PUT", surveyId, "summary"));
    await page.locator('[data-question="q2"]').getByRole("button", { name: "Hide" }).click();
    await hidden;
    await expectSummaryItems(page, ["q1", "q3"]);

    // The Dashboard's grid moves an item dragged by its header's drag area.
    const moved = page.waitForResponse(isViewWrite("PUT", surveyId, "summary"));
    const from = await page
      .locator('[data-question="q3"] .sa-question__header--draggable')
      .boundingBox();
    const to = await page.locator('[data-question="q1"]').boundingBox();
    if (from === null || to === null) throw new Error("The Summary items have no box.");
    await page.mouse.move(from.x + 5, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 20, to.y + 20, { steps: 20 });
    // The grid (Muuri) applies pointer moves on animation frames and re-sorts after a 100 ms
    // debounce, and only after the pointer moved more than 10 px; a release before that drops q3
    // where it was (and still saves). So hold over q1, nudging the pointer 12 px back and forth,
    // until q1 makes room.
    let nudge = 0;
    await expect
      .poll(async () => {
        nudge = 12 - nudge;
        await page.mouse.move(to.x + 20 + nudge, to.y + 20 + nudge);
        const box = await page.locator('[data-question="q1"]').boundingBox();
        return box === null ? 0 : Math.hypot(box.x - to.x, box.y - to.y);
      })
      .toBeGreaterThan(10);
    await page.mouse.up();
    const saved = (await moved).request().postDataJSON() as {
      elements: { name: string; visible?: boolean }[];
    };
    expect(saved.elements.filter((e) => e.visible !== false).map((e) => e.name)).toEqual([
      "q3",
      "q1",
    ]);

    await page.reload();
    await expectSummaryItems(page, ["q3", "q1"]);

    await resetFromDetails(page, surveyId, "summary");
    await openResultsTab(page, "Summary");
    await expectSummaryItems(page, ["q1", "q2", "q3"]);
    await page.reload();
    await expectSummaryItems(page, ["q1", "q2", "q3"]);
  });
});

test("the Table pages through 1,500 responses and exports them all as CSV", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
  await keepViewWritesInBrowser(page);
  const writes = recordViewWrites(page);
  await signInAt(page, `/surveys/${LARGE_SURVEY}/results?tab=table`);
  const submitted = tableCells(page, "HappendAt");
  await expect(submitted.first()).toHaveText("2026-05-01T08:00:00.000Z", { timeout: 30_000 });

  await page.getByRole("button", { name: "Next Page" }).click();
  await expect(submitted.first()).toHaveText("2026-05-01T08:03:00.000Z");
  await page.getByRole("button", { name: "Last Page" }).click();
  await expect(page.locator(".tabulator-page.active")).toHaveText("300");
  await expect(submitted.first()).toHaveText("2026-05-01T20:28:00.000Z");

  const file = await exportAs(page, "CSV");
  expect(file.suggestedFilename()).toBe("results.csv");
  const lines = (await downloaded(file))
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  expect(lines).toHaveLength(1501);
  expect(lines[0]).toContain("Submitted");
  expect(lines[0]).toContain("Favourite colour");
  expect(lines[1]).toContain("2026-05-01T08:00:00.000Z");
  expect(lines.at(-1)).toContain("2026-05-01T20:30:00.000Z");
  expect(writes).toEqual([]);
});

test("a hidden Table column is kept per user and reset from Details; Excel and PDF download", async ({
  page,
  browserName,
}) => {
  const surveyId = await answeredSurvey(page, "Table layout", browserName);
  await withCleanup(page, [surveyId], async () => {
    await page.goto(`/surveys/${surveyId}/results?tab=table`);
    const headers = tableHeaders(page);
    await expect(headers).toHaveText(["Colour", "Agree", "Score", "Submitted"], {
      timeout: 30_000,
    });

    const hidden = page.waitForResponse(isViewWrite("PUT", surveyId, "table"));
    await page
      .locator(".tabulator-col", { has: page.getByText("Agree", { exact: true }) })
      .getByRole("button", { name: "Hide column" })
      .click();
    await hidden;
    await expect(headers).toHaveText(["Colour", "Score", "Submitted"]);

    await page.reload();
    await expect(headers).toHaveText(["Colour", "Score", "Submitted"], { timeout: 30_000 });

    await resetFromDetails(page, surveyId, "table");
    await openResultsTab(page, "Table");
    await expect(headers).toHaveText(["Colour", "Agree", "Score", "Submitted"], {
      timeout: 30_000,
    });

    // Excel and PDF load their libraries on the first such export.
    const excel = await exportAs(page, "Excel");
    expect(excel.suggestedFilename()).toBe("results.xlsx");
    expect((await downloaded(excel)).subarray(0, 2).toString("latin1")).toBe("PK");
    const pdf = await exportAs(page, "PDF");
    expect(pdf.suggestedFilename()).toBe("results.pdf");
    expect((await downloaded(pdf)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

test("surveyjs.io's saved layouts load without being saved again; the Table shows the IP", async ({
  page,
}) => {
  await keepViewWritesInBrowser(page);
  const writes = recordViewWrites(page);
  await signInAt(page, `/surveys/${FEEDBACK_SURVEY}/results`);
  await expectSummaryItems(page, ["satisfaction", "receipt"]);

  await openResultsTab(page, "Table");
  await expect(tableHeaders(page).last()).toHaveText("IPAddress", { timeout: 30_000 });
  await expect(tableCells(page, "IPAddress").filter({ hasText: "203.0.113.7" })).toHaveCount(1);
  await openResultsTab(page, "Summary");
  await expectSummaryItems(page, ["satisfaction", "receipt"]);
  expect(writes).toEqual([]);
});

test("the Dashboard loads only on the results page, and its table only on the Table tab", async ({
  page,
}) => {
  test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
  await keepViewWritesInBrowser(page);
  const writes = recordViewWrites(page);
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await signInAt(page);

  const popup = await openRowMenu(surveyRow(page, "API created"));
  const link = popup.getByRole("link", { name: "View Results", exact: true });
  // Hovering preloads the route (its own chunk and the survey), but nothing of the Dashboard.
  const preloaded = page.waitForRequest((request) =>
    /\/assets\/results\.lazy-[^/]+\.js$/.test(new URL(request.url()).pathname),
  );
  await link.hover();
  await preloaded;
  expect(requested.filter(isCreatorOrDashboardCode)).toEqual([]);
  expect(
    requested.filter((url) =>
      new URL(url).pathname.startsWith(`/api/v1/surveys/${LARGE_SURVEY}/results`),
    ),
  ).toEqual([]);

  await link.click();
  await expectSummaryItems(page, ["color", "score", "subscribe", "channels", "comment"]);
  const paths = () => requested.map((url) => new URL(url).pathname);
  expect(
    paths().some((path) => /\/assets\/survey-dashboard-(?!table-|export-)[^/]+\.js$/.test(path)),
  ).toBe(true);
  expect(paths().filter((path) => path.includes("survey-dashboard-table-"))).toEqual([]);

  await openResultsTab(page, "Table");
  await expect(tableCells(page, "HappendAt").first()).toBeVisible({ timeout: 30_000 });
  expect(paths().some((path) => /\/assets\/survey-dashboard-table-[^/]+\.js$/.test(path))).toBe(
    true,
  );
  expect(writes).toEqual([]);
});

test.describe("a stranger", () => {
  // The page stops at the survey read (404); it reads no layout.
  test.use({ expectedErrorResponses: [{ path: `/api/v1/surveys/${LARGE_SURVEY}`, status: 404 }] });

  test("sees that another user's survey is not available", async ({ page }) => {
    // On the sandbox it would pass only because the survey is not there at all.
    test.skip(sandboxMode, notOnSandbox.seed("survey a08, API created, and its 1,500 responses"));
    await signInAt(page, `/surveys/${LARGE_SURVEY}/results`, "outsider");
    await expect(page.getByText("This survey is not available.")).toBeVisible();
  });
});
