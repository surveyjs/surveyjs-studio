import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashCredential } from "../credentials/format.js";
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
import { runCopy } from "./copy.js";
import { DELETE_ALL_EVENT, runDelta } from "./delta.js";
import { createReport } from "./map/report.js";
import { mapResponse } from "./map/results.js";
import type { HighWaterMarks } from "./marks.js";
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
import type { ResultRow } from "./source/tables.js";
import { Refused } from "./state.js";
import { runVerify } from "./verify.js";

// Runs in the `providers-azurite` Vitest project, against the golden fixtures in the replica. The
// tests change the target to make `verify` red and put every change back; what they write to the
// replica (a response, a blob, the provider's own token rows) is removed or restored afterwards.

const config = replicaConfig();
const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
const OLD_POLL = "22222222-0000-4000-8000-a00000000003";
const OLD_POLL_PUBLISH_ID = "dddddddd-0000-4000-8000-a00000000001";
const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
const FEEDBACK_TABLE = "post33333333000040008000a00000000001";
const CAMPAIGN_TABLE = "post33333333000040008000a00000000004";
const FEEDBACK_POST = "33333333-0000-4000-8000-a00000000001";
const CAMPAIGN_POST = "33333333-0000-4000-8000-a00000000004";
/** The Marketing project, and a member of it who is in no other project. */
const MARKETING = "55555555-0000-4000-8000-a00000000001";
const MARKETING_MEMBER = "11111111-0000-4000-8000-a00000000003";

