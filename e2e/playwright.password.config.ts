// Password mode (`pnpm e2e:password`): the sqlite provider on a new database file (as in
// playwright.sqlite.config.ts), with the local user directory and password sign-in only, so the
// browser signs in on the app's own sign-in page. The main process empties e2e/.data/ (git-ignored)
// and names it in E2E_SQLITE_DIR; the workers inherit the name and leave the folder alone.
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env["E2E_MODE"] = "password";
if (process.env["E2E_SQLITE_DIR"] === undefined) {
  const dir = fileURLToPath(new URL("./.data/", import.meta.url));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["E2E_SQLITE_DIR"] = dir;
}

export default (await import("./playwright.config.js")).default;
