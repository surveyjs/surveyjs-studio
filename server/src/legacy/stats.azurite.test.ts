import { BlobServiceClient } from "@azure/storage-blob";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { run } from "../cli/inspect-legacy.js";
import { readLegacyFixtures, type LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { loadLegacyFixtures, type LoadSummary } from "./load-fixtures.js";
import { replicaConfig, replicaEnv } from "./replica-env.js";
import { measureLegacyStores } from "./stats-source.js";
import { HISTORY_KEPT, newestHistory, type StatsMeasurements } from "./stats.js";

// Runs in the `providers-azurite` Vitest project, against the local replica. The fixtures are
// loaded again first: the loader resets each fixture table and container to the fixture, while
// other test files may have added surveys, tables and blobs of their own. So the counts of the
// fixture's stores are exact, and the rest is only checked to be there.

let loaded: LoadSummary;
let fixtures: LegacyFixtures;
let measured: StatsMeasurements;

beforeAll(async () => {
  loaded = await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
  fixtures = await readLegacyFixtures();
  measured = await measureLegacyStores(replicaConfig(), { resultBytes: true });
}, 120_000);

const rows = (table: string) => fixtures.rawSqlRows[table] ?? [];

describe("measureLegacyStores on the replica", () => {
  it("counts the SQL rows the loader wrote", () => {
    const projectIds = new Set(rows("Organizations").map((r) => String(r.id).toLowerCase()));
    const surveys = rows("Surveys");
    const themes = surveys.map((r) => r.theme).filter((t): t is string => typeof t === "string");
    expect(measured.sql).toEqual({
      users: loaded.sqlRows.Users,
      usersWithAccessKey: rows("Users").filter(
        (r) => typeof r.accesskey === "string" && r.accesskey,
      ).length,
      blockedUsers: rows("Users").filter((r) => r.blocked === 1).length,
      surveys: loaded.sqlRows.Surveys,
      projectSurveys: surveys.filter((r) => projectIds.has(String(r.userid).toLowerCase())).length,
      archivedSurveys: surveys.filter((r) => r.isarchived === 1).length,
      surveysWithTheme: themes.filter((t) => t.length > 0).length,
      themeBytes: themes.reduce((sum, t) => sum + Buffer.byteLength(t, "latin1"), 0),
      projects: loaded.sqlRows.Organizations,
      memberships: loaded.sqlRows.OrganizationUsers,
    });
  });

  it("measures the one account once: the two storage strings of the replica name the same", () => {
    expect(new Set(measured.tables.map((t) => t.account))).toEqual(new Set(["shared"]));
    expect(new Set(measured.containers.map((c) => c.account))).toEqual(new Set(["shared"]));
  });

  it("counts the rows of every fixture table, the 1,500 generated responses included", () => {
    expect(Object.keys(loaded.tableEntities).length).toBeGreaterThan(0);
    for (const [name, count] of Object.entries(loaded.tableEntities)) {
      expect(measured.tables.find((t) => t.name === name)?.rows, name).toBe(count);
    }
    expect(Math.max(...measured.tables.map((t) => t.rows))).toBeGreaterThanOrEqual(1500);
  });

  it("sums the result text of a response table", () => {
    for (const table of fixtures.tables.filter((t) => /^post[0-9a-f]{32}$/i.test(t.name))) {
      const chars = table.entities.reduce(
        (sum, e) => sum + (typeof e.result === "string" ? e.result.length : 0),
        0,
      );
      expect(measured.tables.find((t) => t.name === table.name)?.resultChars, table.name).toBe(
        chars,
      );
    }
  });

  it("counts the blobs and bytes of every fixture container", () => {
    const byContainer = new Map<string, number[]>();
    for (const blob of fixtures.blobs) {
      byContainer.set(blob.container, [
        ...(byContainer.get(blob.container) ?? []),
        blob.content.length,
      ]);
    }
    for (const [name, sizes] of byContainer) {
      const container = measured.containers.find((c) => c.name === name);
      expect([...(container?.blobSizes ?? [])].sort(), name).toEqual([...sizes].sort());
    }
  });

  it("counts the history points per survey folder", () => {
    const history = measured.containers.find((c) => c.name === "surveyjsonhistory");
    const points = fixtures.blobs.filter((b) => b.container === "surveyjsonhistory");
    expect(history?.rootBlobs).toBe(points.filter((b) => !b.name.includes("/")).length);
    expect(history?.blobsPerFolder.reduce((a, b) => a + b, 0)).toBe(
      points.filter((b) => b.name.includes("/")).length,
    );
  });
});

describe("inspect:legacy --stats on the replica", () => {
  it("prints the summary and no connection string", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ["--stats"],
      { out: (t) => out.push(t), err: (t) => err.push(t) },
      undefined,
      { env: replicaEnv() },
    );
    expect(code).toBe(0);
    const text = out.join("") + err.join("");
    expect(out.join("")).toMatch(/^Responses \(post\*\)\s+\d+ tables/m);
    for (const secret of Object.values(replicaConfig())) expect(text).not.toContain(secret);
  });
});

describe("the newest history entries per survey on the replica", () => {
  it("counts a short survey whole, the newest 20 of a long one, and falls back to last-modified", async () => {
    const config = replicaConfig();
    const container = BlobServiceClient.fromConnectionString(
      config.surveysStorageConnectionString,
    ).getContainerClient("surveyjsonhistory");
    await container.createIfNotExists();
    const before = (await measureLegacyStores(config, { resultBytes: false })).historyKept;
    expect(before).not.toBeNull();

    const short = randomUUID();
    const long = randomUUID();
    const time = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
    const expected: { surveyId: string; at: string; id: string; bytes: number }[] = [];
    const write = async (surveyId: string, content: string, metadata?: Record<string, string>) => {
      const id = randomUUID();
      const blob = container.getBlockBlobClient(`${surveyId}/${id}`);
      await blob.upload(content, content.length, { metadata });
      return { id, blob };
    };
    for (let n = 0; n < 3; n++) {
      const { id } = await write(short, "x".repeat(n + 1), { savedat: time(n) });
      expected.push({ surveyId: short, at: time(n), id, bytes: n + 1 });
    }
    for (let n = 0; n < HISTORY_KEPT + 5; n++) {
      const { id } = await write(long, "y".repeat(n + 1), { savedat: time(n) });
      expected.push({ surveyId: long, at: time(n), id, bytes: n + 1 });
    }
    // Missing and malformed saved-at: the blob's last-modified time (now) is the newest.
    for (const metadata of [undefined, { savedat: "not a time" }]) {
      const { id, blob } = await write(long, "zz", metadata);
      const props = await blob.getProperties();
      expected.push({
        surveyId: long,
        at: props.lastModified!.toISOString(),
        id,
        bytes: 2,
      });
    }

    const after = (await measureLegacyStores(config, { resultBytes: false })).historyKept;
    const delta = newestHistory(expected);
    expect(after!.entries - before!.entries).toBe(delta.entries);
    expect(after!.bytes - before!.bytes).toBe(delta.bytes);
  }, 60_000);
});
