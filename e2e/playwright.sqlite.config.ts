// SQLite mode (`pnpm e2e:sqlite`): the same config with E2E_MODE=sqlite, set here rather than on the
// command line so it also works in the Windows shells pnpm uses. The main process empties e2e/.data/
// (git-ignored) and names it in E2E_SQLITE_DIR; the workers load this file too, inherit the name and
// leave the folder alone. The server's `seed` fills the new database before it starts. The folder is
// kept after the run (the server may still hold the file then), and emptied by the next one.
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env["E2E_MODE"] = "sqlite";
if (process.env["E2E_SQLITE_DIR"] === undefined) {
  const dir = fileURLToPath(new URL("./.data/", import.meta.url));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  process.env["E2E_SQLITE_DIR"] = dir;
}

export default (await import("./playwright.config.js")).default;
