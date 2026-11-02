import type { Page } from "@playwright/test";
import { expect } from "./test.js";

/**
 * The first admin of the password mode (`pnpm e2e:password`): the server creates it from
 * ADMIN_EMAIL and ADMIN_PASSWORD (playwright.config.ts), and it must change the password at its
 * first sign-in. Synthetic local-only test values.
 */
export const firstAdmin = {
  email: "first-admin@example.com",
  password: "e2e first admin password",
  /** The admin's display name: the server takes the email's local part. */
  name: "first-admin",
} as const;

/** `password`: the server signs in with passwords only, on the local user directory. */
export const passwordMode = process.env["E2E_MODE"] === "password";

/** The app's sign-in page, with its heading shown. */
export async function expectSignInPage(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/sign-in(\?|$)/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
}

/** Fills the sign-in page's email and password and submits. */
export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The surveyjs-site header's account item, which shows the user's display name. */
export const accountTrigger = (page: Page, name: string) =>
  page.locator("header.v2-class---top-bar").first().getByRole("button", { name });
