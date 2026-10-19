import type { Page } from "@playwright/test";
import { signInAt } from "./support/sign-in.js";
import {
  expectSurveyRow,
  loadAllPages,
  surveyNames,
  surveyRows,
  surveysNamed,
} from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// Runs in memory mode on three browsers and in Azurite mode on the replica. Tests write only to
// the outsider's Personal scope, the admin's Personal scope and Engineering (other browsers and the
// conformance suite write there too), never the owner's Personal scope, Marketing or a fixture
// survey, so those hold exactly their fixture rows; the outsider's list is read to its end.

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const UNKNOWN_PROJECT = "99999999-9999-4999-8999-999999999999";

function activeArchivedSwitch(page: Page) {
  return page.getByRole("checkbox", { name: "Active Archived" });
}

/** Clicks the switch where a user does: its label (the checkbox itself is transparent). */
async function toggleActiveArchived(page: Page) {
  await page.locator('[data-switcher-name="my-surveys-active-archived"]').click();
}

function createButton(page: Page) {
  return page.getByRole("button", { name: "Create a Survey" });
}

/** The project drop-down: its button shows the selected scope; its menu items are links. */
function projectSelector(page: Page) {
  // Not the rows' "…" buttons, which are drop-down buttons too.
  return page.locator(
    ".v2-class---my-surveys-page__actions-container .v2-class---drop-down-button",
  );
}

async function chooseProject(page: Page, name: string) {
  const selector = projectSelector(page);
  await selector.getByRole("button").click();
  await selector.getByRole("link", { name, exact: true }).click();
}

test("the owner's active list shows their surveys, newest first, without archived ones", async ({
  page,
}) => {
  await signInAt(page);

  const rows = surveyRows(page);
  await expectSurveyRow(rows.nth(0), "API created", "5/30/2026", "6/1/2026");
  await expectSurveyRow(rows.nth(1), "Customer feedback", "3/13/2026", "4/14/2026");
  await expectSurveyRow(rows.nth(2), "Draft idea", "2/1/2026", "2/2/2026");
  await expect(surveysNamed(page, "Old poll")).toHaveCount(0);
});

test("the Archived view lists archived surveys, survives a reload and Back returns", async ({
  page,
}) => {
  await signInAt(page);
  await expect(surveyNames(page).first()).toHaveText("API created");

  await toggleActiveArchived(page);
  await expect(page).toHaveURL(/[?&]archived=true(&|$)/);
  await expect(surveyNames(page)).toHaveText(["Old poll"]);
  await expect(activeArchivedSwitch(page)).toBeChecked();
  await expect(createButton(page)).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/[?&]archived=true(&|$)/);
  await expect(surveyNames(page)).toHaveText(["Old poll"]);
  await expect(createButton(page)).toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL("/");
  await expect(surveyNames(page).first()).toHaveText("API created");
  await expect(activeArchivedSwitch(page)).not.toBeChecked();
  await expect(createButton(page)).toBeVisible();
});

test("the project selector switches between a project's lists and Personal Surveys", async ({
  page,
}) => {
  await signInAt(page);
  await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");

  await chooseProject(page, "Marketing");
  await expect(page).toHaveURL(new RegExp(`[?&]project=${MARKETING}(&|$)`));
  await expect(projectSelector(page).getByRole("button")).toHaveText("Marketing");
  await expect(surveysNamed(page, "Campaign survey")).toHaveCount(1);
  await expect(surveysNamed(page, "Customer feedback")).toHaveCount(0);

  await toggleActiveArchived(page);
  await expect(page).toHaveURL(/[?&]archived=true(&|$)/);
  await expect(page).toHaveURL(new RegExp(`[?&]project=${MARKETING}(&|$)`));
  await expect(surveyNames(page)).toHaveText(["Archived campaign"]);

  await page.reload();
  await expect(page).toHaveURL(/[?&]archived=true(&|$)/);
  await expect(page).toHaveURL(new RegExp(`[?&]project=${MARKETING}(&|$)`));
  await expect(projectSelector(page).getByRole("button")).toHaveText("Marketing");
  await expect(activeArchivedSwitch(page)).toBeChecked();
  await expect(surveyNames(page)).toHaveText(["Archived campaign"]);

  await chooseProject(page, "Personal Surveys");
  await expect(page).toHaveURL("/");
  await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");
  await expect(surveyNames(page).first()).toHaveText("API created");
});

test("a user without projects or archived surveys sees neither the selector nor the switch", async ({
  page,
}) => {
  await signInAt(page, "/", "outsider");
  await expect(createButton(page)).toBeVisible();
  await loadAllPages(page);

  await expect(surveysNamed(page, "Outsider quiz")).toHaveCount(1);
  await expect(projectSelector(page)).toHaveCount(0);
  await expect(activeArchivedSwitch(page)).toHaveCount(0);
});

test.describe("an unknown project in the URL", () => {
  // The list and the archived check answer 404 before the page falls back.
  test.use({ expectedErrorResponses: [{ path: "/api/v1/surveys", status: 404 }] });

  test("falls back to Personal Surveys", async ({ page }) => {
    await signInAt(page, `/?project=${UNKNOWN_PROJECT}`);

    await expect(page).toHaveURL("/");
    await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");
    await expect(surveyNames(page).first()).toHaveText("API created");
  });
});

test.describe("an unknown survey id in the URL", () => {
  test.use({
    expectedErrorResponses: [{ path: `/api/v1/surveys/${UNKNOWN_PROJECT}`, status: 404 }],
  });

  test("shows that the survey is not available, with a way back", async ({ page }) => {
    await signInAt(page, `/surveys/${UNKNOWN_PROJECT}/edit`, "outsider");

    await expect(page.getByText("This survey is not available.")).toBeVisible();
    await page.getByRole("link", { name: "Back to My Surveys" }).click();
    await expect(page).toHaveURL("/");
    await expect(createButton(page)).toBeVisible();
  });
});

test("Create a Survey opens the new survey, which then heads the list", async ({ page }) => {
  await signInAt(page, "/", "outsider");

  await createButton(page).click();
  await expect(page).toHaveURL(
    /\/surveys\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/,
  );
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^New Survey \d+$/);
  const name = await heading.innerText();

  await page.getByRole("link", { name: "Back to My Surveys" }).click();
  await expect(page).toHaveURL("/");
  await expect(surveysNamed(page, name).first()).toBeVisible();
  await loadAllPages(page);

  // Other browsers may create surveys in this scope at the same time, so only the order is fixed.
  const names = await surveyNames(page).allInnerTexts();
  expect(names).toContain("Outsider quiz");
  expect(names.indexOf(name)).toBeGreaterThanOrEqual(0);
  expect(names.indexOf(name)).toBeLessThan(names.indexOf("Outsider quiz"));
});
