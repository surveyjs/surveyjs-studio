import type { Page } from "@playwright/test";
import { VIEW_404 } from "./support/results.js";
import { routeBrandImage } from "./support/run.js";
import { signInAt } from "./support/sign-in.js";
import {
  answerNextConfirm,
  copiedValues,
  createSurveyViaApi,
  discardSurveyViaApi,
  findSurveysViaApi,
  getSurveyViaApi,
  loadAllPages,
  menuEntries,
  menuTrigger,
  openFlyout,
  openRowMenu,
  pickMenuItem,
  recordClipboard,
  surveyRow,
} from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// Writes only to scopes tests may write to (the other browsers and the conformance suite write there
// too): the admin's Personal scope and Engineering. Nothing here touches the outsider's Personal
// scope: survey-list.spec.ts expects it to hold no archived survey, which cleanup (archive, then
// delete) would leave for a moment. Never the owner's Personal scope or Marketing (other specs count
// their rows), never a fixture survey. Every test creates surveys with unique names and removes them
// at the end. Assertions are about one named row, never about how many surveys a scope holds. The
// "cannot modify" tests only read fixtures.

// Each test signs in, creates a survey and acts on its row; Firefox on a busy machine needs the time.
test.describe.configure({ timeout: 60_000 });

const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const MARKETING = "55555555-0000-4000-8000-a00000000001";
const MOVE_CONFIRM =
  "Do you want to move this survey to another organization? This operation can't be undone.";

// The cookie banner is fixed to the bottom of the page and covers the last menu items; it has
// already been answered.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

function uniqueName(browserName: string): string {
  return `Actions ${browserName} ${Math.random().toString(36).slice(2, 8)}`;
}

/** Runs `body`, then removes the surveys with these ids and the surveys found under these names. */
async function withCleanup(
  page: Page,
  scopes: { name: string; projectId: string | null }[],
  ids: string[],
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } finally {
    const all = new Set(ids);
    for (const scope of scopes) {
      for (const survey of await findSurveysViaApi(page, scope.name, scope.projectId)) {
        all.add(survey.id);
      }
    }
    for (const id of all) await discardSurveyViaApi(page, id);
  }
}

test("rename: Esc keeps the name, Enter saves it, and it survives a reload", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const renamed = `${name} renamed`;
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [], [survey.id], async () => {
    await page.goto("/");
    const row = surveyRow(page, name);
    await expect(row).toBeVisible();
    const input = page.getByRole("textbox", { name: "Survey name" });

    // The pencil has no box of its own: hover the row, then click its icon.
    await row.hover();
    await row.locator(".v2-class---my-surveys-page__edit-icon").click();
    await expect(input).toHaveValue(name);
    await input.fill("Discarded name");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(surveyRow(page, name)).toBeVisible();
    await expect(surveyRow(page, "Discarded name")).toHaveCount(0);

    await row.hover();
    await row.locator(".v2-class---my-surveys-page__edit-icon").click();
    await input.fill(renamed);
    await input.press("Enter");
    await expect(surveyRow(page, renamed)).toBeVisible();
    await expect(surveyRow(page, name)).toHaveCount(0);

    await page.reload();
    await expect(surveyRow(page, renamed)).toBeVisible();
    await expect(surveyRow(page, name)).toHaveCount(0);
    expect((await getSurveyViaApi(page, survey.id))?.name).toBe(renamed);
  });
});

test("publish shows Run, which opens the run page in a new tab, and unpublish hides it", async ({
  page,
  context,
  browserName,
}) => {
  // The run page's brand footer loads its image from surveyjs.io; answered locally.
  await routeBrandImage(context);
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [], [survey.id], async () => {
    await page.goto("/");
    let popup = await openRowMenu(surveyRow(page, name));
    await expect(popup.getByRole("link", { name: "Run", exact: true })).toHaveCount(0);
    await pickMenuItem(popup, "Publish");

    popup = await openRowMenu(surveyRow(page, name));
    const run = popup.getByRole("link", { name: "Run", exact: true });
    await expect(run).toBeVisible();
    const opened = context.waitForEvent("page");
    await run.click();
    const tab = await opened;
    await expect(tab).toHaveURL(new RegExp(`/s/${survey.id}$`));
    // A new survey has no questions yet.
    await expect(tab.getByText("The survey doesn't contain any visible elements.")).toBeVisible();
    await tab.close();

    popup = await openRowMenu(surveyRow(page, name));
    await pickMenuItem(popup, "Unpublish");
    popup = await openRowMenu(surveyRow(page, name));
    await expect(popup.getByRole("link", { name: "Publish", exact: true })).toBeVisible();
    await expect(popup.getByRole("link", { name: "Run", exact: true })).toHaveCount(0);
  });
});

