// The user stories on the sandbox build (`pnpm e2e:sandbox:stories`): sandbox mode
// (playwright.sandbox.config.ts) with the user-story specs in place of the `@sandbox` spec. Their
// set-up requests go through the page, so its service worker answers them (tests/support/api.ts).
// A spec or test that cannot apply to the sandbox skips itself with the reason.
process.env["E2E_MODE"] = "sandbox";
process.env["E2E_SANDBOX_STORIES"] = "1";

export default (await import("./playwright.config.js")).default;
