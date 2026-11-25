import { BlobServiceClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newFileId } from "../domain/file-id.js";
import { localTableClient } from "../legacy/local-clients.js";
import { replicaConfig } from "../legacy/replica-env.js";
import { createAzureLegacyProviders } from "../providers/azure-legacy/index.js";
import { readLegacyFixtures, type LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import {
  largeSurveyAnswers,
  LARGE_SURVEY_ID,
  LARGE_SURVEY_RESPONSES,
} from "../providers/azure-legacy/large-survey.js";
import { createStubShareReader } from "../providers/azure-legacy/legacy-shares-stub.js";
import { API_TOKENS_TABLE } from "../providers/azure-legacy/writes.js";
import { LEGACY_ASSET_NAME, OUTSIDER_ID, OWNER_ID } from "../providers/suite/expected.js";
import type { ProviderSet } from "../providers/types.js";
import { jsonText } from "../sql/values.js";
import { runDelta } from "./delta.js";
import { createReport } from "./map/report.js";
import { runReconcile } from "./reconcile.js";
import {
  copyFromReplica,
  marksAt,
  newTarget,
  openReplicaSource,
  targetProviders,
  type Target,
} from "./replica-setup.js";
import { selectSample, type SampleSet } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import { Refused } from "./state.js";
import { runVerify } from "./verify.js";

// Runs in the `providers-azurite` Vitest project, against the golden fixtures in the replica. The
// tests change the target to make `verify` red and put every change back; what they write to the
// replica (a response, a blob, the provider's own token rows) is removed or restored afterwards.

const config = replicaConfig();
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
const FEEDBACK_TABLE = "post33333333000040008000a00000000001";
const CAMPAIGN_TABLE = "post33333333000040008000a00000000004";

interface Finding {
  check: string;
  ids: Record<string, string>;
}
interface VerifyJson {
  notes: { kind: string; ids: Record<string, string> }[];
  durations: Record<string, number>;
  checks: Record<string, { compared: number; differences: number; pending: number }>;
  differences: Finding[];
  pending: Finding[];
}

let fixtures: LegacyFixtures;
let copied: Target;
let legacy: ProviderSet;
let migrated: ProviderSet;
const blobs = BlobServiceClient.fromConnectionString(config.surveysStorageConnectionString);
const tokens = localTableClient(
  config.surveysStorageConnectionString,
  API_TOKENS_TABLE,
  "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
);
/** The provider's own token rows the fixtures hold, taken out for the green runs. */
let tokenRows: Record<string, unknown>[] = [];
const files = blobs.getContainerClient("my-surveys-files");
/** Users' editor files of no survey other tests left in the replica, taken out likewise. */
let userFiles: {
  name: string;
  content: Buffer;
  metadata: Record<string, string>;
  type?: string;
}[] = [];

const VIEW_USER = "11111111-0000-4000-8000-a0000000f00d";
const OWN_FILE = newFileId(FEEDBACK);
const written: [string, string][] = [];
async function putBlob(
  container: string,
  name: string,
  content: string,
  metadata?: Record<string, string>,
) {
  const client = blobs.getContainerClient(container);
  await client.createIfNotExists();
  await client.getBlockBlobClient(name).uploadData(Buffer.from(content), { metadata });
  written.push([container, name]);
}

async function verify(
  options: {
    full?: boolean;
    deepSample?: number;
    deepMaxResponses?: number;
    sample?: SampleSet;
    into?: Target;
    /** Wraps the source (a test counting its reads). */
    wrap?: (source: LegacySource) => LegacySource;
  } = {},
): Promise<{ ok: boolean; json: VerifyJson; text: string }> {
  const report = createReport();
  const opened = openReplicaSource(fixtures);
  const source = options.wrap ? options.wrap(opened) : opened;
  const into = options.into ?? copied;
  const providers = into === copied ? migrated : targetProviders(into);
  try {
    const { ok } = await runVerify(source, legacy, providers, into.target, {
      full: options.full ?? true,
      deepSample: options.deepSample ?? fixtures.surveys.length,
      report,
      ...(options.sample && { sample: options.sample }),
      ...(options.deepMaxResponses !== undefined && {
        deepMaxResponses: options.deepMaxResponses,
      }),
    });
    const text = JSON.stringify(report.toJSON());
    return { ok, json: JSON.parse(text) as VerifyJson, text };
  } finally {
    await opened.close();
    // Not closed: closing the SQL providers closes the database, which the test target owns.
  }
}

const findings = (list: Finding[], check: string) => list.filter((f) => f.check === check);

/** Every string among the fixtures' answers (and the generated survey's), as stored. */
function answerTexts(): string[] {
  const texts = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") texts.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk);
  };
  for (const rows of Object.values(fixtures.resultsByTable)) {
    for (const row of rows) walk(JSON.parse(row.result));
  }
  for (let n = 1; n <= LARGE_SURVEY_RESPONSES; n += 1) walk(largeSurveyAnswers(n));
  // Short strings could match an id or a check name by chance; the rest are content.
  return [...texts].filter((text) => text.length >= 4);
}

