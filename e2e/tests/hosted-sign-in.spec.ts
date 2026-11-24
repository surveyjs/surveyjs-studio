import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import { accountTrigger } from "./support/password.js";
import { expect, test } from "./support/test.js";

// Hosted OAuth mode only (`pnpm e2e:hosted-oauth`): the hosted edition (local accounts, the surveyjs
// method, open sign-up, ACCOUNT_NOTICES=sign-in-licence) against the OAuth stub's surveyjs.io, which
// playwright.config.ts starts. Each sign-in is a new person or a new browser context.
test.skip(process.env["E2E_MODE"] !== "hosted-oauth", "needs pnpm e2e:hosted-oauth");

interface Person {
  sub: string;
  email: string;
  name: string;
  blocked?: boolean;
  licenseExpiresAt?: string;
}

const unique = (label: string) => `${label}-${Date.now().toString(36)}-${test.info().workerIndex}`;

// surveyjs.io ids are GUIDs; the server refuses any other subject.
function person(label: string, extra: Partial<Person> = {}): Person {
  const id = unique(label);
  return { sub: randomUUID(), email: `${id}@example.com`, name: `Person ${id}`, ...extra };
}

/** A page in a browser context of its own: a fresh browser, signed out. */
async function openBrowser(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
  return page;
}

/** Opens the app: the surveyjs-only sign-in goes straight to the stub's form, which this fills in. */
async function signInAtStub(page: Page, who: Person): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Sign in to the surveyjs.io stub" }),
  ).toBeVisible();
  await page.getByLabel("email", { exact: true }).fill(who.email);
  await page.getByLabel("name", { exact: true }).fill(who.name);
  await page.getByLabel("sub", { exact: true }).fill(who.sub);
  if (who.blocked) await page.getByLabel("blocked", { exact: true }).check();
  if (who.licenseExpiresAt !== undefined) {
    await page.getByLabel("license_expires_at", { exact: true }).fill(who.licenseExpiresAt);
  }
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const expiredNotice = "Your renewal subscription has expired.";

test("a new person signs in with surveyjs.io and gets an account", async ({ browser }) => {
  const page = await openBrowser(browser);
  const who = person("new");
  await signInAtStub(page, who);
  await expect(accountTrigger(page, who.name)).toBeVisible({ timeout: 30_000 });
  // The survey list, on the new account's Personal scope.
  await expect(page).toHaveURL(/\/\?project=personal$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.context().close();
});

test("an expired licence shows the notice, and a later date at the next sign-in removes it", async ({
  browser,
}) => {
  const who = person("licence", { licenseExpiresAt: "2020-01-01T00:00:00.000Z" });
  const first = await openBrowser(browser);
  await signInAtStub(first, who);
  await expect(first.getByRole("dialog")).toContainText(expiredNotice, { timeout: 30_000 });
  await first.context().close();

  const second = await openBrowser(browser);
  await signInAtStub(second, { ...who, licenseExpiresAt: "2999-01-01T00:00:00.000Z" });
  await expect(accountTrigger(second, who.name)).toBeVisible({ timeout: 30_000 });
  await expect(second.getByRole("dialog")).toBeHidden();
  await second.context().close();
});

test("a blocked person is sent to the refused page", async ({ browser }) => {
  const page = await openBrowser(browser);
  await signInAtStub(page, person("blocked", { blocked: true }));
  await expect(page).toHaveURL(/\/sign-in\/refused\?/);
  await expect(
    page.getByText(
      "This surveyjs.io account is blocked. Contact SurveyJS support if you think this is a mistake.",
    ),
  ).toBeVisible();
  await page.context().close();
});

test("an email another surveyjs.io id holds is refused", async ({ browser }) => {
  const holder = person("holder");
  const first = await openBrowser(browser);
  await signInAtStub(first, holder);
  await expect(accountTrigger(first, holder.name)).toBeVisible({ timeout: 30_000 });
  await first.context().close();

  const recreated = await openBrowser(browser);
  await signInAtStub(recreated, { ...holder, sub: randomUUID() });
  await expect(recreated).toHaveURL(/\/sign-in\/refused\?/);
  await expect(
    recreated.getByText(
      "This email is already used by another surveyjs.io account in SurveyJS Studio. If you recreated your surveyjs.io account, you can sign in once the old one has been removed.",
    ),
  ).toBeVisible();
  await recreated.context().close();
});
