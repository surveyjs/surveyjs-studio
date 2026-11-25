import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashCredential, lastFour } from "../credentials/format.js";
import { legacyFileRecord } from "../domain/legacy-file.js";
import type { SurveyRecord } from "../domain/types.js";
import { localSuiteBytes, type SuiteBytes } from "../providers/sql-suite-setup.js";
import { createSqlProviders } from "../providers/sql.js";
import type { ProviderSet } from "../providers/types.js";
import { openDatabase, type SqlDatabase, type SqlDialectName } from "../sql/database.js";
import { migrate } from "../sql/migrator.js";
import type { DatabaseSchema } from "../sql/schema.js";
import { scratchDatabase, type ScratchDatabase } from "../sql/scratch-databases.js";
import type {
  DeletedRec,
  EventRec,
  FileRec,
  HistoryRec,
  KeyRec,
  LayoutRec,
  MarkerRec,
  MemberRec,
  PersonRec,
  ProjectRec,
  ResponseRec,
  SurveyRec,
  ViewRec,
} from "./records.js";
import { openMigrationTarget, type MigrationTarget } from "./target.js";

const guid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T0 = Date.UTC(2026, 0, 1);
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

const ALICE = guid(1);
const BOB = guid(2);
const PROJECT = guid(10);
const S1 = guid(100);
const S2 = guid(101);
const RESPONSE_COUNT = 5;
const HISTORY_COUNT = 25;
const KEEP = 20;

const surveyRecord = (id: string, name: string, owner: SurveyRecord["owner"]): SurveyRecord => ({
  id,
  name,
  owner,
  creatorId: ALICE,
  postId: guid(Number(id.slice(-3)) + 1000),
  resultId: guid(Number(id.slice(-3)) + 2000),
  legacyPublishId: guid(Number(id.slice(-3)) + 3000),
  published: true,
  archived: false,
  createdAt: at(1),
  updatedAt: at(2),
  settings: { publicResults: false, storeRespondentIp: true, useCookies: false },
});

const FILE_BYTES = Buffer.from("legacy image bytes");
const OWN_BYTES = Buffer.from("an own upload");
const OWN_ID = createHash("sha256").update("own").digest("hex");
const KEY_VALUE = "key-".repeat(4);

interface Data {
  surveys: SurveyRec[];
  history: HistoryRec[];
  responses: ResponseRec[];
  markers: MarkerRec[];
  layouts: LayoutRec[];
  views: ViewRec[];
  project: ProjectRec;
  members: MemberRec[];
  people: PersonRec[];
  keys: KeyRec[];
  files: FileRec[];
  events: EventRec[];
  deleted: DeletedRec[];
}

