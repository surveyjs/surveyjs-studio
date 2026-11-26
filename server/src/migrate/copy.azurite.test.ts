import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashCredential } from "../credentials/format.js";
import { newFileId } from "../domain/file-id.js";
import { localTableClient } from "../legacy/local-clients.js";
import { replicaConfig } from "../legacy/replica-env.js";
import { measureLegacyStores } from "../legacy/stats-source.js";
import { readLegacyFixtures, type LegacyFixtures } from "../providers/azure-legacy/fixtures.js";
import { LARGE_SURVEY_RESPONSES } from "../providers/azure-legacy/large-survey.js";
import {
  ERASABLE_ID,
  LEGACY_ASSET_NAME,
  LEGACY_RESPONSE_NAME,
  OUTSIDER_ID,
  OWNER_ID,
} from "../providers/suite/expected.js";
import { describeProviderSuite } from "../providers/suite/provider-suite.js";
import type { SqlDatabase } from "../sql/database.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { createSurveyCopier, runCopy, type CopyOptions } from "./copy.js";
import { runDelta } from "./delta.js";
import { openDumpWriter } from "./dump.js";
import { createReport, type Report } from "./map/report.js";
import { runPlan } from "./plan.js";
import { runReconcile } from "./reconcile.js";
import {
  copyFromReplica,
  newTarget,
  openReplicaSource,
  readAll,
  targetProviders,
  type Target,
} from "./replica-setup.js";
import { selectSample } from "./sample.js";
import type { LegacySource } from "./source/index.js";
import { Refused } from "./state.js";
import type { MigrationTarget } from "./target.js";

// Runs in the `providers-azurite` Vitest project: the replica holds the golden fixtures (its
// global setup loads them). Azurite has no file service: the legacy shares are the stub over the
// fixtures' share files.

const NOW = new Date("2026-11-25T12:00:00.000Z");
const now = () => NOW;

/** Every table the copy writes (not the tool's own state). */
const TABLES = [
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
] as const satisfies readonly (keyof DatabaseSchema)[];