beforeAll(async () => {
  fixtures = await readLegacyFixtures();
  // The fixtures hold a key revocation of the provider's own table, and other tests leave users'
  // editor files of no survey; the copy takes neither, so green needs both stores empty (tests
  // below put one of each back and expect red).
  for await (const row of tokens.listEntities<Record<string, unknown>>()) {
    tokenRows.push(
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "etag" && key !== "timestamp"),
      ),
    );
  }
  for (const row of tokenRows) {
    await tokens.deleteEntity(String(row.partitionKey), String(row.rowKey));
  }
  await files.createIfNotExists();
  for await (const blob of files.listBlobsFlat({ includeMetadata: true, prefix: "uploads/" })) {
    userFiles.push({
      name: blob.name,
      content: await files.getBlobClient(blob.name).downloadToBuffer(),
      metadata: blob.metadata ?? {},
      ...(blob.properties.contentType && { type: blob.properties.contentType }),
    });
  }
  for (const { name } of userFiles) await files.deleteBlob(name);
  // A user's own view and an editor file of a survey in Studio's own containers, so their counts
  // compare something (removed afterwards).
  await putBlob("my-surveys-views", `${FEEDBACK}/${VIEW_USER}/summary`, '{"panels":[]}');
  await putBlob("my-surveys-files", `${FEEDBACK}/${OWN_FILE}`, "own bytes", {
    kind: "asset",
    name: "logo.png",
    createdat: "2026-11-01T10:00:00.000Z",
  });
  legacy = createAzureLegacyProviders(config, {
    legacyShares: createStubShareReader(fixtures.files),
  });
  // Blob times are whole seconds: written a second before the marks, they count as before them.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  copied = await newTarget();
  // The real clock and no margin: the marks are now, so a row written to the replica later is
  // after them.
  await copyFromReplica(copied, fixtures, { marginMs: 0 });
  migrated = targetProviders(copied);
});

afterAll(async () => {
  for (const row of tokenRows) {
    await tokens.upsertEntity(row as { partitionKey: string; rowKey: string }, "Replace");
  }
  tokenRows = [];
  for (const { name, content, metadata, type } of userFiles) {
    await files.getBlockBlobClient(name).uploadData(content, {
      metadata,
      ...(type && { blobHTTPHeaders: { blobContentType: type } }),
    });
  }
  userFiles = [];
  for (const [container, name] of written) {
    await blobs
      .getContainerClient(container)
      .deleteBlob(name)
      .catch(() => undefined);
  }
  await migrated?.close();
  await legacy?.close();
  await copied?.close();
});

