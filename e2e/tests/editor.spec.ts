import type { Page, Request } from "@playwright/test";
import {
  addQuestion,
  creator,
  designerQuestions,
  editorStatus,
  expectEditorReady,
  expectSaved,
  footerName,
  getDocumentViaApi,
  isDocumentSave,
  openEditor,
  openTab,
  putDefinitionViaApi,
  questionNames,
  uniqueSurveyName,
  withCleanup,
} from "./support/editor.js";
import { signInAt } from "./support/sign-in.js";
import {
  answerNextConfirm,
  createSurveyViaApi,
  getSurveyViaApi,
  surveyRow,
} from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";

// The editor page (US 16, 27-30, 33-36). Runs in memory mode on three browsers and in Azurite mode
// on the replica. Writes only to the admin's Personal scope (the other browsers and the conformance
// suite write there too): every test that writes creates its own survey with a unique name as the
// admin and removes it at the end. Fixture surveys are only read (the read-only test sends no
// write). Assertions are about the test's own survey, never about how many surveys a scope holds.

// The Creator is a large chunk; each test signs in and opens it, some twice or in two contexts.
// Six Creators starting at once in one browser starved the machine (Firefox then needed more than
// 30 s to mount one), so this file's tests run one after another in one worker; other spec files
// still run beside them. A failed test does not stop the next one.
test.describe.configure({ mode: "default", timeout: 90_000 });

/** Engineering retro (Engineering, created by Adam): Olivia, a `user` there, cannot modify it. */
const ENGINEERING_RETRO = "22222222-0000-4000-8000-a00000000006";

// The cookie banner is fixed to the bottom of the page and covers the editor's bottom bar; it has
// already been answered.
const answerCookieBanner = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));

test.beforeEach(async ({ page }) => {
  await answerCookieBanner(page);
});

test("a row click opens the editor; an added question is saved and survives a reload", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueSurveyName("Editor", browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [survey.id], async () => {
    await page.reload();
    const row = surveyRow(page, name);
    // Not the name, the pencil or the menu: an empty part of the row.
    await row.locator('[title="Created on"]').click();
    await expect(page).toHaveURL(`/surveys/${survey.id}/edit`);
    await expectEditorReady(page);
    await expect(footerName(page)).toHaveText(name);
    await expect(editorStatus(page)).toHaveText("All changes saved");
    await expect(designerQuestions(page)).toHaveCount(0);

    await expectSaved(page, survey.id, "definition", () => addQuestion(page));
    expect(questionNames((await getDocumentViaApi(page, survey.id, "definition")).content)).toEqual(
      ["question1"],
    );

    await page.reload();
    await expectEditorReady(page);
    await expect(designerQuestions(page)).toHaveCount(1);
    await expect(designerQuestions(page).getByText("question1").first()).toBeVisible();
  });
});

test("an edit reads as saving until it is saved, and leaving the editor at once still saves it", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueSurveyName("Pending", browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [survey.id], async () => {
    await page.reload();
    await surveyRow(page, name).locator('[title="Created on"]').click();
    await expectEditorReady(page);
    await expect(editorStatus(page)).toHaveText("All changes saved");

    // The Creator sends a change 500 ms after it; until then it is not saved either. The status is
    // read in the page right after the click, before that delay can end, whatever the machine load.
    const firstSave = page.waitForResponse(
      (response) => isDocumentSave(response, survey.id, "definition") && response.status() === 204,
    );
    const statusRightAfterEdit = await page
      .locator(".svc-add-new-question-action")
      .getByText("Add Question")
      .first()
      .evaluate(async (button) => {
        // Runs in the page; this project has no DOM types.
        type Node = { textContent: string | null; click(): void };
        const { document } = globalThis as unknown as {
          document: { querySelector(selector: string): Node | null };
        };
        (button as unknown as Node).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return document.querySelector("#edit-survey-change-name-container [role=status]")
          ?.textContent;
      });
    expect(statusRightAfterEdit).toBe("Saving…");
    await expect(designerQuestions(page)).toHaveCount(1);
    await firstSave;
    await expect(editorStatus(page)).toHaveText("All changes saved");

    // Back to the list (in the app) right after the next edit: the change is sent all the same.
    const secondSave = page.waitForResponse(
      (response) => isDocumentSave(response, survey.id, "definition") && response.status() === 204,
    );
    await addQuestion(page);
    await page.goBack();
    await expect(surveyRow(page, name)).toBeVisible();
    await secondSave;
    expect(questionNames((await getDocumentViaApi(page, survey.id, "definition")).content)).toEqual(
      ["question1", "question2"],
    );
  });
});