/** Every row of every copied table (sorted) and every file's bytes, as one text. */
async function dumpOf({ database, bytes }: Target): Promise<string> {
  const out: Record<string, string[]> = {};
  for (const table of TABLES) {
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

const count = async (database: SqlDatabase, table: (typeof TABLES)[number]): Promise<number> =>
  (await database.db.selectFrom(table).selectAll().execute()).length;

const lower = (values: Iterable<string>) => [...values].map((v) => v.toLowerCase()).sort();

let fixtures: LegacyFixtures;
const config = replicaConfig();
const openSource = (): LegacySource => openReplicaSource(fixtures);

/** A copy from the replica into `into`, at the fixed time. */
const copyInto = (into: Target, options: Partial<CopyOptions> = {}): Promise<Report> =>
  copyFromReplica(into, fixtures, { now, ...options });

/** A fresh copy of the replica, opened as the hosted app opens it (the local user directory). */
async function migratedProviders() {
  fixtures ??= await readLegacyFixtures();
  const into = await newTarget();
  await copyInto(into);
  const providers = targetProviders(into);
  return {
    ...providers,
    async close() {
      await providers.close();
      await into.close();
    },
  };
}

describeProviderSuite("migrated from the local replica", migratedProviders, {
  userDirectoryKind: "local",
  // Cases that differ only by a documented migration decision (global constraints, Decisions);
  // each decision is asserted directly below ("copy decisions").
  except: {
    // Decision "private_questions": the union of the permissions' names and the column layout's
    // hidden ones; the feedback survey's layout lists columns, so HappendAt and InstanceId join.
    "views > private questions > reads the fixture list and an empty one elsewhere":
      "private_questions is the union with the column layout's hidden names",
    // Decision "files": only files a copied definition, theme, history snapshot or response
    // links; no fixture record links the editor asset.
    "files > getFileByLegacyName > returns the seeded editor asset as stored, octet-stream without an extension":
      "only linked legacy files are copied, and no fixture record links the editor asset",
  },
});

describe("copy from the local replica", () => {
  let copied: Target;
  let report: Report;
  let dumpDir: string;
  const blobs = BlobServiceClient.fromConnectionString(config.surveysStorageConnectionString);
  const written: [string, string][] = [];
  const FEEDBACK = "22222222-0000-4000-8000-a00000000001";
  const VIEW_USER = "11111111-0000-4000-8000-a0000000f00d";
  const OWN_FILE = newFileId(FEEDBACK);

  async function put(
    container: string,
    name: string,
    content: string,
    options: { metadata?: Record<string, string>; contentType?: string } = {},
  ) {
    const client = blobs.getContainerClient(container);
    await client.createIfNotExists();
    await client.getBlockBlobClient(name).uploadData(Buffer.from(content), {
      metadata: options.metadata,
      ...(options.contentType && { blobHTTPHeaders: { blobContentType: options.contentType } }),
    });
    written.push([container, name]);
  }

  beforeAll(async () => {
    fixtures ??= await readLegacyFixtures();
    // A user's own view and an editor file of the app's own container (tests may write to the
    // replica; both are removed afterwards).
    await put("my-surveys-views", `${FEEDBACK}/${VIEW_USER}/summary`, '{"panels":[]}');
    await put("my-surveys-files", `${FEEDBACK}/${OWN_FILE}`, "own bytes", {
      metadata: { kind: "asset", name: "logo.png", createdat: "2026-11-01T10:00:00.000Z" },
      contentType: "image/png",
    });
    copied = await newTarget();
    dumpDir = mkdtempSync(join(tmpdir(), "surveyjs-studio-dump-"));
    const dump = openDumpWriter(dumpDir);
    try {
      report = await copyInto(copied, { dump });
    } finally {
      await dump.close();
    }
  });

  afterAll(async () => {
    for (const [container, name] of written) {
      await blobs
        .getContainerClient(container)
        .deleteBlob(name)
        .catch(() => undefined);
    }
    await copied?.close();
    rmSync(dumpDir, { recursive: true, force: true });
  });

  it("copies every survey, response and event of the replica", async () => {
    expect(
      lower(
        (await copied.database.db.selectFrom("surveys").select("id").execute()).map((r) => r.id),
      ),
    ).toEqual(lower(fixtures.surveys.map((s) => s.id)));
    const responses = Object.values(fixtures.resultsByTable).reduce(
      (n, rows) => n + rows.length,
      0,
    );
    expect(responses).toBeGreaterThan(LARGE_SURVEY_RESPONSES);
    expect(await count(copied.database, "survey_responses")).toBe(responses);
    const log = fixtures.tables.find((t) => t.account === "surveys" && t.name === "surveys")!;
    expect(await count(copied.database, "survey_events")).toBe(log.entities.length);
    expect(report.counts()["skipped:survey"]).toBeUndefined();
  });

  it("reads each survey's history once, names its authors from that read, and times each phase", async () => {
    // A history entry whose author nothing else names (the fixtures' entries name nobody, and
    // every fixture user holds a key): a user row and the entry, both removed afterwards.
    const author = "11111111-0000-4000-8000-a0000000a001";
    const pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, author)
      .query("INSERT INTO Users (id, email, displayname) VALUES (@id, 'author@example.com', NULL)");
    const point = "99999999-0000-4000-8000-a0000000a001";
    const history = blobs.getContainerClient("surveyjsonhistory");
    await history
      .getBlockBlobClient(`${FEEDBACK}/${point}`)
      .uploadData(Buffer.from('{"pages":[]}'), {
        metadata: { userid: author, savedat: new Date().toISOString() },
      });
    const listed: string[] = [];
    const read: string[] = [];
    const into = await newTarget();
    const source = openSource();
    try {
      const counting: LegacySource = {
        ...source,
        historyEntries: (surveyId) => {
          listed.push(surveyId);
          return source.historyEntries(surveyId);
        },
        historyNewest: (surveyId, keep) => {
          read.push(surveyId.toLowerCase());
          return source.historyNewest(surveyId, keep);
        },
      };
      const timed = createReport();
      await runCopy(counting, into.target, { now, report: timed });
      expect(listed).toEqual([]);
      expect(read.length).toBe(new Set(read).size);
      expect(await into.target.historyAuthors()).toContain(author);
      expect(await into.target.idsOf("users")).toContain(author);
      expect(timed.toJSON()).toMatchObject({
        durations: {
          marks: expect.any(Number),
          people: expect.any(Number),
          projects: expect.any(Number),
          surveys: expect.any(Number),
          events: expect.any(Number),
          views: expect.any(Number),
          files: expect.any(Number),
        },
      });
    } finally {
      await source.close();
      await into.close();
      await history.deleteBlob(`${FEEDBACK}/${point}`).catch(() => undefined);
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, author)
        .query("DELETE FROM Users WHERE id = @id");
      await pool.close();
    }
  });

  it("copies a user's own view and the app's own file", async () => {
    const view = await copied.database.db
      .selectFrom("saved_views")
      .selectAll()
      .where("user_id", "=", VIEW_USER)
      .executeTakeFirst();
    expect(view).toMatchObject({ survey_id: FEEDBACK, view: "summary" });
    const file = await copied.database.db
      .selectFrom("files")
      .selectAll()
      .where("id", "=", OWN_FILE)
      .executeTakeFirst();
    expect(file).toMatchObject({ survey_id: FEEDBACK, kind: "asset", name: "logo.png", size: 9 });
  });

  describe("copy decisions", () => {
    const CAMPAIGN = "22222222-0000-4000-8000-a00000000004";
    const providersOf = targetProviders;
    const remove = (container: string, name: string) =>
      blobs
        .getContainerClient(container)
        .deleteBlob(name)
        .catch(() => undefined);

    it("private_questions: the permissions' hidden names with the column layout's, HappendAt and InstanceId too", async () => {
      const providers = providersOf(copied);
      const names = await providers.views.getPrivateQuestions(FEEDBACK);
      // "receipt": not public in the permissions (and hidden by the layout); the layout lists
      // columns and neither HappendAt nor InstanceId.
      expect([...names].sort()).toEqual(["HappendAt", "InstanceId", "receipt"]);
      expect(await providers.views.getPrivateQuestions(CAMPAIGN)).toEqual([]);
    });

    /**
     * Runs `work` while the campaign survey has a response with a key its definition lacks and a
     * column layout that hides new columns (both removed afterwards).
     */
    async function withResponseOnlyName(work: () => Promise<void>): Promise<void> {
      const table = localTableClient(
        config.resultsStorageConnectionString,
        "post33333333000040008000a00000000004",
        "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
      );
      const rowId = "66666666-0000-4000-8000-a0000000beef";
      await table.createEntity({
        partitionKey: "*",
        rowKey: rowId,
        id: rowId,
        happendat: new Date("2026-11-20T10:00:00.000Z"),
        result: '{"satisfaction":2,"only_in_responses":"x"}',
      });
      const layout = {
        columns: [{ name: "satisfaction", visibility: 0 }],
        newcolumnsvisibility: 2,
      };
      await put("surveyresultcolumns", CAMPAIGN, JSON.stringify(layout));
      try {
        await work();
      } finally {
        await table.deleteEntity("*", rowId).catch(() => undefined);
        await remove("surveyresultcolumns", CAMPAIGN);
      }
    }
    const CAMPAIGN_PRIVATE = ["HappendAt", "InstanceId", "only_in_responses", "receipt"];

    it("private_questions: an answer name found only in responses takes the layout's new-columns visibility", async () => {
      await withResponseOnlyName(async () => {
        const into = await newTarget();
        try {
          await copyInto(into);
          const names = await providersOf(into).views.getPrivateQuestions(CAMPAIGN);
          expect([...names].sort()).toEqual(CAMPAIGN_PRIVATE);
        } finally {
          await into.close();
        }
      });
    });

    it("private_questions: a response-only name is private before the batch that carries it is written", async () => {
      await withResponseOnlyName(async () => {
        const into = await newTarget();
        try {
          // What the app would serve while the copy writes: read as each batch goes in.
          const seen: string[][] = [];
          const watching: MigrationTarget = {
            ...into.target,
            upsertResponses: async (recs) => {
              if (recs.some((rec) => "only_in_responses" in rec.response.data)) {
                seen.push([...(await providersOf(into).views.getPrivateQuestions(CAMPAIGN))]);
              }
              await into.target.upsertResponses(recs);
            },
          };
          const source = openSource();
          try {
            await runCopy(source, watching, { now, report: createReport(), batchSize: 1 });
          } finally {
            await source.close();
          }
          expect(seen).toHaveLength(1);
          expect(seen[0]).toContain("only_in_responses");
          expect([...(await into.target.privateQuestionsOf(CAMPAIGN))].sort()).toEqual(
            CAMPAIGN_PRIVATE,
          );
        } finally {
          await into.close();
        }
      });
    });

    it("private_questions: a --full run killed mid-survey never weakens the stored list, and the next copy finishes the survey", async () => {
      await withResponseOnlyName(async () => {
        const into = await newTarget();
        try {
          // An uninterrupted copy, one response per batch, noting the order of the response reads.
          const order: string[] = [];
          const source = openSource();
          try {
            const recording: LegacySource = {
              ...source,
              responses: (postId, since) => {
                order.push(postId.toLowerCase());
                return source.responses(postId, since);
              },
            };
            // One survey at a time: the order of the reads is the order of the batches.
            await runCopy(recording, into.target, {
              now,
              report: createReport(),
              batchSize: 1,
              concurrency: 1,
            });
          } finally {
            await source.close();
          }
          const whole = await dumpOf(into);
          expect([...(await into.target.privateQuestionsOf(CAMPAIGN))].sort()).toEqual(
            CAMPAIGN_PRIVATE,
          );

          // Stop a --full run after the campaign survey's first response batch.
          const surveyOfPost = new Map(
            fixtures.surveys.map((s) => [s.postid!.toLowerCase(), s.id.toLowerCase()]),
          );
          const campaignPost = fixtures.surveys
            .find((s) => s.id.toLowerCase() === CAMPAIGN)!
            .postid!.toLowerCase();
          const before = order.slice(0, order.indexOf(campaignPost));
          expect(before.length).toBeLessThan(order.length);
          let batchesBefore = 0;
          for (const postId of before) {
            const rows = await into.database.db
              .selectFrom("survey_responses")
              .select("id")
              .where("survey_id", "=", surveyOfPost.get(postId)!)
              .execute();
            batchesBefore += rows.length;
          }
          await expect(
            copyInto(into, {
              full: true,
              batchSize: 1,
              concurrency: 1,
              failAfter: batchesBefore + 1,
            }),
          ).rejects.toThrow(/failAfter/);

          // Mid-survey: the stored list is at least the previous run's, and no checkpoint.
          const stored = await into.target.privateQuestionsOf(CAMPAIGN);
          for (const name of CAMPAIGN_PRIVATE) expect(stored).toContain(name);
          expect(await into.target.state.get(`survey:${CAMPAIGN}`)).toBeNull();

          await copyInto(into, { batchSize: 1 });
          expect(await dumpOf(into)).toBe(whole);
        } finally {
          await into.close();
        }
      });
    });

    it("files: a legacy file is copied only once a copied record links it", async () => {
      const share = (name: string) => fixtures.files.find((f) => f.name === name)!.content;
      const withoutDefinition = fixtures.surveys
        .find(
          (s) =>
            !fixtures.blobs.some(
              (b) => b.container === "surveyjson" && b.name.toLowerCase() === s.id.toLowerCase(),
            ),
        )!
        .id.toLowerCase();
      const into = await newTarget();
      try {
        await copyInto(into);
        const providers = providersOf(into);
        expect(await providers.files.getFileByLegacyName("asset", LEGACY_ASSET_NAME)).toBeNull();
        const response = await providers.files.getFileByLegacyName(
          "response",
          LEGACY_RESPONSE_NAME,
        );
        expect(response && (await readAll(response.content))).toEqual(share(LEGACY_RESPONSE_NAME));

        const link = `https://surveyjs.io/private/Surveys/files?name=${LEGACY_ASSET_NAME}`;
        const definition = {
          pages: [{ elements: [{ type: "html", name: "logo", html: `<img src="${link}">` }] }],
        };
        await put("surveyjson", withoutDefinition, JSON.stringify(definition));
        await copyInto(into, { full: true });
        const asset = await providers.files.getFileByLegacyName("asset", LEGACY_ASSET_NAME);
        expect(asset && (await readAll(asset.content))).toEqual(share(LEGACY_ASSET_NAME));
        expect(asset?.file).toMatchObject({
          kind: "asset",
          name: LEGACY_ASSET_NAME,
          contentType: "application/octet-stream",
          size: share(LEGACY_ASSET_NAME).length,
        });
      } finally {
        await remove("surveyjson", withoutDefinition);
        await into.close();
      }
    });
  });

  it("leaves a byte-identical dump when it copies everything again", async () => {
    const once = await dumpOf(copied);
    await copyInto(copied, { full: true });
    expect(await dumpOf(copied)).toBe(once);
  });

  it("skips the surveys with a checkpoint unless --full", async () => {
    const keys = await copied.target.state.keys("survey:");
    expect(keys.length).toBe(fixtures.surveys.length);
    expect(await copied.target.state.get("marks")).toMatchObject({ takenAt: NOW.toISOString() });
    let reads = 0;
    const source = openSource();
    try {
      const counting = {
        ...source,
        responses: (postId: string, since?: Date) => {
          reads += 1;
          return source.responses(postId, since);
        },
      };
      await runCopy(counting, copied.target, { now, report: createReport() });
    } finally {
      await source.close();
    }
    expect(reads).toBe(0);
  });

  it("resumes a run stopped in the middle of a survey's responses, ending with exactly the source's rows", async () => {
    const resumed = await newTarget();
    try {
      await expect(copyInto(resumed, { failAfter: 1, batchSize: 2 })).rejects.toThrow(/failAfter/);
      // A copy that never finished: delta and reconcile refuse (what it did not reach, they
      // would never read).
      const source = openSource();
      try {
        await expect(runDelta(source, resumed.target, { report: createReport() })).rejects.toThrow(
          Refused,
        );
        await expect(
          runReconcile(source, resumed.target, { report: createReport(), full: false }),
        ).rejects.toThrow(/no copy has finished/);
      } finally {
        await source.close();
      }
      const partly = await count(resumed.database, "survey_responses");
      expect(partly).toBeGreaterThan(0);
      expect(partly).toBeLessThan(await count(copied.database, "survey_responses"));
      expect((await resumed.target.state.keys("survey:")).length).toBeLessThan(
        fixtures.surveys.length,
      );
      await copyInto(resumed, { batchSize: 2 });
      expect(await dumpOf(resumed)).toBe(await dumpOf(copied));
      expect(await resumed.target.state.get("copy:complete")).not.toBeNull();
    } finally {
      await resumed.close();
    }
  });

  it("writes one NDJSON line per record, with its kind and id", async () => {
    const lines = readFileSync(join(dumpDir, "records.ndjson"), "utf8").trimEnd().split("\n");
    const byKind = new Map<string, Set<string>>();
    for (const line of lines) {
      const parsed = JSON.parse(line) as { kind: unknown; id: unknown; record: unknown };
      expect(typeof parsed.kind).toBe("string");
      expect(typeof parsed.id).toBe("string");
      expect(parsed.record).toBeTypeOf("object");
      const ids = byKind.get(parsed.kind as string) ?? new Set<string>();
      expect(ids.has(parsed.id as string), `${String(parsed.kind)} ${String(parsed.id)}`).toBe(
        false,
      );
      ids.add(parsed.id as string);
      byKind.set(parsed.kind as string, ids);
    }
    const tableOf: Record<string, (typeof TABLES)[number]> = {
      survey: "surveys",
      history: "survey_history",
      response: "survey_responses",
      marker: "completion_markers",
      layout: "survey_layouts",
      view: "saved_views",
      project: "projects",
      member: "project_members",
      person: "users",
      key: "legacy_access_keys",
      file: "files",
      event: "survey_events",
      deleted: "deleted_responses",
    };
    expect([...byKind.keys()].sort()).toEqual(Object.keys(tableOf).sort());
    for (const [kind, table] of Object.entries(tableOf)) {
      expect(byKind.get(kind)?.size, kind).toBe(await count(copied.database, table));
    }
  });

  it("refuses a sample copy onto the full copy, changing nothing", async () => {
    const before = await dumpOf(copied);
    const source = openSource();
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      await expect(
        runCopy(source, copied.target, { now, sample, report: createReport() }),
      ).rejects.toThrow(Refused);
      expect(await copied.target.state.get("sample")).toBeNull();
      expect(await dumpOf(copied)).toBe(before);
    } finally {
      await source.close();
    }
  });
});

