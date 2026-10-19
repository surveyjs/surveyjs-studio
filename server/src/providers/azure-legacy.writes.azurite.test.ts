import { randomUUID } from "node:crypto";
import type { TableClient } from "@azure/data-tables";
import type { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NewSurvey, SurveyOwner } from "../domain/types.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { localBlobServiceClient, localTableClient } from "../legacy/local-clients.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { LegacyStoreError, createAzureLegacyProviders } from "./azure-legacy/index.js";
import { PROJECT_B_ID, surveyDraft, surveyFeedback } from "./suite/expected.js";
import type { ProviderSet } from "./types.js";

// Runs in the `providers-azurite` Vitest project. Checks that survey create, update, clone and
// delete write exactly the legacy format (layout section 5.3), by reading the replica directly.
// Writes go to fresh personal scopes and to Engineering (project B) only; fixture surveys are only
// read (as clone sources), and afterAll restores the golden fixtures.

const SURVEYS_ACCOUNT = "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING";
const WRITTEN_COLUMNS = [
  "id",
  "name",
  "userid",
  "creatorid",
  "postid",
  "resultid",
  "createdat",
  "timestamp",
];
/** Containers of the saved results layouts (layout section 3.10). */
const LAYOUT_CONTAINERS = [
  "surveyresulttablestate",
  "surveyresultsummarystate",
  "surveyresultpermissions",
  "surveyresultcolumns",
];
/** Keys, system properties and the properties every survey event row has (layout section 3.5). */
const COMMON_EVENT_PROPERTIES = [
  "partitionKey",
  "rowKey",
  "etag",
  "timestamp",
  "id",
  "type",
  "happendat",
  "surveyid",
];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Warning {
  details: Readonly<Record<string, string>>;
  message: string;
}

/** A new survey; the creator is a fresh user unless the owner is personal. */
function newSurvey(owner: SurveyOwner, over: Partial<NewSurvey> = {}): NewSurvey {
  return {
    id: randomUUID(),
    name: "Writes test survey",
    owner,
    creatorId: owner.kind === "personal" ? owner.userId : randomUUID(),
    postId: randomUUID(),
    resultId: randomUUID(),
    createdAt: "2026-08-05T12:30:00.000Z",
    updatedAt: "2026-08-05T12:30:00.000Z",
    ...over,
  };
}

const personal = (): SurveyOwner => ({ kind: "personal", userId: randomUUID() });
const engineering: SurveyOwner = { kind: "project", projectId: PROJECT_B_ID };

