import type { Locator, Page } from "@playwright/test";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expectSignInPage, signInAt } from "./support/sign-in.js";
import { expect, test } from "./support/test.js";

test.skip(sandboxMode, notOnSandbox.shell);

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

test("a keyboard user can open the Account menu and sign out at desktop width", async ({
  page,
  browserName,
}) => {
  await signInAt(page);
  const header = page.locator("header.v2-class---top-bar").first();
  const trigger = header.getByRole("button", { name: "Olivia Owner" });
  const signOut = header.getByRole("button", { name: "Sign Out" });
  await expect(trigger).toBeVisible();
  await expect(signOut).toBeHidden();

  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(signOut).toBeVisible();

  if (browserName === "webkit") {
    // Sign Out is a link (`href="#"`, role button), which WebKit skips on Tab by default; the
    // Tab walk to the trigger above (a real button) and Enter on Sign Out are still keyboard-only.
    await signOut.focus();
  } else {
    await tabTo(page, signOut, 10);
  }
  await page.keyboard.press("Enter");

  // Signed out: the private home page sends the browser back to the dev sign-in page.
  await expectSignInPage(page);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);
});

test("Escape closes a keyboard-opened menu and keeps focus on its trigger", async ({
  page,
  browserName,
}) => {
  // WebKit, like Safari, skips links on Tab unless the user turns that on (Option+Tab), and this
  // test Tabs into a menu link. The sign-out test above needs only buttons, so WebKit runs it.
  test.skip(browserName === "webkit", "WebKit does not Tab to links by default");
  await signInAt(page);
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