describe("a sample copy from the local replica", () => {
  it("holds only the included account's closure for share 0", async () => {
    fixtures ??= await readLegacyFixtures();
    const owner = OWNER_ID.toLowerCase();
    const users = new Set(fixtures.users.map((u) => u.id.toLowerCase()));
    const memberships = fixtures.organizationUsers.map((m) => ({
      projectId: m.organizationid.toLowerCase(),
      userId: m.userid.toLowerCase(),
    }));
    const ownerProjects = new Set(
      memberships.filter((m) => m.userId === owner).map((m) => m.projectId),
    );
    const withMembers = new Set(memberships.map((m) => m.projectId));
    const expectedSurveys = fixtures.surveys
      .filter((s) => {
        const ownerId = s.userid?.toLowerCase() ?? "";
        const orphan = !users.has(ownerId) && !withMembers.has(ownerId);
        return (
          ownerId === owner ||
          ownerProjects.has(ownerId) ||
          (orphan && s.creatorid?.toLowerCase() === owner)
        );
      })
      .map((s) => s.id);
    expect(expectedSurveys.length).toBeGreaterThan(0);
    expect(expectedSurveys.length).toBeLessThan(fixtures.surveys.length);

    const into = await newTarget();
    const source = openSource();
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      await runCopy(source, into.target, { now, sample, report: createReport() });
      const ids = async (table: "surveys" | "projects" | "users") =>
        lower((await into.database.db.selectFrom(table).select("id").execute()).map((r) => r.id));
      expect(await ids("surveys")).toEqual(lower(expectedSurveys));
      expect(await ids("projects")).toEqual(lower(ownerProjects));
      const people = await ids("users");
      for (const m of memberships.filter((m) => ownerProjects.has(m.projectId))) {
        expect(people).toContain(m.userId);
      }
      expect(people).toContain(owner);
      expect(people).not.toContain(OUTSIDER_ID.toLowerCase());
      expect(people).not.toContain(ERASABLE_ID.toLowerCase());
      const responseSurveys = await into.database.db
        .selectFrom("survey_responses")
        .select("survey_id")
        .distinct()
        .execute();
      for (const { survey_id } of responseSurveys)
        expect(lower(expectedSurveys)).toContain(survey_id);
      expect(await into.target.state.get("sample")).toMatchObject({ accounts: [owner] });
    } finally {
      await source.close();
      await into.close();
    }
  });

  it("refuses a full copy or another sample onto a sample target, so a reconcile of another sample still refuses", async () => {
    fixtures ??= await readLegacyFixtures();
    const into = await newTarget();
    const source = openSource();
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      await runCopy(source, into.target, { now, sample, report: createReport() });
      const stored = await into.target.state.get("sample");
      const surveys = async () =>
        lower(
          (await into.database.db.selectFrom("surveys").select("id").execute()).map((r) => r.id),
        );
      const copiedSurveys = await surveys();

      const other = await selectSample(source, 0, [OUTSIDER_ID]);
      for (const options of [{}, { sample: other }, { sample: other, full: true }]) {
        await expect(
          runCopy(source, into.target, { now, ...options, report: createReport() }),
        ).rejects.toThrow(/wipe/);
        expect(await into.target.state.get("sample")).toEqual(stored);
        expect(await surveys()).toEqual(copiedSurveys);
      }
      await expect(
        runReconcile(source, into.target, { report: createReport(), full: false, sample: other }),
      ).rejects.toThrow(Refused);
      expect(await surveys()).toEqual(copiedSurveys);

      // The same sample again is a resumed or repeated copy.
      await runCopy(source, into.target, { now, sample, full: true, report: createReport() });
      expect(await surveys()).toEqual(copiedSurveys);
    } finally {
      await source.close();
      await into.close();
    }
  });

  it("refuses another sample, or a full copy, after a run stopped before its first checkpoint", async () => {
    fixtures ??= await readLegacyFixtures();
    const source = openSource();
    const stopped = () => Promise.reject(new Error("stopped"));
    const atMarks = { ...source, latestChanges: stopped };
    const inResponses = {
      ...source,
      responses: () => ({ [Symbol.asyncIterator]: () => ({ next: stopped }) }),
    };
    const sampleOnto = await newTarget();
    const fullOnto = await newTarget();
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      const other = await selectSample(source, 0, [OUTSIDER_ID]);
      const copy = (from: LegacySource, into: Target, options: Partial<CopyOptions>) =>
        runCopy(from, into.target, { now, ...options, report: createReport() });

      // Stopped before any write but the sample's record (the marks are the first read).
      await expect(copy(atMarks, sampleOnto, { sample })).rejects.toThrow(/stopped/);
      await expect(copy(source, sampleOnto, { sample: other })).rejects.toThrow(/wipe/);
      await expect(copy(source, sampleOnto, {})).rejects.toThrow(/wipe/);
      // Stopped with profiles, projects and surveys written, none checkpointed.
      await expect(copy(inResponses, sampleOnto, { sample })).rejects.toThrow(/stopped/);
      expect(await sampleOnto.target.state.keys("survey:")).toEqual([]);
      expect(await count(sampleOnto.database, "surveys")).toBeGreaterThan(0);
      await expect(copy(source, sampleOnto, { sample: other })).rejects.toThrow(/wipe/);
      expect(await sampleOnto.target.state.get("sample")).toMatchObject({
        accounts: [OWNER_ID.toLowerCase()],
      });

      // A full copy's record is null: present, so a sample is refused there too.
      await expect(copy(atMarks, fullOnto, {})).rejects.toThrow(/stopped/);
      await expect(copy(source, fullOnto, { sample })).rejects.toThrow(/wipe/);
    } finally {
      await source.close();
      await sampleOnto.close();
      await fullOnto.close();
    }
  });

  it("plans the sample: its survey ids and its accounts' key hashes, the volumes and the estimate", async () => {
    fixtures ??= await readLegacyFixtures();
    const source = openSource();
    try {
      const sample = await selectSample(source, 0, [OWNER_ID]);
      const plan = await runPlan(source, {
        sample,
        measure: () => measureLegacyStores(config, { resultBytes: false }),
      });
      expect(plan.volumes.users).toBe(fixtures.users.length);
      expect(plan.volumes.surveys).toBe(fixtures.surveys.length);
      expect(plan.volumes.projects).toBe(fixtures.organizations.length);
      expect(plan.sample?.surveys).toEqual([...sample.surveys].sort());
      const ownerKey = fixtures.rawSqlRows.Users!.find(
        (row) => String(row.id).toLowerCase() === OWNER_ID.toLowerCase(),
      )!.accesskey as string;
      expect(plan.sample?.keyHashes).toEqual([hashCredential(ownerKey, "legacy-key")]);
      expect(plan.estimate).not.toBeNull();
    } finally {
      await source.close();
    }
  });
});

