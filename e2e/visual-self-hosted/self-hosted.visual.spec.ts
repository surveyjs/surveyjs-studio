import { expect, test, type Page } from "@playwright/test";

/**
 * The self-hosted shell's look, page by page, against this repository's baselines
 * (visual-self-hosted/baselines/<platform>/). The data is the memory seed, fresh on every run; the
 * pages are read only, so the screens do not depend on each other.
 */

const FEEDBACK_SURVEY = "22222222-0000-4000-8000-a00000000001";
const OWNER = "owner@example.com";
const INSTANCE_ADMIN = "instance-admin@example.com";

/** Signs in through the dev sign-in (the app's own page is for passwords). */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/api/v1/auth/login?returnTo=%2F");
  await page.locator("li", { hasText: email }).getByRole("link").click();
  await expect(page.locator(".sh-header")).toBeVisible({ timeout: 30_000 });
}

/** Waits until the page and its lazy chunks settle, then compares the window. */
async function expectScreen(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".sh-footer").first()).toBeVisible();
  await expect(page).toHaveScreenshot(`${name}.png`);
}

test("sign-in", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expectScreen(page, "sign-in");
});

test("set-password", async ({ page }) => {
  await page.goto("/set-password?token=visual-test-token");
  await expect(page.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
  await expectScreen(page, "set-password");
});

test("my-surveys and its menu", async ({ page }) => {
  await signIn(page, OWNER);
  await expect(page.getByRole("heading", { level: 1, name: "My Surveys" })).toBeVisible();
  await expectScreen(page, "my-surveys");
  const actions = page.getByRole("button", { name: "Survey actions" }).first();
  await actions.click();
  const menuId = await actions.getAttribute("aria-controls");
  await expect(page.locator(`[id="${menuId}"]`)).toBeVisible();
  await expectScreen(page, "my-surveys-menu");
});

test("projects", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/projects");
  await page.locator("summary").first().click();
  await expect(page.locator(".v2-class---account-page__project-users-list").first()).toBeVisible();
  await expectScreen(page, "projects");
});

test("results details and history", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto(`/surveys/${FEEDBACK_SURVEY}/results?tab=details`);
  await expect(page.getByRole("link", { name: "Details" })).toBeVisible();
  await expectScreen(page, "results-details");
  await page.goto(`/surveys/${FEEDBACK_SURVEY}/history`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectScreen(page, "history");
});

test("change-password", async ({ page }) => {
  await signIn(page, OWNER);
  await page.goto("/change-password");
  await expect(page.getByRole("heading", { level: 1, name: "Change your password" })).toBeVisible();
  await expectScreen(page, "change-password");
});

test("users", async ({ page }) => {
  await signIn(page, INSTANCE_ADMIN);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expect(page.getByRole("row")).not.toHaveCount(0);
  await expectScreen(page, "users");
});
