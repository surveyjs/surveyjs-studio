import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { storageWarning } from "../logging.js";
import { createProviders } from "./index.js";

describe("USER_DIRECTORY=local", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  });

  it("gives SQL storage the database's local accounts as its users", async () => {
    const dir = mkdtempSync(join(tmpdir(), "surveyjs-studio-local-"));
    dirs.push(dir);
    const config = loadConfig({
      STORAGE_PROVIDER: "sqlite",
      SQLITE_PATH: join(dir, "studio.db"),
      FILES_PATH: join(dir, "files"),
      USER_DIRECTORY: "local",
      AUTH_METHODS: "password",
    });
    const providers = await createProviders(config);
    expect(providers.users.kind).toBe("local");
    expect(providers.accounts).not.toBeNull();
    expect(await providers.accounts!.countAccounts()).toBe(0);
    expect(storageWarning(config)).toBeNull();
    await providers.close();
  });

  it("gives memory storage local accounts made from the seed users", async () => {
    const config = loadConfig({
      USER_DIRECTORY: "local",
      AUTH_METHODS: "password",
      MEMORY_SEED: "legacy-fixtures",
    });
    const providers = await createProviders(config);
    expect(providers.users.kind).toBe("local");
    expect(await providers.accounts!.countAccounts()).toBeGreaterThan(0);
    await providers.close();
  });

  it("keeps the other directories without local accounts", async () => {
    const providers = await createProviders(loadConfig({ IDENTITY_PROVIDER: "dev" }));
    expect(providers.accounts).toBeNull();
    await providers.close();
  });
});
