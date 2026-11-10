import type { BrowserContext, Page } from "@playwright/test";
import {
  designerQuestions,
  expectEditorReady,
  footerName,
  editorStatus,
} from "./support/editor.js";
import { FEEDBACK_SURVEY, openResultsTab } from "./support/results.js";
import { openRowMenu, pickMenuItem, surveyRow, surveyRows } from "./support/survey-list.js";
import { expect, test as base, watchConsole } from "./support/test.js";
import { chooseFile, PNG_1X1 } from "./support/uploads.js";

// The sandbox build (`pnpm e2e:sandbox`): the web app with its mock back-end in the browser, on
// localStorage (ADR 0030, D9). The user-story specs run on the sandbox too, setting up their data
// with `api(page)`, which fetches inside the page so that the worker answers. This spec covers what
// only the sandbox has, through the UI. A test's browser context starts empty, so each test starts
// from the seed.
//
// The same tests run on a build for a sub-path (`pnpm e2e:sandbox:subpath`, ADR 0031 D11): so the
// addresses here are relative to `baseURL` (`sign-in`, not `/sign-in`), which ends with the base path.

/**
 * Records every request of the context, its later tabs included, that leaves the app: another site
 * (the self-hosted shell's rule), or the app's own origin outside its base path. A listener on the
 * context sees a tab's first requests too (D9: not page.route). The returned function checks.
 */
function watchRequests(context: BrowserContext, appUrl: string): () => void {
  const outside: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(appUrl)) outside.push(url);
  });
  return () => expect(outside, `requests outside ${appUrl}`).toEqual([]);
}

/** The shared `test`, and every test checks that no request leaves the app (`watchRequests`). */
const test = base.extend<{ appUrl: string; requestGuard: void }>({
  appUrl: async ({ baseURL }, use) => {
    await use(new URL("./", baseURL ?? "").href);
  },
  requestGuard: [
    async ({ context, appUrl }, use) => {
      const check = watchRequests(context, appUrl);
      await use();
      check();
    },
    { auto: true },
  ],
});

test.skip(process.env["E2E_MODE"] !== "sandbox", "needs pnpm e2e:sandbox");

// The cookie banner is fixed to the bottom of the page and would cover the editor's bottom bar.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

const ACCOUNTS = {
  owner: "Olivia Owner",
  member: "Mia Member",
} as const;

/** The self-hosted shell's header: the app's name, its links, the user and Sign Out. */
const header = (page: Page) => page.getByRole("banner");

/** Opens the app signed out and picks an account on the sandbox's sign-in. */
async function pickAccount(page: Page, who: keyof typeof ACCOUNTS): Promise<void> {
  await page.goto("sign-in");
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(ACCOUNTS[who]) }).click();
  await expect(header(page).getByRole("button", { name: "Sign Out" })).toBeVisible({
    timeout: 30_000,
  });
}

/** Opens a survey's editor from My Surveys: a click on the row, on its name. */
async function openFromList(page: Page, name: string): Promise<void> {
  await surveyRow(page, name).getByText(name, { exact: true }).click();
  await expectEditorReady(page);
}

const RENAMED = "Customer feedback (renamed)";

/** Opens the editor of Customer feedback and renames the survey in the bottom bar. */
async function renameInEditor(page: Page): Promise<void> {
  await openFromList(page, "Customer feedback");
  await expect(page).toHaveURL(`surveys/${FEEDBACK_SURVEY}/edit`);
  await footerName(page).click();
  const input = page.getByRole("textbox", { name: "Survey name" });
  await input.fill(RENAMED);
  await input.press("Enter");
  await expect(footerName(page)).toHaveText(RENAMED);
  await expect(editorStatus(page)).toHaveText("All changes saved");
}

/** The path of a URL below the app's base path: `/api/v1/me` for `…/studio/api/v1/me`. */
function appPath(appUrl: string, url: string): string {
  return url.startsWith(appUrl) ? `/${url.slice(appUrl.length).split(/[?#]/)[0] ?? ""}` : url;
}

test("@sandbox the owner renames a seeded survey in the editor and the change survives a reload", async ({
  page,
}) => {
  await pickAccount(page, "owner");
  await expect(surveyRow(page, "Customer feedback")).toBeVisible();
  await renameInEditor(page);

  await page.reload();
  await expectEditorReady(page);
  await expect(footerName(page)).toHaveText(RENAMED);
  await page.goto("./");
  await expect(surveyRow(page, RENAMED)).toBeVisible();
});

test("@sandbox an image chosen in the editor goes through the service worker and renders", async ({
  page,
  appUrl,
}) => {
  await pickAccount(page, "owner");
  await openFromList(page, "Customer feedback");
  const before = await designerQuestions(page).count();
  // The Creator's toolbox has no role or label of its own; its class is SurveyJS's.
  await page.locator(".svc-toolbox").getByRole("button", { name: "Image", exact: true }).click();
  await expect(designerQuestions(page)).toHaveCount(before + 1);

  // The multipart upload is answered by the worker (D5); the saved URL is loaded through it too.
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /^\/api\/v1\/surveys\/[0-9a-f-]+\/assets$/.test(appPath(appUrl, response.url())),
  );
  const question = designerQuestions(page).nth(before);
  const chooser = page.waitForEvent("filechooser");
  // The visible button is a label for the hidden file input (which has the button role).
  await question.getByLabel("Choose Image", { exact: true }).click();
  await chooseFile(await chooser, "pixel.png", PNG_1X1);
  expect((await uploaded).status()).toBe(201);

  const image = question.getByRole("img").first();
  await expect(image).toHaveAttribute(
    "src",
    new RegExp(`^${appUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}api/v1/public/files/[\\w-]+$`),
  );
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(1);
  await expect(editorStatus(page)).toHaveText("All changes saved");
});

