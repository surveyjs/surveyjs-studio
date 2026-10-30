import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEGACY_VARIABLES } from "../config.js";
import { USAGE as ERASE_USAGE } from "./account-erase.js";
import { MEMORY_REFUSAL } from "./common.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const ERIN = "11111111-0000-4000-8000-a00000000006";

// The server's variables (server/src/config.ts): the commands must see only what a test sets.
const appVariables = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "LOG_LEVEL",
  "APP_EDITION",
  "APP_SHELL",
  "AUTH_METHODS",
  "SURVEYJS_LICENSE_KEY",
  "SURVEYJS_IMAGE_LICENSE_KEY",
  "BRAND_NAME",
  "BRAND_LOGO_URL",
  "BRAND_ACCENT_COLOR",
  "TERMS_URL",
  "PRIVACY_URL",
  "BRANDING",
  "STORAGE_PROVIDER",
  "MEMORY_SEED",
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
  "LIMIT_MAX_DOCUMENT_BYTES",
  "API_DOCS",
  "IDENTITY_PROVIDER",
  "SESSION_SECRET",
  "ACCOUNT_NOTICES",
  "USER_DIRECTORY",
  "USER_API_URL",
  "USER_API_TOKEN",
  "ACCOUNT_WEBHOOK_SECRET",
  ...LEGACY_VARIABLES,
];

function command(script: string, args: string[], env: Record<string, string> = {}) {
  const clean = { ...process.env };
  for (const name of appVariables) delete clean[name];
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", `server/src/cli/${script}`, "--", ...args],
    { cwd: repoRoot, env: { ...clean, ...env }, encoding: "utf8" },
  );
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe("account commands (spawned)", { timeout: 30_000 }, () => {
  it("account:erase --help prints the usage", () => {
    const { code, out } = command("account-erase.ts", ["--help"]);
    expect(code).toBe(0);
    expect(out).toBe(`${ERASE_USAGE}\n`);
  });

  it("account:erase refuses the memory store", () => {
    const { code, out, err } = command("account-erase.ts", ["--user", ERIN, "--yes"], {
      STORAGE_PROVIDER: "memory",
      MEMORY_SEED: "legacy-fixtures",
    });
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(`${MEMORY_REFUSAL}\n`);
  });

  it("account:reconcile refuses to run without a store", () => {
    const { code, out, err } = command("account-reconcile.ts", []);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toBe(`${MEMORY_REFUSAL}\n`);
  });
});
