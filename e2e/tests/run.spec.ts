import type { Page, Request } from "@playwright/test";
import { putDefinitionViaApi, uniqueSurveyName, withCleanup } from "./support/editor.js";
import {
  FILE_DEFINITION,
  isCreatorOrDashboardCode,
  publishViaApi,
  putThemeViaApi,
  QUESTION_DEFINITION,
  responseCount,
  routeBrandImage,
} from "./support/run.js";
import { signInAt } from "./support/sign-in.js";
import { createSurveyViaApi, openRowMenu, surveyRow } from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";
import { chooseFile, paddedPng } from "./support/uploads.js";

// The run page (US 18, 37-41, 44): publish and run, single submission, respondent files and the
// not-available page. Runs in memory mode on three browsers and in Azurite mode. The writable
// scope is the admin's Personal scope: each test creates its own survey as the admin (who also
// answers it) and removes it at the end. Fixture surveys are never written.
// The brand footer's image host (surveyjs.io) is routed locally, so runs stay offline.

test.describe.configure({ timeout: 60_000 });

const COMPLETED = "Thank you for completing the survey";

test.beforeEach(async ({ page }) => {
  // The cookie banner would cover the survey list's last menu items.
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
  await routeBrandImage(page.context());
});

/** Whether a request submits a response to the survey. */
function isSubmit(request: Request, surveyId: string): boolean {
  return (
    request.method() === "POST" &&
    new URL(request.url()).pathname === `/api/v1/public/surveys/${surveyId}/responses`
  );
}

/** Signs in as the admin and creates a survey with this definition; a new survey is published. */
async function adminSurvey(
  page: Page,
  prefix: string,
  browserName: string,
  definition: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName(prefix, browserName));
  await putDefinitionViaApi(page, survey.id, definition);
  return survey;
}

function completeButton(page: Page) {
  return page.getByRole("button", { name: "Complete", exact: true });
}

test("a new survey runs from the list in a new tab with its theme and stores the response", async ({
  page,
  context,
  browserName,
}) => {
  const survey = await adminSurvey(page, "Run", browserName, QUESTION_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await putThemeViaApi(page, survey.id, {
      cssVariables: { "--sjs-primary-backcolor": "rgba(255, 0, 0, 1)" },
    });
    await page.goto("/");
    // No Publish: a new survey is published (its legacy flag is empty).
    const popup = await openRowMenu(surveyRow(page, survey.name));
    const opened = context.waitForEvent("page");
    await popup.getByRole("link", { name: "Run", exact: true }).click();
    const tab = await opened;
    const checkTabConsole = watchConsole(tab);
    await expect(tab).toHaveURL(new RegExp(`/s/${survey.id}$`));
    await expect(tab.getByText("Your name")).toBeVisible();
    await expect(tab.getByText("Try and see how easy it is to")).toBeVisible();
    // The library's default primary colour is green: red comes from the stored theme.
    await expect(completeButton(tab)).toHaveCSS("background-color", "rgb(255, 0, 0)");

    await tab.getByRole("textbox", { name: "Your name" }).fill("Ann");
    await completeButton(tab).click();
    await expect(tab.getByText(COMPLETED)).toBeVisible();
    await expect.poll(() => responseCount(page, survey.id)).toBe(1);
    checkTabConsole();
    await tab.close();
  });
});

test("a double click on Complete sends one response", async ({ page, browserName }) => {
  const survey = await adminSurvey(page, "Double", browserName, QUESTION_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await publishViaApi(page, survey.id);
    const submits: Request[] = [];
    page.on("request", (request) => {
      if (isSubmit(request, survey.id)) submits.push(request);
    });

    await page.goto(`/s/${survey.id}`);
    await page.getByRole("textbox", { name: "Your name" }).fill("Ann");
    await completeButton(page).dblclick();
    await expect(page.getByText(COMPLETED)).toBeVisible();
    await expect.poll(() => responseCount(page, survey.id)).toBe(1);
    await page.waitForTimeout(1000);
    expect(await responseCount(page, survey.id)).toBe(1);
    expect(submits).toHaveLength(1);
  });
});

test("a file answer is uploaded to the server and the response keeps its URL", async ({
  page,
  browserName,
}) => {
  const survey = await adminSurvey(page, "File", browserName, FILE_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await publishViaApi(page, survey.id);
    await page.goto(`/s/${survey.id}`);
    const bytes = paddedPng(300_000);

    const uploaded = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/v1/public/surveys/${survey.id}/files`,
    );
    // The library reads its file input only after its own "Select File" button opened it, so the
    // file goes through the native file chooser (which sets that input's files).
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".sd-file__choose-btn").first().click();
    await chooseFile(await chooser, "doc.png", bytes);
    expect((await uploaded).status()).toBe(201);

    const submitted = page.waitForRequest((request) => isSubmit(request, survey.id));
    await completeButton(page).click();
    const body = (await submitted).postDataJSON() as {
      data: { doc: { name: string; type: string; content: string }[] };
    };
    await expect(page.getByText(COMPLETED)).toBeVisible();

    const content = body.data.doc[0]?.content ?? "";
    expect(body.data.doc).toEqual([{ name: "doc.png", type: "image/png", content }]);
    expect(content).toMatch(/^http:\/\/localhost:5173\/api\/v1\/public\/files\/[0-9a-f]{64}$/);
    const served = await page.request.get(content);
    expect(served.status()).toBe(200);
    expect(Buffer.compare(await served.body(), bytes)).toBe(0);
  });
});

test.describe("not available", () => {
  // The page reads the unpublished survey, which answers 404.
  test.use({
    expectedErrorResponses: [{ path: /^\/api\/v1\/public\/surveys\/[0-9a-f-]+$/, status: 404 }],
  });

  test("an unpublished survey shows the not-available page", async ({ page, browserName }) => {
    const survey = await adminSurvey(page, "Unpublished", browserName, QUESTION_DEFINITION);
    await withCleanup(page, [survey.id], async () => {
      await publishViaApi(page, survey.id, false);
      await page.goto(`/s/${survey.id}`);
      await expect(page.getByText("This survey is not currently available.")).toBeVisible();
    });
  });
});

test("a signed-out respondent loads the Form Library and no Creator or Dashboard code", async ({
  page,
  browser,
  browserName,
}) => {
  const survey = await adminSurvey(page, "Bundle", browserName, QUESTION_DEFINITION);
  await withCleanup(page, [survey.id], async () => {
    await publishViaApi(page, survey.id);
    const respondentContext = await browser.newContext();
    try {
      await routeBrandImage(respondentContext);
      const respondent = await respondentContext.newPage();
      const checkRespondentConsole = watchConsole(respondent);
      const requested: string[] = [];
      respondent.on("request", (request) => requested.push(request.url()));

      await respondent.goto(`/s/${survey.id}`);
      await expect(respondent.getByRole("textbox", { name: "Your name" })).toBeVisible();
      expect(requested.filter(isCreatorOrDashboardCode)).toEqual([]);
      expect(requested.some((url) => /\/assets\/survey-form-[^/]+\.js$/.test(url))).toBe(true);
      checkRespondentConsole();
    } finally {
      await respondentContext.close();
    }
  });
});
