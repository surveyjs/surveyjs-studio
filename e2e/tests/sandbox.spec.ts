import type { Page } from "@playwright/test";
import { expectEditorReady, footerName, editorStatus } from "./support/editor.js";
import { FEEDBACK_SURVEY, openResultsTab } from "./support/results.js";
import { openRowMenu, pickMenuItem, surveyRow, surveyRows } from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";

// The sandbox build (`pnpm e2e:sandbox`): the web app with its mock back-end in the browser, on
// localStorage (ADR 0030, D9). Everything goes through the UI: the user-story helpers that create
// data through `page.request` would bypass the service worker. A test's browser context starts
// empty, so each test starts from the seed.
test.skip(process.env["E2E_MODE"] !== "sandbox", "needs pnpm e2e:sandbox");

// The cookie banner is fixed to the bottom of the page and would cover the editor's bottom bar.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

const ACCOUNTS = {
  owner: "Olivia Owner",
  member: "Mia Member",
} as const;

const header = (page: Page) => page.locator(".sh-header");

/** Opens the app signed out and picks an account on the sandbox's sign-in. */
async function pickAccount(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(ACCOUNTS[who]) }).click();
  await expect(header(page).getByRole("button", { name: "Sign Out" })).toBeVisible({
    timeout: 30_000,
  });
}

const RENAMED = "Customer feedback (renamed)";

/** Opens the editor of Customer feedback and renames the survey in the bottom bar. */
async function renameInEditor(page: Page): Promise<void> {
  await surveyRow(page, "Customer feedback").locator('[title="Created on"]').click();
  await expect(page).toHaveURL(`/surveys/${FEEDBACK_SURVEY}/edit`);
  await expectEditorReady(page);
  await footerName(page).click();
  const input = page.getByRole("textbox", { name: "Survey name" });
  await input.fill(RENAMED);
  await input.press("Enter");
  await expect(footerName(page)).toHaveText(RENAMED);
  await expect(editorStatus(page)).toHaveText("All changes saved");
}

test("@sandbox the owner renames a seeded survey in the editor and the change survives a reload", async ({
  page,
}) => {
  await pickAccount(page, "owner");
  await expect(surveyRow(page, "Customer feedback")).toBeVisible();
  await renameInEditor(page);

  await page.reload();
  await expectEditorReady(page);
  await expect(footerName(page)).toHaveText(RENAMED);
  await page.goto("/");
  await expect(surveyRow(page, RENAMED)).toBeVisible();
});

test("@sandbox the member sees Marketing and the owner's shared survey", async ({ page }) => {
  await pickAccount(page, "owner");
  await header(page).getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole("button", { name: new RegExp(ACCOUNTS.member) }).click();
  await expect(header(page).getByRole("button", { name: "Sign Out" })).toBeVisible({
    timeout: 30_000,
  });

  await header(page).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  const marketing = page.locator("details", { hasText: "Marketing" });
  await expect(marketing).toBeVisible();
  await marketing.locator("summary").click();
  await expect(marketing.getByText("Olivia Owner")).toBeVisible();

  // The project's survey list: the survey Olivia owns that the project shares.
  await page.goto("/");
  await page
    .locator(".v2-class---my-surveys-page__actions-container .v2-class---drop-down-button")
    .click();
  await page.getByRole("link", { name: "Marketing", exact: true }).click();
  await expect(surveyRow(page, "Campaign survey")).toBeVisible();
  await expect(surveyRows(page)).not.toHaveCount(0);
});

test("@sandbox a survey published in the sandbox runs in a new tab and its response reaches the results", async ({
  page,
  context,
}) => {
  await pickAccount(page, "owner");
  const row = surveyRow(page, "Customer feedback");

  // Publish it again: unpublish, then publish, in the row's menu.
  await pickMenuItem(await openRowMenu(row), "Unpublish");
  await pickMenuItem(await openRowMenu(row), "Publish");

  const opened = context.waitForEvent("page");
  await pickMenuItem(await openRowMenu(row), "Run");
  const tab = await opened;
  const checkTabConsole = watchConsole(tab);
  await expect(tab).toHaveURL(new RegExp(`/s/${FEEDBACK_SURVEY}$`));
  await tab.getByText("3", { exact: true }).first().click();
  await tab.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(tab.getByText("Thank you for completing the survey")).toBeVisible();
  checkTabConsole();
  await tab.close();

  // The results tab, refreshed: five seeded responses and the new one.
  await pickMenuItem(await openRowMenu(row), "View Results");
  await expect(page).toHaveURL(`/surveys/${FEEDBACK_SURVEY}/results`);
  await openResultsTab(page, "Details");
  await expect(totalResponses(page)).toContainText("Total responses: 6");
  await page.reload();
  await openResultsTab(page, "Details");
  await expect(totalResponses(page)).toContainText("Total responses: 6");
});

test("@sandbox Reset demo data brings the seed back", async ({ page }) => {
  await pickAccount(page, "owner");
  await renameInEditor(page);
  await page.goto("/");
  await expect(surveyRow(page, RENAMED)).toBeVisible();

  const banner = page.getByRole("complementary", { name: "Demo notice" });
  await banner.getByRole("button", { name: "Reset demo data" }).click();
  await expect(
    page.getByText("Reset all demo data? Your changes in this browser are lost."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  // The session goes with the data: pick an account again.
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(ACCOUNTS.owner) }).click();
  await expect(surveyRow(page, "Customer feedback")).toBeVisible();
  await expect(surveyRow(page, RENAMED)).toHaveCount(0);
});

test("@sandbox another browser context starts from the seed and does not see the first one's data", async ({
  page,
  browser,
}) => {
  await pickAccount(page, "owner");
  await renameInEditor(page);
  await page.goto("/");
  await expect(surveyRow(page, RENAMED)).toBeVisible();

  const other = await browser.newContext({
    baseURL: String(test.info().project.use.baseURL),
    locale: "en-US",
    timezoneId: "UTC",
    viewport: page.viewportSize(),
  });
  try {
    const second = await other.newPage();
    const check = watchConsole(second);
    await second.addInitScript(() =>
      localStorage.setItem("isInformedAboutCookieAndPolicies", "true"),
    );
    await pickAccount(second, "owner");
    await expect(surveyRow(second, "Customer feedback")).toBeVisible();
    await expect(surveyRow(second, RENAMED)).toHaveCount(0);
    check();
  } finally {
    await other.close();
  }
});

/** The Details tab's block that holds "Total responses: N". */
function totalResponses(page: Page) {
  return page.locator("div", { has: page.getByText("Total responses:", { exact: true }) }).last();
}
