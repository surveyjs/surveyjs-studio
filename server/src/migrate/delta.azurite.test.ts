import type { Readable } from "node:stream";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newFileId } from "../domain/file-id.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { localTableClient } from "../legacy/local-clients.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "../providers/azure-legacy/index.js";
import { readLegacyFixtures, type LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { createStubShareReader } from "../providers/azure-legacy/legacy-shares-stub.js";
import { API_TOKENS_TABLE } from "../providers/azure-legacy/writes.js";
import type { ProviderSet } from "../providers/types.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { runDelta } from "./delta.js";
import { createReport, type Report } from "./map/report.js";
import { isCompleteMarks, MARKS_MARGIN_MS, type HighWaterMarks } from "./marks.js";
import type { PersonRec } from "./records.js";
import { runReconcile } from "./reconcile.js";
import {
  copyFromReplica,
  newTarget,
  openReplicaSource,
  readAll,
  targetProviders,
  type Target,
} from "./replica-setup.js";
import { runVerify } from "./verify.js";

// Runs in the `providers-azurite` Vitest project. After a copy of the golden fixtures the test
// changes the replica through its own clients (mssql, TableClient, BlobServiceClient), as the old
// app would, then runs delta, reconcile and verify. The tool only reads the replica: every row,
// entity and blob is unchanged by its runs (counts, checksums, etags). afterAll reloads the
// golden fixtures and removes what the test wrote outside them.

const config = replicaConfig();
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const OLD_POLL = "22222222-0000-4000-8000-a00000000003";
const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
const RETRO = "22222222-0000-4000-8000-a00000000006";
const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
const API_SURVEY = "22222222-0000-4000-8000-a00000000008";
const FEEDBACK_TABLE = "post33333333000040008000a00000000001";
const FEEDBACK_DELETED = "postdelete33333333000040008000a00000000001";
const CAMPAIGN_TABLE = "post33333333000040008000a00000000004";
const VIEW_USER = "11111111-0000-4000-8000-a0000000f00d";
const NEW_RESPONSE = "66666666-0000-4000-8000-a0000000d001";
const DELETION_COPY = "77777777-0000-4000-8000-a0000000d002";
const GONE_VIEW = `${FEEDBACK}/${VIEW_USER}/table`;
const NEW_VIEW = `${CAMPAIGN}/${VIEW_USER}/summary`;
const GONE_FILE = newFileId(FEEDBACK);
const POLL_FILE = newFileId(OLD_POLL);
const NEW_FILE = newFileId(CAMPAIGN);
const FILES = "my-surveys-files";
const VIEWS = "my-surveys-views";

const blobs = BlobServiceClient.fromConnectionString(config.surveysStorageConnectionString);
const results = (table: string) =>
  localTableClient(
    config.resultsStorageConnectionString,
    table,
    "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
  );
const tokens = localTableClient(
  config.surveysStorageConnectionString,
  API_TOKENS_TABLE,
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
);

let fixtures: LegacyFixtures;
let copied: Target;
let pool: sql.ConnectionPool;
let legacy: ProviderSet;
let migrated: ProviderSet;
/** Blobs the test wrote in containers the fixture loader does not clear. */
const written: [string, string][] = [];
/** Users' editor files of no survey other tests left; the copy takes none, verify flags any. */
let userFiles: { name: string; content: Buffer; metadata: Record<string, string> }[] = [];
let goneResponseId: string;
let campaignDefinition: Record<string, unknown>;

async function putBlob(
  container: string,
  name: string,
  content: string,
  metadata?: Record<string, string>,
) {
  const client = blobs.getContainerClient(container);
  await client.createIfNotExists();
  await client.getBlockBlobClient(name).uploadData(Buffer.from(content), { metadata });
  if (container === FILES) written.push([container, name]);
}

const fileMetadata = (name: string) => ({
  kind: "asset",
  name,
  createdat: "2026-11-01T10:00:00.000Z",
});

/**
 * Every row, entity and blob of the replica, by store, as counts and change stamps (SQL
 * checksums, entity and blob etags): what the tool must leave exactly as it is.
 */
async function replicaState(): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const table of [
    "Users",
    "Surveys",
    "Organizations",
    "OrganizationUsers",
    "UserLicenses",
    "LicenseTransfers",
  ]) {
    const { recordset } = await pool
      .request()
      .query<{ n: number; sum: number | null }>(
        `SELECT COUNT(*) AS n, CHECKSUM_AGG(BINARY_CHECKSUM(*)) AS sum FROM ${table}`,
      );
    state[`sql:${table}`] = recordset[0];
  }
  const tables = new Set(fixtures.tables.map((t) => `${t.account}/${t.name}`));
  tables.add(`results/${FEEDBACK_DELETED}`);
  for (const key of tables) {
    const [account, name] = key.split("/") as [string, string];
    const client = localTableClient(
      account === "results"
        ? config.resultsStorageConnectionString
        : config.surveysStorageConnectionString,
      name,
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    );
    const stamps: string[] = [];
    for await (const row of client.listEntities()) stamps.push(`${row.rowKey}:${row.etag}`);
    state[`table:${key}`] = stamps.sort();
  }
  for await (const container of blobs.listContainers()) {
    const stamps: string[] = [];
    for await (const blob of blobs.getContainerClient(container.name).listBlobsFlat()) {
      stamps.push(`${blob.name}:${blob.properties.etag}`);
    }
    state[`blobs:${container.name}`] = stamps.sort();
  }
  return state;
}