test("clone adds Copy of <name>, which is unpublished", async ({ page, browserName }) => {
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const copyName = `Copy of ${name}`;
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [{ name: copyName, projectId: null }], [survey.id], async () => {
    await page.goto("/");
    const popup = await openRowMenu(surveyRow(page, name));
    await pickMenuItem(popup, "Clone");
    const copyRow = surveyRow(page, copyName);
    await expect(copyRow).toBeVisible();
    await expect(surveyRow(page, name)).toBeVisible();

    const copyMenu = await openRowMenu(copyRow);
    await expect(copyMenu.getByRole("link", { name: "Publish", exact: true })).toBeVisible();
    await expect(copyMenu.getByRole("link", { name: "Run", exact: true })).toHaveCount(0);
  });
});

test("Survey IDs copies the id, the result id and the post id", async ({ page, browserName }) => {
  await recordClipboard(page);
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [], [survey.id], async () => {
    await page.goto("/");
    const row = surveyRow(page, name);
    const items = ["Copy ID", "Copy Result ID", "Copy Post ID"];
    for (const item of items) {
      const popup = await openRowMenu(row);
      const flyout = await openFlyout(popup, "Survey IDs");
      await flyout.getByRole("link", { name: item, exact: true }).click();
      await expect(popup).toHaveCount(0);
    }
    const stored = await getSurveyViaApi(page, survey.id);
    expect(await copiedValues(page)).toEqual([stored?.id, stored?.resultId, stored?.postId]);
  });
});

test.describe("the survey pages", () => {
  // The results page reads the admin's saved layouts of the new survey: none, so 404.
  test.use({ expectedErrorResponses: [VIEW_404] });

  test("Edit, View Results and View History open their pages with the survey name", async ({
    page,
    browserName,
  }) => {
    await signInAt(page, "/", "admin");
    const name = uniqueName(browserName);
    const survey = await createSurveyViaApi(page, name);
    await withCleanup(page, [], [survey.id], async () => {
      const targets = [
        // The editor shows the name in its bottom bar.
        {
          item: "Edit",
          path: "edit",
          shows: page.locator(
            "#edit-survey-change-name-container .v2-class---my-surveys-page__survey-name",
          ),
          text: name,
        },
        {
          item: "View Results",
          path: "results",
          shows: page.getByRole("heading", { level: 1 }),
          text: name,
        },
        {
          item: "View History",
          path: "history",
          shows: page.getByRole("heading", { level: 1 }),
          text: `Survey editing history of the '${name}'`,
        },
      ];
      for (const { item, path, shows, text } of targets) {
        await page.goto("/");
        const url = new RegExp(`/surveys/${survey.id}/${path}$`);
        await pickMenuItem(await openRowMenu(surveyRow(page, name)), item);
        await expect(page).toHaveURL(url);
        await expect(shows).toHaveText(text);
      }
    });
  });
});

