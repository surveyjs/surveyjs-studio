import { signInAt } from "./support/sign-in.js";
import { expect, test } from "./support/test.js";

// Runs against the second server (ACCOUNT_NOTICES=license-expired) behind its own preview.
test.use({ baseURL: "http://localhost:5174" });

test("the expired-licence dialog appears after sign-in and Later dismisses it", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
  await signInAt(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Your renewal subscription has expired.");
  await expect(dialog.getByRole("link", { name: "Renew" })).toBeVisible();
  await dialog.getByRole("button", { name: "Later" }).click();
  await expect(dialog).toBeHidden();
});