function fixtures(): Data {
  return {
    surveys: [
      {
        record: surveyRecord(S1, "First", { kind: "personal", userId: ALICE }),
        definition: { title: "First", pages: [{ elements: [{ type: "text", name: "q1" }] }] },
        theme: { themeName: "default" },
        privateQuestions: ["q1"],
      },
      {
        record: surveyRecord(S2, "Second", { kind: "project", projectId: PROJECT }),
        definition: { title: "Second" },
        theme: {},
        privateQuestions: [],
      },
    ],
    history: Array.from({ length: HISTORY_COUNT }, (_, i) => ({
      surveyId: S1,
      id: guid(500 + i),
      at: at(10 + i),
      userId: i % 2 === 0 ? ALICE : null,
      snapshot: { title: `Version ${i}` },
    })),
    responses: Array.from({ length: RESPONSE_COUNT }, (_, i) => ({
      surveyId: S1,
      response: {
        id: guid(700 + i),
        submittedAt: at(20 + i),
        data: { q1: `answer ${i}` },
        ...(i % 2 === 0 && { clientId: `client-${i}`, respondentIp: "10.0.0.1" }),
        partial: i === 1,
      },
    })),
    markers: [
      { surveyId: S1, clientId: "client-0", partial: false },
      { surveyId: S1, clientId: "Client-X", partial: true },
    ],
    layouts: [
      { surveyId: S1, kind: "table", text: '{"a":1}' },
      { surveyId: S1, kind: "columns", text: "q1 | hidden" },
    ],
    views: [
      { surveyId: S1, userId: ALICE, view: "summary", state: { charts: [1] }, updatedAt: at(30) },
      { surveyId: S1, userId: BOB, view: "table", state: null, updatedAt: at(31) },
    ],
    project: { id: PROJECT, name: "Team", creatorId: ALICE, createdAt: at(3) },
    members: [
      { projectId: PROJECT, userId: ALICE, role: "admin", createdAt: at(3), updatedAt: at(4) },
      { projectId: PROJECT, userId: BOB, role: "user", createdAt: at(3), updatedAt: at(5) },
    ],
    people: [
      {
        id: ALICE,
        email: "alice@example.com",
        displayName: "Alice",
        siteBlocked: false,
        createdAt: at(0),
      },
      {
        id: BOB,
        email: "bob@example.com",
        displayName: "Bob",
        siteBlocked: true,
        createdAt: at(0),
      },
    ],
    keys: [
      {
        userId: ALICE,
        keyHash: hashCredential(KEY_VALUE, "legacy-key"),
        lastFour: lastFour(KEY_VALUE.toLowerCase()),
        createdAt: at(0),
      },
    ],
    files: [
      {
        kind: "asset",
        legacyName: "picture.png",
        record: legacyFileRecord("asset", "picture.png", FILE_BYTES.length),
        content: FILE_BYTES,
      },
      {
        kind: "response",
        legacyName: null,
        record: {
          id: OWN_ID,
          surveyId: S1,
          kind: "response",
          name: "upload.txt",
          contentType: "text/plain",
          size: OWN_BYTES.length,
          createdAt: at(40),
        },
        content: OWN_BYTES,
      },
    ],
    events: [{ id: guid(900), surveyId: S1, type: "published", at: at(50), payload: '{"x":1}' }],
    deleted: [
      {
        surveyId: S1,
        responseId: guid(990),
        deletedAt: at(60),
        response: '{"data":{"q1":"gone"},"partial":false}',
      },
    ],
  };
}

async function writeAll(target: MigrationTarget, data: Data): Promise<void> {
  await target.upsertPeople(data.people);
  for (const survey of data.surveys) await target.upsertSurvey(survey);
  await target.upsertHistory(data.history);
  await target.upsertResponses(data.responses);
  await target.upsertMarkers(data.markers);
  await target.upsertLayouts(data.layouts);
  await target.upsertViews(data.views);
  await target.upsertProject(data.project, data.members);
  await target.upsertKeys(data.keys);
  for (const file of data.files) await target.upsertFile(file);
  await target.upsertEvents(data.events);
  await target.upsertDeleted(data.deleted);
}

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

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