test("Move to Project moves a Personal survey to Engineering and back, after a confirmation", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [], [survey.id], async () => {
    await page.goto("/");
    let popup = await openRowMenu(surveyRow(page, name));
    let flyout = await openFlyout(popup, "Move to Project");

    // Dismissing the confirmation changes nothing.
    let asked = answerNextConfirm(page, false);
    await flyout.getByRole("link", { name: "Engineering", exact: true }).click();
    expect(await asked).toBe(MOVE_CONFIRM);
    await expect(page).toHaveURL(/\/$/);
    await expect(surveyRow(page, name)).toBeVisible();
    expect((await getSurveyViaApi(page, survey.id))?.projectId).toBeNull();

    popup = await openRowMenu(surveyRow(page, name));
    flyout = await openFlyout(popup, "Move to Project");
    asked = answerNextConfirm(page, true);
    await flyout.getByRole("link", { name: "Engineering", exact: true }).click();
    expect(await asked).toBe(MOVE_CONFIRM);
    await expect(page).toHaveURL(new RegExp(`[?&]project=${ENGINEERING}$`));
    await expect(surveyRow(page, name)).toBeVisible();
    expect((await getSurveyViaApi(page, survey.id))?.projectId).toBe(ENGINEERING);

    popup = await openRowMenu(surveyRow(page, name));
    flyout = await openFlyout(popup, "Move to Project");
    asked = answerNextConfirm(page, true);
    await flyout.getByRole("link", { name: "Personal Surveys", exact: true }).click();
    await asked;
    await expect(page).toHaveURL(/\/$/);
    await expect(surveyRow(page, name)).toBeVisible();
    expect((await getSurveyViaApi(page, survey.id))?.projectId).toBeNull();
  });
});

test("Archive, Restore and Delete move a survey between the views and remove it", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueName(browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [], [survey.id], async () => {
    await page.goto("/");
    await pickMenuItem(await openRowMenu(surveyRow(page, name)), "Archive");
    await expect(surveyRow(page, name)).toHaveCount(0);

    await page.locator('[data-switcher-name="my-surveys-active-archived"]').click();
    await expect(page).toHaveURL(/[?&]archived=true(&|$)/);
    await expect(surveyRow(page, name)).toBeVisible();

    await pickMenuItem(await openRowMenu(surveyRow(page, name)), "Restore");
    await expect(surveyRow(page, name)).toHaveCount(0);
    await page.goto("/");
    await expect(surveyRow(page, name)).toBeVisible();

    await pickMenuItem(await openRowMenu(surveyRow(page, name)), "Archive");
    await expect(surveyRow(page, name)).toHaveCount(0);
    await page.goto("/?archived=true");
    await expect(surveyRow(page, name)).toBeVisible();

    // Dismissing the confirmation keeps the survey.
    let popup = await openRowMenu(surveyRow(page, name));
    let asked = answerNextConfirm(page, false);
    await popup.getByRole("link", { name: "Delete", exact: true }).click();
    expect(await asked).toBe(
      "Do you really want to delete this survey? This operation can't be undone.",
    );
    await expect(surveyRow(page, name)).toBeVisible();
    expect(await getSurveyViaApi(page, survey.id)).not.toBeNull();

    popup = await openRowMenu(surveyRow(page, name));
    asked = answerNextConfirm(page, true);
    await popup.getByRole("link", { name: "Delete", exact: true }).click();
    await asked;
    await expect(surveyRow(page, name)).toHaveCount(0);
    await expect.poll(() => getSurveyViaApi(page, survey.id)).toBeNull();
  });
});

test("a member who cannot modify a survey sees no pencil and no modifying items (Active)", async ({
  page,
}) => {
  await signInAt(page, `/?project=${ENGINEERING}`, "owner");
  await loadAllPages(page);
  const row = surveyRow(page, "Engineering retro");
  await expect(row).toBeVisible();
  await expect(row.locator(".v2-class---my-surveys-page__edit-icon")).toHaveCount(0);

  const popup = await openRowMenu(row);
  const entries = await menuEntries(popup).allInnerTexts();
  // Engineering retro is unpublished, so no Run.
  expect(entries).toEqual(["Edit", "Clone", "Survey IDs", "View Results", "View History"]);
  await expect(menuTrigger(row)).toBeVisible();
});

test("a member who cannot modify a survey sees only Clone and View Results (Archived)", async ({
  page,
}) => {
  await signInAt(page, `/?project=${MARKETING}&archived=true`, "member");
  const row = surveyRow(page, "Archived campaign");
  await expect(row).toBeVisible();
  await expect(row.locator(".v2-class---my-surveys-page__edit-icon")).toHaveCount(0);
  const popup = await openRowMenu(row);
  expect(await menuEntries(popup).allInnerTexts()).toEqual(["Clone", "View Results"]);
});