test("a predefined theme picked on the Themes tab is saved and kept after a reload", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName("Editor", browserName));
  await withCleanup(page, [survey.id], async () => {
    await putDefinitionViaApi(page, survey.id, {
      pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }],
    });
    await openEditor(page, survey.id);
    await openTab(page, "Themes");
    const themeName = page.locator('.spg-question[data-name="themeName"]');
    await expect(themeName.getByText("Default", { exact: true })).toBeVisible();

    await expectSaved(page, survey.id, "theme", async () => {
      await themeName.locator(".sd-dropdown").click();
      await page.getByRole("option", { name: "Contrast", exact: true }).click();
    });
    const stored = (await getDocumentViaApi(page, survey.id, "theme")).content;
    expect(stored["themeName"]).toBe("contrast");

    await page.reload();
    await expectEditorReady(page);
    await openTab(page, "Themes");
    await expect(themeName.getByText("Contrast", { exact: true })).toBeVisible();
    await expect(editorStatus(page)).toHaveText("All changes saved");
  });
});

test.describe("two editors on one survey", () => {
  // The second editor's save is refused with 412, which browsers may log as a failed resource.
  test.use({
    expectedErrorResponses: [{ path: /^\/api\/v1\/surveys\/[0-9a-f-]+\/definition$/, status: 412 }],
  });

  test("the later save shows the conflict notice; Reload latest shows the other change", async ({
    page,
    browser,
    browserName,
  }) => {
    // First editor: its own context, signed in as the admin too.
    const firstContext = await browser.newContext();
    const first = await firstContext.newPage();
    const checkFirstConsole = watchConsole(first);
    await answerCookieBanner(first);
    await signInAt(first, "/", "admin");
    await signInAt(page, "/", "admin");
    const survey = await createSurveyViaApi(page, uniqueSurveyName("Conflict", browserName));
    try {
      await withCleanup(page, [survey.id], async () => {
        await openEditor(first, survey.id);
        await openEditor(page, survey.id);

        // Two questions in the first editor, so its version is told apart from the second's.
        await expectSaved(first, survey.id, "definition", () => addQuestion(first));
        await expectSaved(first, survey.id, "definition", () => addQuestion(first));

        const refused = page.waitForResponse((response) =>
          isDocumentSave(response, survey.id, "definition"),
        );
        await addQuestion(page);
        expect((await refused).status()).toBe(412);
        const notice = page.getByRole("alert").filter({
          hasText: "The survey was changed by someone else. Your latest changes are not saved.",
        });
        await expect(notice).toBeVisible();
        await expect(editorStatus(page)).toHaveText("Changes are not saved");

        await notice.getByRole("button", { name: "Reload latest" }).click();
        await expect(notice).toBeHidden();
        await expect(designerQuestions(page)).toHaveCount(2);
        await expect(editorStatus(page)).toHaveText("All changes saved");

        await expectSaved(page, survey.id, "definition", () => addQuestion(page));
        const stored = (await getDocumentViaApi(page, survey.id, "definition")).content;
        expect(questionNames(stored)).toHaveLength(3);
      });
      checkFirstConsole();
    } finally {
      await firstContext.close();
    }
  });
});

test("Clear Survey asks first, then the empty survey is saved and stays empty", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName("Editor", browserName));
  await withCleanup(page, [survey.id], async () => {
    await putDefinitionViaApi(page, survey.id, {
      pages: [
        {
          name: "page1",
          elements: [
            { type: "text", name: "q1" },
            { type: "comment", name: "q2" },
          ],
        },
      ],
    });
    await openEditor(page, survey.id);
    await expect(designerQuestions(page)).toHaveCount(2);

    const clear = page.getByRole("button", { name: "Clear Survey" });
    // Declined: nothing changes.
    let confirm = answerNextConfirm(page, false);
    await clear.click();
    expect(await confirm).toBe(
      "You are going to delete all elements in this survey. Do you want to proceed?",
    );
    await expect(designerQuestions(page)).toHaveCount(2);

    await expectSaved(page, survey.id, "definition", async () => {
      confirm = answerNextConfirm(page, true);
      await clear.click();
      await confirm;
    });
    await expect(designerQuestions(page)).toHaveCount(0);
    expect(questionNames((await getDocumentViaApi(page, survey.id, "definition")).content)).toEqual(
      [],
    );

    await page.reload();
    await expectEditorReady(page);
    await expect(designerQuestions(page)).toHaveCount(0);
  });
});

