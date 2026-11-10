import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { creator, openEditor } from "./support/editor.js";
import { routeBrandImage } from "./support/run.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { signInAt } from "./support/sign-in.js";
import { surveyRow } from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

// The "XSS in question name" survey (R24): markup in its name, a question's name and title, an
// HTML question and the completed HTML, with `{q1}` prefilled with markup from the URL. The list,
// the editor and the run page show the names as text, and no script runs: the page's Content
// Security Policy blocks the inline event handlers (so its console violations are expected here),
// and any dialog fails the test.
//
// The survey is a read-only fixture of Mia (both seeds, memory and Azurite). The run page's
// submission is answered here (`201` with a random id), so nothing is stored; any PUT of the
// survey's definition or theme is aborted and fails the test. Runs in memory mode on three
// browsers and in Azurite mode. The cookie banner is pre-dismissed and the brand footer's image
// host is routed locally, as in run.spec.ts.

test.skip(sandboxMode, notOnSandbox.seed("survey a09, the XSS fixture"));

const XSS_SURVEY_ID = "22222222-0000-4000-8000-a00000000009";
const NAME = "XSS in question name <img src=x onerror=alert(1)>";
const QUESTION_TITLE = "<script>alert(3)</script>";

/** Records and dismisses every dialog; nothing in this survey may open one. */
function recordDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return dialogs;
}

/** Aborts and records any PUT of the fixture survey's definition or theme. */
async function refuseDocumentWrites(page: Page): Promise<string[]> {
  const writes: string[] = [];
  const documents = new RegExp(`^/api/v1/surveys/${XSS_SURVEY_ID}/(definition|theme)$`);
  await page.route(
    (url) => documents.test(url.pathname),
    async (route) => {
      if (route.request().method() === "PUT") {
        writes.push(new URL(route.request().url()).pathname);
        await route.abort();
      } else {
        await route.fallback();
      }
    },
  );
  return writes;
}

/** Every test here: the dialog record and the refused writes must both end empty. */
const xssTest = test.extend<{ readOnlyAndSilent: void }>({
  readOnlyAndSilent: [
    async ({ page }, use) => {
      await page.addInitScript(() =>
        localStorage.setItem("isInformedAboutCookieAndPolicies", "true"),
      );
      await routeBrandImage(page.context());
      const dialogs = recordDialogs(page);
      const writes = await refuseDocumentWrites(page);
      await use();
      expect(dialogs, "dialogs").toEqual([]);
      expect(writes, "definition or theme writes").toEqual([]);
    },
    { auto: true },
  ],
});

xssTest.describe.configure({ timeout: 90_000 });
xssTest.use({ allowCspViolations: true });

xssTest.describe("the list and the editor", () => {
  // The editor renders the name's `<img src=x>` (its onerror is blocked by the CSP), so the browser
  // loads `x` next to the editor's path. The server that serves the web app (the image) answers
  // it with 404, which Chromium and WebKit log; `vite preview` answers 200.
  xssTest.use({ expectedErrorResponses: [{ path: `/surveys/${XSS_SURVEY_ID}/x`, status: 404 }] });

  xssTest("the list and the editor show the names as text", async ({ page }) => {
    await signInAt(page, "/", "member");
    const row = surveyRow(page, NAME);
    await expect(row).toBeVisible();
    await expect(row.locator('img[src="x"]')).toHaveCount(0);

    await openEditor(page, XSS_SURVEY_ID);
    await expect(creator(page).getByText(QUESTION_TITLE, { exact: true })).toBeVisible();
  });
});

xssTest("the run page shows the names as text, completes, and stores nothing", async ({ page }) => {
  let submissions = 0;
  await page.route(`**/api/v1/public/surveys/${XSS_SURVEY_ID}/responses`, (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submissions += 1;
    return route.fulfill({ status: 201, json: { id: randomUUID() } });
  });

  await page.goto(`/s/${XSS_SURVEY_ID}?q1=${encodeURIComponent("<img src=x onerror=alert(6)>")}`);
  // The Form Library's header shows the survey title as text, not as a heading element.
  const title = page.getByText(NAME, { exact: true });
  await expect(title).toBeVisible();
  await expect(title.locator("img")).toHaveCount(0);
  await expect(page).toHaveTitle(NAME);
  await expect(page.getByText(QUESTION_TITLE, { exact: true })).toBeVisible();
  await expect(page.getByText("Hello,")).toBeVisible();

  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByText("Thank you,")).toBeVisible();
  await expect.poll(() => submissions).toBe(1);
});
