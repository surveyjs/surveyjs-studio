import { expect, test } from "@playwright/test";

test("home page shows the configured edition and shell without errors", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.goto("/");

  await expect(page.getByText("edition: self-hosted")).toBeVisible();
  await expect(page.getByText("shell: surveyjs-site")).toBeVisible();
  expect(problems).toEqual([]);
});