test("the bottom bar renames the survey: Enter saves, and the name survives a reload", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const name = uniqueSurveyName("Editor", browserName);
  const renamed = `${name} renamed`;
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [survey.id], async () => {
    await openEditor(page, survey.id);
    await expect(footerName(page)).toHaveText(name);

    await footerName(page).click();
    const input = page
      .locator("#edit-survey-change-name-container")
      .getByRole("textbox", { name: "Survey name" });
    await expect(input).toHaveValue(name);
    const patched = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === `/api/v1/surveys/${survey.id}`,
    );
    await input.fill(renamed);
    await input.press("Enter");
    await expect(input).toBeHidden();
    await expect(footerName(page)).toHaveText(renamed);
    expect((await patched).status()).toBe(200);

    await page.reload();
    await expectEditorReady(page);
    await expect(footerName(page)).toHaveText(renamed);
    expect((await getSurveyViaApi(page, survey.id))?.name).toBe(renamed);
    await page.goto("/");
    await expect(surveyRow(page, renamed)).toBeVisible();
  });
});

test("the Embed Survey tab can load the survey from this service", async ({
  page,
  browserName,
  baseURL,
}) => {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName("Editor", browserName));
  await withCleanup(page, [survey.id], async () => {
    await openEditor(page, survey.id);
    await openTab(page, "Embed Survey");
    const code = page.locator(".svc-embed-tab__source-code");
    const serviceUrl = `${baseURL}/api/v1/public/surveys/${survey.id}`;
    await expect(code.first()).toBeVisible();
    await expect(code.filter({ hasText: serviceUrl })).toHaveCount(0);

    // The survey's own checkbox hides its input: a user clicks the text.
    await page.getByText("Load Survey JSON from service", { exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Load Survey JSON from service" }),
    ).toBeChecked();
    await expect(code.filter({ hasText: serviceUrl }).first()).toBeVisible();
  });
});

test("without modify rights the editor is read-only and sends no save", async ({ page }) => {
  await signInAt(page, "/", "owner");
  const writes: Request[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      new URL(request.url()).pathname.startsWith("/api/v1/surveys")
    ) {
      writes.push(request);
    }
  });
  await openEditor(page, ENGINEERING_RETRO);
  await expect(editorStatus(page)).toHaveText("Read-only");
  await expect(footerName(page)).toHaveText("Engineering retro");
  await expect(designerQuestions(page)).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Clear Survey" })).toHaveCount(0);
  await expect(page.getByText("Add Question", { exact: true })).toHaveCount(0);

  // The designer refuses edits: no text can be edited in place, no question added or removed, and
  // the property grid is locked.
  await expect(creator(page).locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Single-Line Input", exact: true }).click();
  await expect(designerQuestions(page)).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Survey title" })).not.toBeEditable();
  // Nor can the name be renamed from the bottom bar.
  await footerName(page).click();
  await expect(page.getByRole("textbox", { name: "Survey name" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Rename survey" })).toHaveCount(0);

  // Longer than the Creator's auto-save delay (500 ms): a save would have been sent by now.
  await page.waitForTimeout(1500);
  expect(writes.map((request) => `${request.method()} ${request.url()}`)).toEqual([]);
});

test("the survey list loads no Creator code; the editor does", async ({ page, browserName }) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  const creatorCode = (url: string) =>
    /\/assets\/(survey-creator|SurveyEditor|worker-json)-[^/]*$/.test(new URL(url).pathname) ||
    /ace-builds|[/.-]ace[.-]/.test(url);

  // The pointer stays off the rows: hovering a row's link preloads the editor route.
  await signInAt(page, "/", "admin");
  const name = uniqueSurveyName("Bundle", browserName);
  const survey = await createSurveyViaApi(page, name);
  await withCleanup(page, [survey.id], async () => {
    await page.reload();
    await expect(surveyRow(page, name)).toBeVisible();
    expect(requested.filter(creatorCode)).toEqual([]);

    await openEditor(page, survey.id);
    await expect(creator(page)).toBeVisible();
    expect(requested.some((url) => /\/assets\/survey-creator-[^/]+\.js$/.test(url))).toBe(true);
  });
});
