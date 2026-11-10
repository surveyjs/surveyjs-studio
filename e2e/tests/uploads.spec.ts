import type { Page, Request } from "@playwright/test";
import { api } from "./support/api.js";
import {
  creator,
  designerQuestions,
  editorStatus,
  expectSaved,
  getDocumentViaApi,
  openEditor,
  openTab,
  putDefinitionViaApi,
  uniqueSurveyName,
  withCleanup,
} from "./support/editor.js";
import { signInAt } from "./support/sign-in.js";
import { createSurveyViaApi, csrfHeaders } from "./support/survey-list.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test } from "./support/test.js";
import {
  chooseFile,
  creatorNotification,
  paddedPng,
  PNG_1X1,
  uploadViaApi,
} from "./support/uploads.js";

// Editor uploads and file serving (US 31, 32; files are removed with their survey). Runs in memory
// mode on three browsers and in Azurite mode. The writable scope is the admin's Personal scope:
// each test creates its own survey as the admin and removes it at the end. Fixture surveys are
// never written. The server's per-survey quota is 1 MB here (playwright.config.ts).

const FILE_URL = /\/api\/v1\/public\/files\/[0-9a-f]{64}$/;
const isAssetUpload = (request: Request) =>
  request.method() === "POST" &&
  /^\/api\/v1\/surveys\/[0-9a-f-]+\/assets$/.test(new URL(request.url()).pathname);

test.describe.configure({ timeout: 90_000 });

test.beforeEach(async ({ page }) => {
  // The cookie banner would cover the editor's bottom bar.
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

/** Chooses a file for the selected image question through the native file chooser. */
async function chooseImage(page: Page, bytes: Buffer, name: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await creator(page).locator(".sd-file__choose-btn").first().click();
  await chooseFile(await chooser, name, bytes);
}

test("an image chosen in the editor is uploaded, shown, saved, served, and removed with the survey", async ({
  page,
  browserName,
}) => {
  await signInAt(page, "/", "admin");
  const survey = await createSurveyViaApi(page, uniqueSurveyName("Upload", browserName));
  await withCleanup(page, [survey.id], async () => {
    await openEditor(page, survey.id);
    await expect(designerQuestions(page)).toHaveCount(0);
    await expectSaved(page, survey.id, "definition", async () => {
      await page
        .locator(".svc-toolbox")
        .getByRole("button", { name: "Image", exact: true })
        .click();
      await expect(designerQuestions(page)).toHaveCount(1);
    });

    await expectSaved(page, survey.id, "definition", () => chooseImage(page, PNG_1X1, "pixel.png"));
    const image = designerQuestions(page).locator("img").first();
    await expect(image).toHaveAttribute("src", FILE_URL);
    const url = (await image.getAttribute("src")) ?? "";

    await openTab(page, "Preview");
    await expect(creator(page).locator(`img[src="${url}"]`).first()).toBeVisible();

    const definition = (await getDocumentViaApi(page, survey.id, "definition")).content;
    const pages = definition["pages"] as { elements: { imageLink?: string }[] }[];
    expect(pages[0]?.elements[0]?.imageLink).toBe(url);

    const served = await api(page).get(url);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("image/png");
    expect(Buffer.compare(await served.body(), PNG_1X1)).toBe(0);

    const headers = await csrfHeaders(page);
    const archived = await api(page).patch(`/api/v1/surveys/${survey.id}`, {
      headers: { ...headers, "Content-Type": "application/merge-patch+json" },
      data: { archived: true },
    });
    expect(archived.status()).toBe(200);
    expect((await api(page).delete(`/api/v1/surveys/${survey.id}`, { headers })).status()).toBe(
      204,
    );
    expect((await api(page).get(url)).status()).toBe(404);
  });
});

test.describe("quota", () => {
  test.use({
    expectedErrorResponses: [{ path: /^\/api\/v1\/surveys\/[0-9a-f-]+\/assets$/, status: 413 }],
  });

  test("a file over the quota shows a message, before and after asking the server", async ({
    page,
    browserName,
  }) => {
    test.skip(
      sandboxMode,
      notOnSandbox.design(
        "its file quota is maxUploadKb, 200 KB, not the 1 MB this test sets on the server",
      ),
    );
    await signInAt(page, "/", "admin");
    const survey = await createSurveyViaApi(page, uniqueSurveyName("Quota", browserName));
    await withCleanup(page, [survey.id], async () => {
      await putDefinitionViaApi(page, survey.id, {
        pages: [{ name: "page1", elements: [{ type: "image", name: "q1" }] }],
      });
      await uploadViaApi(page, survey.id, paddedPng(600_000), "first.png");
      await openEditor(page, survey.id);
      await expect(editorStatus(page)).toHaveText("All changes saved");
      await designerQuestions(page).first().click();

      const message =
        "A survey can store up to 1 MB of files in total. This file was not uploaded.";
      const requests: Request[] = [];
      page.on("request", (request) => {
        if (isAssetUpload(request)) requests.push(request);
      });

      await chooseImage(page, paddedPng(1_200_000), "too-big.png");
      await expect(creatorNotification(page)).toContainText(message);
      expect(requests).toHaveLength(0);
      // The toast fades after a couple of seconds; the next one must be a new one.
      await expect(creatorNotification(page)).toBeHidden();

      const refused = page.waitForResponse(
        (response) => isAssetUpload(response.request()) && response.status() === 413,
      );
      await chooseImage(page, paddedPng(600_000), "second.png");
      await refused;
      expect(requests).toHaveLength(1);
      await expect(creatorNotification(page)).toContainText(message);

      const definition = (await getDocumentViaApi(page, survey.id, "definition")).content;
      const pages = definition["pages"] as { elements: { imageLink?: string }[] }[];
      expect(pages[0]?.elements[0]?.imageLink).toBeUndefined();
    });
  });
});
