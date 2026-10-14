import { signInAt } from "./support/sign-in.js";
import { expect, test } from "./support/test.js";

test("home page shows the configured edition and shell without errors", async ({ page }) => {
  // `/` is private: the guard sends the browser through the sign-in page and back. The shared
  // fixture fails the test on any unexpected console or page error.
  await signInAt(page);

  await expect(page.getByText("edition: self-hosted")).toBeVisible();
  await expect(page.getByText("shell: surveyjs-site")).toBeVisible();
});
