import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Page } from "@playwright/test";
import { accountTrigger, signInAt } from "./support/sign-in.js";
import { answerNextConfirm } from "./support/survey-list.js";
import { notOnSandbox, sandboxMode } from "./support/sandbox.js";
import { expect, test } from "./support/test.js";

// The API tokens page (ADR 0037): create a token, call the API with it from a page on another
// origin (CORS), revoke it, and see the next call refused; and revoke the legacy access key.
// Runs in memory mode (the surveyjs-site shell, LEGACY_KEY_REVOKE=true in playwright.config.ts).

/** A page on another origin than the app: a static server on a free port, started by the test. */
async function serveOtherOrigin(): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Another origin</title><p>Another origin</p>");
  });
  await new Promise<void>((resolve) => server.listen(0, "localhost", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** `GET /api/v1/surveys` with the token from the page, which is on another origin: the status. */
function callWithToken(page: Page, apiOrigin: string, token: string): Promise<number | string> {
  return page.evaluate(
    async ({ url, value }) => {
      try {
        const answer = await fetch(url, { headers: { Authorization: `Bearer ${value}` } });
        return answer.status;
      } catch (error) {
        return `network error: ${String(error)}`;
      }
    },
    { url: `${apiOrigin}/api/v1/surveys`, value: token },
  );
}

test.describe("API tokens", () => {
  test.skip(sandboxMode, notOnSandbox.server("API tokens"));
  // The 401 of the revoked token is logged by the page that sent the request, not the app's.

  test("a token works from another origin until it is revoked", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const name = `CI ${testInfo.project.name} ${Math.random().toString(36).slice(2, 8)}`;
    await signInAt(page, "/", "owner");
    await accountTrigger(page, "owner").hover();
    await page
      .locator("header.v2-class---top-bar")
      .first()
      .getByRole("link", { name: "API tokens", exact: true })
      .click();
    await expect(page).toHaveURL(/\/api-tokens$/);
    await expect(page.getByRole("heading", { name: "API tokens", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog", { name: "Create token" });
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByText("Copy this token now. You won't see it again.")).toBeVisible();
    const value = await dialog.getByLabel("Token").inputValue();
    expect(value).toMatch(/^sjs_[A-Za-z0-9_-]{43}$/);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();
    // The list shows the end of the value, never the value.
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByText(`…${value.slice(-4)}`)).toBeVisible();
    await expect(page.getByText(value)).toHaveCount(0);

    const other = await serveOtherOrigin();
    const context = await browser.newContext();
    try {
      const external = await context.newPage();
      await external.goto(other.origin);
      expect(new URL(external.url()).origin).not.toBe(new URL(baseURL!).origin);
      expect(await callWithToken(external, baseURL!, value)).toBe(200);

      const confirmed = answerNextConfirm(page, true);
      await row.getByRole("button", { name: `Revoke ${name}` }).click();
      expect(await confirmed).toBe("Revoke this token? Integrations that use it stop working.");
      await expect(row).toHaveCount(0);

      expect(await callWithToken(external, baseURL!, value)).toBe(401);
    } finally {
      await context.close();
      await other.close();
    }
  });

  test("the legacy access key is revoked", async ({ page, browserName }) => {
    // One user has the key and the instance revokes it once: the other browsers' runs skip.
    test.skip(browserName !== "chromium", "the key can be revoked once per run");
    await signInAt(page, "/api-tokens", "member");
    const row = page.getByRole("row", { name: /Legacy access key/ });
    await expect(row.getByText(/^…/)).toBeVisible();
    await expect(row.getByRole("link", { name: "Replace it on surveyjs.io" })).toHaveCount(0);

    const confirmed = answerNextConfirm(page, true);
    await row.getByRole("button", { name: "Revoke" }).click();
    expect(await confirmed).toBe("Revoke this key? Integrations that use it stop working.");
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Personal" })).toBeVisible();
    await expect(page.getByText("Legacy access key")).toHaveCount(0);
  });
});
