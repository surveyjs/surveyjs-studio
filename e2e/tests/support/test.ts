import { test as base, expect, type Page } from "@playwright/test";

interface ConsoleError {
  readonly text: string;
  readonly url: string;
}

/**
 * An answer a test expects to fail, which browsers log as a resource-load console error: an API
 * answer, or the 404 of a path that is not the app's. On the image target (E2E_TARGET=image) the
 * server answers such a path with the web app's page and 404 (ADR 0021), where `vite preview`
 * answers 200. An entry that never matches is fine (nothing is required to fail), so one list
 * serves both targets.
 */
export interface ExpectedErrorResponse {
  /**
   * The URL path, without the query and below a sandbox's base path (`APP_BASE`). A pattern
   * matches paths that hold an id only known at run time (a survey the test creates); it must
   * match the whole path (anchor it with `^…$`).
   */
  readonly path: string | RegExp;
  readonly status: number;
}

/** How browsers word a Content Security Policy violation in the console. */
const CSP_VIOLATION = /Content[- ]Security[- ]Policy/i;

/** The signed-out `/api/v1/me` probe: expected in every test. */
const ME_401: ExpectedErrorResponse = { path: "/api/v1/me", status: 401 };

const pathMatches = (item: ExpectedErrorResponse, path: string) =>
  typeof item.path === "string" ? item.path === path : item.path.test(path);

/** Error answers the tests' own requests got, per page (see `expectErrorResponse`). */
const requestedErrors = new WeakMap<Page, ExpectedErrorResponse[]>();

/**
 * Expects one more error answer on the page: a test's own request sent from the page (the
 * sandbox's `api(page)`), which the browser logs as the app's requests.
 */
export function expectErrorResponse(page: Page, item: ExpectedErrorResponse): void {
  const list = requestedErrors.get(page) ?? [];
  list.push(item);
  requestedErrors.set(page, list);
}

/**
 * Watches one page's console and page errors, as the shared `test` does for `page`; the returned
 * function checks what was seen so far. For a second page a test opens itself (another browser
 * context): call the check at the end of the test. With `allowCspViolations`, the console's
 * Content Security Policy violations are expected too.
 */
export function watchConsole(
  page: Page,
  expectedErrorResponses: readonly ExpectedErrorResponse[] = [],
  { allowCspViolations = false }: { readonly allowCspViolations?: boolean } = {},
): () => void {
  const consoleErrors: ConsoleError[] = [];
  const pageErrors: string[] = [];
  const responses: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    responses.push({ path: appPathOf(response.url()), status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  return () => {
    const expected = [ME_401, ...expectedErrorResponses, ...(requestedErrors.get(page) ?? [])];
    const observed = new Map<ExpectedErrorResponse, number>();
    for (const { path, status } of responses) {
      const match = expected.find((item) => pathMatches(item, path) && item.status === status);
      if (match) observed.set(match, (observed.get(match) ?? 0) + 1);
    }
    const matchOf = (error: ConsoleError) =>
      expected.find(
        (item) =>
          error.text.includes(`status of ${item.status}`) &&
          pathMatches(item, appPathOf(error.url)),
      );
    const isFaviconCsp = (error: ConsoleError) =>
      error.text.includes("Content-Security-Policy") && error.text.includes("/favicon.ico");
    const isAllowedCsp = (error: ConsoleError) =>
      allowCspViolations && CSP_VIOLATION.test(error.text);
    const unexpected = consoleErrors.filter(
      (error) => !matchOf(error) && !isFaviconCsp(error) && !isAllowedCsp(error),
    );
    // Each such console error needs its own observed response; the surplus is a problem.
    const unmatched = expected.flatMap((item) =>
      consoleErrors.filter((error) => matchOf(error) === item).slice(observed.get(item) ?? 0),
    );
    expect(
      [...unexpected, ...unmatched].map((error) => `console: ${error.text} (${error.url})`),
    ).toEqual([]);
    expect(pageErrors).toEqual([]);
  };
}

/**
 * The shared `test`: every spec imports it instead of `@playwright/test`. An automatic fixture
 * watches the page and fails the test at teardown on any unexpected console error or page error.
 *
 * Expected noise, and only this:
 * - The signed-out `/api/v1/me` probe answers 401, and the error responses a test lists in its
 *   `expectedErrorResponses` option (`test.use`). Browsers may log such an answer as a
 *   resource-load error located at its URL (which ones do differs by browser and status; WebKit
 *   does not log the /me 401). Each such console error must be matched by an observed response
 *   with that path and status, and the two are compared only at the end of the test because the
 *   browser does not order the response event before the console message.
 * - Firefox reports the dev sign-in page's CSP blocking its favicon request.
 * - With the `allowCspViolations` option (`test.use`), every Content Security Policy violation:
 *   for a spec whose survey holds markup the policy is there to block.
 */
export const test = base.extend<{
  expectedErrorResponses: ExpectedErrorResponse[];
  allowCspViolations: boolean;
  consoleGuard: void;
}>({
  expectedErrorResponses: [[], { option: true }],
  allowCspViolations: [false, { option: true }],
  consoleGuard: [
    async ({ page, expectedErrorResponses, allowCspViolations }, use) => {
      const check = watchConsole(page, expectedErrorResponses, { allowCspViolations });
      await use();
      check();
    },
    { auto: true },
  ],
});

export { expect };

/**
 * The base path of a sandbox built for a sub-path (`SANDBOX_BASE`, `pnpm e2e:sandbox:subpath`),
 * without the trailing slash; `""` at the root.
 */
const APP_BASE = (process.env["SANDBOX_BASE"] ?? "").replace(/\/+$/, "");

/** A URL's path as the app names it, below the base path: `/api/v1/me` for `/studio/api/v1/me`. */
function appPathOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "";
  }
  return APP_BASE && path.startsWith(`${APP_BASE}/`) ? path.slice(APP_BASE.length) : path;
}
