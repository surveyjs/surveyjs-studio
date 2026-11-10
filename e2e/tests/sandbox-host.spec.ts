import type { APIResponse } from "@playwright/test";
import { expect, test, watchConsole } from "./support/test.js";

// The headers and caching of the sandbox's host (deploy/sandbox/nginx.conf), over HTTP: run with
// `E2E_SANDBOX_URL` set (`pnpm sandbox:serve`, then `pnpm e2e:sandbox:url`, or the published demo).
// `vite preview` is not that host, so `pnpm e2e:sandbox` skips this file.
test.skip(
  process.env["E2E_MODE"] !== "sandbox" || !process.env["E2E_SANDBOX_URL"],
  "needs E2E_SANDBOX_URL",
);

const EDITOR_PATH = "/surveys/22222222-0000-4000-8000-a00000000001/edit";

function expectSecurityHeaders(response: APIResponse): void {
  const headers = response.headers();
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["strict-transport-security"]).toBe("max-age=31536000");
}

for (const path of ["/", "/index.html", EDITOR_PATH]) {
  test(`@sandbox-host ${path} is the shell: HTML, never cached, not frameable`, async ({
    request,
  }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
    expect(response.headers()["cache-control"]).toContain("no-cache");
    expect(response.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'$/);
    expectSecurityHeaders(response);
  });
}

test("@sandbox-host the run page may be framed by any site", async ({ request }) => {
  const response = await request.get("/s/anything");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/html");
  expect(response.headers()["content-security-policy"]).toMatch(/frame-ancestors \*$/);
  expectSecurityHeaders(response);
});

test("@sandbox-host the service worker is JavaScript and never cached", async ({ request }) => {
  const response = await request.get("/mockServiceWorker.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/javascript/);
  expect(response.headers()["cache-control"]).toContain("no-cache");
  expectSecurityHeaders(response);
});

test("@sandbox-host version.json names the commit and the data version", async ({ request }) => {
  const response = await request.get("/version.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-cache");
  const body = (await response.json()) as { commit: unknown; dataVersion: unknown };
  expect(typeof body.commit).toBe("string");
  expect(typeof body.dataVersion).toBe("number");
  expectSecurityHeaders(response);
});

test("@sandbox-host sandbox.config.json holds the settings and is never stored", async ({
  request,
}) => {
  const response = await request.get("/sandbox.config.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = (await response.json()) as Record<string, unknown>;
  expect(body).toHaveProperty("maxUploadKb");
  expectSecurityHeaders(response);
});

test("@sandbox-host built assets are cached for good, and a missing one is a 404", async ({
  request,
}) => {
  const html = await (await request.get("/")).text();
  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(asset, "index.html links a script under /assets/").toBeDefined();
  const response = await request.get(asset ?? "");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
  expectSecurityHeaders(response);

  // A 404 keeps the security headers (`always`) but is not cached for good: a file that a deploy adds
  // later must not stay missing in a cache.
  const missing = await request.get("/assets/does-not-exist.js");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"] ?? "").not.toContain("immutable");
  expect(missing.headers()["content-security-policy"]).toMatch(/frame-ancestors 'none'$/);
  expectSecurityHeaders(missing);
});

test("@sandbox-host the app starts under the policy without a violation", async ({ page }) => {
  const check = watchConsole(page);
  await page.addInitScript(() => localStorage.setItem("isInformedAboutCookieAndPolicies", "true"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pick an account" })).toBeVisible();
  check();
});
