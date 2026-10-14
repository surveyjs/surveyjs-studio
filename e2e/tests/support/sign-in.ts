import type { Page } from "@playwright/test";
import { expect } from "./test.js";

/** The legacy-fixture users the servers are seeded with (their names come from either provider). */
export const users = {
  owner: {
    id: "11111111-0000-4000-8000-a00000000001",
    email: "owner@example.com",
    name: "Olivia Owner",
  },
} as const;

export type UserKey = keyof typeof users;

/** `azurite`: the server runs on the legacy replica and signs in through the mock OIDC server. */
export const azuriteMode = process.env["E2E_MODE"] === "azurite";

/** Locators of whichever sign-in page the mode shows. */
function signInPage(page: Page) {
  return azuriteMode
    ? page.locator('input[name="username"]')
    : page.locator("li", { hasText: users.owner.email });
}

/** Waits until the browser shows the identity provider's sign-in page. */
export async function expectSignInPage(page: Page): Promise<void> {
  await expect(signInPage(page).first()).toBeVisible();
}

/** Completes the sign-in page the browser is on: the dev page's link, or the mock OIDC form. */
export async function completeSignIn(page: Page, user: UserKey = "owner"): Promise<void> {
  await expectSignInPage(page);
  if (azuriteMode) {
    await page.locator('input[name="username"]').fill(users[user].id);
    await page.locator('input[name="username"]').press("Enter");
  } else {
    await page.locator("li", { hasText: users[user].email }).getByRole("link").click();
  }
}

/** Opens `path` signed out, signs in as `user` and waits for the signed-in header. */
export async function signInAt(page: Page, path = "/", user: UserKey = "owner"): Promise<void> {
  await page.goto(path);
  await completeSignIn(page, user);
  await expect(accountTrigger(page, user)).toBeVisible();
}

/** The header's account item, which shows the user's display name. */
export function accountTrigger(page: Page, user: UserKey = "owner") {
  return page
    .locator("header.v2-class---top-bar")
    .first()
    .getByRole("button", { name: users[user].name });
}
