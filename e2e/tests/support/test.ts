import { test as base, expect } from "@playwright/test";

interface ConsoleError {
  readonly text: string;
  readonly url: string;
}

/** An API answer a test expects to fail, which browsers log as a resource-load console error. */
export interface ExpectedErrorResponse {
  /** The URL path, without the query. */
  readonly path: string;
  readonly status: number;
}

/** The signed-out `/api/v1/me` probe: expected in every test. */
const ME_401: ExpectedErrorResponse = { path: "/api/v1/me", status: 401 };

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
 */
export const test = base.extend<{
  expectedErrorResponses: ExpectedErrorResponse[];
  consoleGuard: void;
}>({
  expectedErrorResponses: [[], { option: true }],
  consoleGuard: [
    async ({ page, expectedErrorResponses }, use) => {
      const expected = [ME_401, ...expectedErrorResponses];
      const consoleErrors: ConsoleError[] = [];
      const pageErrors: string[] = [];
      const observed = new Map<ExpectedErrorResponse, number>();
      page.on("response", (response) => {
        const path = new URL(response.url()).pathname;
        const match = expected.find(
          (item) => item.path === path && item.status === response.status(),
        );
        if (match) observed.set(match, (observed.get(match) ?? 0) + 1);
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push({ text: message.text(), url: message.location().url });
        }
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await use();

      const matchOf = (error: ConsoleError) =>
        expected.find(
          (item) =>
            error.text.includes(`status of ${item.status}`) && pathOf(error.url) === item.path,
        );
      const isFaviconCsp = (error: ConsoleError) =>
        error.text.includes("Content-Security-Policy") && error.text.includes("/favicon.ico");
      const unexpected = consoleErrors.filter((error) => !matchOf(error) && !isFaviconCsp(error));
      // Each such console error needs its own observed response; the surplus is a problem.
      const unmatched = expected.flatMap((item) =>
        consoleErrors.filter((error) => matchOf(error) === item).slice(observed.get(item) ?? 0),
      );
      expect(
        [...unexpected, ...unmatched].map((error) => `console: ${error.text} (${error.url})`),
      ).toEqual([]);
      expect(pageErrors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}
