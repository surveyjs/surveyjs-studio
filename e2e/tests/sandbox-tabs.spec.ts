import type { Page } from "@playwright/test";
import { surveyRow } from "./support/survey-list.js";
import { expect, test, watchConsole } from "./support/test.js";

// Two tabs of the sandbox build (`pnpm e2e:sandbox`) write at the same moment (ADR 0030, D11). The
// requests are sent from each page, so the page's service worker answers them, as it would the
// app's own. Each tab reads its own copy of localStorage, and the cross-tab lock keeps a write from
// starting on a copy that has not seen the other tab's last write.
test.skip(process.env["E2E_MODE"] !== "sandbox", "needs pnpm e2e:sandbox");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
});

/** Sends `count` createSurvey requests from `page` at once; resolves their statuses. */
function createSurveys(page: Page, prefix: string, count: number): Promise<number[]> {
  return page.evaluate(
    async ({ prefix, count }) =>
      Promise.all(
        Array.from({ length: count }, async (_, n) => {
          const response = await fetch("/api/v1/surveys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `${prefix} ${n}` }),
          });
          return response.status;
        }),
      ),
    { prefix, count },
  );
}

/** The names of the signed-in user's personal surveys, read through `page`'s worker. */
function surveyNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/surveys?limit=200");
    const body = (await response.json()) as { items: { name: string }[] };
    return body.items.map((item) => item.name);
  });
}

test("@sandbox two tabs that write at the same moment keep each other's writes", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: /Olivia Owner/ }).click();
  await expect(surveyRow(page, "Customer feedback")).toBeVisible({ timeout: 30_000 });

  const second = await context.newPage();
  const check = watchConsole(second);
  await second.goto("/");
  await expect(surveyRow(second, "Customer feedback")).toBeVisible({ timeout: 30_000 });
  expect(await second.evaluate(() => typeof navigator.locks?.request)).toBe("function");

  const COUNT = 15;
  const [first, other] = await Promise.all([
    createSurveys(page, "Tab A", COUNT),
    createSurveys(second, "Tab B", COUNT),
  ]);
  expect([...first, ...other]).toEqual(Array.from({ length: 2 * COUNT }, () => 201));

  // A read does not wait for the other tab's last write to arrive: poll until it has.
  const counts = async (tab: Page) => {
    const names = await surveyNames(tab);
    return [
      names.filter((n) => n.startsWith("Tab A ")).length,
      names.filter((n) => n.startsWith("Tab B ")).length,
    ];
  };
  for (const tab of [page, second]) {
    await expect.poll(() => counts(tab)).toEqual([COUNT, COUNT]);
  }
  check();
});
