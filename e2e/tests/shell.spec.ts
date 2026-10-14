import { expect, test, type Locator, type Page } from "@playwright/test";

/** Presses Tab until `target` has the focus, or fails after `limit` presses. */
async function tabTo(page: Page, target: Locator, limit = 40) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    // Typed by hand: the e2e project compiles without the DOM types.
    const focused = await target.evaluate(
      (element: { ownerDocument: { activeElement: unknown } }) =>
        element === element.ownerDocument.activeElement,
    );
    if (focused) return;
  }
  throw new Error(`Tab did not reach the element in ${limit} presses`);
}

// WebKit, like Safari, skips links on Tab unless the user turns that on (Option+Tab), so the Tab
// walk below would not reach the menu items there; Chromium and Firefox cover the keyboard path.
test.skip(({ browserName }) => browserName === "webkit", "WebKit does not Tab to links by default");

test("a keyboard user can open the Account menu and sign out at desktop width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("li", { hasText: "owner@example.com" }).getByRole("link").click();
  const header = page.locator("header.v2-class---top-bar").first();
  const trigger = header.getByRole("button", { name: "Olivia Owner" });
  const signOut = header.getByRole("button", { name: "Sign Out" });
  await expect(trigger).toBeVisible();
  await expect(signOut).toBeHidden();

  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(signOut).toBeVisible();

  await tabTo(page, signOut, 10);
  await page.keyboard.press("Enter");

  // Signed out: the private home page sends the browser back to the dev sign-in page.
  await expect(page.locator("li", { hasText: "owner@example.com" })).toBeVisible();
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});

test("Escape closes a keyboard-opened menu and keeps focus on its trigger", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("li", { hasText: "owner@example.com" }).getByRole("link").click();
  const products = page.locator("header.v2-class---top-bar").first().getByRole("button", {
    name: "Products",
  });

  await products.focus();
  await page.keyboard.press("Enter");
  const formLibrary = page
    .locator("header.v2-class---top-bar")
    .first()
    .getByRole("link", { name: "Form Library" });
  await expect(formLibrary).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(formLibrary).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(formLibrary).toBeHidden();
  await expect(products).toBeFocused();
  await expect(products).toHaveAttribute("aria-expanded", "false");
});
