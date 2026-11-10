import type { Browser, Page } from "@playwright/test";
import { sandboxMode } from "./sandbox.js";
import { expect } from "./test.js";

/** The legacy-fixture users the servers are seeded with (their names come from either provider). */
export const users = {
  owner: {
    id: "11111111-0000-4000-8000-a00000000001",
    email: "owner@example.com",
    name: "Olivia Owner",
  },
  admin: {
    id: "11111111-0000-4000-8000-a00000000002",
    email: "admin@example.com",
    name: "Adam Admin",
  },
  member: {
    id: "11111111-0000-4000-8000-a00000000003",
    email: "member@example.com",
    name: "Mia Member",
  },
  outsider: {
    id: "11111111-0000-4000-8000-a00000000004",
    email: "outsider@example.com",
    name: "Oscar Outsider",
  },
  erasable: {
    id: "11111111-0000-4000-8000-a00000000006",
    email: "erasable@example.com",
    name: "Erin Erasable",
  },
} as const;

export type UserKey = keyof typeof users;

/** `azurite`: the server runs on the legacy replica and signs in through the mock OIDC server. */
export const azuriteMode = process.env["E2E_MODE"] === "azurite";

/** Locators of whichever sign-in page the mode shows. */
function signInPage(page: Page) {
  if (sandboxMode) return page.getByRole("heading", { name: "Pick an account" });
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
  if (sandboxMode) {
    // The sandbox's Pick an account: one button per seed user, which shows the email.
    await page.getByRole("button", { name: users[user].email }).click();
  } else if (azuriteMode) {
    await page.locator('input[name="username"]').fill(users[user].id);
    await page.locator('input[name="username"]').press("Enter");
  } else {
    await page.locator("li", { hasText: users[user].email }).getByRole("link").click();
  }
}

/** Opens `path` signed out, signs in as `user` and waits for the signed-in header. */
export async function signInAt(page: Page, path = "/", user: UserKey = "owner"): Promise<void> {
  await page.goto(path);
  if (sandboxMode) await sandboxSignIn(page, path, user);
  else await completeSignIn(page, user);
  // A browser the run has just launched (several start side by side, next to the Survey Creator
  // in other workers) can take longer than the default 10 s to show its first signed-in page.
  await expect(accountTrigger(page, user)).toBeVisible({ timeout: 30_000 });
}

/**
 * The sandbox's tabs share one session cookie (`secondBrowser` opens a tab): a page may already
 * be signed in, as `user` (nothing to do) or as someone else (sign out first).
 */
async function sandboxSignIn(page: Page, path: string, user: UserKey): Promise<void> {
  const picker = signInPage(page);
  const account = page.locator(".sh-header .sh-account__name");
  await expect(picker.or(account)).toBeVisible({ timeout: 30_000 });
  if (await account.isVisible()) {
    if ((await account.innerText()) === users[user].name) return;
    await page.locator(".sh-header").getByRole("button", { name: "Sign Out" }).click();
    await expectSignInPage(page);
    await page.goto(path);
  }
  await completeSignIn(page, user);
}

/**
 * A page for a second person, or the same person in a second browser; `close` closes it. On a
 * server it is a new browser context. The sandbox keeps its data in one browser (ADR 0030), so
 * there it is a new tab of the page's context, which shares the session: `signInAt` on it signs
 * the first page in as that user too.
 */
export async function secondBrowser(
  page: Page,
  browser: Browser,
): Promise<{ page: Page; close: () => Promise<void> }> {
  if (sandboxMode) {
    const tab = await page.context().newPage();
    return { page: tab, close: () => tab.close() };
  }
  const context = await browser.newContext();
  return { page: await context.newPage(), close: () => context.close() };
}

/**
 * The header's account item, which shows the user's display name. The sandbox runs the
 * self-hosted shell, whose header shows the name as text next to Sign Out.
 */
export function accountTrigger(page: Page, user: UserKey = "owner") {
  if (sandboxMode) {
    return page.locator(".sh-header .sh-account__name").filter({ hasText: users[user].name });
  }
  return page
    .locator("header.v2-class---top-bar")
    .first()
    .getByRole("button", { name: users[user].name });
}