describe("verify against a copy of the local replica", () => {
  it("is green right after copy, every check run", async () => {
    const { ok, json } = await verify();
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    for (const check of [
      "surveys",
      "projects",
      "members",
      "people",
      "keys",
      "definitions",
      "themes",
      "history",
      "layouts",
      "private_questions",
      "response_counts",
      "deep_surveys",
      "deep_definitions",
      "deep_themes",
      "deep_history",
      "deep_layouts",
      "responses",
      "legacy_files",
      "identities",
      "markers",
      "views",
      "events",
      "deleted_responses",
      "own_files",
      "legacy_file_count",
    ]) {
      expect(json.checks[check]?.compared, check).toBeGreaterThan(0);
    }
    expect(json.checks.surveys!.compared).toBe(fixtures.surveys.length);
    expect(json.checks.responses!.compared).toBe(fixtures.surveys.length);
    // Each phase's duration, for timing the window.
    for (const phase of ["stores", "people", "projects", "surveys", "tables"]) {
      expect(json.durations[phase], phase).toBeGreaterThanOrEqual(0);
    }
  });

  it("lists no unchanged survey's history incrementally, and queries only the tables that exist", async () => {
    const history: string[] = [];
    const queried: string[] = [];
    let tableLists = 0;
    let tables = new Set<string>();
    const counting = (source: LegacySource): LegacySource => ({
      ...source,
      historyEntries: (surveyId) => {
        history.push(surveyId);
        return source.historyEntries(surveyId);
      },
      historyNewest: (surveyId, keep) => {
        history.push(surveyId);
        return source.historyNewest(surveyId, keep);
      },
      resultTables: async () => {
        tableLists += 1;
        tables = await source.resultTables();
        return tables;
      },
      responses: (postId, since) => {
        queried.push(`post${postId.replaceAll("-", "").toLowerCase()}`);
        return source.responses(postId, since);
      },
      deletedCopies: (postId, since) => {
        queried.push(`postdelete${postId.replaceAll("-", "").toLowerCase()}`);
        return source.deletedCopies(postId, since);
      },
    });
    const { ok, json } = await verify({ full: false, wrap: counting });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    expect(history).toEqual([]);
    expect(tableLists).toBe(1);
    expect(queried.length).toBeGreaterThan(0);
    for (const table of queried) expect(tables.has(table), table).toBe(true);
  });

  it("is red when a partial response is gone from the target (every row is counted, not only the complete ones)", async () => {
    const db = copied.database.db;
    const gone = await db
      .selectFrom("survey_responses")
      .selectAll()
      .where("partial", "=", 1)
      .orderBy("id")
      .executeTakeFirstOrThrow();
    await db.deleteFrom("survey_responses").where("id", "=", gone.id).execute();
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "response_counts")).toEqual([
        expect.objectContaining({ ids: { surveyId: gone.survey_id } }),
      ]);
    } finally {
      await db
        .insertInto("survey_responses")
        .values(gone as never)
        .execute();
    }
  });

  it("accepts stored private questions that keep a name only deleted responses used, never fewer", async () => {
    const before = await copied.target.privateQuestionsOf(FEEDBACK);
    const key = `survey:${FEEDBACK}`;
    const checkpoint = await copied.target.state.get<{ copiedAt: string; answerNames: string[] }>(
      key,
    );
    expect(checkpoint).not.toBeNull();
    const at = new Date().toISOString();
    try {
      // A name a deleted response carried: still in the checkpoint and the stored list.
      await copied.target.state.set(
        key,
        { ...checkpoint!, answerNames: [...checkpoint!.answerNames, "gone_answer"] },
        at,
      );
      await copied.target.setPrivateQuestions(FEEDBACK, [...before, "gone_answer"]);
      const kept = await verify({ deepSample: 0 });
      expect(kept.json.differences).toEqual([]);
      expect(kept.ok).toBe(true);
      expect(kept.json.notes).toContainEqual({
        kind: "private_questions_superset",
        ids: { surveyId: FEEDBACK },
      });
      // A name no response carried is a difference; so is a computed name the list lacks.
      await copied.target.setPrivateQuestions(FEEDBACK, [...before, "never_an_answer"]);
      const unknown = await verify({ deepSample: 0 });
      expect(findings(unknown.json.differences, "private_questions")).toHaveLength(1);
      await copied.target.setPrivateQuestions(FEEDBACK, [...before.slice(1), "gone_answer"]);
      const fewer = await verify({ deepSample: 0 });
      expect(findings(fewer.json.differences, "private_questions")).toHaveLength(1);
    } finally {
      await copied.target.state.set(key, checkpoint, at);
      await copied.target.setPrivateQuestions(FEEDBACK, before);
    }
  });

  it("is green incrementally after a full verify, and refuses without one", async () => {
    expect((await verify({ full: false })).ok).toBe(true);
    const stored = await copied.target.state.get("verify:full");
    expect(stored).not.toBeNull();
    await copied.target.state.delete("verify:full");
    try {
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "full_verify")).toHaveLength(1);
    } finally {
      await copied.target.state.set("verify:full", stored, new Date().toISOString());
    }
  });

  it("is red, naming the survey and the check, when one response's data differs", async () => {
    const id = fixtures.resultsByTable[FEEDBACK_TABLE]![0]!.id.toLowerCase();
    const db = copied.database.db;
    const row = await db
      .selectFrom("survey_responses")
      .select("data")
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    await db
      .updateTable("survey_responses")
      .set({ data: jsonText(copied.database.dialect, { changed: 1 }) })
      .where("id", "=", id)
      .execute();
    try {
      const { ok, json, text } = await verify();
      expect(ok).toBe(false);
      expect(findings(json.differences, "responses")).toEqual([
        expect.objectContaining({ ids: expect.objectContaining({ surveyId: FEEDBACK }) }),
      ]);
      // Rule 6: ids and counts only, never an answer.
      for (const answer of answerTexts()) expect(text, answer).not.toContain(answer);
    } finally {
      await db
        .updateTable("survey_responses")
        .set({ data: row.data as string })
        .where("id", "=", id)
        .execute();
    }
  });

  it("is red, naming the survey and the check, when one history entry is gone", async () => {
    const db = copied.database.db;
    const row = await db
      .selectFrom("survey_history")
      .selectAll()
      .where("survey_id", "=", FEEDBACK)
      .orderBy("id")
      .executeTakeFirstOrThrow();
    await db.deleteFrom("survey_history").where("id", "=", row.id).execute();
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "history")).toEqual([
        expect.objectContaining({ ids: expect.objectContaining({ surveyId: FEEDBACK }) }),
      ]);
    } finally {
      const at = row.at instanceof Date ? row.at.toISOString() : row.at;
      await db
        .insertInto("survey_history")
        .values({ ...row, at, snapshot: row.snapshot as string })
        .execute();
    }
  });

  it("is red, naming the survey and the check, when one private question is flipped", async () => {
    const before = await copied.target.privateQuestionsOf(FEEDBACK);
    expect(before.length).toBeGreaterThan(0);
    const db = copied.database.db;
    const names = (list: string[]) => jsonText(copied.database.dialect, list);
    await db
      .updateTable("private_questions")
      .set({ names: names(before.slice(1)) })
      .where("survey_id", "=", FEEDBACK)
      .execute();
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "private_questions")).toEqual([
        expect.objectContaining({ ids: expect.objectContaining({ surveyId: FEEDBACK }) }),
      ]);
    } finally {
      await db
        .updateTable("private_questions")
        .set({ names: names(before) })
        .where("survey_id", "=", FEEDBACK)
        .execute();
    }
  });

  it("compares the small tables in full incrementally: a renamed survey is red", async () => {
    const db = copied.database.db;
    const { name } = await db
      .selectFrom("surveys")
      .select("name")
      .where("id", "=", CAMPAIGN)
      .executeTakeFirstOrThrow();
    await db.updateTable("surveys").set({ name: "renamed" }).where("id", "=", CAMPAIGN).execute();
    try {
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "surveys")).toEqual([
        expect.objectContaining({ ids: { surveyId: CAMPAIGN } }),
      ]);
    } finally {
      await db.updateTable("surveys").set({ name }).where("id", "=", CAMPAIGN).execute();
    }
  });

  it("compares a survey changed since the last full verify in full; after the marks it is pending", async () => {
    const marks = await copied.target.state.get<{ takenAt: string }>("marks");
    await blobs.getContainerClient("surveyresulttablestate").createIfNotExists();
    const layout = blobs.getContainerClient("surveyresulttablestate").getBlockBlobClient(CAMPAIGN);
    await layout.uploadData(Buffer.from('{"columns":[]}'));
    try {
      // After the marks: not copied yet, so pending.
      const before = await verify({ full: false });
      expect(before.json.differences).toEqual([]);
      expect(before.json.pending).toContainEqual({
        check: "layouts",
        ids: { surveyId: CAMPAIGN, kind: "table" },
      });
      // Marks taken after the change (blob times are whole seconds) and nothing copied: red.
      const later = new Date(Math.floor(Date.now() / 1000) * 1000 + 2000).toISOString();
      await copied.target.state.set("marks", marksAt(later), later);
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "layouts")).toEqual([
        expect.objectContaining({ ids: { surveyId: CAMPAIGN, kind: "table" } }),
      ]);
    } finally {
      await layout.deleteIfExists();
      await copied.target.state.set("marks", marks, new Date().toISOString());
    }
  });

  it("lists a response added to the source after the marks as pending and stays green; before them it is missing", async () => {
    const table = localTableClient(
      config.resultsStorageConnectionString,
      CAMPAIGN_TABLE,
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    );
    const marks = await copied.target.state.get<{ takenAt: string }>("marks");
    const rowId = "66666666-0000-4000-8000-a0000000cafe";
    const answer = "an answer written after the marks";
    await table.createEntity({
      partitionKey: "*",
      rowKey: rowId,
      id: rowId,
      happendat: new Date(),
      result: JSON.stringify({ satisfaction: 5, remark: answer }),
    });
    try {
      for (const full of [true, false]) {
        const { ok, json, text } = await verify({ full });
        expect(json.differences, `full: ${String(full)}`).toEqual([]);
        expect(ok).toBe(true);
        expect(json.pending).toContainEqual({
          check: "responses",
          ids: { surveyId: CAMPAIGN, responseId: rowId },
        });
        expect(text).not.toContain(answer);
      }
      // Marks taken after it and the row not copied: the window's verify counts it missing.
      const later = new Date(Date.now() + 1000).toISOString();
      await copied.target.state.set("marks", marksAt(later), later);
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "new_responses")).toEqual([
        { check: "new_responses", ids: { surveyId: CAMPAIGN }, counts: { source: 1, missing: 1 } },
      ]);
    } finally {
      await table.deleteEntity("*", rowId).catch(() => undefined);
      await copied.target.state.set("marks", marks, new Date().toISOString());
    }
  });

  it("counts the responses before the marks exactly, also when a survey has rows after them", async () => {
    const table = localTableClient(
      config.resultsStorageConnectionString,
      CAMPAIGN_TABLE,
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    );
    const lateId = "66666666-0000-4000-8000-a0000000cab1";
    await table.createEntity({
      partitionKey: "*",
      rowKey: lateId,
      id: lateId,
      happendat: new Date(),
      result: JSON.stringify({ satisfaction: 3 }),
    });
    const db = copied.database.db;
    const gone = await db
      .selectFrom("survey_responses")
      .selectAll()
      .where("survey_id", "=", CAMPAIGN)
      .where("partial", "=", 0)
      .orderBy("id")
      .executeTakeFirstOrThrow();
    await db.deleteFrom("survey_responses").where("id", "=", gone.id).execute();
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "response_counts")).toEqual([
        expect.objectContaining({ ids: { surveyId: CAMPAIGN } }),
      ]);
      expect(json.pending).toContainEqual({
        check: "responses",
        ids: { surveyId: CAMPAIGN, responseId: lateId },
      });
    } finally {
      await table.deleteEntity("*", lateId).catch(() => undefined);
      await db
        .insertInto("survey_responses")
        .values(gone as never)
        .execute();
    }
  });

  // One row taken out of the target per counted entity: each check turns red alone.
  type Db = Target["database"]["db"];
  const removals: [check: string, table: string, rows: (db: Db) => Promise<unknown[]>][] = [
    [
      "identities",
      "user_identities",
      (db) =>
        db
          .selectFrom("user_identities")
          .selectAll()
          .where("user_id", "=", OWNER_ID.toLowerCase())
          .execute(),
    ],
    [
      "markers",
      "completion_markers",
      (db) =>
        db
          .selectFrom("completion_markers")
          .selectAll()
          .where("survey_id", "=", FEEDBACK)
          .orderBy("client_id")
          .limit(1)
          .execute(),
    ],
    [
      "views",
      "saved_views",
      (db) => db.selectFrom("saved_views").selectAll().where("user_id", "=", VIEW_USER).execute(),
    ],
    [
      "events",
      "survey_events",
      (db) => db.selectFrom("survey_events").selectAll().orderBy("id").limit(1).execute(),
    ],
    [
      "deleted_responses",
      "deleted_responses",
      (db) =>
        db
          .selectFrom("deleted_responses")
          .selectAll()
          .where("survey_id", "=", FEEDBACK)
          .limit(1)
          .execute(),
    ],
    [
      "own_files",
      "files",
      (db) => db.selectFrom("files").selectAll().where("id", "=", OWN_FILE).execute(),
    ],
    [
      "legacy_file_count",
      "legacy_files",
      (db) => db.selectFrom("legacy_files").selectAll().limit(1).execute(),
    ],
  ];
  const KEY_COLUMNS = new Set([
    "id",
    "survey_id",
    "user_id",
    "client_id",
    "response_id",
    "view",
    "provider",
    "subject",
    "kind",
    "legacy_name",
  ]);
  for (const [check, table, rowsOf] of removals) {
    it(`is red when one row of ${table} is gone from the target (${check})`, async () => {
      const db = copied.database.db;
      const [row] = (await rowsOf(db)) as Record<string, unknown>[];
      expect(row).toBeDefined();
      let remove = db.deleteFrom(table as "files");
      for (const [key, value] of Object.entries(row!)) {
        if (KEY_COLUMNS.has(key)) remove = remove.where(key as "id", "=", value as string);
      }
      await remove.execute();
      try {
        const { ok, json } = await verify({ deepSample: 0 });
        expect(ok).toBe(false);
        expect(json.differences.map((d) => d.check)).toEqual([check]);
      } finally {
        await db
          .insertInto(table as "files")
          .values(row as never)
          .execute();
      }
    });
  }

  it("is red incrementally for a response deleted in the source since the full verify but kept in the target", async () => {
    const name = "postdelete33333333000040008000a00000000004";
    const existed = fixtures.tables.some((t) => t.account === "results" && t.name === name);
    const table = localTableClient(
      config.resultsStorageConnectionString,
      name,
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    );
    await table.createTable();
    const responseId = fixtures.resultsByTable[CAMPAIGN_TABLE]![0]!.id;
    const copyId = "77777777-0000-4000-8000-a0000000dead";
    await table.createEntity({
      partitionKey: "*",
      rowKey: copyId,
      id: copyId,
      instanceid: responseId,
      happendat: new Date(),
      result: JSON.stringify({ satisfaction: 1 }),
    });
    const marks = await copied.target.state.get<{ takenAt: string }>("marks");
    try {
      // Marks taken after the deletion, which no delta applied.
      const later = new Date(Date.now() + 1000).toISOString();
      await copied.target.state.set("marks", marksAt(later), later);
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "deletions")).toEqual([
        { check: "deletions", ids: { surveyId: CAMPAIGN }, counts: { source: 1, kept: 1 } },
      ]);
    } finally {
      await table.deleteEntity("*", copyId).catch(() => undefined);
      if (!existed) await table.deleteTable().catch(() => undefined);
      await copied.target.state.set("marks", marks, new Date().toISOString());
    }
  });

  it("walks no survey above the size cap response by response, and notes it", async () => {
    const { ok, json } = await verify({ deepMaxResponses: LARGE_SURVEY_RESPONSES - 1 });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    expect(json.notes).toContainEqual({
      kind: "deep_skipped_size",
      ids: { surveyId: LARGE_SURVEY_ID },
    });
    expect(json.checks.responses!.compared).toBe(fixtures.surveys.length - 1);
  });

  describe("people the target holds otherwise than the copy seeded them", () => {
    type Db = Target["database"]["db"];
    /** A copied person other than the owner (other tests change the owner's rows). */
    async function somePerson(db: Db): Promise<string> {
      const rows = await db.selectFrom("users").select("id").orderBy("id").execute();
      return rows.map((row) => row.id).find((id) => id !== OWNER_ID.toLowerCase())!;
    }
    /** The person's rows, put back as they were by the returned function. */
    async function keep(db: Db, userId: string): Promise<() => Promise<void>> {
      const user = await db.selectFrom("users").selectAll().where("id", "=", userId).execute();
      const identities = await db
        .selectFrom("user_identities")
        .selectAll()
        .where("user_id", "=", userId)
        .execute();
      const keys = await db
        .selectFrom("legacy_access_keys")
        .selectAll()
        .where("user_id", "=", userId)
        .execute();
      return async () => {
        await db.deleteFrom("legacy_access_keys").where("user_id", "=", userId).execute();
        await db.deleteFrom("users").where("id", "=", userId).execute();
        if (user.length > 0) {
          await db
            .insertInto("users")
            .values(user as never)
            .execute();
        }
        if (identities.length > 0) {
          await db
            .insertInto("user_identities")
            .values(identities as never)
            .execute();
        }
        if (keys.length > 0) {
          await db
            .insertInto("legacy_access_keys")
            .values(keys as never)
            .execute();
        }
      };
    }
    /** An account the migration did not seed: an administrator. */
    const account = (id: string, email: string) => ({
      id,
      email,
      display_name: "Someone",
      instance_role: "admin" as const,
      status: "active" as const,
      password_hash: null,
      must_change_password: false,
      site_blocked: false,
      licence_expires_at: null,
      session_epoch: 0,
      created_at: new Date().toISOString(),
      last_sign_in_at: null,
    });

    it("notes an account the migration did not seed (an administrator, a sign-in account); a seeded one left over is red", async () => {
      const db = copied.database.db;
      const admin = "11111111-0000-4000-8000-a0000000e001";
      const signIn = "11111111-0000-4000-8000-a0000000e002";
      const seeded = "11111111-0000-4000-8000-a0000000e003";
      await db.insertInto("users").values(account(admin, "unseeded-admin@example.com")).execute();
      await copied.target.upsertPeople(
        [signIn, seeded].map((id) => ({
          id,
          email: `${id}@example.com`,
          displayName: id,
          siteBlocked: false,
          createdAt: new Date().toISOString(),
        })),
      );
      // An account made at sign-in: another provider's identity.
      await db
        .updateTable("user_identities")
        .set({ provider: "google", subject: "google-subject" })
        .where("user_id", "=", signIn)
        .execute();
      try {
        const { ok, json } = await verify({ deepSample: 0 });
        expect(ok).toBe(false);
        expect(findings(json.differences, "people")).toEqual([
          { check: "people", ids: { userId: seeded }, counts: { inSource: 0 } },
        ]);
        expect(json.notes).toContainEqual({ kind: "person_kept_unseeded", ids: { userId: admin } });
        expect(json.notes).toContainEqual({
          kind: "person_kept_unseeded",
          ids: { userId: signIn },
        });
      } finally {
        await copied.target.deletePeople([admin, signIn, seeded]);
      }
    });

    it("notes a named person the copy could not write: the email or the identity is held elsewhere", async () => {
      const db = copied.database.db;
      const userId = await somePerson(db);
      const restore = await keep(db, userId);
      const { email } = await db
        .selectFrom("users")
        .select("email")
        .where("id", "=", userId)
        .executeTakeFirstOrThrow();
      const holder = "11111111-0000-4000-8000-a0000000e004";
      try {
        // Another account holds the person's email (the copy skipped them: email-taken).
        await copied.target.deletePeople([userId]);
        await db.insertInto("users").values(account(holder, email)).execute();
        const taken = await verify({ deepSample: 0 });
        expect(taken.json.differences).toEqual([]);
        expect(taken.ok).toBe(true);
        expect(taken.json.notes).toContainEqual({ kind: "person_held_elsewhere", ids: { userId } });
        // The person's surveyjs identity is linked to that account (identity-linked-elsewhere).
        await db
          .updateTable("users")
          .set({ email: "holder@example.com" })
          .where("id", "=", holder)
          .execute();
        await db
          .insertInto("user_identities")
          .values({
            provider: "surveyjs",
            subject: userId,
            user_id: holder,
            email,
            email_verified: true,
            created_at: new Date().toISOString(),
          })
          .execute();
        const linked = await verify({ deepSample: 0 });
        expect(linked.json.differences).toEqual([]);
        expect(linked.ok).toBe(true);
        expect(linked.json.notes).toContainEqual({
          kind: "person_held_elsewhere",
          ids: { userId },
        });
      } finally {
        await copied.target.deletePeople([holder]);
        await restore();
      }
    });

    it("compares only what the migration owns of a person who signed in and linked another sign-in", async () => {
      const db = copied.database.db;
      const userId = await somePerson(db);
      const restore = await keep(db, userId);
      try {
        await db
          .updateTable("users")
          .set({ last_sign_in_at: new Date().toISOString(), session_epoch: 3 })
          .where("id", "=", userId)
          .execute();
        await db
          .insertInto("user_identities")
          .values({
            provider: "google",
            subject: "google-of-a-migrated-person",
            user_id: userId,
            email: "other@example.com",
            email_verified: true,
            created_at: new Date().toISOString(),
          })
          .execute();
        const used = await verify({ deepSample: 0 });
        expect(used.json.differences).toEqual([]);
        expect(used.ok).toBe(true);
        expect(used.json.notes).toContainEqual({ kind: "person_used", ids: { userId } });
        // The display name is the migration's: changed in the target, it is a difference.
        await db
          .updateTable("users")
          .set({ display_name: "Changed in the target" })
          .where("id", "=", userId)
          .execute();
        const renamed = await verify({ deepSample: 0 });
        expect(findings(renamed.json.differences, "people")).toEqual([
          expect.objectContaining({ ids: { userId } }),
        ]);
      } finally {
        await restore();
      }
    });
  });

  it("is red when the provider's own token table holds rows, which the copy does not take", async () => {
    expect(tokenRows.length).toBeGreaterThan(0);
    for (const row of tokenRows) {
      await tokens.upsertEntity(row as { partitionKey: string; rowKey: string }, "Replace");
    }
    try {
      const { ok, json, text } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "not_copied_api_tokens")).toHaveLength(1);
      for (const row of tokenRows) expect(text).not.toContain(String(row.rowKey));
    } finally {
      for (const row of tokenRows) {
        await tokens.deleteEntity(String(row.partitionKey), String(row.rowKey));
      }
    }
  });

  it("is red when Studio's own files container holds editor files of no survey", async () => {
    const name = "uploads/0f0f0f0f-0000-4000-8000-a0000000f11e";
    await files.getBlockBlobClient(name).uploadData(Buffer.from("user file"));
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "not_copied_user_files")).toHaveLength(1);
    } finally {
      await files.deleteBlob(name).catch(() => undefined);
    }
  });
});

