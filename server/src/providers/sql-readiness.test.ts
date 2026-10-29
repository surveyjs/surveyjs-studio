import { describe, expect, it } from "vitest";
import { createLocalByteStore } from "../bytes/local.js";
import { openDatabase } from "../sql/database.js";
import { createSqlProviders } from "./sql.js";

describe("SQL provider readiness", () => {
  it("answers within its time limit when the file store never does", async () => {
    const database = openDatabase({ dialect: "sqlite", path: ":memory:" });
    const hung = { ...createLocalByteStore("unused"), probe: () => new Promise<never>(() => {}) };
    const providers = createSqlProviders(database, { bytes: hung });
    const started = Date.now();
    const checks = await providers.ready();
    expect(Date.now() - started).toBeLessThan(4500);
    expect(checks).toEqual([
      { name: "database", ok: true },
      { name: "files", ok: false, reason: "timeout" },
    ]);
    await providers.close();
  }, 10_000);
});
