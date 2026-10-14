import { expect, test } from "@playwright/test";

test("home page shows the configured edition and shell without errors", async ({ page }) => {
  const problems: string[] = [];
  // Expected noise on the way through sign-in. The signed-out /me probe answers 401, and Chromium and
  // Firefox log it as a resource-load error located at /api/v1/me (WebKit logs nothing). Each logged
  // message must be matched by an observed 401 response. Firefox also reports the dev sign-in page's
  // CSP blocking its favicon request.
  let unmatchedMe401 = 0;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/v1/me" && response.status() === 401) {
      unmatchedMe401 += 1;
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const isMe401 =
      text.includes("status of 401") && new URL(message.location().url).pathname === "/api/v1/me";
    if (isMe401 && unmatchedMe401 > 0) {
      unmatchedMe401 -= 1;
      return;
    }
    if (text.includes("Content-Security-Policy") && text.includes("/favicon.ico")) return;
    problems.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  // `/` is private: the guard sends the browser through the dev sign-in page and back.
  await page.goto("/");
  await page.locator("li", { hasText: "owner@example.com" }).getByRole("link").click();

  await expect(page.getByText("edition: self-hosted")).toBeVisible();
  await expect(page.getByText("shell: surveyjs-site")).toBeVisible();
  expect(problems).toEqual([]);
});
