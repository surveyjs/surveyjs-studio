import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/src/app.js";
import { loadConfig } from "../../server/src/config.js";
import { hashCredential, lastFour, newApiTokenValue } from "../../server/src/credentials/format.js";
import { createProviders } from "../../server/src/providers/index.js";
import { openDatabase } from "../../server/src/sql/database.js";
import { migrate } from "../../server/src/sql/migrator.js";
import { scratchSqlite } from "../../server/src/sql/scratch-databases.js";
import { check, formatTimings, percentile, run } from "./check.js";
import { generate } from "./generate.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A generated database behind a real listening app; the owner's API token. */
async function served() {
  const scratch = scratchSqlite();
  cleanups.push(() => scratch.drop());
  if (scratch.target.dialect !== "sqlite") throw new Error("sqlite expected");
  const database = openDatabase(scratch.target);
  await migrate(database);
  const { largestSurveyId, ownerId } = await generate(database, {
    users: 3,
    surveys: 5,
    responses: 20,
    largest: 50,
    historyPerSurvey: 20,
    seed: 1,
  });
  const token = newApiTokenValue();
  await database.db
    .insertInto("api_tokens")
    .values({
      id: randomUUID(),
      creator_id: ownerId,
      project_id: null,
      name: "check",
      token_hash: hashCredential(token, "api-token"),
      last_four: lastFour(token),
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked_at: null,
    })
    .execute();
  await database.close();
  const config = loadConfig({
    NODE_ENV: "test",
    STORAGE_PROVIDER: "sqlite",
    SQLITE_PATH: scratch.target.path,
    USER_DIRECTORY: "local",
    AUTH_METHODS: "password",
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD: "first admin password",
    HISTORY_MAX_ENTRIES: "20",
  });
  const app = await buildApp(config, await createProviders(config));
  cleanups.push(() => app.close());
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { base, token, surveyId: largestSurveyId };
}

describe("check", () => {
  it("times each operation against a running server", async () => {
    const { base, token, surveyId } = await served();
    const timings = await check({ base, token, surveyId, runs: 2 });
    expect(timings.map((t) => t.operation)).toEqual([
      "listSurveys",
      "listResults (first page)",
      "exportResults CSV (first byte)",
      "exportResults CSV (total)",
      "saveSurveyDefinition",
    ]);
    for (const t of timings) {
      expect(t.p95Ms).toBeGreaterThanOrEqual(t.p50Ms);
      expect(t.met).toBe(t.p95Ms < t.targetMs);
    }
  });

  it("exits from the targets and prints no ids", async () => {
    const { base, token, surveyId } = await served();
    const result = await run([
      "--base",
      base,
      "--token",
      token,
      "--survey",
      surveyId,
      "--runs",
      "2",
    ]);
    expect(result.err).toBe("");
    expect(result.out.trim().split("\n")).toHaveLength(5);
    expect(result.out).not.toContain(surveyId);
    expect(result.out).not.toContain(token);
    expect(result.code).toBe(result.out.includes("FAIL") ? 1 : 0);
  });

  it("fails on an unknown token", async () => {
    const { base, surveyId } = await served();
    const result = await run(["--base", base, "--token", newApiTokenValue(), "--survey", surveyId]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("401");
  });

  it("is a usage error without a token", async () => {
    const result = await run(["--base", "http://127.0.0.1:1", "--survey", "x"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("usage");
  });
});

describe("helpers", () => {
  it("takes the nearest-rank percentile", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
  });
  it("marks a missed target", () => {
    const line = formatTimings([{ operation: "x", p50Ms: 1, p95Ms: 9, targetMs: 5, met: false }]);
    expect(line).toContain("FAIL");
  });
});
