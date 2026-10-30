// Self-hosted mode (`pnpm e2e:self-hosted`): the sqlite provider on a new database file (as in
// playwright.sqlite.config.ts) in the self-hosted shell with an instance's branding, local accounts
// and the dev sign-in. The main process empties e2e/.data/ (git-ignored) and names it in
// E2E_SQLITE_DIR; the workers inherit the name and leave the folder alone.
// On the image target (E2E_TARGET=image) the data is on a named Docker volume instead
// (playwright.config.ts), and the folder stays empty.
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env["E2E_MODE"] = "self-hosted";
if (process.env["E2E_SQLITE_DIR"] === undefined) {
  const dir = fileURLToPath(new URL("./.data/", import.meta.url));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["E2E_SQLITE_DIR"] = dir;
}

export default (await import("./playwright.config.js")).default;
