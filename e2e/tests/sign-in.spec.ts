import { accountTrigger, expectSignInPage, signInAt, users } from "./support/sign-in.js";
import { expect, test } from "./support/test.js";

test("an anonymous visit to a private page goes to sign-in, not an error page", async ({
  page,
}) => {
  await page.goto("/");
  await expectSignInPage(page);
  await expect(page.getByText(/not found|something went wrong/i)).toHaveCount(0);
});

test("signing in from / lands on / with the user's name in the header", async ({ page }) => {
  await signInAt(page, "/");
  await expect(page).toHaveURL("/");
  await expect(accountTrigger(page)).toContainText(users.owner.name);
});

test("a deep link survives sign-in", async ({ page }) => {
  await signInAt(page, "/?project=personal&archived=true");
  await expect(page).toHaveURL("/?project=personal&archived=true");
});

test("Sign Out ends the session and the next visit asks to sign in again", async ({ page }) => {
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
