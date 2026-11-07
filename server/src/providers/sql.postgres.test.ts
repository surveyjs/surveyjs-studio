import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { scratchPostgres, type ScratchDatabase } from "../sql/scratch-databases.js";
import { createProviders } from "./index.js";
import type { ProviderSet } from "./types.js";

describe("createProviders with STORAGE_PROVIDER=postgres", () => {
  let scratch: ScratchDatabase | undefined;
  let providers: ProviderSet | undefined;
  const filesRoot = mkdtempSync(join(tmpdir(), "surveyjs-studio-files-"));
  afterAll(async () => {
    await providers?.close();
    await scratch?.drop();
    rmSync(filesRoot, { recursive: true, force: true });
  });

  it("logs a closed database connection with its code only, and keeps serving", async () => {
    scratch = await scratchPostgres();
    if (scratch.target.dialect !== "postgres") throw new Error("unreachable");
    const config = loadConfig({
      IDENTITY_PROVIDER: "dev",
      STORAGE_PROVIDER: "postgres",
      DATABASE_URL: scratch.target.url,
      FILES_PATH: filesRoot,
    });
    const warnings: { details: Readonly<Record<string, string>>; message: string }[] = [];
    providers = await createProviders(config, {
      logger: { warn: (details, message) => warnings.push({ details, message }) },
    });

    // The pool's connections after the start-up migration; end them all from outside.
    const admin = new pg.Client({ connectionString: scratch.target.url });
    await admin.connect();
    try {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()",
      );
    } finally {
      await admin.end();
    }
    await expect.poll(() => warnings.length, { timeout: 5000 }).toBeGreaterThan(0);
    expect(warnings[0]).toEqual({
      details: { code: "57P01" },
      message: "A database connection was closed; the next query opens a new one.",
    });
    expect(await providers.ready()).toEqual([
      { name: "database", ok: true },
      { name: "files", ok: true },
    ]);
    expect(JSON.stringify(warnings)).not.toContain("Local-Postgres-Pwd-1");
  });
});
