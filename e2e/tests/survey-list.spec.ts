import type { Page } from "@playwright/test";
import { createProjectViaApi, deleteProjectViaApi, uniqueProjectName } from "./support/projects.js";
import { signInAt } from "./support/sign-in.js";
import {
  expectSurveyRow,
  loadAllPages,
  menuTrigger,
  surveyNames,
  surveyRows,
  surveysNamed,
} from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";

// Runs in memory mode on three browsers and in Azurite mode on the replica. Tests write only to
// the outsider's Personal scope, the admin's Personal scope and Engineering (other browsers and the
// conformance suite write there too), never the owner's Personal scope, Marketing or a fixture
// survey, so those hold exactly their fixture rows; the outsider's list is read to its end. One
// test creates a project of the admin's own and deletes it.

const MARKETING = "55555555-0000-4000-8000-a00000000001";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
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

test("the page is titled My Surveys and offers Create a Survey and each row's menu", async ({
  page,
}) => {
  await signInAt(page);

  await expect(page).toHaveTitle("My Surveys");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My Surveys");
  await expect(createButton(page)).toBeVisible();
  const first = surveyRows(page).first();
  await expectSurveyRow(first, "API created", "5/30/2026", "6/1/2026");
  // The "…" trigger shows while the row is hovered.
  await first.hover();
  await expect(menuTrigger(first)).toBeVisible();
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
  await expect(page).toHaveURL("/?project=personal");
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
  await expect(page).toHaveURL("/?project=personal");
  await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");
  await expect(surveyNames(page).first()).toHaveText("API created");
});

test("the project selector lists Personal Surveys and the user's projects, the current one marked", async ({
  page,
}) => {
  const selected = /\bv2-class---drop-down-menu-item__link--selected\b/;
  await signInAt(page);
  const selector = projectSelector(page);
  await selector.getByRole("button").click();

  const personal = selector.getByRole("link", { name: "Personal Surveys", exact: true });
  const marketing = selector.getByRole("link", { name: "Marketing", exact: true });
  const engineering = selector.getByRole("link", { name: "Engineering", exact: true });
  await expect(personal).toHaveAttribute("href", "/?project=personal");
  await expect(marketing).toHaveAttribute("href", `/?project=${MARKETING}`);
  await expect(engineering).toHaveAttribute("href", `/?project=${ENGINEERING}`);
  await expect(selector.getByRole("link", { name: "Manage Projects" })).toHaveAttribute(
    "href",
    "/projects",
  );
  await expect(personal).toHaveClass(selected);
  await expect(marketing).not.toHaveClass(selected);
  await expect(engineering).not.toHaveClass(selected);

  await marketing.click();
  await expect(page).toHaveURL(new RegExp(`[?&]project=${MARKETING}(&|$)`));
  await selector.getByRole("button").click();
  await expect(marketing).toHaveClass(selected);
  await expect(personal).not.toHaveClass(selected);
});

test("My Surveys opens the list the user looked at last, and Back still returns", async ({
  page,
  context,
}) => {
  await signInAt(page);
  await expect(page).toHaveURL("/?project=personal");
  await chooseProject(page, "Marketing");
  await expect(page).toHaveURL(`/?project=${MARKETING}`);
  // The list is remembered once it is shown, which can come after the URL changes.
  await expect(surveysNamed(page, "Campaign survey")).toHaveCount(1);

  // Another tab of the same browser: `/` opens Marketing.
  const tab = await context.newPage();
  const checkConsole = watchConsole(tab);
  await tab.goto("/");
  await expect(tab).toHaveURL(`/?project=${MARKETING}`);
  await expect(projectSelector(tab).getByRole("button")).toHaveText("Marketing");
  await expect(surveysNamed(tab, "Campaign survey")).toHaveCount(1);
  checkConsole();
  await tab.close();

  // Back returns to the list before, not to the remembered one, which it then becomes.
  await page.goBack();
  await expect(page).toHaveURL("/?project=personal");
  await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");
  await expect(surveyNames(page).first()).toHaveText("API created");
  await page.goto("/");
  await expect(page).toHaveURL("/?project=personal");
  await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");

  // A reload keeps the archived view with the remembered project.
  await chooseProject(page, "Marketing");
  await expect(page).toHaveURL(`/?project=${MARKETING}`);
  await expect(surveysNamed(page, "Campaign survey")).toHaveCount(1);
  await page.goto("/?archived=true");
  await expect(page).toHaveURL(`/?project=${MARKETING}&archived=true`);
  await expect(surveyNames(page)).toHaveText(["Archived campaign"]);
});

test.describe("a remembered project the user can no longer open", () => {
  // The list and the archived check of the deleted project answer 404 before the page falls back.
  test.use({ expectedErrorResponses: [{ path: "/api/v1/surveys", status: 404 }] });

  test("falls back to Personal Surveys, which is remembered instead", async ({
    page,
    browserName,
  }) => {
    await signInAt(page, "/", "admin");
    const project = await createProjectViaApi(page, uniqueProjectName("Remembered", browserName));
    try {
      await page.goto(`/?project=${project.id}`);
      await expect(projectSelector(page).getByRole("button")).toHaveText(project.name);
    } finally {
      await deleteProjectViaApi(page, project.id);
    }

    await page.goto("/");
    await expect(page).toHaveURL("/?project=personal");
    await expect(projectSelector(page).getByRole("button")).toHaveText("Personal Surveys");
    await page.goto("/");
    await expect(page).toHaveURL("/?project=personal");
  });
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

    await expect(page).toHaveURL("/?project=personal");
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
    await expect(page).toHaveURL("/?project=personal");
    await expect(createButton(page)).toBeVisible();
  });
});

test("Create a Survey opens the new survey, which then heads the list", async ({ page }) => {
  await signInAt(page, "/", "outsider");

  await createButton(page).click();
  await expect(page).toHaveURL(
    /\/surveys\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/,
  );
  // The editor: the Creator, and the new survey's name in its bottom bar.
  await expect(page.locator("#creator .svc-creator")).toBeVisible({ timeout: 30_000 });
  const footerName = page.locator(
    "#edit-survey-change-name-container .v2-class---my-surveys-page__survey-name",
  );
  await expect(footerName).toHaveText(/^New Survey \d+$/);
  const name = await footerName.innerText();

  await page.goBack();
  await expect(page).toHaveURL("/?project=personal");
  await expect(surveysNamed(page, name).first()).toBeVisible();
  await loadAllPages(page);

  // Other browsers may create surveys in this scope at the same time, so only the order is fixed.
  const names = await surveyNames(page).allInnerTexts();
  expect(names).toContain("Outsider quiz");
  expect(names.indexOf(name)).toBeGreaterThanOrEqual(0);
  expect(names.indexOf(name)).toBeLessThan(names.indexOf("Outsider quiz"));
});
