import type { Page } from "@playwright/test";
import { expectEditorReady } from "./support/editor.js";
import { FEEDBACK_SURVEY } from "./support/results.js";
import { brand, selfHostedMode } from "./support/self-hosted.js";
import { completeSignIn } from "./support/sign-in.js";
import { surveyRows } from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// Self-hosted mode only (`pnpm e2e:self-hosted`): the other modes run the surveyjs-site shell. The
// shell's look is checked by its visual run (`pnpm e2e:visual:self-hosted`); this spec checks what it
// does.
test.skip(!selfHostedMode, "needs pnpm e2e:self-hosted");

/** The shell's own header: the instance's name, linking to My Surveys. */
const header = (page: Page) => page.locator(".sh-header");

/** "Powered by SurveyJS" with Terms and Privacy in the footer, and the name in the header. */
async function expectBranding(page: Page, { withHeader = true } = {}): Promise<void> {
  const footer = page.locator(".sh-footer");
  await expect(footer.getByRole("link", { name: "Powered by SurveyJS" })).toBeVisible();
  await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", brand.termsUrl);
  await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    brand.privacyUrl,
  );
  if (withHeader) await expect(header(page).locator(".sh-brand")).toHaveText(brand.name);
}

/** Signs in through the dev sign-in (the app's own page is for passwords). */
async function signInAs(page: Page, user: "owner" | "instanceAdmin" = "owner"): Promise<void> {
  await page.goto("/api/v1/auth/login?returnTo=%2F");
  if (user === "owner") await completeSignIn(page);
  else
    await page.locator("li", { hasText: "instance-admin@example.com" }).getByRole("link").click();
  await expect(header(page).getByRole("button", { name: "Sign Out" })).toBeVisible({
    timeout: 30_000,
  });
}

/** The hosts the browser may reach: the instance's own. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Records every request of the page to another host (a `data:` or `blob:` URL stays in the
 * browser), with the reason when it failed; the returned function lists them. On the image target
 * the browser has no way out (playwright.config.ts), so such a request also fails.
 */
function watchOutbound(page: Page): () => string[] {
  const outbound: string[] = [];
  const leaves = (url: string) => {
    const { protocol, hostname } = new URL(url);
    return protocol !== "data:" && protocol !== "blob:" && !LOCAL_HOSTS.has(hostname);
  };
  page.on("request", (request) => {
    if (leaves(request.url())) outbound.push(request.url());
  });
  page.on("requestfailed", (request) => {
    if (leaves(request.url())) {
      outbound.push(`${request.url()} (failed: ${request.failure()?.errorText ?? "unknown"})`);
    }
  });
  return () => outbound;
}

// S11: no telemetry and no CDN fonts. The image target also runs it with outbound network blocked.
test("nothing is requested from another host: sign-in, My Surveys, the editor, a run page", async ({
  page,
}) => {
  const outbound = watchOutbound(page);
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await signInAs(page);
  await expect(page.getByRole("heading", { level: 1, name: "My Surveys" })).toBeVisible();
  await expect(surveyRows(page).first()).toBeVisible();
  await page.goto(`/surveys/${FEEDBACK_SURVEY}/edit`);
  await expectEditorReady(page);
  await page.goto(`/s/${FEEDBACK_SURVEY}`);
  await expect(page.locator(".running-survey")).toBeVisible({ timeout: 30_000 });
  expect(outbound()).toEqual([]);
});

test("the sign-in page shows the instance's branding, and nothing of surveyjs.io", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expectBranding(page);
  // The shell loads no surveyjs.io styles or fonts.
  await expect(
    page.locator("[class*='v2-class---top-bar'], [class*='v2-class---footer']"),
  ).toHaveCount(0);
  const fonts = await page.evaluate(() =>
    [...document.fonts].map((font) => font.family.replaceAll('"', "")),
  );
  expect(fonts).not.toContain("Raleway");
  expect(fonts).not.toContain("Open Sans");
});

test("the header leads to My Surveys and Projects, and back home from any page", async ({
  page,
}) => {
  await signInAs(page);
  await expectBranding(page);
  // The accent colour reaches the page through the shell's custom properties.
  await expect(header(page)).toHaveCSS("border-bottom-color", "rgb(10, 125, 79)");

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await header(page).getByRole("link", { name: brand.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My Surveys" })).toBeVisible();
  await page.goto("/change-password");
  await nav.getByRole("link", { name: "My Surveys" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My Surveys" })).toBeVisible();
  // Users is an instance admin's.
  await expect(nav.getByRole("link", { name: "Users" })).toHaveCount(0);
});

test("an instance admin reaches Users from the header", async ({ page }) => {
  await signInAs(page, "instanceAdmin");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  await expectBranding(page);
});

test("the editor and the results keep the branding, without the Embed tabs", async ({ page }) => {
  await signInAs(page);
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

test("the public results page has the frame and one main landmark", async ({ page }) => {
  await page.goto(`/results/${FEEDBACK_SURVEY}`);
  await expect(page.locator(".sh-app")).toBeVisible({ timeout: 30_000 });
  await expectBranding(page);
  await expect(page.getByRole("main")).toHaveCount(1);
});

test("a running survey ends with the Powered by footer", async ({ page }) => {
  await page.goto(`/s/${FEEDBACK_SURVEY}`);
  await expect(page.locator(".running-survey")).toBeVisible({ timeout: 30_000 });
  await expectBranding(page, { withHeader: false });
  // The footer replaces the Form Library's brand block (its logo is on surveyjs.io).
  await expect(page.locator(".sv-brand-info")).toHaveCount(0);
});

test("the API docs are not served", async ({ request }) => {
  expect((await request.get("/api/docs")).status()).toBe(404);
});