describe("verify after the source dropped its only link to a legacy file", () => {
  it("is green and notes the target's unlinked file by count", async () => {
    const withoutDefinition = fixtures.surveys
      .find(
        (s) =>
          !fixtures.blobs.some(
            (b) => b.container === "surveyjson" && b.name.toLowerCase() === s.id.toLowerCase(),
          ),
      )!
      .id.toLowerCase();
    const link = `https://surveyjs.io/private/Surveys/files?name=${LEGACY_ASSET_NAME}`;
    const definition = {
      pages: [{ elements: [{ type: "html", name: "logo", html: `<img src="${link}">` }] }],
    };
    const into = await newTarget();
    const definitions = blobs.getContainerClient("surveyjson");
    try {
      await definitions
        .getBlockBlobClient(withoutDefinition)
        .uploadData(Buffer.from(JSON.stringify(definition)));
      await copyFromReplica(into, fixtures);
      expect(
        await into.target.existingKeys("legacy_files", [`asset/${LEGACY_ASSET_NAME}`]),
      ).toEqual([`asset/${LEGACY_ASSET_NAME}`]);
      // The image dropped from the definition, and the change copied: the file stays behind.
      await definitions.deleteBlob(withoutDefinition);
      await copyFromReplica(into, fixtures, { full: true });
      const { ok, json, text } = await verify({ into, deepSample: 0 });
      expect(json.differences).toEqual([]);
      expect(ok).toBe(true);
      expect(json.notes).toContainEqual({ kind: "legacy_files_unlinked", ids: { files: "1" } });
      expect(text).not.toContain(LEGACY_ASSET_NAME);
    } finally {
      await definitions.deleteBlob(withoutDefinition).catch(() => undefined);
      await into.close();
    }
  });
});