describe("a file several surveys link", () => {
  it("lets no survey go on to its checkpoint while another survey's task still writes the file", async () => {
    const into = await newTarget();
    try {
      let release = () => undefined as void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let reads = 0;
      const source = {
        async shareFile() {
          reads += 1;
          await held;
          return Buffer.from("asset bytes");
        },
      } as unknown as LegacySource;
      const copier = createSurveyCopier(source, into.target, {
        ctx: {
          projects: new Set(),
          projectsWithoutMembers: new Set(),
          people: new Set(),
          legacyUsers: new Set(),
          report: createReport(),
        },
        batchSize: 10,
        now,
      });
      const link = { kind: "asset" as const, name: LEGACY_ASSET_NAME };
      const first = copier.linkedFiles("22222222-0000-4000-8000-a00000000001", [link]);
      let secondDone = false;
      const second = copier
        .linkedFiles("22222222-0000-4000-8000-a00000000002", [link])
        .then(() => void (secondDone = true));
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
      expect(secondDone).toBe(false);
      release();
      await Promise.all([first, second]);
      expect(reads).toBe(1);
      expect(
        await into.target.existingKeys("legacy_files", [`asset/${LEGACY_ASSET_NAME}`]),
      ).toEqual([`asset/${LEGACY_ASSET_NAME}`]);
    } finally {
      await into.close();
    }
  });
});
