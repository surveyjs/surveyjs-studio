import type { Browser, Page } from "@playwright/test";
import { firstAdmin, passwordMode } from "./support/password.js";
import { expect, test } from "./support/test.js";

// Password mode only (`pnpm e2e:password`): the other modes sign in through an identity provider.
test.skip(!passwordMode, "needs pnpm e2e:password");

const NEW_PASSWORD = "the first admin's own password";

// Each refused sign-in, which the browser logs as a failed resource load.
const WRONG_PASSWORD = { path: "/api/v1/auth/password/login", status: 401 };
const LOCKED_OUT = { path: "/api/v1/auth/password/login", status: 429 };

/** The app's sign-in page, with its heading shown. */
async function expectSignInPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/sign-in(\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The user the instance admin creates. */
const unaUser = { email: "una@example.com", name: "Una User" };
const unaEmail = unaUser.email;
const UNA_PASSWORD = "Una's first long password";
const UNA_NEW_PASSWORD = "Una's password after the reset";

/** The one-time link the Users page shows, then dismissed with Done. */
async function shownLink(page: Page): Promise<string> {
  const box = page.getByRole("status").filter({ hasText: "shown only now" });
  const url = await box.getByLabel("Set-password link").inputValue();
  expect(url).toMatch(/\/set-password\?token=/);
  await box.getByRole("button", { name: "Done" }).click();
  return url;
}

/** A page in a browser context of its own: another person's browser. */
async function openBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return context.newPage();
}

/** Opens a set-password link and sets the password; ends on the sign-in page. */
async function setPasswordWith(page: Page, url: string, password: string): Promise<void> {
  await page.goto(url);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Repeat the password").fill(password);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByText(/Your password was set/)).toBeVisible();
  await page.getByRole("link", { name: "Sign in" }).click();
  await expectSignInPage(page);
}

const unaTrigger = (page: Page) =>
  page.locator("header.v2-class---top-bar").first().getByRole("button", { name: unaUser.name });

/** The surveyjs-site header's account item, which shows the user's display name. */
const accountTrigger = (page: Page) =>
  page.locator("header.v2-class---top-bar").first().getByRole("button", { name: firstAdmin.name });

// The [value, options] form: Playwright would read a bare pair of objects as one.
test.use({ expectedErrorResponses: [[WRONG_PASSWORD, LOCKED_OUT], { scope: "test" }] });

// In order: the first test changes the admin's password, which the second signs in with.
test.describe.serial("the first admin", () => {
  test("the first admin signs in, must change the password, signs out and signs in again", async ({
    page,
  }) => {
    await page.goto("/?project=personal");
    await expectSignInPage(page);
    await signIn(page, firstAdmin.email, firstAdmin.password);

    // The forced change comes before anything else, then the app goes back to the deep link.
    await expect(page).toHaveURL(/\/change-password\?/);
    await expect(page.getByText(/must choose a new password/)).toBeVisible();
    await page.getByLabel("Current password").fill(firstAdmin.password);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Repeat the new password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL("/?project=personal");
    await expect(accountTrigger(page)).toBeVisible({ timeout: 30_000 });

    await accountTrigger(page).hover();
    const signOut = page.locator("header.v2-class---top-bar").first().getByRole("button", {
      name: "Sign Out",
    });
    await expect(signOut).toBeVisible();
    await signOut.click();
    await expectSignInPage(page);

    // The first password no longer works; the new one does, with no forced change this time.
    await signIn(page, firstAdmin.email, firstAdmin.password);
    await expect(page.getByRole("alert")).toHaveText("The email or the password is wrong.");
    await page.getByLabel("Password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(accountTrigger(page)).toBeVisible({ timeout: 30_000 });
    await expect(page).not.toHaveURL(/change-password/);
  });

  test("the instance admin creates, resets, disables, enables and deletes a user", async ({
    page,
    browser,
  }) => {
    // Every row action asks first.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/");
    await expectSignInPage(page);
    await signIn(page, firstAdmin.email, NEW_PASSWORD);
    await accountTrigger(page).hover();
    await page
      .locator("header.v2-class---top-bar")
      .first()
      .getByRole("link", { name: "Users" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();

    // Create Una: the link is shown once.
    await page.getByLabel("Email").fill(unaUser.email);
    await page.getByLabel("Name").fill(unaUser.name);
    await page.getByRole("button", { name: "Create user" }).click();
    const invitation = await shownLink(page);
    const unaRow = page.getByRole("row", { name: new RegExp(unaUser.name) });
    await expect(unaRow).toContainText("Invited");

    // Una sets her password in her own browser and signs in.
    const una = await openBrowser(browser);
    await setPasswordWith(una, invitation, UNA_PASSWORD);
    await signIn(una, unaEmail, UNA_PASSWORD);
    await expect(unaTrigger(una)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(unaRow).toContainText("Active");

    // A reset ends her session and her password; the new link works.
    await unaRow.getByRole("button", { name: "Reset password" }).click();
    const reset = await shownLink(page);
    await una.reload();
    await expectSignInPage(una);
    await setPasswordWith(una, reset, UNA_NEW_PASSWORD);
    await signIn(una, unaEmail, UNA_NEW_PASSWORD);
    await expect(unaTrigger(una)).toBeVisible({ timeout: 30_000 });

    // Disabled, she is signed out and cannot sign in; enabled, she can again.
    await unaRow.getByRole("button", { name: "Disable" }).click();
    await expect(unaRow).toContainText("Disabled");
    await una.reload();
    await expectSignInPage(una);
    await signIn(una, unaEmail, UNA_NEW_PASSWORD);
    await expect(una.getByRole("alert")).toHaveText("The email or the password is wrong.");
    await unaRow.getByRole("button", { name: "Enable" }).click();
    await expect(unaRow).toContainText("Active");
    await una.getByRole("button", { name: "Sign in" }).click();
    await expect(unaTrigger(una)).toBeVisible({ timeout: 30_000 });

    // Deleted, she is gone from the list and signed out.
    await unaRow.getByRole("button", { name: "Delete" }).click();
    await expect(unaRow).toHaveCount(0);
    await una.reload();
    await expectSignInPage(una);
    await una.context().close();
  });
});

test("too many failed sign-ins for an email show when to try again", async ({ page }) => {
  // An email of its own, so the back-off does not touch the admin's sign-in in the other test.
  const email = `locked-${test.info().workerIndex}-${Date.now()}@example.com`;
  await page.goto("/sign-in");
  await expectSignInPage(page);
  for (let i = 0; i < 5; i++) {
    await signIn(page, email, "not the password at all");
    await expect(page.getByRole("alert")).toHaveText("The email or the password is wrong.");
  }
  await signIn(page, email, "not the password at all");
  await expect(page.getByRole("alert")).toHaveText(/Too many failed attempts\. Try again in/);
});
