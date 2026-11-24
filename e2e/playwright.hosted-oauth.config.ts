// Hosted OAuth mode (`pnpm e2e:hosted-oauth`): the hosted edition on a new SQLite file (local user
// directory, surveyjs sign-in only, open sign-up), signing in through the OAuth stub's surveyjs.io
// that Playwright starts on port 5180 (playwright.config.ts). The data folder is made as in
// playwright.password.config.ts.
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env["E2E_MODE"] = "hosted-oauth";
if (process.env["E2E_SQLITE_DIR"] === undefined) {
  const dir = fileURLToPath(new URL("./.data/", import.meta.url));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["E2E_SQLITE_DIR"] = dir;
}

export default (await import("./playwright.config.js")).default;
