import type { Page } from "@playwright/test";
import {
  addQuestion,
  expectSaved,
  openEditor,
  uniqueSurveyName,
  withCleanup,
} from "./support/editor.js";
import { signInAt, users } from "./support/sign-in.js";
import {
  copiedValues,
  createSurveyViaApi,
  openRowMenu,
  pickMenuItem,
  recordClipboard,
  surveyRow,
} from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// The History page (US 57). Runs in memory mode on three browsers and in Azurite mode on the
// replica. Writes only to the admin's Personal scope (other browsers and the conformance suite
// write there too), to a survey the test creates with a unique name and removes at the end. The
// fixture "Customer feedback" is only read.

test.describe.configure({ timeout: 90_000 });

/** Customer feedback (Olivia's Personal scope): two legacy history entries, recorded without a user. */
const CUSTOMER_FEEDBACK = "22222222-0000-4000-8000-a00000000001";

test.beforeEach(async ({ page }) => {
  // The cookie banner covers the bottom of the page; it has already been answered.
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

function historyEntries(page: Page) {
  return page.locator(".my-surveys-history-item");
}

test("after two saves in the editor the history lists both, newest first, by the admin", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueSurveyName("History", browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [survey.id], async () => {
    await page.goto(`/surveys/${survey.id}/history`);
    await expect(
      page.getByRole("heading", { name: `Survey editing history of the '${name}'` }),
    ).toBeVisible();
    await expect(page.getByText("No edits yet.")).toBeVisible();

    await openEditor(page, survey.id);
    await expectSaved(page, survey.id, "definition", () => addQuestion(page));
    await expectSaved(page, survey.id, "definition", () => addQuestion(page));

    // From the list, as a user gets there: the row's menu.
    await page.goto("/");
    await pickMenuItem(await openRowMenu(surveyRow(page, name)), "View History");
    await expect(page).toHaveURL(`/surveys/${survey.id}/history`);
    await expect(
      page.getByRole("heading", { name: `Survey editing history of the '${name}'` }),
    ).toBeVisible();
    const entries = historyEntries(page);
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText(`by ${users.admin.name}`);
    await expect(entries.nth(1)).toContainText(`by ${users.admin.name}`);
    const times = await entries
      .locator("time")
      .evaluateAll((items) => items.map((item) => item.getAttribute("datetime") ?? ""));
    expect(times).toHaveLength(2);
    expect(Date.parse(times[0] ?? "")).toBeGreaterThanOrEqual(Date.parse(times[1] ?? ""));
    // The time is shown with its zone (the browser runs in UTC).
    await expect(entries.nth(0).locator("time")).toHaveText(/\d{1,2}:\d{2} (AM|PM) UTC$/);
    await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);

    await page.getByRole("link", { name: "Back to My Surveys" }).click();
    await expect(surveyRow(page, name)).toBeVisible();
  });
});

test("legacy history entries are listed without a user", async ({ page }) => {
  await signInAt(page, "/", "owner");
  await page.goto(`/surveys/${CUSTOMER_FEEDBACK}/history`);
  await expect(
    page.getByRole("heading", { name: "Survey editing history of the 'Customer feedback'" }),
  ).toBeVisible();
  const entries = historyEntries(page);
  await expect(entries).toHaveCount(2);
  for (const entry of await entries.all()) {
    await expect(entry.locator("time")).toBeVisible();
    await expect(entry).not.toContainText(" by ");
  }
});

test("an entry opens the JSON saved in it, and Copy JSON copies it", async ({ page }) => {
  await recordClipboard(page);
  await signInAt(page, "/", "owner");
  await page.goto(`/surveys/${CUSTOMER_FEEDBACK}/history`);
  const entry = historyEntries(page).first();
  const toggle = entry.getByRole("button", { expanded: false });
  await toggle.click();

  const code = entry.locator("pre code");
  await expect(code).toContainText('"title": "Customer feedback');
  const shown = await code.textContent();
  await entry.getByRole("button", { name: "Copy JSON" }).click();
  await expect(entry.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await copiedValues(page)).toEqual([shown]);

  await entry.getByRole("button", { expanded: true }).click();
  await expect(code).toHaveCount(0);
});