describe("verify of a sample copy", () => {
  it("is green, every sampled survey compared in depth", async () => {
    const into = await newTarget();
    const source = openReplicaSource(fixtures);
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      await copyFromReplica(into, fixtures, { sample });
      const { ok, json } = await verify({ into, sample, deepSample: 0 });
      expect(json.differences).toEqual([]);
      expect(ok).toBe(true);
      expect(json.checks.surveys!.compared).toBe(sample.surveys.size);
      expect(json.checks.responses!.compared).toBe(sample.surveys.size);
      // The target holds a sample: a verify of everything, or of another sample, refuses.
      await expect(verify({ into, full: false })).rejects.toThrow(Refused);
      const other = await selectSample(source, 0, [OUTSIDER_ID]);
      await expect(verify({ into, sample: other, full: false })).rejects.toThrow(/another sample/);
      expect((await verify({ into, sample, full: false })).ok).toBe(true);
      // So do delta and reconcile, before they change anything; and on a full copy, a sample.
      const before = await into.target.idsOf("surveys");
      await expect(runDelta(source, into.target, { report: createReport() })).rejects.toThrow(
        /holds a sample/,
      );
      await expect(
        runReconcile(source, into.target, { report: createReport(), full: false, sample: other }),
      ).rejects.toThrow(Refused);
      expect(await into.target.idsOf("surveys")).toEqual(before);
      const whole = await copied.target.idsOf("surveys");
      await expect(
        runReconcile(source, copied.target, { report: createReport(), full: false, sample }),
      ).rejects.toThrow(/holds a full copy/);
      expect(await copied.target.idsOf("surveys")).toEqual(whole);
    } finally {
      await source.close();
      await into.close();
    }
  });
});
