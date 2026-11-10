import { routeBrandImage } from "./support/run.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test } from "./support/test.js";

// The web app's security headers (R17, ADR 0019) as `vite preview` sends them, the server's on a
// proxied API answer (R18), and an old surveyjs.io address shown as an unknown page (R22, R23).
// Memory mode only: the headers do not depend on the storage provider. Sends no write.

const CAMPAIGN_SURVEY_ID = "22222222-0000-4000-8000-a00000000004";

test("a private page may not be framed and loads scripts only from the app", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});

test("the run page may be framed by any site", async ({ page }) => {
  await routeBrandImage(page);
  const response = await page.goto(`/s/${CAMPAIGN_SURVEY_ID}`);
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors *");
});

test("an API answer through the preview keeps the server's own policy", async ({ page }) => {
  test.skip(sandboxMode, notOnSandbox.server("the API server's own headers"));
  const response = await page.request.get("/api/v1/config");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
});

test.describe("an old surveyjs.io address", () => {
  // The server that serves the web app (the image) answers the page with 404, which Chromium and
  // WebKit log; `vite preview` answers 200.
  test.use({ expectedErrorResponses: [{ path: "/published", status: 404 }] });

  test("an old surveyjs.io run link shows the not-found page, without a redirect", async ({
    page,
  }) => {
    const path = `/published?id=${CAMPAIGN_SURVEY_ID}`;
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
  });
});
