// Azurite mode (`pnpm e2e:azurite`): the same config with E2E_MODE=azurite, set here rather than on
// the command line so it also works in the Windows shells pnpm uses. The workers load this file too.
process.env["E2E_MODE"] = "azurite";

export default (await import("./playwright.config.js")).default;
