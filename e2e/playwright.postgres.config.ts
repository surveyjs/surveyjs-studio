// PostgreSQL mode (`pnpm e2e:postgres`): the same config with E2E_MODE=postgres, set here rather than
// on the command line so it also works in the Windows shells pnpm uses. The main process makes the
// database `surveyjs_studio_e2e` new on the server of DATABASE_URL (docker/postgres.env; start it
// with `pnpm postgres:up`) and names it in E2E_DATABASE_URL, and makes the bucket
// `surveyjs-studio-e2e` new on the local S3 server (`pnpm s3:up`; E2E_S3_SETTINGS). The workers
// load this file too, inherit both and leave them alone. The server's `seed` fills the database
// before it starts. Both are kept after the run, and made new by the next one.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import pg from "pg";

const DATABASE = "surveyjs_studio_e2e";
const BUCKET = "surveyjs-studio-e2e";
const S3_VARIABLES = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_FORCE_PATH_STYLE",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

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

  // The files go to the bucket `surveyjs-studio-e2e` of the local S3 server (`pnpm s3:up`,
  // docker/s3.env), made new here by the server's `s3:bucket` command like the database.
  const s3File = parseEnv(readFileSync(new URL("../docker/s3.env", import.meta.url), "utf8"));
  const s3 = Object.fromEntries(
    S3_VARIABLES.map((name) => [name, s3File[name] ?? ""] as const),
  ) as Record<(typeof S3_VARIABLES)[number], string>;
  const bucket = (command: "create" | "remove") => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/src/cli/s3-bucket.ts", command, BUCKET],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: { ...process.env, ...s3 },
        encoding: "utf8",
      },
    );
    if (result.status !== 0 && command === "create") {
      throw new Error(`s3:bucket create failed (is \`pnpm s3:up\` running?):\n${result.stderr}`);
    }
  };
  bucket("remove");
  bucket("create");
  process.env["E2E_S3_SETTINGS"] = JSON.stringify({ FILE_STORE: "s3", S3_BUCKET: BUCKET, ...s3 });
}

export default (await import("./playwright.config.js")).default;