interface Finding {
  check: string;
  ids: Record<string, string>;
  counts?: Record<string, number>;
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
/** The marks the copy took: tests that move the marks put the copy's back. */
let copyMarks: HighWaterMarks;
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
const ofSurvey = (list: Finding[], surveyId: string) =>
  list.filter((f) => f.ids.surveyId === surveyId);

/** A green full verify's record as of `marks` (default: the stored ones), as `verify --full` keeps it. */
async function setBaseline(marks?: HighWaterMarks): Promise<void> {
  const at = new Date().toISOString();
  const as = marks ?? (await copied.target.state.get<HighWaterMarks>("marks"))!;
  await copied.target.state.set("verify:full", { at, marks: as, sample: false }, at);
}

/** Runs `work`, then puts back the marks, the reconcile record and the full verify's record. */
async function keepingState(work: () => Promise<void>): Promise<void> {
  const keys = ["marks", "reconcile", "verify:full"];
  const saved = await Promise.all(keys.map((key) => copied.target.state.get(key)));
  try {
    await work();
  } finally {
    const at = new Date().toISOString();
    for (const [i, key] of keys.entries()) {
      if (saved[i] === null) await copied.target.state.delete(key);
      else await copied.target.state.set(key, saved[i], at);
    }
  }
}

/** A source whose event table also holds `event`, stamped (and dated) `at`. */
const withEvent =
  (surveyId: string, type: string, at: Date) =>
  (source: LegacySource): LegacySource => ({
    ...source,
    async *events(since) {
      yield* source.events(since);
      if (since === undefined || at > since) {
        yield { id: randomUUID(), surveyId, type, at, rest: {}, timestamp: at };
      }
    },
  });

/** A source in which every response and completion marker of the survey is gone. */
const allDeleted =
  (surveyId: string, postId: string) =>
  (source: LegacySource): LegacySource => ({
    ...source,
    async *responses(post, since) {
      if (post.toLowerCase() === postId) return;
      yield* source.responses(post, since);
    },
    async *markers(survey, since) {
      if (survey.toLowerCase() === surveyId) return;
      yield* source.markers(survey, since);
    },
  });

const both =
  (...wraps: ((source: LegacySource) => LegacySource)[]) =>
  (source: LegacySource): LegacySource =>
    wraps.reduce((wrapped, wrap) => wrap(wrapped), source);

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
  // The old poll's published snapshot, which the copy takes into its history (removed afterwards).
  await putBlob("surveypublishedjson", OLD_POLL_PUBLISH_ID, '{"title":"Published"}');
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
  copyMarks = (await copied.target.state.get<HighWaterMarks>("marks"))!;
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
      historyEntries: (surveyId, publishId) => {
        history.push(surveyId);
        return source.historyEntries(surveyId, publishId);
      },
      historyNewest: (surveyId, keep, publishId) => {
        history.push(surveyId);
        return source.historyNewest(surveyId, keep, publishId);
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
    expect((await verify({ deepSample: 0 })).ok).toBe(true);
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

  it("forgets the last green full verify when a full verify starts: after a red one the incremental refuses", async () => {
    await setBaseline();
    const db = copied.database.db;
    const { name } = await db
      .selectFrom("surveys")
      .select("name")
      .where("id", "=", CAMPAIGN)
      .executeTakeFirstOrThrow();
    await db.updateTable("surveys").set({ name: "renamed" }).where("id", "=", CAMPAIGN).execute();
    try {
      expect((await verify({ deepSample: 0 })).ok).toBe(false);
      expect(await copied.target.state.get("verify:full")).toBeNull();
      const { ok, json } = await verify({ full: false });
      expect(ok).toBe(false);
      expect(findings(json.differences, "full_verify")).toHaveLength(1);
    } finally {
      await db.updateTable("surveys").set({ name }).where("id", "=", CAMPAIGN).execute();
      await setBaseline();
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

  it("is red, naming the survey and both checks, when the published snapshot's entry is gone", async () => {
    const db = copied.database.db;
    const row = await db
      .selectFrom("survey_history")
      .selectAll()
      .where("survey_id", "=", OLD_POLL)
      .where("id", "=", OLD_POLL_PUBLISH_ID)
      .executeTakeFirstOrThrow();
    await db.deleteFrom("survey_history").where("id", "=", row.id).execute();
    try {
      const { ok, json } = await verify();
      expect(ok).toBe(false);
      for (const check of ["history", "deep_history"]) {
        expect(findings(json.differences, check), check).toEqual([
          expect.objectContaining({ ids: { surveyId: OLD_POLL } }),
        ]);
      }
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

  it("computes the private questions by the old rule on the permissions and the layout: a weaker stored list is red", async () => {
    const before = await copied.target.privateQuestionsOf(FEEDBACK);
    // The feedback survey's permissions as Studio writes them (private entries only), under its
    // layout: no answer stays public, satisfaction included.
    const studioList = (source: LegacySource): LegacySource => ({
      ...source,
      async permissionsText(surveyId) {
        if (surveyId.toLowerCase() === FEEDBACK) return '[{"name":"receipt","isPublic":false}]';
        return source.permissionsText(surveyId);
      },
    });
    try {
      // The stored list as the union of both settings computed it: satisfaction public.
      expect([...before].sort()).toEqual(["HappendAt", "InstanceId", "receipt"]);
      const weaker = await verify({ deepSample: 0, wrap: studioList });
      expect(weaker.ok).toBe(false);
      expect(findings(weaker.json.differences, "private_questions")).toEqual([
        expect.objectContaining({ ids: expect.objectContaining({ surveyId: FEEDBACK }) }),
      ]);
      // The list the copy writes under that rule: green.
      await copied.target.setPrivateQuestions(FEEDBACK, [...before, "satisfaction"]);
      const agreed = await verify({ deepSample: 0, wrap: studioList });
      expect(agreed.json.differences).toEqual([]);
      expect(agreed.ok).toBe(true);
    } finally {
      await copied.target.setPrivateQuestions(FEEDBACK, before);
    }
  });

  it("compares the small tables in full incrementally: a renamed survey is red", async () => {
    await setBaseline();
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
    await setBaseline();
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
    await setBaseline();
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

describe("verify as the go/no-go: deletions, pending and the window", () => {
  const state = () => copied.target.state;
  const checksOf = (list: Finding[]) => [...new Set(list.map((f) => f.check))].sort();
  /** Marks a second after `at`, stored as a `delta` would leave them. */
  async function marksAfter(at: Date | string): Promise<string> {
    const later = new Date(new Date(at).getTime() + 1000).toISOString();
    await state().set("marks", marksAt(later), later);
    return later;
  }
  /** `reconcile` ran after the marks `marks` (its own marks a second later). */
  async function reconciledAfter(marks: string): Promise<void> {
    const at = new Date(Date.parse(marks) + 1000).toISOString();
    await state().set("reconcile", { since: marksAt(at), at }, at);
  }

  it("incremental: compares a survey's responses and markers after a delete-all since the full verify, and a delta without a reconcile after it is a difference", async () => {
    await keepingState(async () => {
      await setBaseline(copyMarks);
      // After the full verify the old app deletes every response of CAMPAIGN (no copies, one
      // event); a delta then moves the marks past it.
      const deletedAt = new Date(Date.parse(copyMarks.tables) + 1000);
      const later = await marksAfter(deletedAt);
      // That delta kept the copy's marks for `reconcile`, which has not run since.
      await state().set("reconcile", { since: copyMarks }, later);
      const wrap = both(
        allDeleted(CAMPAIGN, CAMPAIGN_POST),
        withEvent(CAMPAIGN, DELETE_ALL_EVENT, deletedAt),
      );
      const unreconciled = await verify({ full: false, wrap });
      expect(unreconciled.ok).toBe(false);
      expect(findings(unreconciled.json.differences, "reconcile")).toHaveLength(1);
      expect(checksOf(ofSurvey(unreconciled.json.differences, CAMPAIGN))).toEqual([
        "markers",
        "response_counts",
      ]);
      // A reconcile ran after the delta and missed the delete-all: still red, for the survey.
      await reconciledAfter(later);
      const missed = await verify({ full: false, wrap });
      expect(missed.ok).toBe(false);
      expect(findings(missed.json.differences, "reconcile")).toEqual([]);
      expect(checksOf(ofSurvey(missed.json.differences, CAMPAIGN))).toEqual([
        "markers",
        "response_counts",
      ]);
      // No delete-all: green.
      const clean = await verify({ full: false });
      expect(clean.json.differences).toEqual([]);
      expect(clean.ok).toBe(true);
    });
  });

  it("full: a delete-all after the marks is pending; one with no event is still a difference", async () => {
    const deletedAt = new Date(Date.now() + 1000);
    const { ok, json } = await verify({
      wrap: both(
        allDeleted(CAMPAIGN, CAMPAIGN_POST),
        withEvent(CAMPAIGN, DELETE_ALL_EVENT, deletedAt),
      ),
    });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    for (const check of ["response_counts", "markers", "responses"]) {
      expect(json.pending, check).toContainEqual({ check, ids: { surveyId: CAMPAIGN } });
    }
    // Its event missing (written last, best effort): the full verify counts the rows.
    const silent = await verify({ deepSample: 0, wrap: allDeleted(CAMPAIGN, CAMPAIGN_POST) });
    expect(silent.ok).toBe(false);
    expect(checksOf(ofSurvey(silent.json.differences, CAMPAIGN))).toEqual([
      "markers",
      "response_counts",
    ]);
  });

  it("full: a survey deleted in the source after the marks is pending, not a difference", async () => {
    const deletedAt = new Date(Date.now() + 1000);
    const deleted = (source: LegacySource): LegacySource => ({
      ...source,
      async *surveys(since) {
        for await (const row of source.surveys(since)) {
          if (row.id.toLowerCase() !== CAMPAIGN) yield row;
        }
      },
      async resultTables() {
        const tables = await source.resultTables();
        tables.delete(CAMPAIGN_TABLE);
        return tables;
      },
    });
    const { ok, json } = await verify({
      wrap: both(deleted, withEvent(CAMPAIGN, "SURVEY_DELETE", deletedAt)),
    });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    expect(json.pending).toContainEqual({ check: "surveys", ids: { surveyId: CAMPAIGN } });
    // With the event before the marks, the target holds a survey the source lacks.
    const before = new Date(Date.parse(copyMarks.tables) - 60_000);
    const old = await verify({
      deepSample: 0,
      wrap: both(deleted, withEvent(CAMPAIGN, "SURVEY_DELETE", before)),
    });
    expect(findings(old.json.differences, "surveys")).toEqual([
      { check: "surveys", ids: { surveyId: CAMPAIGN }, counts: { inSource: 0 } },
    ]);
  });

  it("full: a response deleted after the marks takes its completion marker with it: both pending", async () => {
    // Response ...002 (client-0001, partial) deleted as the old app deletes one: a deletion copy
    // stamped after the marks, the row gone, the client's completion marker deleted.
    const responseId = "66666666-0000-4000-8000-a00000000002";
    const deletedAt = new Date(Date.now() + 1000);
    const deleted = (source: LegacySource): LegacySource => ({
      ...source,
      async *responses(postId, since) {
        for await (const row of source.responses(postId, since)) {
          if (row.id.toLowerCase() !== responseId) yield row;
        }
      },
      async *deletedCopies(postId, since) {
        yield* source.deletedCopies(postId, since);
        if (postId.toLowerCase() === FEEDBACK_POST) {
          const entity: ResultRow = {
            id: responseId,
            happendat: deletedAt,
            result: '{"satisfaction":2}',
            clientid: "client-0001",
            ispartialcompleted: true,
          };
          yield { responseId, deletedAt, timestamp: deletedAt, entity };
        }
      },
      async *markers(surveyId, since) {
        for await (const marker of source.markers(surveyId, since)) {
          if (!(surveyId.toLowerCase() === FEEDBACK && marker.clientId === "client-0001")) {
            yield marker;
          }
        }
      },
    });
    const { ok, json } = await verify({ wrap: deleted });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
    expect(json.pending).toContainEqual({
      check: "responses",
      ids: { surveyId: FEEDBACK, responseId },
    });
    expect(json.pending).toContainEqual({ check: "markers", ids: { surveyId: FEEDBACK } });
  });

  describe("what the old app deletes without a trace: a view, a layout, a member", () => {
    const traceless = (source: LegacySource): LegacySource => ({
      ...source,
      async *views(surveyId) {
        for await (const view of source.views(surveyId)) {
          if (view.userId.toLowerCase() !== VIEW_USER) yield view;
        }
      },
      async layoutText(surveyId, kind) {
        if (surveyId.toLowerCase() === FEEDBACK && kind === "table") return null;
        return source.layoutText(surveyId, kind);
      },
      async *layoutNames(kind) {
        for await (const name of source.layoutNames(kind)) {
          if (!(kind === "table" && name.toLowerCase() === FEEDBACK)) yield name;
        }
      },
      async *organizationUsers(since) {
        for await (const row of source.organizationUsers(since)) {
          const gone =
            row.organizationid.toLowerCase() === MARKETING &&
            row.userid.toLowerCase() === MARKETING_MEMBER;
          if (!gone) yield row;
        }
      },
    });

    it("full: pending once a reconcile ran after the marks (the day before, the old service live)", async () => {
      await keepingState(async () => {
        await reconciledAfter(copyMarks.takenAt);
        const { ok, json } = await verify({ deepSample: 0, wrap: traceless });
        expect(json.differences).toEqual([]);
        expect(ok).toBe(true);
        expect(json.pending).toContainEqual({
          check: "views",
          ids: { surveyId: FEEDBACK, userId: VIEW_USER, view: "summary" },
        });
        expect(json.pending).toContainEqual({
          check: "layouts",
          ids: { surveyId: FEEDBACK, kind: "table" },
        });
        expect(json.pending).toContainEqual({ check: "members", ids: { projectId: MARKETING } });
        // Only pending: the run stands as the baseline of the incremental verify.
        expect(await state().get("verify:full")).not.toBeNull();
      });
    });

    it("full: a difference when no reconcile ran after the marks", async () => {
      await keepingState(async () => {
        await state().set("reconcile", { since: copyMarks }, new Date().toISOString());
        await marksAfter(copyMarks.takenAt);
        const { ok, json } = await verify({ deepSample: 0, wrap: traceless });
        expect(ok).toBe(false);
        expect(checksOf(json.differences)).toEqual(
          expect.arrayContaining(["layouts", "members", "views"]),
        );
      });
    });

    it("full: a project record that differs otherwise stays a difference, its member count only pending", async () => {
      const db = copied.database.db;
      const { name } = await db
        .selectFrom("projects")
        .select("name")
        .where("id", "=", MARKETING)
        .executeTakeFirstOrThrow();
      await keepingState(async () => {
        try {
          await reconciledAfter(copyMarks.takenAt);
          // A member removed in the source: only the member count differs, pending.
          const removed = await verify({ deepSample: 0, wrap: traceless });
          expect(findings(removed.json.differences, "projects")).toEqual([]);
          // A wrong name, with or without a member removed: red.
          await db
            .updateTable("projects")
            .set({ name: "renamed" })
            .where("id", "=", MARKETING)
            .execute();
          for (const wrap of [traceless, (source: LegacySource) => source]) {
            const { ok, json } = await verify({ deepSample: 0, wrap });
            expect(ok).toBe(false);
            expect(findings(json.differences, "projects")).toEqual([
              expect.objectContaining({ ids: { projectId: MARKETING } }),
            ]);
          }
        } finally {
          await db.updateTable("projects").set({ name }).where("id", "=", MARKETING).execute();
        }
      });
    });

    it("incremental (the window, after the final reconcile): a member the source lacks is a difference", async () => {
      await keepingState(async () => {
        await setBaseline(copyMarks);
        await reconciledAfter(copyMarks.takenAt);
        const { ok, json } = await verify({ full: false, wrap: traceless });
        expect(ok).toBe(false);
        expect(findings(json.differences, "members")).toEqual([
          expect.objectContaining({ ids: { projectId: MARKETING } }),
        ]);
      });
    });
  });

  describe("the window's verify after a reconcile that missed a deletion", () => {
    /** A source that lost FEEDBACK's table layout and permissions, a saved view and an own file. */
    const missed = (source: LegacySource): LegacySource => ({
      ...source,
      async layoutText(surveyId, kind) {
        if (surveyId.toLowerCase() === FEEDBACK && kind === "table") return null;
        return source.layoutText(surveyId, kind);
      },
      async *layoutNames(kind) {
        for await (const name of source.layoutNames(kind)) {
          if (!(kind === "table" && name.toLowerCase() === FEEDBACK)) yield name;
        }
      },
      async permissionsText(surveyId) {
        if (surveyId.toLowerCase() === FEEDBACK) return null;
        return source.permissionsText(surveyId);
      },
      async *changedBlobs(container, since) {
        for await (const name of source.changedBlobs(container, since)) {
          const lower = name.toLowerCase();
          if (container === "permissions" && lower === FEEDBACK) continue;
          if (container === "views" && lower.startsWith(`${FEEDBACK}/${VIEW_USER}/`)) continue;
          yield name;
        }
      },
      async *views(surveyId) {
        for await (const view of source.views(surveyId)) {
          if (view.userId.toLowerCase() !== VIEW_USER) yield view;
        }
      },
      async *appFiles() {
        for await (const blob of source.appFiles()) {
          if (!blob.blobName.toLowerCase().endsWith(OWN_FILE)) yield blob;
        }
      },
    });

    it("is red for a layout, a permissions blob, a saved view and an own file the source lacks", async () => {
      await keepingState(async () => {
        await setBaseline(copyMarks);
        await reconciledAfter(copyMarks.takenAt);
        const clean = await verify({ full: false });
        expect(clean.json.differences).toEqual([]);
        const { ok, json } = await verify({ full: false, wrap: missed });
        expect(ok).toBe(false);
        for (const [check, ids] of [
          ["layouts", { surveyId: FEEDBACK, kind: "table" }],
          ["permissions", { surveyId: FEEDBACK }],
          ["views", { surveyId: FEEDBACK, userId: VIEW_USER, view: "summary" }],
          ["own_files", { fileId: OWN_FILE }],
        ] as const) {
          expect(json.differences, check).toContainEqual(expect.objectContaining({ check, ids }));
        }
      });
    });

    it("is red for a project and a seeded person the source lacks", async () => {
      const ENGINEERING = "55555555-0000-4000-8000-a00000000002";
      const seeded = "11111111-0000-4000-8000-a0000000e005";
      const withoutProject = (source: LegacySource): LegacySource => ({
        ...source,
        async *organizations(since) {
          for await (const row of source.organizations(since)) {
            if (row.id.toLowerCase() !== ENGINEERING) yield row;
          }
        },
        async *organizationUsers(since) {
          for await (const row of source.organizationUsers(since)) {
            if (row.organizationid.toLowerCase() !== ENGINEERING) yield row;
          }
        },
      });
      await keepingState(async () => {
        try {
          await setBaseline(copyMarks);
          await reconciledAfter(copyMarks.takenAt);
          await copied.target.upsertPeople([
            {
              id: seeded,
              email: `${seeded}@example.com`,
              displayName: seeded,
              siteBlocked: false,
              createdAt: new Date().toISOString(),
            },
          ]);
          const { ok, json } = await verify({ full: false, wrap: withoutProject });
          expect(ok).toBe(false);
          expect(json.differences).toContainEqual({
            check: "projects",
            ids: { projectId: ENGINEERING },
            counts: { inSource: 0 },
          });
          expect(json.differences).toContainEqual({
            check: "people",
            ids: { userId: seeded },
            counts: { inSource: 0 },
          });
        } finally {
          await copied.target.deletePeople([seeded]);
        }
      });
    });
  });

  it("counts a response deleted twice (two copies of it) once", async () => {
    const twice = (source: LegacySource): LegacySource => ({
      ...source,
      async *deletedCopies(postId, since) {
        for await (const copy of source.deletedCopies(postId, since)) {
          // A retried delete: a second copy row of the same deleted row.
          yield copy;
          yield copy;
        }
      },
    });
    const { ok, json } = await verify({ deepSample: 0, wrap: twice });
    expect(json.differences).toEqual([]);
    expect(ok).toBe(true);
  });

  it("judges a deletion copy by its storage time, as the marks are taken, not by the time it holds", async () => {
    await keepingState(async () => {
      await setBaseline(copyMarks);
      const responseId = fixtures.resultsByTable[CAMPAIGN_TABLE]![0]!.id.toLowerCase();
      const stamped = new Date(Date.parse(copyMarks.tables) + 1000);
      const later = await marksAfter(stamped);
      await reconciledAfter(later);
      const copyOf =
        (deletedAt: Date, timestamp: Date) =>
        (source: LegacySource): LegacySource => ({
          ...source,
          async resultTables() {
            return (await source.resultTables()).add(`postdelete${CAMPAIGN_TABLE.slice(4)}`);
          },
          async *deletedCopies(postId, since) {
            if (postId.toLowerCase() !== CAMPAIGN_POST) {
              yield* source.deletedCopies(postId, since);
              return;
            }
            const entity: ResultRow = { id: responseId, happendat: deletedAt, result: "{}" };
            yield { responseId, deletedAt, timestamp, entity };
          },
        });
      // Stored before the marks, the time it holds ahead of them (its writer's clock): the
      // target still serving the response is a difference.
      const ahead = await verify({
        full: false,
        wrap: copyOf(new Date(Date.parse(later) + 3_600_000), stamped),
      });
      expect(findings(ahead.json.differences, "deletions")).toEqual([
        { check: "deletions", ids: { surveyId: CAMPAIGN }, counts: { source: 1, kept: 1 } },
      ]);
      // Stored after the marks, the time it holds behind them: pending.
      const behind = await verify({
        full: false,
        wrap: copyOf(
          new Date(Date.parse(copyMarks.tables) - 3_600_000),
          new Date(Date.parse(later) + 1000),
        ),
      });
      expect(behind.json.differences).toEqual([]);
      expect(behind.json.pending).toContainEqual({
        check: "responses",
        ids: { surveyId: CAMPAIGN, responseId },
      });
    });
  });

  it("compares every key by its hash, not its last four", async () => {
    const db = copied.database.db;
    const key = await db
      .selectFrom("legacy_access_keys")
      .selectAll()
      .orderBy("user_id")
      .executeTakeFirstOrThrow();
    await db
      .updateTable("legacy_access_keys")
      .set({ key_hash: hashCredential(`another key ${key.last_four}`, "legacy-key") })
      .where("user_id", "=", key.user_id)
      .execute();
    try {
      const { ok, json } = await verify({ deepSample: 0 });
      expect(ok).toBe(false);
      expect(findings(json.differences, "keys")).toEqual([
        expect.objectContaining({ ids: { userId: key.user_id } }),
      ]);
    } finally {
      await db
        .updateTable("legacy_access_keys")
        .set({ key_hash: key.key_hash })
        .where("user_id", "=", key.user_id)
        .execute();
    }
  });

  it("incremental: computes the private questions with the checkpoint's answer names, not the target's own list", async () => {
    const checkpointKey = `survey:${FEEDBACK}`;
    const checkpoint = await state().get<{ copiedAt: string; answerNames: string[] }>(
      checkpointKey,
    );
    const storedLayout = await migrated.views.getLayout(FEEDBACK, "columns");
    const reader = openReplicaSource(fixtures);
    const columns = JSON.parse((await reader.layoutText(FEEDBACK, "columns"))!) as object;
    await reader.close();
    // The saved layout hides new columns: an answer only responses carry is private.
    const hiding = JSON.stringify({ ...columns, newcolumnsvisibility: 2 });
    const wrap = (source: LegacySource): LegacySource => ({
      ...source,
      async layoutText(surveyId, kind) {
        if (surveyId.toLowerCase() === FEEDBACK && kind === "columns") return hiding;
        return source.layoutText(surveyId, kind);
      },
    });
    await keepingState(async () => {
      try {
        await copied.target.upsertLayouts([{ surveyId: FEEDBACK, kind: "columns", text: hiding }]);
        // Every survey's row counts as changed since the full verify: its settings are compared.
        await setBaseline({
          ...copyMarks,
          sql: { ...copyMarks.sql, surveys: new Date(0).toISOString() },
        });
        expect((await verify({ full: false, wrap })).json.differences).toEqual([]);
        // An earlier response's answer the target's list lacks (the copy's checkpoint has it).
        await state().set(
          checkpointKey,
          { ...checkpoint!, answerNames: [...checkpoint!.answerNames, "earlier_answer"] },
          new Date().toISOString(),
        );
        const { ok, json } = await verify({ full: false, wrap });
        expect(ok).toBe(false);
        expect(findings(json.differences, "private_questions")).toEqual([
          expect.objectContaining({ ids: { surveyId: FEEDBACK } }),
        ]);
      } finally {
        await state().set(checkpointKey, checkpoint, new Date().toISOString());
        await copied.target.upsertLayouts([
          { surveyId: FEEDBACK, kind: "columns", text: storedLayout! },
        ]);
      }
    });
  });

  describe("the deep walk, run by run", () => {
    const table = localTableClient(
      config.resultsStorageConnectionString,
      CAMPAIGN_TABLE,
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    );
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** Writes the rows to the replica and, with `copy`, to the target as the copy maps them. */
    async function post(rows: ResultRow[], copy: boolean): Promise<void> {
      for (const row of rows) {
        await table.createEntity({
          partitionKey: "*",
          rowKey: row.id,
          id: row.id,
          happendat: row.happendat!,
          result: row.result,
          ...(row.clientid !== undefined && { clientid: row.clientid }),
          ...(row.ispartialcompleted !== undefined && {
            ispartialcompleted: row.ispartialcompleted,
          }),
        });
      }
      if (copy) {
        await copied.target.upsertResponses(
          rows.map((row) => mapResponse(CAMPAIGN, row, createReport())!),
        );
      }
    }
    async function setData(id: string, data: unknown): Promise<void> {
      await copied.database.db
        .updateTable("survey_responses")
        .set({ data: jsonText(copied.database.dialect, data) })
        .where("id", "=", id)
        .execute();
    }
    async function remove(ids: string[]): Promise<void> {
      for (const id of ids) await table.deleteEntity("*", id).catch(() => undefined);
      await copied.database.db.deleteFrom("survey_responses").where("id", "in", ids).execute();
    }
    const row = (id: string, at: string, satisfaction: number, partial: boolean): ResultRow => ({
      id,
      happendat: new Date(at),
      result: JSON.stringify({ satisfaction }),
      clientid: "client-runs",
      ispartialcompleted: partial,
    });

    it("a client's later run after the marks leaves its earlier run compared", async () => {
      const first = "66666666-0000-4000-8000-a0000000f8a1";
      const late = "66666666-0000-4000-8000-a0000000f8a2";
      await keepingState(async () => {
        try {
          await post([row(first, "2026-05-01T08:00:00Z", 4, false)], true);
          await pause(20);
          const marks = new Date().toISOString();
          await state().set("marks", marksAt(marks), marks);
          await pause(20);
          // The same client starts a new run after the marks (not copied yet: pending).
          await post([row(late, "2026-05-02T08:00:00Z", 1, true)], false);
          expect((await verify()).json.differences).toEqual([]);
          await setData(first, { satisfaction: 5 });
          const { ok, json } = await verify();
          expect(ok).toBe(false);
          expect(findings(json.differences, "responses")).toEqual([
            expect.objectContaining({ ids: { surveyId: CAMPAIGN } }),
          ]);
        } finally {
          await remove([first, late]);
        }
      });
    });

    it("compares the rows of a run, not only the response they fold into", async () => {
      const save1 = "66666666-0000-4000-8000-a0000000f8d1";
      const save2 = "66666666-0000-4000-8000-a0000000f8d2";
      await keepingState(async () => {
        try {
          await post(
            [
              row(save1, "2026-05-01T08:00:00Z", 1, true),
              row(save2, "2026-05-01T08:05:00Z", 2, true),
            ],
            true,
          );
          await pause(20);
          await marksAfter(new Date());
          expect((await verify()).json.differences).toEqual([]);
          // The first save's value, which the second overwrites in the folded response.
          await setData(save1, { satisfaction: 3 });
          const { ok, json } = await verify();
          expect(ok).toBe(false);
          expect(findings(json.differences, "responses")).toEqual([
            expect.objectContaining({ ids: { surveyId: CAMPAIGN } }),
          ]);
        } finally {
          await remove([save1, save2]);
        }
      });
    });
  });

  it("keeps a deletion copy without a time at its storage time: copy writes it, verify counts it", async () => {
    const responseId = "66666666-0000-4000-8000-a0000000d0d0";
    const stamped = new Date("2026-06-01T10:00:00.000Z");
    const undated = (source: LegacySource): LegacySource => ({
      ...source,
      async *deletedCopies(postId, since) {
        yield* source.deletedCopies(postId, since);
        if (postId.toLowerCase() !== FEEDBACK_POST) return;
        const entity: ResultRow = { id: responseId, happendat: null, result: '{"satisfaction":3}' };
        yield { responseId, deletedAt: null, timestamp: stamped, entity };
      },
    });
    const into = await newTarget();
    const source = undated(openReplicaSource(fixtures));
    try {
      const report = createReport();
      await runCopy(source, into.target, { report, marginMs: 0 });
      const stored = await into.database.db
        .selectFrom("deleted_responses")
        .selectAll()
        .where("response_id", "=", responseId)
        .executeTakeFirstOrThrow();
      expect(new Date(stored.deleted_at as string).toISOString()).toBe(stamped.toISOString());
      expect((report.toJSON() as VerifyJson).notes).toContainEqual({
        kind: "deleted_copy_undated",
        ids: { surveyId: FEEDBACK, responseId },
      });
      const { ok, json } = await verify({ into, deepSample: 0, wrap: undated });
      expect(json.differences).toEqual([]);
      expect(ok).toBe(true);
    } finally {
      await source.close();
      await into.close();
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