describe("azure-legacy survey writes use the legacy format (local replica)", () => {
  const config = replicaConfig();
  const warnings: Warning[] = [];
  let providers: ProviderSet | undefined;
  let pool: sql.ConnectionPool | undefined;
  let blobs: BlobServiceClient;
  let events: TableClient;

  beforeAll(async () => {
    providers = createAzureLegacyProviders(config, {
      logger: { warn: (details, message) => warnings.push({ details, message }) },
    });
    pool = await new sql.ConnectionPool(config.sqlConnectionString).connect();
    blobs = localBlobServiceClient(config.surveysStorageConnectionString, SURVEYS_ACCOUNT);
    events = localTableClient(config.surveysStorageConnectionString, "surveys", SURVEYS_ACCOUNT);
  });

  // Runs even when beforeAll failed half way, so no written rows are left for other files.
  afterAll(async () => {
    try {
      await providers?.close();
      await pool?.close();
    } finally {
      await loadLegacyFixtures(replicaEnv(), { log: () => undefined });
    }
  });

  const store = (): ProviderSet => {
    if (!providers) throw new Error("beforeAll did not create the providers");
    return providers;
  };

  async function rawRow(id: string): Promise<Record<string, unknown> | undefined> {
    if (!pool) throw new Error("beforeAll did not connect");
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query<Record<string, unknown>>("SELECT * FROM Surveys WHERE id = @id");
    return result.recordset[0];
  }

  async function blobText(container: string, name: string): Promise<string> {
    const blob = blobs.getContainerClient(container).getBlobClient(name);
    return (await blob.downloadToBuffer()).toString("utf8");
  }

  async function blobType(container: string, name: string): Promise<string | undefined> {
    return (await blobs.getContainerClient(container).getBlobClient(name).getProperties()).blobType;
  }

  async function historyNames(surveyId: string): Promise<string[]> {
    const names: string[] = [];
    const container = blobs.getContainerClient("surveyjsonhistory");
    for await (const blob of container.listBlobsFlat({ prefix: `${surveyId}/` })) {
      names.push(blob.name);
    }
    return names;
  }

  /** The audit rows of a survey, each property as `{ value, type }` with its stored Edm type. */
  async function auditRows(surveyId: string): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for await (const entity of events.listEntities({
      queryOptions: { filter: `surveyid eq guid'${surveyId}'` },
      disableTypeConversion: true,
    })) {
      rows.push(entity as Record<string, unknown>);
    }
    return rows;
  }

  it("inserts exactly the legacy create columns, no blob, and a SURVEY_CREATE audit row", async () => {
    const survey = newSurvey(personal());
    const owner = survey.owner.kind === "personal" ? survey.owner.userId : "";
    await store().surveys.createSurvey(survey);

    const row = await rawRow(survey.id);
    expect(row).toBeDefined();
    const lower = (value: unknown) => String(value).toLowerCase();
    expect(lower(row!.id)).toBe(survey.id);
    expect(row!.name).toBe(survey.name);
    expect(lower(row!.userid)).toBe(owner);
    expect(lower(row!.creatorid)).toBe(survey.creatorId);
    expect(lower(row!.postid)).toBe(survey.postId);
    expect(lower(row!.resultid)).toBe(survey.resultId);
    expect((row!.createdat as Date).toISOString()).toBe(survey.createdAt);
    expect((row!.timestamp as Date).toISOString()).toBe(survey.updatedAt);
    for (const column of [
      "ispublished",
      "isarchived",
      "allowaccessresult",
      "storeipaddress",
      "usecookies",
      "theme",
      "publishid",
    ]) {
      expect(row, column).toHaveProperty(column, null);
    }
    // Every other column stays NULL, as the legacy create leaves it.
    for (const [column, value] of Object.entries(row!)) {
      if (!WRITTEN_COLUMNS.includes(column)) expect(value, column).toBeNull();
    }

    expect(await blobs.getContainerClient("surveyjson").getBlobClient(survey.id).exists()).toBe(
      false,
    );
    expect(await historyNames(survey.id)).toEqual([]);

    const audit = await auditRows(survey.id);
    expect(audit).toHaveLength(1);
    const entity = audit[0]!;
    const rowKey = String(entity.rowKey);
    expect(entity.partitionKey).toBe("*");
    expect(rowKey).toMatch(GUID);
    expect(entity).toMatchObject({
      id: { type: "Guid", value: rowKey },
      type: { type: "String", value: "SURVEY_CREATE" },
      happendat: { type: "DateTime" },
      surveyid: { type: "Guid", value: survey.id },
      postid: { type: "Guid", value: survey.postId },
      resultid: { type: "Guid", value: survey.resultId },
      userid: { type: "Guid", value: owner },
      creatorid: { type: "Guid", value: survey.creatorId },
      name: { type: "String", value: survey.name },
    });
    const happenedAt = (entity.happendat as { value: string }).value;
    expect(new Date(happenedAt).toISOString()).toBe(survey.createdAt);
  });

  it("writes the definition to identical surveyjson and surveytext append blobs and one history blob", async () => {
    const definition = {
      title: "Writes test",
      pages: [{ name: "page1", elements: [{ type: "comment", name: "q1", title: "Größe ✓" }] }],
    };
    const text = JSON.stringify(definition);
    const survey = newSurvey(personal());
    await store().surveys.createSurvey(survey, definition);

    for (const container of ["surveyjson", "surveytext"]) {
      expect(await blobType(container, survey.id), container).toBe("AppendBlob");
      expect(await blobText(container, survey.id), container).toBe(text);
    }
    const history = await historyNames(survey.id);
    expect(history).toHaveLength(1);
    const [point] = history as [string];
    expect(point.slice(survey.id.length + 1)).toMatch(GUID);
    expect(await blobType("surveyjsonhistory", point)).toBe("AppendBlob");
    expect(await blobText("surveyjsonhistory", point)).toBe(text);

    expect(await store().surveys.getDefinition(survey.id)).toEqual(definition);
  });

  it("stores a project survey under the project id and lists it in the project", async () => {
    const survey = newSurvey(engineering);
    const created = await store().surveys.createSurvey(survey);

    expect(String((await rawRow(survey.id))?.userid).toLowerCase()).toBe(PROJECT_B_ID);
    expect(created.owner).toEqual(engineering);
    expect(created.creatorId).toBe(survey.creatorId);
    expect(await store().surveys.getSurvey(survey.id)).toEqual(created);
    const page = await store().surveys.listSurveyPage({
      owner: engineering,
      archived: false,
      limit: 200,
    });
    expect(page.items).toContainEqual(created);
    const audit = await auditRows(survey.id);
    expect(audit[0]).toMatchObject({ userid: { type: "Guid", value: PROJECT_B_ID } });
  });

  /** The rejection of a create with an id that is taken; checks the message is safe. */
  async function expectDuplicateRejection(
    survey: NewSurvey,
    definition?: Record<string, unknown>,
  ): Promise<void> {
    const error: unknown = await store()
      .surveys.createSurvey(survey, definition)
      .then(
        () => undefined,
        (rejected: unknown) => rejected,
      );
    expect(error).toBeInstanceOf(LegacyStoreError);
    const message = (error as Error).message;
    expect(message).toMatch(/^Legacy store survey create failed \(.*SQL error 2627/);
    for (const secret of [
      config.sqlConnectionString,
      config.surveysStorageConnectionString,
      "Password",
      "AccountKey",
      "127.0.0.1",
      "devstoreaccount1",
    ]) {
      expect(message).not.toContain(secret);
    }
  }

  it("rejects a duplicate id with a LegacyStoreError that holds no connection-string text", async () => {
    const definition = { title: "First" };
    const first = await store().surveys.createSurvey(newSurvey(personal()), definition);

    await expectDuplicateRejection(newSurvey(personal(), { id: first.id }));
    await expectDuplicateRejection(newSurvey(personal(), { id: first.id }), { title: "Second" });

    // The first survey and its definition are unchanged.
    expect(await store().surveys.getSurvey(first.id)).toEqual(first);
    expect(await store().surveys.getDefinition(first.id)).toEqual(definition);
    expect(await historyNames(first.id)).toHaveLength(1);
  });

  it("writes no blob for a duplicate id whose survey has no definition yet", async () => {
    const first = await store().surveys.createSurvey(newSurvey(personal()));

    await expectDuplicateRejection(newSurvey(personal(), { id: first.id }), { title: "Second" });

    for (const container of ["surveyjson", "surveytext"]) {
      const blob = blobs.getContainerClient(container).getBlobClient(first.id);
      expect(await blob.exists(), container).toBe(false);
    }
    expect(await historyNames(first.id)).toEqual([]);
    expect(await store().surveys.getDefinition(first.id)).toEqual({});
    expect(await store().surveys.getSurvey(first.id)).toEqual(first);
  });

  it("round-trips a name of 200 characters with non-ASCII letters", async () => {
    const name = "Größenumfrage — Ünïcödé ✓ ".repeat(8).slice(0, 200);
    expect(name).toHaveLength(200);
    const survey = newSurvey(personal(), { name });
    const created = await store().surveys.createSurvey(survey);

    expect(created.name).toBe(name);
    expect((await rawRow(survey.id))?.name).toBe(name);
    expect((await store().surveys.getSurvey(survey.id))?.name).toBe(name);
  });

  it("recreates a missing audit table", async () => {
    await events.deleteTable();
    const survey = newSurvey(personal());
    await store().surveys.createSurvey(survey);

    const audit = await auditRows(survey.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: { value: "SURVEY_CREATE" } });
    // No create in this file needed the best-effort path.
    expect(warnings).toEqual([]);
  });

  it("still creates the survey when the audit row cannot be written, and warns with its id only", async () => {
    // The table endpoint points at a closed local port; SQL and blobs stay reachable.
    const surveysStorage = config.surveysStorageConnectionString.replace(
      /TableEndpoint=[^;]*/,
      "TableEndpoint=http://127.0.0.1:1/devstoreaccount1",
    );
    expect(surveysStorage).not.toBe(config.surveysStorageConnectionString);
    const local: Warning[] = [];
    const broken = createAzureLegacyProviders(
      { ...config, surveysStorageConnectionString: surveysStorage },
      { logger: { warn: (details, message) => local.push({ details, message }) } },
    );
    try {
      const survey = newSurvey(personal());
      const created = await broken.surveys.createSurvey(survey);
      expect(created.id).toBe(survey.id);
      expect(await store().surveys.getSurvey(survey.id)).toEqual(created);
      expect(local).toEqual([{ details: { surveyId: survey.id }, message: expect.any(String) }]);
      expect(local[0]!.message).not.toMatch(/127\.0\.0\.1|AccountKey|devstoreaccount1/);
    } finally {
      await broken.close();
    }
  });

  /** The event type of an audit row read without type conversion. */
  const typeOf = (row: Record<string, unknown>): string => (row.type as { value: string }).value;

  /** The audit rows of a survey except its `SURVEY_CREATE` row, in the order they were written. */
  async function laterAuditRows(surveyId: string): Promise<Record<string, unknown>[]> {
    const rows = (await auditRows(surveyId)).filter((row) => typeOf(row) !== "SURVEY_CREATE");
    // One partition with random row keys: the write order shows only in the system timestamp,
    // ISO 8601 text with 100 ns digits, so the text order is the time order.
    const written = (row: Record<string, unknown>) => String(row.timestamp);
    return rows.sort((a, b) => (written(a) < written(b) ? -1 : written(a) > written(b) ? 1 : 0));
  }

  /** Checks the properties every audit row has; returns its payload (the other properties). */
  function payloadOf(
    row: Record<string, unknown>,
    surveyId: string,
    type: string,
    happenedAt: string,
  ): Record<string, unknown> {
    const rowKey = String(row.rowKey);
    expect(row.partitionKey).toBe("*");
    expect(rowKey).toMatch(GUID);
    expect(row).toMatchObject({
      id: { type: "Guid", value: rowKey },
      type: { type: "String", value: type },
      happendat: { type: "DateTime" },
      surveyid: { type: "Guid", value: surveyId },
    });
    const happenedValue = (row.happendat as { value: string }).value;
    expect(new Date(happenedValue).toISOString()).toBe(happenedAt);
    return Object.fromEntries(
      Object.entries(row).filter(([key]) => !COMMON_EVENT_PROPERTIES.includes(key)),
    );
  }

  describe("updateSurvey", () => {
    const UPDATED_AT = "2026-09-01T12:34:56.000Z";

    it("renames: sets only name and timestamp, and writes one SURVEY_UPDATE row", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const before = await rawRow(survey.id);

      const updated = await store().surveys.updateSurvey(survey.id, {
        name: "Renamed — Größe ✓",
        updatedAt: UPDATED_AT,
      });

      expect(updated).toMatchObject({ name: "Renamed — Größe ✓", updatedAt: UPDATED_AT });
      expect(await rawRow(survey.id)).toEqual({
        ...before,
        name: "Renamed — Größe ✓",
        timestamp: new Date(UPDATED_AT),
      });
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_UPDATE", UPDATED_AT)).toEqual({
        name: { type: "String", value: "Renamed — Größe ✓" },
      });
    });

    it("applies a combined change in one row write, with typed columns and six audit rows in order", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const before = await rawRow(survey.id);
      const mover = randomUUID();

      const updated = await store().surveys.updateSurvey(survey.id, {
        name: "Combined",
        move: { owner: engineering, creatorId: mover.toUpperCase() },
        published: true,
        archived: true,
        settings: { publicResults: true, storeRespondentIp: true },
        updatedAt: UPDATED_AT,
      });

      expect(updated).toMatchObject({
        owner: engineering,
        creatorId: mover,
        published: true,
        archived: true,
        settings: { publicResults: true, storeRespondentIp: true, useCookies: false },
      });
      const row = await rawRow(survey.id);
      expect({ ...row, userid: undefined, creatorid: undefined }).toEqual({
        ...before,
        userid: undefined,
        creatorid: undefined,
        name: "Combined",
        ispublished: 1,
        isarchived: 1,
        allowaccessresult: 1,
        storeipaddress: "1",
        timestamp: new Date(UPDATED_AT),
      });
      expect(String(row!.userid).toLowerCase()).toBe(PROJECT_B_ID);
      expect(String(row!.creatorid).toLowerCase()).toBe(mover);

      const audit = await laterAuditRows(survey.id);
      expect(audit.map(typeOf)).toEqual([
        "SURVEY_UPDATE",
        "SURVEY_TRANSFER",
        "SURVEY_PUBLISHED",
        "SURVEY_ARCHIVE",
        "SURVEY_ACCESSRESUTL",
        "SURVEY_POSTRESUTL",
      ]);
      const payloads = audit.map((entity) =>
        payloadOf(entity, survey.id, typeOf(entity), UPDATED_AT),
      );
      expect(payloads).toEqual([
        { name: { type: "String", value: "Combined" } },
        {
          userid: { type: "Guid", value: PROJECT_B_ID },
          creatorid: { type: "Guid", value: mover },
        },
        { ispublished: { type: "Boolean", value: "true" } },
        {},
        { grantaccess: { type: "Boolean", value: "true" } },
        { storeipaddress: { type: "Boolean", value: "true" } },
      ]);

      // Turning everything off writes 0 / "0" and the restore event.
      const LATER = "2026-09-02T08:00:00.000Z";
      await store().surveys.updateSurvey(survey.id, {
        published: false,
        archived: false,
        settings: { publicResults: false, storeRespondentIp: false },
        updatedAt: LATER,
      });
      expect(await rawRow(survey.id)).toMatchObject({
        name: "Combined",
        ispublished: 0,
        isarchived: 0,
        allowaccessresult: 0,
        storeipaddress: "0",
        usecookies: null,
        timestamp: new Date(LATER),
      });
      const off = (await laterAuditRows(survey.id)).slice(6);
      expect(off.map((entity) => payloadOf(entity, survey.id, typeOf(entity), LATER))).toEqual([
        { ispublished: { type: "Boolean", value: "false" } },
        {},
        { grantaccess: { type: "Boolean", value: "false" } },
        { storeipaddress: { type: "Boolean", value: "false" } },
      ]);
      expect(off.map(typeOf)).toEqual([
        "SURVEY_PUBLISHED",
        "SURVEY_RESTORE",
        "SURVEY_ACCESSRESUTL",
        "SURVEY_POSTRESUTL",
      ]);
    });

    it("moves to Personal: the user id in userid, the mover in creatorid", async () => {
      const survey = newSurvey(engineering);
      await store().surveys.createSurvey(survey);
      const user = randomUUID();
      const mover = randomUUID();

      const updated = await store().surveys.updateSurvey(survey.id, {
        move: { owner: { kind: "personal", userId: user }, creatorId: mover },
        updatedAt: UPDATED_AT,
      });

      expect(updated).toMatchObject({
        owner: { kind: "personal", userId: user },
        creatorId: mover,
      });
      const row = await rawRow(survey.id);
      expect(String(row!.userid).toLowerCase()).toBe(user);
      expect(String(row!.creatorid).toLowerCase()).toBe(mover);
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_TRANSFER", UPDATED_AT)).toEqual({
        userid: { type: "Guid", value: user },
        creatorid: { type: "Guid", value: mover },
      });
    });

    it("moves only timestamp for { settings: {} } and writes no audit row", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const before = await rawRow(survey.id);

      const updated = await store().surveys.updateSurvey(survey.id, {
        settings: {},
        updatedAt: UPDATED_AT,
      });

      expect(updated?.updatedAt).toBe(UPDATED_AT);
      expect(await rawRow(survey.id)).toEqual({ ...before, timestamp: new Date(UPDATED_AT) });
      expect(await laterAuditRows(survey.id)).toEqual([]);
    });
  });

  describe("cloneSurvey", () => {
    const CLONED_AT = "2026-09-03T09:00:00.000Z";
    const copyOf = (owner: SurveyOwner) =>
      newSurvey(owner, { name: "Copy of source", createdAt: CLONED_AT, updatedAt: CLONED_AT });

    async function blobBytes(container: string, name: string): Promise<Buffer> {
      return blobs.getContainerClient(container).getBlobClient(name).downloadToBuffer();
    }

    it("copies the source's blob bytes and raw theme text into a row with the create columns", async () => {
      const source = surveyFeedback.id;
      const sourceTheme = (await rawRow(source))?.theme;
      expect(typeof sourceTheme).toBe("string");
      const sourceJson = await blobBytes("surveyjson", source);
      const copy = copyOf(personal());

      const stored = await store().surveys.cloneSurvey(source, copy);

      expect(stored?.id).toBe(copy.id);
      const row = await rawRow(copy.id);
      expect(row!.theme).toBe(sourceTheme);
      expect((row!.timestamp as Date).toISOString()).toBe(CLONED_AT);
      for (const [column, value] of Object.entries(row!)) {
        if (![...WRITTEN_COLUMNS, "theme"].includes(column)) expect(value, column).toBeNull();
      }
      for (const container of ["surveyjson", "surveytext"]) {
        expect(await blobType(container, copy.id), container).toBe("AppendBlob");
        expect((await blobBytes(container, copy.id)).equals(sourceJson), container).toBe(true);
      }
      const history = await historyNames(copy.id);
      expect(history).toHaveLength(1);
      expect((await blobBytes("surveyjsonhistory", history[0]!)).equals(sourceJson)).toBe(true);

      const audit = await auditRows(copy.id);
      expect(audit.map(typeOf).sort()).toEqual(["SURVEY_CREATE", "SURVEY_THEME_CHANGE"]);
      const themeChange = audit.find((entity) => typeOf(entity) === "SURVEY_THEME_CHANGE")!;
      expect(payloadOf(themeChange, copy.id, "SURVEY_THEME_CHANGE", CLONED_AT)).toEqual({
        theme: { type: "String", value: sourceTheme },
      });
    });

    it("copies a source without blob or theme as a row without blobs and a NULL theme", async () => {
      const copy = copyOf(personal());
      await store().surveys.cloneSurvey(surveyDraft.id, copy);

      const row = await rawRow(copy.id);
      expect(row).toBeDefined();
      for (const [column, value] of Object.entries(row!)) {
        if (!WRITTEN_COLUMNS.includes(column)) expect(value, column).toBeNull();
      }
      for (const container of ["surveyjson", "surveytext"]) {
        const blob = blobs.getContainerClient(container).getBlobClient(copy.id);
        expect(await blob.exists(), container).toBe(false);
      }
      expect(await historyNames(copy.id)).toEqual([]);
      const audit = await auditRows(copy.id);
      expect(audit.map(typeOf)).toEqual(["SURVEY_CREATE"]);
    });
  });

  describe("deleteSurvey", () => {
    const RESULTS_ACCOUNT = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";
    const resultsTable = (name: string) =>
      localTableClient(config.resultsStorageConnectionString, name, RESULTS_ACCOUNT);
    const compact = (id: string) => id.replaceAll("-", "");

    async function tableExists(name: string): Promise<boolean> {
      try {
        await resultsTable(name).listEntities().byPage({ maxPageSize: 1 }).next();
        return true;
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return false;
        throw error;
      }
    }

    async function putBlob(container: string, name: string, text: string): Promise<void> {
      const client = blobs.getContainerClient(container);
      await client.createIfNotExists();
      await client.getBlockBlobClient(name).upload(text, Buffer.byteLength(text));
    }

    it("deletes the results tables, every blob and the row, and writes one SURVEY_DELETE row", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Delete me" });
      const tables = [
        `post${compact(survey.postId)}`,
        `SurveyCompletion${compact(survey.id)}`,
        `postdelete${compact(survey.postId)}`,
      ];
      const [post, completion, postDelete] = tables as [string, string, string];
      await resultsTable(post).createTable();
      await resultsTable(post).createEntity({
        partitionKey: "*",
        rowKey: randomUUID(),
        result: '{"q1":1}',
      });
      await resultsTable(completion).createTable();
      await resultsTable(completion).createEntity({
        partitionKey: "*",
        rowKey: "client-1",
        ispartialcompleted: false,
      });
      await resultsTable(postDelete).createTable();
      await putBlob("surveyjsonhistory", `${survey.id}/${randomUUID()}`, '{"title":"Older"}');
      for (const container of LAYOUT_CONTAINERS) await putBlob(container, survey.id, "{}");
      for (const table of tables) expect(await tableExists(table), table).toBe(true);
      expect(await historyNames(survey.id)).toHaveLength(2);

      const deletedFrom = Date.now();
      expect(await store().surveys.deleteSurvey(survey.id)).toBe(true);
      const deletedUntil = Date.now();

      for (const table of tables) expect(await tableExists(table), table).toBe(false);
      for (const container of ["surveyjson", "surveytext", ...LAYOUT_CONTAINERS]) {
        const blob = blobs.getContainerClient(container).getBlobClient(survey.id);
        expect(await blob.exists(), container).toBe(false);
      }
      expect(await historyNames(survey.id)).toEqual([]);
      expect(await rawRow(survey.id)).toBeUndefined();
      expect(await store().surveys.getSurvey(survey.id)).toBeNull();
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ type: { type: "String", value: "SURVEY_DELETE" } });
      // Stamped with the provider's clock at the delete.
      const happenedAt = new Date((audit[0]!.happendat as { value: string }).value);
      expect(happenedAt.getTime()).toBeGreaterThanOrEqual(deletedFrom);
      expect(happenedAt.getTime()).toBeLessThanOrEqual(deletedUntil);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_DELETE", happenedAt.toISOString())).toEqual(
        {},
      );

      // Fixture 01's own data is untouched.
      expect(await tableExists(`post${compact(surveyFeedback.postId)}`)).toBe(true);
      const fixtureLayout = blobs
        .getContainerClient("surveyresulttablestate")
        .getBlobClient(surveyFeedback.id);
      expect(await fixtureLayout.exists()).toBe(true);
    });

    it("deletes a survey that never had blobs or results, once", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);

      expect(await store().surveys.deleteSurvey(survey.id)).toBe(true);
      expect(await rawRow(survey.id)).toBeUndefined();
      expect(await store().surveys.deleteSurvey(survey.id)).toBe(false);
      const types = (await laterAuditRows(survey.id)).map(typeOf);
      expect(types).toEqual(["SURVEY_DELETE"]);
    });
  });

  it("updates, clones and deletes when the audit table cannot be written, and warns with ids only", async () => {
    const surveysStorage = config.surveysStorageConnectionString.replace(
      /TableEndpoint=[^;]*/,
      "TableEndpoint=http://127.0.0.1:1/devstoreaccount1",
    );
    const local: Warning[] = [];
    const broken = createAzureLegacyProviders(
      { ...config, surveysStorageConnectionString: surveysStorage },
      { logger: { warn: (details, message) => local.push({ details, message }) } },
    );
    try {
      const survey = await store().surveys.createSurvey(newSurvey(personal()));
      const updated = await broken.surveys.updateSurvey(survey.id, {
        name: "Renamed without audit",
        published: true,
        updatedAt: "2026-09-04T10:00:00.000Z",
      });
      expect(updated).toMatchObject({ name: "Renamed without audit", published: true });
      expect(await store().surveys.getSurvey(survey.id)).toEqual(updated);

      const copy = newSurvey(personal());
      expect((await broken.surveys.cloneSurvey(surveyFeedback.id, copy))?.id).toBe(copy.id);
      expect(typeof (await rawRow(copy.id))?.theme).toBe("string");

      expect(await broken.surveys.deleteSurvey(survey.id)).toBe(true);
      expect(await rawRow(survey.id)).toBeUndefined();

      expect(local.map((warning) => warning.details)).toEqual([
        { surveyId: survey.id }, // SURVEY_UPDATE
        { surveyId: survey.id }, // SURVEY_PUBLISHED
        { surveyId: copy.id }, // SURVEY_CREATE
        { surveyId: copy.id }, // SURVEY_THEME_CHANGE
        { surveyId: survey.id }, // SURVEY_DELETE
      ]);
      expect(local.map((warning) => warning.message.match(/the (\w+) audit row/)?.[1])).toEqual([
        "SURVEY_UPDATE",
        "SURVEY_PUBLISHED",
        "SURVEY_CREATE",
        "SURVEY_THEME_CHANGE",
        "SURVEY_DELETE",
      ]);
      for (const { message } of local) {
        expect(message).not.toMatch(/127\.0\.0\.1|AccountKey|devstoreaccount1|Renamed/);
      }
    } finally {
      await broken.close();
    }
  });
});