/** The importer on one dialect. */
export function describeMigrationTargetSuite(dialect: SqlDialectName): void {
  describe(`migration target: ${dialect}`, () => {
    let scratch: ScratchDatabase;
    let database: SqlDatabase;
    let bytes: SuiteBytes;
    let target: MigrationTarget;
    let providers: ProviderSet;

    /** Every row of every table (sorted) and the stored bytes, as one text. */
    const dump = async (): Promise<string> => {
      const out: Record<string, string[]> = {};
      for (const table of TABLES) {
        const rows = await database.db.selectFrom(table).selectAll().execute();
        out[table] = rows.map((row) => JSON.stringify(row)).sort();
      }
      const stored: Record<string, string> = {};
      for (const file of fixtures().files) {
        const stream = await bytes.store.get(`${file.record.surveyId}/${file.record.id}`);
        stored[file.record.id] = stream ? (await readAll(stream)).toString("base64") : "missing";
      }
      return JSON.stringify({ out, stored });
    };

    const wipe = async (): Promise<void> => {
      for (const table of [...TABLES].reverse()) await database.db.deleteFrom(table).execute();
    };

    beforeAll(async () => {
      scratch = await scratchDatabase(dialect);
      database = openDatabase(scratch.target);
      await migrate(database);
      bytes = await localSuiteBytes();
      target = openMigrationTarget(database, bytes.store);
      providers = createSqlProviders(database, { bytes: bytes.store, localAccounts: true });
    });
    afterAll(async () => {
      await target.close();
      await database.close();
      await scratch.drop();
      await bytes.remove();
    });

    it("writes what the app reads back", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);

      const [first, second] = data.surveys;
      expect(await providers.surveys.getSurvey(S1)).toEqual(first!.record);
      expect(await providers.surveys.getSurvey(S2)).toEqual(second!.record);
      expect((await providers.surveys.getDefinition(S1))?.content).toEqual(first!.definition);
      expect((await providers.surveys.getTheme(S1))?.content).toEqual(first!.theme);
      const privates = await database.db
        .selectFrom("private_questions")
        .select("survey_id")
        .execute();
      expect(privates.map((row) => row.survey_id)).toEqual([S1]);

      const page = await providers.surveys.listHistory({ surveyId: S1, limit: 200 });
      expect(page.items.map((entry) => entry.id)).toEqual(
        data.history.map((entry) => entry.id).reverse(),
      );
      expect(page.items[0]).toMatchObject({ at: data.history.at(-1)!.at, userId: ALICE });

      const survey = (await providers.surveys.getSurvey(S1))!;
      const responses = await providers.results.listResponses(survey);
      expect(responses).toEqual(data.responses.map((rec) => rec.response));
      expect(await providers.results.completion(survey, "client-0")).toBe("completed");
      expect(await providers.results.completion(survey, "Client-X")).toBe("partial");
      expect(await providers.results.completion(survey, "nobody")).toBe("none");

      expect(await providers.views.getLayout(S1, "table")).toBe('{"a":1}');
      expect(await providers.views.getLayout(S1, "columns")).toBe("q1 | hidden");
      expect(await providers.views.getView(S1, ALICE, "summary")).toEqual({ charts: [1] });
      expect(await providers.views.getView(S1, BOB, "table")).toBeNull();

      expect(await providers.projects.getProject(PROJECT)).toMatchObject({
        id: PROJECT,
        name: "Team",
        ownerId: ALICE,
        createdAt: at(3),
        memberCount: 2,
      });
      const members = await providers.projects.listMembers(PROJECT);
      expect(members.map((m) => [m.user.id, m.role])).toEqual([
        [ALICE, "admin"],
        [BOB, "user"],
      ]);

      expect(await providers.accounts!.listIdentities(ALICE)).toEqual([
        {
          provider: "surveyjs",
          subject: ALICE,
          userId: ALICE,
          email: "alice@example.com",
          emailVerified: true,
          createdAt: at(0),
        },
      ]);
      expect(await providers.users.getUser(BOB)).toMatchObject({
        email: "bob@example.com",
        displayName: "Bob",
      });
      const bobRow = await database.db
        .selectFrom("users")
        .select(["site_blocked", "status", "instance_role", "password_hash"])
        .where("id", "=", BOB)
        .executeTakeFirstOrThrow();
      expect(bobRow).toMatchObject({
        status: "active",
        instance_role: "user",
        password_hash: null,
      });
      expect(bobRow.site_blocked === true || bobRow.site_blocked === 1).toBe(true);

      expect(await providers.credentials.legacyKeyOf(ALICE)).toEqual({
        lastFour: lastFour(KEY_VALUE.toLowerCase()),
        revoked: false,
      });

      const legacy = await providers.files.getFileByLegacyName("asset", "picture.png");
      expect(legacy!.file).toMatchObject({ name: "picture.png", size: FILE_BYTES.length });
      expect(await readAll(legacy!.content)).toEqual(FILE_BYTES);
      const own = await providers.files.getFile(OWN_ID);
      expect(await readAll(own!.content)).toEqual(OWN_BYTES);

      const event = await database.db.selectFrom("survey_events").selectAll().executeTakeFirst();
      expect(event).toMatchObject({ id: guid(900), type: "published", payload: '{"x":1}' });
      const deleted = await database.db
        .selectFrom("deleted_responses")
        .selectAll()
        .executeTakeFirst();
      expect(deleted).toMatchObject({ response_id: guid(990) });
    });

    it("leaves identical rows and bytes when everything is written twice", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      const once = await dump();
      await writeAll(target, data);
      expect(await dump()).toBe(once);
    });

    it("takes the new values of changed data", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);

      const renamed = structuredClone(data.surveys[0]!);
      renamed.record = { ...renamed.record, name: "Renamed", updatedAt: at(99) };
      renamed.definition = { title: "Renamed" };
      renamed.privateQuestions = [];
      await target.upsertSurvey(renamed);
      await target.upsertResponses([
        {
          surveyId: S1,
          response: { ...data.responses[0]!.response, data: { q1: "changed" }, partial: true },
        },
      ]);
      await target.upsertMarkers([{ surveyId: S1, clientId: "client-0", partial: true }]);
      await target.upsertPeople([{ ...data.people[0]!, displayName: "Alice B" }]);

      const survey = (await providers.surveys.getSurvey(S1))!;
      expect(survey.name).toBe("Renamed");
      expect((await providers.surveys.getDefinition(S1))?.content).toEqual({ title: "Renamed" });
      expect(
        await database.db.selectFrom("private_questions").select("survey_id").execute(),
      ).toEqual([]);
      const responses = await providers.results.listResponses(survey);
      expect(responses).toHaveLength(RESPONSE_COUNT);
      expect(responses[0]).toMatchObject({ data: { q1: "changed" }, partial: true });
      expect(await providers.results.completion(survey, "client-0")).toBe("partial");
      expect((await providers.users.getUser(ALICE))?.displayName).toBe("Alice B");
    });

    it("lets two people swap emails in one call", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      const [alice, bob] = data.people;
      const result = await target.upsertPeople([
        { ...alice!, email: bob!.email },
        { ...bob!, email: alice!.email },
      ]);
      expect(result.skipped).toEqual([]);
      expect((await providers.users.getUser(ALICE))?.email).toBe("bob@example.com");
      expect((await providers.users.getUser(BOB))?.email).toBe("alice@example.com");
      const rows = await database.db.selectFrom("users").select("email").execute();
      expect(rows.some((row) => row.email.includes("parked"))).toBe(false);
    });

    it("skips a person whose email belongs to someone outside the call", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      const carol = { ...data.people[0]!, id: guid(3), email: "carol@example.com" };
      await target.upsertPeople([carol]);
      const result = await target.upsertPeople([
        { ...data.people[0]!, email: carol.email },
        { ...data.people[1]!, displayName: "Bob 2" },
      ]);
      expect(result.skipped).toEqual([{ id: ALICE, reason: "email-taken" }]);
      expect((await providers.users.getUser(ALICE))?.email).toBe("alice@example.com");
      expect((await providers.users.getUser(BOB))?.displayName).toBe("Bob 2");
    });

    it("does not write a person whose identity is linked to another account", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      const stranger = guid(5);
      await database.db
        .insertInto("user_identities")
        .values({
          provider: "surveyjs",
          subject: stranger,
          user_id: BOB,
          email: "other@example.com",
          email_verified: true,
          created_at: at(0),
        })
        .execute();
      const result = await target.upsertPeople([
        { ...data.people[0]!, id: stranger, email: "stranger@example.com" },
      ]);
      expect(result.skipped).toEqual([{ id: stranger, reason: "identity-linked-elsewhere" }]);
      expect(await providers.users.getUser(stranger)).toBeNull();
      const link = await database.db
        .selectFrom("user_identities")
        .select(["user_id", "email"])
        .where("subject", "=", stranger)
        .executeTakeFirstOrThrow();
      expect(link).toEqual({ user_id: BOB, email: "other@example.com" });
    });

    it("replaces the member set of a project", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      await target.upsertProject({ ...data.project, name: "Team 2" }, [data.members[0]!]);
      const members = await providers.projects.listMembers(PROJECT);
      expect(members.map((m) => m.user.id)).toEqual([ALICE]);
      expect((await providers.projects.getProject(PROJECT))?.name).toBe("Team 2");
    });

    it("reads back a survey's stored private questions, [] for none", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      expect(await target.privateQuestionsOf(S1.toUpperCase())).toEqual(["q1"]);
      expect(await target.privateQuestionsOf(S2)).toEqual([]);
      expect(await target.privateQuestionsOf(guid(999))).toEqual([]);
    });

    it("lists the ids of the surveys, projects and users, ascending", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      const sorted = (ids: string[]) => [...ids].sort();
      expect(await target.idsOf("surveys")).toEqual(sorted(data.surveys.map((s) => s.record.id)));
      expect(await target.idsOf("projects")).toEqual([data.project.id]);
      expect(await target.idsOf("users")).toEqual(sorted(data.people.map((p) => p.id)));
    });

    it("prunes the history to the newest by (at, id)", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      expect(await target.pruneHistory(S1, KEEP)).toBe(HISTORY_COUNT - KEEP);
      const page = await providers.surveys.listHistory({ surveyId: S1, limit: 200 });
      expect(page.items.map((entry) => entry.id)).toEqual(
        data.history
          .slice(HISTORY_COUNT - KEEP)
          .map((entry) => entry.id)
          .reverse(),
      );
      expect(await target.pruneHistory(S1, KEEP)).toBe(0);
    });

    it("writes U+0000 in a response as U+FFFD", async () => {
      await wipe();
      const data = fixtures();
      await target.upsertSurvey(data.surveys[0]!);
      await target.upsertResponses([
        {
          surveyId: S1,
          response: {
            id: guid(800),
            submittedAt: at(70),
            data: { "k\u0000ey": "a\u0000b" },
            partial: false,
          },
        },
      ]);
      const survey = (await providers.surveys.getSurvey(S1))!;
      const [stored] = await providers.results.listResponses(survey);
      expect(stored!.data).toEqual({ "k\uFFFDey": "a\uFFFDb" });
    });

    it("writes more rows than one statement takes", async () => {
      await wipe();
      const data = fixtures();
      await target.upsertSurvey(data.surveys[0]!);
      const many = Array.from({ length: 450 }, (_, i) => ({
        surveyId: S1,
        response: {
          id: guid(10_000 + i),
          submittedAt: at(100 + i),
          data: { n: i },
          partial: false,
        },
      }));
      await target.upsertResponses(many);
      await target.upsertResponses(many);
      const survey = (await providers.surveys.getSurvey(S1))!;
      expect(await providers.results.listResponses(survey)).toHaveLength(many.length);
    });

    it("refuses an id that is not a GUID", async () => {
      await wipe();
      const data = fixtures();
      await expect(
        target.upsertSurvey({
          ...data.surveys[0]!,
          record: { ...data.surveys[0]!.record, id: "not-a-guid" },
        }),
      ).rejects.toThrow();
      await expect(
        target.upsertPeople([{ ...data.people[0]!, id: "not-a-guid" }]),
      ).rejects.toThrow();
      await expect(
        target.upsertResponses([
          { surveyId: S1, response: { ...data.responses[0]!.response, id: "nope" } },
        ]),
      ).rejects.toThrow();
    });

    it("deletes what the source no longer has", async () => {
      await wipe();
      const data = fixtures();
      await writeAll(target, data);
      expect(await target.deleteResponses(S1, [guid(700), guid(701), guid(12345)])).toBe(2);
      expect(await target.deleteProject(PROJECT)).toBe(true);
      expect(await target.deleteProject(PROJECT)).toBe(false);
      expect(await target.deletePeople([BOB, guid(777)])).toBe(1);
      expect(await providers.accounts!.listIdentities(BOB)).toEqual([]);
      expect(await target.deleteSurvey(S1)).toBe(true);
      expect(await target.deleteSurvey(S1)).toBe(false);
      for (const table of [
        "survey_history",
        "survey_responses",
        "completion_markers",
        "saved_views",
        "survey_layouts",
        "private_questions",
        "survey_events",
        "deleted_responses",
      ] as const) {
        expect(await database.db.selectFrom(table).selectAll().execute()).toEqual([]);
      }
      expect(await providers.surveys.getSurvey(S2)).not.toBeNull();
    });

    it("keeps its state in the state store", async () => {
      await target.state.clear();
      await target.state.set("run", { id: "r1" }, at(0));
      expect(await target.state.get("run")).toEqual({ id: "r1" });
    });
  });
}
