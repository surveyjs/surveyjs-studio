import type { Page } from "@playwright/test";
import { accountTrigger, expectSignInPage, firstAdmin, signIn } from "./support/password.js";
import { createProjectViaApi, openProjectCard, uniqueProjectName } from "./support/projects.js";
import { expect, test } from "./support/test.js";

// OAuth mode only (`pnpm e2e:oauth`): password mode's server plus GitHub and Google sign-in, both
// against the OAuth stub (started by playwright.config.ts). SIGN_UP_DOMAINS there is allowed.example.
test.skip(process.env["E2E_MODE"] !== "oauth", "needs pnpm e2e:oauth");

const NEW_PASSWORD = "the first admin's own password";
const invited = { email: "new@example.com", name: "Nina New" };
const stranger = { email: "stranger@example.net", name: "Sam Stranger" };

/** A page in a browser context of its own: another person's browser. */
async function openBrowser(browser: import("@playwright/test").Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return context.newPage();
}

/** On the sign-in page: follows the provider's link and fills in the stub's form. */
async function signInWithProvider(
  page: Page,
  provider: "GitHub" | "Google",
  person: { email: string; name: string },
): Promise<void> {
  await page.getByRole("link", { name: `Sign in with ${provider}` }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Sign in to the ${provider} stub` }),
  ).toBeVisible();
  await page.getByLabel("email", { exact: true }).fill(person.email);
  await page.getByLabel("name", { exact: true }).fill(person.name);
  await page.getByLabel("sub", { exact: true }).fill(`sub-${person.email}`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function signOut(page: Page, name: string): Promise<void> {
  await accountTrigger(page, name).hover();
  const button = page.locator("header.v2-class---top-bar").first().getByRole("button", {
    name: "Sign Out",
  });
  await expect(button).toBeVisible();
  await button.click();
  await expectSignInPage(page);
}

// In order: the first test ends the admin's forced password change, which the third needs.
test.describe.serial("OAuth sign-in", () => {
  test("an invited email is pending, then joins with GitHub", async ({ page, browser }) => {
    // The first admin must change the password before anything else.
    await page.goto("/");
    await expectSignInPage(page);
    await signIn(page, firstAdmin.email, firstAdmin.password);
    await expect(page).toHaveURL(/\/change-password\?/);
    await page.getByLabel("Current password").fill(firstAdmin.password);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Repeat the new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).not.toHaveURL(/change-password/);
    await expect(accountTrigger(page, firstAdmin.name)).toBeVisible({ timeout: 30_000 });

    // The admin invites an email no account has: the row is pending.
    const projectName = uniqueProjectName("Invited", "chromium");
    await createProjectViaApi(page, projectName);
    await page.goto("/projects");
    const card = await openProjectCard(page, projectName);
    await card.getByRole("button", { name: "Add a New Member" }).click();
    await card.getByLabel("New member's email").fill(invited.email);
    await card.getByRole("button", { name: "Add", exact: true }).click();
    await expect(
      card.getByText(`${invited.email} will join when they first sign in.`),
    ).toBeVisible();
    const row = card
      .locator(".v2-class---account-page__project-user")
      .filter({ hasText: invited.email });
    await expect(row).toContainText("Pending");

    // The invited person signs in with GitHub in their own browser and has the project.
    const other = await openBrowser(browser);
    await other.goto("/");
    await expectSignInPage(other);
    await signInWithProvider(other, "GitHub", invited);
    await expect(accountTrigger(other, invited.name)).toBeVisible({ timeout: 30_000 });
    await other.goto("/projects");
    await expect(
      other.locator(".v2-class---account-page__project-title").filter({ hasText: projectName }),
    ).toBeVisible();

    // Back on the admin's page the row is no longer pending.
    await page.reload();
    const joined = await openProjectCard(page, projectName);
    await expect(
      joined.locator(".v2-class---account-page__project-user").filter({ hasText: invited.name }),
    ).not.toContainText("Pending");
    await other.context().close();
  });

  test("a stranger is refused and stays signed out", async ({ page }) => {
    await page.goto("/");
    await expectSignInPage(page);
    await signInWithProvider(page, "GitHub", stranger);
    await expect(page).toHaveURL(/\/sign-in\/refused\?/);
    await expect(page.getByRole("heading", { name: "You can't sign in yet" })).toBeVisible();
    await expect(
      page.getByText(
        "This instance is open to invited people only. Ask a project admin or the person who runs it to invite your email address, then sign in again.",
      ),
    ).toBeVisible();
    await page.goto("/");
    await expectSignInPage(page);
  });

  test("Google with the admin's verified email is the same account", async ({ page }) => {
    await page.goto("/");
    await expectSignInPage(page);
    await signIn(page, firstAdmin.email, NEW_PASSWORD);
    await expect(accountTrigger(page, firstAdmin.name)).toBeVisible({ timeout: 30_000 });
    await signOut(page, firstAdmin.name);

    await signInWithProvider(page, "Google", { email: firstAdmin.email, name: "" });
    await expect(accountTrigger(page, firstAdmin.name)).toBeVisible({ timeout: 30_000 });
    await accountTrigger(page, firstAdmin.name).hover();
    await expect(
      page.locator("header.v2-class---top-bar").first().getByRole("link", { name: "Users" }),
    ).toBeVisible();
  });
});