const run = async <T>(work: (source: ReturnType<typeof openReplicaSource>) => Promise<T>) => {
  const source = openReplicaSource(fixtures);
  try {
    return await work(source);
  } finally {
    await source.close();
  }
};

async function verifyAll(): Promise<{ ok: boolean; json: { differences: unknown[] } }> {
  const report = createReport();
  const { ok } = await run((source) =>
    runVerify(source, legacy, migrated, copied.target, {
      full: true,
      deepSample: fixtures.surveys.length,
      report,
    }),
  );
  return { ok, json: JSON.parse(JSON.stringify(report.toJSON())) as { differences: unknown[] } };
}

/** Every row of every copied table (sorted) and every file's bytes, as one text. */
async function dumpOf({ database, bytes }: Target): Promise<string> {
  const out: Record<string, string[]> = {};
  for (const table of [
    "surveys",
    "survey_history",
    "survey_responses",
    "completion_markers",
    "saved_views",
    "survey_layouts",
    "private_questions",
    "projects",
    "project_members",
    "files",
    "legacy_files",
    "users",
    "user_identities",
    "legacy_access_keys",
    "survey_events",
    "deleted_responses",
  ] as const satisfies readonly (keyof DatabaseSchema)[]) {
    const rows = await database.db.selectFrom(table).selectAll().execute();
    out[table] = rows.map((row) => JSON.stringify(row)).sort();
  }
  const stored: Record<string, string> = {};
  for (const row of await database.db.selectFrom("files").selectAll().execute()) {
    const stream = await bytes.store.get(`${row.survey_id}/${row.id}`);
    stored[row.id] = stream ? (await readAll(stream)).toString("base64") : "missing";
  }
  return JSON.stringify({ out, stored });
}

const bytesOf = async (key: string): Promise<Buffer | null> => {
  const stream: Readable | null = await copied.bytes.store.get(key);
  return stream ? readAll(stream) : null;
};

beforeAll(async () => {
  fixtures = await readLegacyFixtures();
  pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
  // Green needs the stores the copy does not take empty: the provider's token rows (fixtures,
  // reloaded afterwards) and users' editor files of no survey (put back afterwards).
  for await (const row of tokens.listEntities()) {
    await tokens.deleteEntity(String(row.partitionKey), String(row.rowKey));
  }
  const files = blobs.getContainerClient(FILES);
  await files.createIfNotExists();
  for await (const blob of files.listBlobsFlat({ includeMetadata: true, prefix: "uploads/" })) {
    userFiles.push({
      name: blob.name,
      content: await files.getBlobClient(blob.name).downloadToBuffer(),
      metadata: blob.metadata ?? {},
    });
  }
  for (const { name } of userFiles) await files.deleteBlob(name);

  // Before the copy: a view and Studio's own files that the source later loses (or keeps for a
  // survey it deletes, as the old app leaves a deleted survey's files).
  await putBlob(VIEWS, GONE_VIEW, '{"columns":[]}');
  await putBlob(FILES, `${FEEDBACK}/${GONE_FILE}`, "gone bytes", fileMetadata("gone.png"));
  await putBlob(FILES, `${OLD_POLL}/${POLL_FILE}`, "poll bytes", fileMetadata("poll.png"));
  // Blob times are whole seconds: written a second before the marks, they count as before them.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  copied = await newTarget();
  // No margin: the marks are the copy's start, so every change below comes after them.
  await copyFromReplica(copied, fixtures, { marginMs: 0 });
  legacy = createAzureLegacyProviders(config, {
    legacyShares: createStubShareReader(fixtures.files),
  });
  migrated = targetProviders(copied);
}, 180_000);

