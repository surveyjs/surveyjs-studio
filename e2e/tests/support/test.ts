import { test as base, expect } from "@playwright/test";

interface ConsoleError {
  readonly text: string;
  readonly url: string;
}

/**
 * The shared `test`: every spec imports it instead of `@playwright/test`. An automatic fixture
 * watches the page and fails the test at teardown on any unexpected console error or page error.
 *
 * Expected noise, and only this:
 * - The signed-out `/api/v1/me` probe answers 401. Chromium and Firefox log it as a resource-load
 *   error located at `/api/v1/me` (WebKit logs nothing). Each such console error must be matched
 *   by an observed 401 response, and the two are compared only at the end of the test because the
 *   browser does not order the response event before the console message.
 * - Firefox reports the dev sign-in page's CSP blocking its favicon request.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const consoleErrors: ConsoleError[] = [];
      const pageErrors: string[] = [];
      let me401Responses = 0;
      page.on("response", (response) => {
        if (new URL(response.url()).pathname === "/api/v1/me" && response.status() === 401) {
          me401Responses += 1;
        }
      });
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push({ text: message.text(), url: message.location().url });
        }
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));

      await use();

      const isMe401 = (error: ConsoleError) =>
        error.text.includes("status of 401") && pathOf(error.url) === "/api/v1/me";
      const isFaviconCsp = (error: ConsoleError) =>
        error.text.includes("Content-Security-Policy") && error.text.includes("/favicon.ico");
      const me401Errors = consoleErrors.filter(isMe401);
      const unexpected = consoleErrors.filter((error) => !isMe401(error) && !isFaviconCsp(error));
      // Each /me 401 console error needs its own observed 401 response; the surplus is a problem.
      const unmatched = me401Errors.slice(me401Responses);
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
