import type { Page } from "@playwright/test";
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

/** The surveyjs-site header's account item, which shows the user's display name. */
const accountTrigger = (page: Page) =>
  page.locator("header.v2-class---top-bar").first().getByRole("button", { name: firstAdmin.name });

// The [value, options] form: Playwright would read a bare pair of objects as one.
test.use({ expectedErrorResponses: [[WRONG_PASSWORD, LOCKED_OUT], { scope: "test" }] });

// One test: the steps change the admin's password, so they cannot run apart or in parallel.
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
