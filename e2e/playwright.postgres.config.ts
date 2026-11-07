// PostgreSQL mode (`pnpm e2e:postgres`): the same config with E2E_MODE=postgres, set here rather than
// on the command line so it also works in the Windows shells pnpm uses. The main process makes the
// database `surveyjs_studio_e2e` new on the server of DATABASE_URL (docker/postgres.env; start it
// with `pnpm postgres:up`) and names it in E2E_DATABASE_URL; the workers load this file too, inherit
// the name and leave the database alone. The server's `seed` fills it before it starts. It is kept
// after the run, and made new by the next one.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";

const DATABASE = "surveyjs_studio_e2e";

process.env["E2E_MODE"] = "postgres";
if (process.env["E2E_DATABASE_URL"] === undefined) {
  const file = parseEnv(readFileSync(new URL("../docker/postgres.env", import.meta.url), "utf8"));
  const serverUrl = process.env["DATABASE_URL"] ?? file["DATABASE_URL"];
  if (!serverUrl) throw new Error("e2e:postgres needs DATABASE_URL (docker/postgres.env)");
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists ${DATABASE} with (force)`);
    await admin.query(`create database ${DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = new URL(serverUrl);
  url.pathname = `/${DATABASE}`;
  process.env["E2E_DATABASE_URL"] = url.toString();
}

export default (await import("./playwright.config.js")).default;
