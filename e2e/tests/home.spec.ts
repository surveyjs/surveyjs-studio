import { expect, test } from "@playwright/test";

test("home page shows the configured edition and shell without errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Expected noise on the way through sign-in: the signed-out /me probe answers 401, and Firefox
    // reports the dev sign-in page's CSP blocking its favicon request.
    if (text.includes("401") || text.includes("favicon.ico")) return;
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