test("@sandbox the member sees Marketing and the owner's shared survey", async ({ page }) => {
  await pickAccount(page, "owner");
  await header(page).getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.getByRole("button", { name: new RegExp(ACCOUNTS.member) }).click();
  await expect(header(page).getByRole("button", { name: "Sign Out" })).toBeVisible({
    timeout: 30_000,
  });

  await header(page).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  // A project card is a disclosure (`details`): a group, opened by a click on its title.
  const marketing = page.getByRole("main").getByRole("group").filter({ hasText: "Marketing" });
  await expect(marketing).toBeVisible();
  await marketing.getByText("Marketing", { exact: true }).click();
  await expect(marketing.getByText("Olivia Owner")).toBeVisible();

  // The project's survey list: the survey Olivia owns that the project shares.
  await page.goto("./");
  await page.getByRole("main").getByRole("button", { name: "Personal Surveys" }).click();
  await page.getByRole("link", { name: "Marketing", exact: true }).click();
  await expect(surveyRow(page, "Campaign survey")).toBeVisible();
  await expect(surveyRows(page)).not.toHaveCount(0);
});

test("@sandbox a survey published in the sandbox runs in a new tab and its response reaches the results", async ({
  page,
  context,
}) => {
  await pickAccount(page, "owner");
  const row = surveyRow(page, "Customer feedback");

  // Publish it again: unpublish, then publish, in the row's menu.
  await pickMenuItem(await openRowMenu(row), "Unpublish");
  await pickMenuItem(await openRowMenu(row), "Publish");

  const opened = context.waitForEvent("page");
  await pickMenuItem(await openRowMenu(row), "Run");
  const tab = await opened;
  const checkTabConsole = watchConsole(tab);
  await expect(tab).toHaveURL(new RegExp(`/s/${FEEDBACK_SURVEY}$`));
  await tab
    .getByRole("radiogroup", { name: "How satisfied are you?" })
    .getByText("3", { exact: true })
    .click();
  await tab.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(tab.getByText("Thank you for completing the survey")).toBeVisible();
  checkTabConsole();
  await tab.close();

  // The results tab, refreshed: five seeded responses and the new one.
  await pickMenuItem(await openRowMenu(row), "View Results");
  await expect(page).toHaveURL(`surveys/${FEEDBACK_SURVEY}/results`);
  await openResultsTab(page, "Details");
  await expect(page.getByText("Total responses: 6", { exact: true })).toBeVisible();
  await page.reload();
  await openResultsTab(page, "Details");
  await expect(page.getByText("Total responses: 6", { exact: true })).toBeVisible();
});

test("@sandbox Reset demo data brings the seed back", async ({ page }) => {
  await pickAccount(page, "owner");
  await renameInEditor(page);
  await page.goto("./");
  await expect(surveyRow(page, RENAMED)).toBeVisible();

  const banner = page.getByRole("complementary", { name: "Demo notice" });
  await banner.getByRole("button", { name: "Reset demo data" }).click();
  await expect(
    page.getByText("Reset all demo data? Your changes in this browser are lost."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();

  // The session goes with the data: pick an account again.
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(ACCOUNTS.owner) }).click();
  await expect(surveyRow(page, "Customer feedback")).toBeVisible();
  await expect(surveyRow(page, RENAMED)).toHaveCount(0);
});

test("@sandbox another browser context starts from the seed and does not see the first one's data", async ({
  page,
  browser,
  baseURL,
  appUrl,
}) => {
  await pickAccount(page, "owner");
  await renameInEditor(page);
  await page.goto("./");
  await expect(surveyRow(page, RENAMED)).toBeVisible();

  const other = await browser.newContext({
    ...(baseURL !== undefined && { baseURL }),
    locale: "en-US",
    timezoneId: "UTC",
    viewport: page.viewportSize(),
  });
  try {
    const checkRequests = watchRequests(other, appUrl);
    const second = await other.newPage();
    const check = watchConsole(second);
    await second.addInitScript(() =>
      localStorage.setItem("isInformedAboutCookieAndPolicies", "true"),
    );
    await pickAccount(second, "owner");
    await expect(surveyRow(second, "Customer feedback")).toBeVisible();
    await expect(surveyRow(second, RENAMED)).toHaveCount(0);
    check();
    checkRequests();
  } finally {
    await other.close();
  }
});

test("@sandbox a returning visitor with another data version is offered a reset", async ({
  page,
}) => {
  const check = watchConsole(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  await page.evaluate(() => {
    const document = JSON.parse(localStorage.getItem("studio-sandbox:v1") ?? "null");
    localStorage.setItem("studio-sandbox:v1", JSON.stringify({ ...document, version: 0 }));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "This demo has been updated" })).toBeVisible();
  await page.getByRole("button", { name: "Reset to continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  check();
});
