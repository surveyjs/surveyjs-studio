import type { Page } from "@playwright/test";
import {
  addMemberViaApi,
  adminBadge,
  createProjectViaApi,
  deleteProjectViaApi,
  findProjectIdViaApi,
  MEMBER_409,
  MEMBERS_404,
  memberRow,
  openProjectCard,
  projectCard,
  uniqueProjectName,
} from "./support/projects.js";
import { accountTrigger, signInAt, users } from "./support/sign-in.js";
import {
  answerNextConfirm,
  createSurveyViaApi,
  discardSurveyViaApi,
  loadAllPages,
  surveysNamed,
} from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";

// The Projects page (US 59, 61-69). Runs in memory mode on three browsers and in Azurite mode on the
// replica. Marketing, Engineering and the fixture memberships are read only: every test works on its
// own project, created by Adam Admin and deleted in `finally`. The only member added is Mia Member,
// never Oscar or Olivia. Surveys that move out of a deleted project land in Adam's Personal scope
// and are discarded.

const DELETE_PROJECT_CONFIRMATION =
  "Delete this project? Its surveys will move to the project owner's Personal Surveys, or to you if the owner has left.";
const LEAVE_PROJECT_CONFIRMATION = "Leave this project? You will lose access to its surveys.";

/** The project drop-down of the survey list (not the rows' "..." buttons). */
const projectSelector = (page: Page) =>
  page.locator(".v2-class---my-surveys-page__actions-container .v2-class---drop-down-button");

test.describe("create, add, promote, demote and remove", () => {
  test.use({ expectedErrorResponses: [MEMBERS_404] });

  test("an admin creates a project and manages its members (US 59, 61, 62, 63, 65)", async ({
    page,
    browserName,
  }) => {
    const name = uniqueProjectName("Projects", browserName);
    await signInAt(page, "/", "admin");
    try {
      await accountTrigger(page, "admin").hover();
      await page
        .locator("header.v2-class---top-bar")
        .first()
        .getByRole("link", { name: "Projects", exact: true })
        .click();
      await expect(page).toHaveURL(/\/projects$/);
      await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Create a Project" }).click();
      await page.getByLabel("Project name").fill(name);
      await page.getByRole("button", { name: "Save", exact: true }).click();

      const card = projectCard(page, name);
      await expect(card).toHaveCount(1);
      await openProjectCard(page, name);
      const adam = memberRow(card, users.admin.name);
      await expect(adam).toBeVisible();
      await expect(adminBadge(adam)).toHaveText("Admin");

      await card.getByRole("button", { name: "Add a New Member" }).click();
      const email = card.getByLabel("New member's email");
      await email.fill(`nobody-${Math.random().toString(36).slice(2, 8)}@example.com`);
      await card.getByRole("button", { name: "Add", exact: true }).click();
      await expect(card.getByRole("alert")).toContainText("is not a registered surveyjs.io user");

      await email.fill(users.member.email);
      await card.getByRole("button", { name: "Add", exact: true }).click();
      const mia = memberRow(card, users.member.name);
      await expect(mia).toBeVisible();
      await expect(adminBadge(mia)).toHaveCount(0);

      await mia.getByRole("link", { name: "Make Admin" }).click();
      await expect(adminBadge(mia)).toHaveText("Admin");

      await mia.getByRole("link", { name: "Remove Admin Rights" }).click();
      await expect(adminBadge(mia)).toHaveCount(0);

      const confirmation = answerNextConfirm(page, true);
      await card.getByRole("button", { name: `Remove ${users.member.name}` }).click();
      expect(await confirmation).toBe(`Remove ${users.member.name} from this project?`);
      await expect(mia).toHaveCount(0);
    } finally {
      const id = await findProjectIdViaApi(page, name);
      if (id) await deleteProjectViaApi(page, id);
    }
  });
});

test.describe("the last admin", () => {
  test.use({ expectedErrorResponses: [MEMBER_409] });

  test("cannot demote themselves (US 64)", async ({ page, browserName }) => {
    await signInAt(page, "/", "admin");
    const project = await createProjectViaApi(page, uniqueProjectName("Last admin", browserName));
    try {
      await page.goto("/projects");
      const card = await openProjectCard(page, project.name);
      const adam = memberRow(card, users.admin.name);
      await adam.getByRole("link", { name: "Remove Admin Rights" }).click();
      await expect(card.getByRole("alert")).toHaveText(
        "A project must keep at least one admin. Make another member an admin first.",
      );
      await expect(adminBadge(adam)).toHaveText("Admin");
    } finally {
      await deleteProjectViaApi(page, project.id);
    }
  });
});

test("a member leaves a project (US 66)", async ({ page, browser, browserName }) => {
  await signInAt(page, "/", "admin");
  const project = await createProjectViaApi(page, uniqueProjectName("Leave", browserName));
  const miaContext = await browser.newContext();
  try {
    await addMemberViaApi(page, project.id, users.member.email);
    const mia = await miaContext.newPage();
    const checkConsole = watchConsole(mia);
    await signInAt(mia, "/projects", "member");
    const card = await openProjectCard(mia, project.name);
    const confirmation = answerNextConfirm(mia, true);
    await card.getByRole("link", { name: "Leave Project" }).click();
    expect(await confirmation).toBe(LEAVE_PROJECT_CONFIRMATION);
    await expect(projectCard(mia, project.name)).toHaveCount(0);

    await mia.goto("/");
    const selector = projectSelector(mia);
    await selector.getByRole("button").click();
    // Mia still has Marketing, so the menu is there; only the left project is gone from it.
    await expect(selector.getByRole("link", { name: "Manage Projects" })).toBeVisible();
    await expect(selector.getByRole("link", { name: project.name, exact: true })).toHaveCount(0);
    checkConsole();
  } finally {
    await miaContext.close();
    await deleteProjectViaApi(page, project.id);
  }
});

test("deleting a project moves its surveys to the owner (US 67, 69)", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const project = await createProjectViaApi(page, uniqueProjectName("Delete", browserName));
  const survey = await createSurveyViaApi(
    page,
    uniqueProjectName("Moved survey", browserName),
    project.id,
  );
  try {
    await page.reload();
    const selector = projectSelector(page);
    await selector.getByRole("button").click();
    await selector.getByRole("link", { name: "Manage Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);

    const card = projectCard(page, project.name);
    const confirmation = answerNextConfirm(page, true);
    await card.getByRole("link", { name: "Remove", exact: true }).click();
    expect(await confirmation).toBe(DELETE_PROJECT_CONFIRMATION);
    await expect(card).toHaveCount(0);

    await page.goto("/");
    await loadAllPages(page);
    await expect(surveysNamed(page, survey.name)).toHaveCount(1);
  } finally {
    await discardSurveyViaApi(page, survey.id);
    await deleteProjectViaApi(page, project.id);
  }
});
