import { accountTrigger, expectSignInPage, signInAt, users } from "./support/sign-in.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test } from "./support/test.js";

test("an anonymous visit to a private page goes to sign-in, not an error page", async ({
  page,
}) => {
  await page.goto("/");
  await expectSignInPage(page);
  await expect(page.getByText(/not found|something went wrong/i)).toHaveCount(0);
});

test("signing in from / lands on My Surveys with the user's name in the header", async ({
  page,
}) => {
  await signInAt(page, "/");
  await expect(page).toHaveURL("/?project=personal");
  await expect(accountTrigger(page)).toContainText(users.owner.name);
});

test("a deep link survives sign-in", async ({ page }) => {
  await signInAt(page, "/?project=personal&archived=true");
  await expect(page).toHaveURL("/?project=personal&archived=true");
});

test("Sign Out ends the session and the next visit asks to sign in again", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.shell);
  await signInAt(page);
  await accountTrigger(page).hover();
  const signOut = page.locator("header.v2-class---top-bar").first().getByRole("button", {
    name: "Sign Out",
  });
  await expect(signOut).toBeVisible();
  await signOut.click();

  await expectSignInPage(page);
  await page.goto("/");
  await expectSignInPage(page);
});

test("Sign Out after the session expired still ends the provider's session", async ({
  page,
  context,
}) => {
  test.skip(sandboxMode, notOnSandbox.shell);
  await signInAt(page);
  // The browser drops msid and msid_csrf when they expire; the header still shows the user.
  await context.clearCookies();
  await accountTrigger(page).hover();
  const signOut = page.locator("header.v2-class---top-bar").first().getByRole("button", {
    name: "Sign Out",
  });
  await expect(signOut).toBeVisible();
  const logout = page.waitForResponse("**/api/v1/auth/logout");
  await signOut.click();

  // The server still answers with the provider's end-session URL, and the browser goes there.
  expect((await logout).status()).toBe(200);
  await expectSignInPage(page);
});
