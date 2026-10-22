import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LEGACY_VARIABLES } from "../config.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

// Same list as conformance-tests/src/global-setup.ts: the CLI must see only what the test sets.
const appVariables = [
  "NODE_ENV",
  "HOST",
  "PORT",
  "LOG_LEVEL",
  "APP_EDITION",
  "APP_SHELL",
  "AUTH_METHODS",
  "SURVEYJS_LICENSE_KEY",
  "STORAGE_PROVIDER",
  "MEMORY_SEED",
  "PUBLIC_BASE_URL",
  "LIMIT_MAX_ASSET_BYTES_PER_SURVEY",
  "LIMIT_MAX_FILE_BYTES",
  "LIMIT_MAX_RESPONSE_BYTES",
  "LIMIT_MAX_DOCUMENT_BYTES",
  "API_DOCS",
  "USER_DIRECTORY",
  "USER_API_URL",
  "USER_API_TOKEN",
  "ACCOUNT_WEBHOOK_SECRET",
  ...LEGACY_VARIABLES,
];

function inspect(args: string[], env: Record<string, string> = {}) {
  const clean = { ...process.env };
  for (const name of appVariables) delete clean[name];
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "server/src/cli/inspect-legacy.ts", "--", ...args],
    { cwd: repoRoot, env: { ...clean, ...env }, encoding: "utf8" },
  );
  return { code: result.status, out: result.stdout, err: result.stderr };
}

const memory = { STORAGE_PROVIDER: "memory", MEMORY_SEED: "legacy-fixtures" };

describe("inspect-legacy CLI (memory provider)", { timeout: 30_000 }, () => {
  it("lists personal and project surveys with their dates", () => {
    const { code, out } = inspect(["--user", "owner@example.com"], memory);
    expect(code).toBe(0);
    expect(out).toContain("owner@example.com");
    expect(out).toContain("Olivia Owner");
    expect(out).toContain("memory");
    expect(out).toContain("Personal");
    expect(out).toContain("Customer feedback");
    expect(out).toContain("2026-03-13T09:12:00.000Z");
    expect(out).toContain("2026-04-14T15:30:00.000Z");
    expect(out).toContain("Old poll");
    expect(out).toContain("2026-05-20T12:00:00.123Z");
    expect(out).toContain("Project ");
    expect(out).toContain("Campaign survey");
    expect(out).toContain("2026-06-10T09:05:00.000Z");
  });

  it("finds a user by id, case-insensitively", () => {
    const { code, out } = inspect(["--user", "11111111-0000-4000-8000-A00000000001"], memory);
    expect(code).toBe(0);
    expect(out).toContain("Customer feedback");
  });

  it("exits 1 for an unknown user and names the store", () => {
    const { code, err, out } = inspect(["--user", "nobody@example.com"], memory);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("nobody@example.com");
    expect(err).toContain("memory store");
  });

  it("exits 2 when no store is configured, instead of reading an empty memory store", () => {
    const { code, err, out } = inspect(["--user", "owner@example.com"]);
    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("STORAGE_PROVIDER is not set");
    expect(err).toContain("--env-file docker/azurite.env");
  });

  it("exits 2 without arguments", () => {
    const { code, err } = inspect([], memory);
    expect(code).toBe(2);
    expect(err).toContain("--user");
  });

  it("exits 2 for a missing env file", () => {
    const { code, err } = inspect(["--user", "a", "--env-file", "no-such.env"], memory);
    expect(code).toBe(2);
    expect(err).toContain("no-such.env");
  });

  it("exits 1 with a clean message on a configuration error", () => {
    const { code, err } = inspect(["--user", "a"], { STORAGE_PROVIDER: "bogus" });
    expect(code).toBe(1);
    expect(err).not.toContain("    at ");
  });
});
