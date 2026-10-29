import type { Page } from "@playwright/test";
import { expectEditorReady } from "./support/editor.js";
import { brand, poweredByMode } from "./support/powered-by.js";
import { FEEDBACK_SURVEY } from "./support/results.js";
import { completeSignIn } from "./support/sign-in.js";
import { expect, test } from "./support/test.js";

// Powered-by mode only (`pnpm e2e:powered-by`): the other modes run the surveyjs-site shell.
test.skip(!poweredByMode, "needs pnpm e2e:powered-by");

/** The instance's name in the shell's header, and "Powered by SurveyJS" with Terms and Privacy below. */
async function expectBranding(page: Page, { header = true } = {}): Promise<void> {
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "Powered by SurveyJS" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", brand.termsUrl);
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    brand.privacyUrl,
  );
  if (header) await expect(page.getByRole("banner").first()).toContainText(brand.name);
}

/** Signs in as Olivia through the dev sign-in (the app's page is for passwords). */
async function signInAsOwner(page: Page): Promise<void> {
  await page.goto("/api/v1/auth/login?returnTo=%2F");
  await completeSignIn(page);
  await expect(page.getByRole("button", { name: "Sign Out" })).toBeVisible({ timeout: 30_000 });
}

test("the sign-in page shows the instance's branding", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expectBranding(page);
});

test("My Surveys, the editor and the results show the branding, without the Embed tabs", async ({
  page,
}) => {
  await signInAsOwner(page);
  await expectBranding(page);
  // The accent colour reaches the page as a custom property.
  await expect(page.getByRole("banner").first()).toHaveCSS(
    "border-bottom-color",
    "rgb(10, 125, 79)",
  );

  await page.goto(`/surveys/${FEEDBACK_SURVEY}/edit`);
  await expectEditorReady(page);
  await expectBranding(page);
  // Every tab of the Creator, also those under "More": no Embed tab (D21).
  await expect(page.locator(".svc-tabbed-menu")).toHaveCSS("opacity", "1");
  const more = page.locator(".svc-tabbed-menu-dots").getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
    await expect(page.locator(".svc-tabbed-menu-item__popup")).toBeVisible();
  }
  await expect(page.getByText("Embed Survey", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Embed Creator", { exact: true })).toHaveCount(0);

  await page.goto(`/surveys/${FEEDBACK_SURVEY}/results`);
  await expect(page.getByRole("link", { name: "Summary" })).toBeVisible({ timeout: 30_000 });
  await expectBranding(page);
});

test("a running survey ends with the Powered by footer", async ({ page }) => {
  await page.goto(`/s/${FEEDBACK_SURVEY}`);
  await expect(page.locator(".running-survey")).toBeVisible({ timeout: 30_000 });
  await expectBranding(page, { header: false });
});

test("the API docs are not served", async ({ request }) => {
  expect((await request.get("/api/docs")).status()).toBe(404);
});
