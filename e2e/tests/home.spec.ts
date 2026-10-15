import { signInAt } from "./support/sign-in.js";
import { surveyRows } from "./support/survey-list.js";
import { expect, test } from "./support/test.js";

test("the signed-in home page shows the My Surveys list without errors", async ({ page }) => {
  // `/` is private: the guard sends the browser through the sign-in page and back. The shared
  // fixture fails the test on any unexpected console or page error.
  await signInAt(page);

  await expect(page.getByRole("heading", { level: 1, name: "My Surveys" })).toBeVisible();
  await expect(surveyRows(page).first()).toBeVisible();
});