afterAll(async () => {
  try {
    await migrated?.close();
    await legacy?.close();
    await copied?.close();
    for (const [container, name] of written) {
      await blobs
        .getContainerClient(container)
        .deleteBlob(name)
        .catch(() => undefined);
    }
    for (const { name, content, metadata } of userFiles) {
      await blobs.getContainerClient(FILES).getBlockBlobClient(name).uploadData(content, {
        metadata,
      });
    }
    userFiles = [];
    await pool?.close();
  } finally {
    // The SQL rows, fixture tables (tokens and the deletion copies included) and fixture blobs.
    await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
  }
}, 180_000);

describe("delta and reconcile from the high-water marks", () => {
  it("takes the source's own marks, a margin back, when copy starts", async () => {
    const fresh = await newTarget();
    try {
      const before = Date.now();
      await copyFromReplica(fresh, fixtures, { now: () => new Date(before) });
      const marks = await fresh.target.state.get<HighWaterMarks>("marks");
      expect(isCompleteMarks(marks)).toBe(true);
      // The services' clocks, a margin back; the SQL marks the latest fixture row's, a margin back.
      expect(Date.parse(marks!.tables)).toBeLessThanOrEqual(before - MARKS_MARGIN_MS);
      expect(Date.parse(marks!.blobs)).toBeLessThanOrEqual(before - MARKS_MARGIN_MS);
      const latest = Math.max(...fixtures.surveys.map((s) => s.timestamp?.getTime() ?? 0));
      expect(marks!.sql.surveys).toBe(new Date(latest - MARKS_MARGIN_MS).toISOString());
    } finally {
      await fresh.close();
    }
  }, 120_000);

  it("copies what changed and removes what is gone; verify is green, the replica untouched", async () => {
    // ---- The old app's changes, after the marks ----
    const now = new Date();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, CAMPAIGN)
      .input("now", sql.DateTime, now)
      .query("UPDATE Surveys SET name = 'Campaign renamed', [timestamp] = @now WHERE id = @id");
    // A row with no change time is read by every delta.
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, API_SURVEY)
      .query("UPDATE Surveys SET name = 'API renamed', [timestamp] = NULL WHERE id = @id");
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, OLD_POLL)
      .query("DELETE FROM Surveys WHERE id = @id");
    const definition = fixtures.blobs.find(
      (b) => b.container === "surveyjson" && b.name === CAMPAIGN,
    )!;
    campaignDefinition = {
      ...(JSON.parse(definition.content.toString("utf8")) as Record<string, unknown>),
      title: "Campaign edited",
    };
    await putBlob("surveyjson", CAMPAIGN, JSON.stringify(campaignDefinition));
    await results(CAMPAIGN_TABLE).createEntity({
      partitionKey: "*",
      rowKey: NEW_RESPONSE,
      id: NEW_RESPONSE,
      happendat: now,
      result: JSON.stringify({ satisfaction: 4, extraanswer: "late" }),
    });
    await putBlob("surveyresulttablestate", RETRO, '{"columns":[]}');
    // One response deleted, as the old app does: its copy first, then the row.
    const gone = fixtures.tables
      .find((t) => t.account === "results" && t.name === FEEDBACK_TABLE)!
      .entities.at(-1)!;
    goneResponseId = String(gone.RowKey).toLowerCase();
    await results(FEEDBACK_DELETED).createTable();
    await results(FEEDBACK_DELETED).createEntity({
      partitionKey: "*",
      rowKey: DELETION_COPY,
      id: DELETION_COPY,
      instanceid: String(gone.RowKey),
      happendat: now,
      result: String(gone.result),
    });
    await results(FEEDBACK_TABLE).deleteEntity(String(gone.PartitionKey), String(gone.RowKey));
    await blobs.getContainerClient(VIEWS).deleteBlob(GONE_VIEW);
    await putBlob(VIEWS, NEW_VIEW, '{"panels":[]}');
    await blobs.getContainerClient(FILES).deleteBlob(`${FEEDBACK}/${GONE_FILE}`);
    await putBlob(FILES, `${CAMPAIGN}/${NEW_FILE}`, "new bytes", fileMetadata("new.png"));

    // ---- delta, reconcile, verify ----
    const before = await replicaState();
    const report: Report = createReport();
    await run((source) => runDelta(source, copied.target, { report, marginMs: 0, concurrency: 4 }));
    const reconciled = createReport();
    await run((source) =>
      runReconcile(source, copied.target, { report: reconciled, full: false, marginMs: 0 }),
    );
    const { ok, json } = await verifyAll();
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    expect(await replicaState()).toEqual(before);

    // ---- The changes, through the target's providers ----
    expect((await migrated.surveys.getSurvey(CAMPAIGN))?.name).toBe("Campaign renamed");
    expect((await migrated.surveys.getDefinition(CAMPAIGN))?.content).toEqual(campaignDefinition);
    expect((await migrated.surveys.getSurvey(API_SURVEY))?.name).toBe("API renamed");
    expect(report.toJSON()).toMatchObject({
      notes: expect.arrayContaining([
        { kind: "change_time_missing", ids: { table: "surveys", id: API_SURVEY } },
      ]),
    });
    const campaign = (await migrated.surveys.getSurvey(CAMPAIGN))!;
    expect(await migrated.results.hasResponse(campaign, NEW_RESPONSE)).toBe(true);
    expect(await migrated.views.getLayout(RETRO, "table")).toBe('{"columns":[]}');
    expect(await migrated.surveys.getSurvey(OLD_POLL)).toBeNull();
    const feedback = (await migrated.surveys.getSurvey(FEEDBACK))!;
    expect(await migrated.results.hasResponse(feedback, goneResponseId)).toBe(false);
    expect(
      await copied.target.existingKeys("deleted_responses", [goneResponseId], FEEDBACK),
    ).toEqual([goneResponseId]);
    const views = await copied.target.keysOf("saved_views");
    expect(views).toContain(NEW_VIEW);
    expect(views).not.toContain(GONE_VIEW);
    // Studio's own files: the new one copied; the one deleted and the removed survey's gone,
    // bytes included.
    const files = await copied.target.keysOf("files");
    expect(files).toContain(NEW_FILE);
    expect(files).not.toContain(GONE_FILE);
    expect(files).not.toContain(POLL_FILE);
    expect((await bytesOf(`${CAMPAIGN}/${NEW_FILE}`))?.toString()).toBe("new bytes");
    expect(await bytesOf(`${FEEDBACK}/${GONE_FILE}`)).toBeNull();
    expect(await bytesOf(`${OLD_POLL}/${POLL_FILE}`)).toBeNull();
    expect(reconciled.toJSON()).toMatchObject({
      notes: expect.arrayContaining([
        { kind: "reconcile_removed_survey", ids: { surveyId: OLD_POLL } },
      ]),
    });
  }, 180_000);

  it("removes the responses and markers of a survey whose responses were all deleted", async () => {
    // As the old app deletes them all: the rows go (the tables stay), then its audit event.
    const markers = results(`SurveyCompletion${CAMPAIGN.replaceAll("-", "")}`);
    for (const table of [results(CAMPAIGN_TABLE), markers]) {
      for await (const row of table.listEntities()) {
        await table.deleteEntity(String(row.partitionKey), String(row.rowKey));
      }
    }
    const eventId = "77777777-0000-4000-8000-a0000000d003";
    await localTableClient(
      config.surveysStorageConnectionString,
      "surveys",
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    ).createEntity({
      partitionKey: "*",
      rowKey: eventId,
      id: { type: "Guid", value: eventId },
      type: "SURVEY_DELETEALLRESULTS",
      happendat: { type: "DateTime", value: new Date().toISOString() },
      surveyid: { type: "Guid", value: CAMPAIGN },
    });
    expect(await copied.target.countRows("survey_responses", CAMPAIGN)).toBeGreaterThan(0);
    expect(await copied.target.countRows("completion_markers", CAMPAIGN)).toBeGreaterThan(0);

    await run((source) => runDelta(source, copied.target, { report: createReport(), marginMs: 0 }));
    await run((source) =>
      runReconcile(source, copied.target, { report: createReport(), full: false, marginMs: 0 }),
    );
    expect(await copied.target.countRows("survey_responses", CAMPAIGN)).toBe(0);
    expect(await copied.target.countRows("completion_markers", CAMPAIGN)).toBe(0);
    const { ok, json } = await verifyAll();
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
  }, 180_000);

  it("moves the surveys of a project left without members to their creator", async () => {
    // Deleted member rows leave no change time: only reconcile can see it.
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, ENGINEERING)
      .query("DELETE FROM OrganizationUsers WHERE organizationid = @id");
    expect((await migrated.surveys.getSurvey(RETRO))?.owner).toEqual({
      kind: "project",
      projectId: ENGINEERING,
    });
    const report = createReport();
    await run((source) => runDelta(source, copied.target, { report: createReport(), marginMs: 0 }));
    await run((source) =>
      runReconcile(source, copied.target, { report, full: false, marginMs: 0 }),
    );
    const creator = fixtures.surveys.find((s) => s.id.toLowerCase() === RETRO)!.creatorid!;
    expect((await migrated.surveys.getSurvey(RETRO))?.owner).toEqual({
      kind: "personal",
      userId: creator.toLowerCase(),
    });
    expect(await migrated.projects.getProject(ENGINEERING)).toBeNull();
    expect(report.toJSON()).toMatchObject({
      notes: expect.arrayContaining([
        { kind: "reconcile_removed_project", ids: { projectId: ENGINEERING } },
        { kind: "reconcile_remapped_survey", ids: { surveyId: RETRO } },
      ]),
    });
    const { ok, json } = await verifyAll();
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
  }, 180_000);

  it("drops a layout, and the private questions of a permissions blob, deleted in the source", async () => {
    const step = async () => {
      await run((source) =>
        runDelta(source, copied.target, { report: createReport(), marginMs: 0 }),
      );
      await run((source) =>
        runReconcile(source, copied.target, { report: createReport(), full: false, marginMs: 0 }),
      );
    };
    // The campaign survey has no column layout: its private questions come from permissions only.
    await putBlob("surveyresultpermissions", CAMPAIGN, '[{"name":"receipt","isPublic":false}]');
    await step();
    expect(await copied.target.privateQuestionsOf(CAMPAIGN)).toEqual(["receipt"]);

    expect(await migrated.views.getLayout(FEEDBACK, "summary")).not.toBeNull();
    await blobs.getContainerClient("surveyresultsummarystate").deleteBlob(FEEDBACK);
    await blobs.getContainerClient("surveyresultpermissions").deleteBlob(CAMPAIGN);
    await step();
    expect(await migrated.views.getLayout(FEEDBACK, "summary")).toBeNull();
    expect(await migrated.views.getLayout(FEEDBACK, "table")).not.toBeNull();
    expect(await copied.target.privateQuestionsOf(CAMPAIGN)).toEqual([]);
    const { ok, json } = await verifyAll();
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
  }, 180_000);

  it("removes only pre-created accounts nobody used; an admin and a sign-in account stay", async () => {
    const db = copied.database.db;
    const person = (id: string): PersonRec => ({
      id,
      email: `${id}@example.com`,
      displayName: id,
      siteBlocked: false,
      createdAt: new Date().toISOString(),
    });
    const seeded = "11111111-0000-4000-8000-a0000000d101";
    const admin = "11111111-0000-4000-8000-a0000000d102";
    const created = "11111111-0000-4000-8000-a0000000d103";
    await copied.target.upsertPeople([person(seeded), person(admin), person(created)]);
    await db.updateTable("users").set({ instance_role: "admin" }).where("id", "=", admin).execute();
    // An account made at sign-in: its identity is another provider's.
    await db
      .updateTable("user_identities")
      .set({ provider: "google", subject: "google-subject" })
      .where("user_id", "=", created)
      .execute();
    try {
      const report = createReport();
      await run((source) =>
        runReconcile(source, copied.target, { report, full: false, marginMs: 0 }),
      );
      const users = await copied.target.idsOf("users");
      expect(users).not.toContain(seeded);
      expect(users).toContain(admin);
      expect(users).toContain(created);
      expect(report.toJSON()).toMatchObject({
        notes: expect.arrayContaining([
          { kind: "reconcile_removed_person", ids: { userId: seeded } },
          { kind: "person_kept_unseeded", ids: { userId: admin } },
          { kind: "person_kept_unseeded", ids: { userId: created } },
        ]),
      });
    } finally {
      await copied.target.deletePeople([seeded, admin, created]);
    }
  }, 180_000);

  it("changes nothing when run again with nothing new", async () => {
    const once = await dumpOf(copied);
    const before = await replicaState();
    await run((source) => runDelta(source, copied.target, { report: createReport(), marginMs: 0 }));
    await run((source) =>
      runReconcile(source, copied.target, { report: createReport(), full: true, marginMs: 0 }),
    );
    expect(await dumpOf(copied)).toBe(once);
    expect(await replicaState()).toEqual(before);
  }, 180_000);
});
