import { randomUUID } from "node:crypto";
import { TableServiceClient, type TableClient } from "@azure/data-tables";
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  newPipeline,
  type RequestPolicyFactory,
  type WebResource,
} from "@azure/storage-blob";
import sql from "mssql";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { newFileId } from "../domain/file-id.js";
import type {
  NewProject,
  NewResponse,
  NewSurvey,
  StoredFileRecord,
  SurveyOwner,
  SurveyRecord,
} from "../domain/types.js";
import { loadLegacyFixtures } from "../legacy/load-fixtures.js";
import { localBlobServiceClient, localTableClient } from "../legacy/local-clients.js";
import { replicaConfig, replicaEnv } from "../legacy/replica-env.js";
import { LegacyStoreError, createAzureLegacyProviders } from "./azure-legacy/index.js";
import {
  ADMIN_ID,
  MEMBER_ID,
  PROJECT_B_ID,
  adminUser,
  memberUser,
  surveyDraft,
  surveyFeedback,
} from "./suite/expected.js";
import { ResponseTooLargeError, type AppendOutcome, type ProviderSet } from "./types.js";
import {
  writeDefinitionSave,
  writeThemeSave,
  type LegacyWriteTargets,
} from "./azure-legacy/writes.js";

// Runs in the `providers-azurite` Vitest project. Checks that survey create, update, clone,
// delete and the definition and theme saves write exactly the legacy format (layout section 5.3),
// and that editor files go to their own container only (Step 7, R2), by reading the replica
// directly, and that project and member writes change exactly the Organizations and
// OrganizationUsers columns the Step 11 rulings name.
// Writes go to fresh personal scopes, to Engineering (project B) and to projects the tests create
// and delete; fixture projects and memberships are never written; fixture surveys are only
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

    expect((await store().surveys.getDefinition(survey.id))?.content).toEqual(definition);
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
    expect((await store().surveys.getDefinition(first.id))?.content).toEqual(definition);
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
    expect((await store().surveys.getDefinition(first.id))?.content).toEqual({});
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

    it("stores the rewritten definition and theme text for the copy only", async () => {
      const definition = { title: "Größe OLD-ID ✓", logo: "https://x/api/v1/public/files/OLD-ID" };
      const theme = { cssVariables: { "--logo": "url(https://x/OLD-ID)" } };
      const source = await store().surveys.createSurvey(newSurvey(personal()), definition);
      const themeVersion = (await store().surveys.getTheme(source.id))!.version;
      await store().surveys.saveTheme(source.id, theme, {
        ifVersion: themeVersion,
        savedAt: "2026-09-02T08:00:00.000Z",
      });
      const sourceRow = await rawRow(source.id);
      const [sourcePoint] = (await historyNames(source.id)) as [string];
      const sourceBlobs = async () => [
        await blobBytes("surveyjson", source.id),
        await blobBytes("surveytext", source.id),
        await blobBytes("surveyjsonhistory", sourcePoint),
      ];
      const sourceBefore = await sourceBlobs();
      const copy = copyOf(personal());

      const rewriteText = (text: string) => text.replaceAll("OLD-ID", "NEW-ID");
      await store().surveys.cloneSurvey(source.id, copy, { rewriteText });

      const expected = Buffer.from(rewriteText(JSON.stringify(definition)), "utf8");
      const history = await historyNames(copy.id);
      expect(history).toHaveLength(1);
      const copyBlobs: [string, string][] = [
        ["surveyjson", copy.id],
        ["surveytext", copy.id],
        ["surveyjsonhistory", history[0]!],
      ];
      for (const [container, name] of copyBlobs) {
        expect(await blobType(container, name), container).toBe("AppendBlob");
        const bytes = await blobBytes(container, name);
        expect(bytes.equals(expected), container).toBe(true);
        expect([...bytes.subarray(0, 3)], container).not.toEqual([0xef, 0xbb, 0xbf]);
      }
      const rewrittenTheme = rewriteText(String(sourceRow!.theme));
      expect(rewrittenTheme).toContain("NEW-ID");
      expect((await rawRow(copy.id))!.theme).toBe(rewrittenTheme);
      const audit = await auditRows(copy.id);
      const themeChange = audit.find((entity) => typeOf(entity) === "SURVEY_THEME_CHANGE")!;
      expect(payloadOf(themeChange, copy.id, "SURVEY_THEME_CHANGE", CLONED_AT)).toEqual({
        theme: { type: "String", value: rewrittenTheme },
      });

      expect(await rawRow(source.id)).toEqual(sourceRow);
      expect(await historyNames(source.id)).toEqual([sourcePoint]);
      expect(await sourceBlobs()).toEqual(sourceBefore);
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

  describe("files", () => {
    const FILES_CONTAINER = "my-surveys-files";
    const LEGACY_CONTAINERS = ["surveyjson", "surveytext", "surveyjsonhistory"];
    /** A minimal valid 1x1 PNG. */
    const PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
      "base64",
    );
    const fileOf = (surveyId: string, over: Partial<StoredFileRecord> = {}): StoredFileRecord => ({
      id: newFileId(surveyId),
      surveyId,
      kind: "asset",
      name: "logo.png",
      contentType: "image/png",
      size: PNG.length,
      createdAt: "2026-09-01T10:00:00.000Z",
      ...over,
    });
    /** Fresh survey ids (the store does not need the survey); their files are removed at the end. */
    const surveyIds: string[] = [];
    const freshSurveyId = (): string => {
      const id = randomUUID();
      surveyIds.push(id);
      return id;
    };
    afterAll(async () => {
      for (const id of surveyIds) await store().files.deleteSurveyFiles(id);
    });

    async function namesUnder(container: string, prefix: string): Promise<string[]> {
      const names: string[] = [];
      const client = blobs.getContainerClient(container);
      if (!(await client.exists())) return names;
      for await (const blob of client.listBlobsFlat({ prefix })) names.push(blob.name);
      return names.sort();
    }

    it("stores a block blob {surveyId}/{id} with the type, the metadata and the bytes, and no legacy blob", async () => {
      const surveyId = freshSurveyId();
      const name = 'Логотип "ü" 1.png';
      const file = fileOf(surveyId, { name });
      await store().files.putFile(file, PNG);

      const blob = blobs
        .getContainerClient(FILES_CONTAINER)
        .getBlobClient(`${surveyId}/${file.id}`);
      const properties = await blob.getProperties();
      expect(properties.blobType).toBe("BlockBlob");
      expect(properties.contentType).toBe("image/png");
      expect(properties.metadata).toEqual({
        kind: "asset",
        name: encodeURIComponent(name),
        createdat: "2026-09-01T10:00:00.000Z",
      });
      expect((await blob.downloadToBuffer()).equals(PNG)).toBe(true);

      for (const container of LEGACY_CONTAINERS) {
        expect(await namesUnder(container, surveyId), container).toEqual([]);
        expect(await namesUnder(container, file.id), container).toEqual([]);
      }
    });

    it("creates its container on the first upload", async () => {
      const container = `files-test-${randomUUID()}`;
      const client = blobs.getContainerClient(container);
      expect(await client.exists()).toBe(false);
      const own = createAzureLegacyProviders(config, { filesContainer: container });
      try {
        const file = fileOf(randomUUID());
        await own.files.putFile(file, PNG);
        expect(await client.exists()).toBe(true);
        expect(await namesUnder(container, "")).toEqual([`${file.surveyId}/${file.id}`]);
        expect((await own.files.getFile(file.id))?.file).toEqual(file);
      } finally {
        await own.close();
        await client.deleteIfExists();
      }
    });

    it("deletes exactly the survey's blobs", async () => {
      const surveyId = freshSurveyId();
      const other = freshSurveyId();
      const mine = [fileOf(surveyId), fileOf(surveyId)];
      const theirs = fileOf(other);
      for (const file of [...mine, theirs]) await store().files.putFile(file, PNG);

      expect(await store().files.deleteSurveyFiles(surveyId)).toBe(2);

      expect(await namesUnder(FILES_CONTAINER, `${surveyId}/`)).toEqual([]);
      expect(await namesUnder(FILES_CONTAINER, `${other}/`)).toEqual([`${other}/${theirs.id}`]);
    });
  });

  describe("views", () => {
    const VIEWS = "my-surveys-views";
    const RESULTS_ACCOUNT = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";
    const FIXTURE_SURVEY = "22222222-0000-4000-8000-a00000000001";
    const compact = (id: string) => id.replaceAll("-", "");
    const freshSurvey = (): Promise<SurveyRecord> =>
      store().surveys.createSurvey(newSurvey(personal()));

    async function viewNames(surveyId: string): Promise<string[]> {
      const names: string[] = [];
      try {
        for await (const blob of blobs
          .getContainerClient(VIEWS)
          .listBlobsFlat({ prefix: `${surveyId}/` })) {
          names.push(blob.name);
        }
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode !== 404) throw error;
      }
      return names;
    }

    async function putViewBlob(name: string, text: string): Promise<void> {
      const client = blobs.getContainerClient(VIEWS);
      await client.createIfNotExists();
      await client.getBlockBlobClient(name).upload(text, Buffer.byteLength(text));
    }

    it("saves a block blob of JSON at {survey}/{user}/{view}, all lower case", async () => {
      const survey = await freshSurvey();
      const user = randomUUID();
      await store().views.saveView(survey.id.toUpperCase(), user.toUpperCase(), "summary", {
        a: 1,
      });
      const name = `${survey.id}/${user}/summary`;
      const properties = await blobs.getContainerClient(VIEWS).getBlobClient(name).getProperties();
      expect(properties.blobType).toBe("BlockBlob");
      expect(properties.contentType).toBe("application/json");
      expect(await blobText(VIEWS, name)).toBe('{"a":1}');
      expect(await store().views.getView(survey.id, user, "summary")).toEqual({ a: 1 });
    });

    it("leaves a zero-byte blob on reset, and a later save replaces it", async () => {
      const survey = await freshSurvey();
      const user = randomUUID();
      const name = `${survey.id}/${user}/table`;
      await store().views.saveView(survey.id, user, "table", { a: 1 });
      await store().views.resetView(survey.id, user, "table");
      const properties = await blobs.getContainerClient(VIEWS).getBlobClient(name).getProperties();
      expect(properties.contentLength).toBe(0);
      expect(await store().views.getView(survey.id, user, "table")).toBeNull();
      await store().views.saveView(survey.id, user, "table", { b: 2 });
      expect(await blobText(VIEWS, name)).toBe('{"b":2}');
    });

    it("answers null for a stored blob that is not a JSON object, warning with ids only", async () => {
      const survey = await freshSurvey();
      const user = randomUUID();
      for (const [view, text] of [
        ["summary", "[1]"],
        ["table", "not json"],
      ] as const) {
        await putViewBlob(`${survey.id}/${user}/${view}`, text);
        const before = warnings.length;
        expect(await store().views.getView(survey.id, user, view)).toBeNull();
        const added = warnings.splice(before); // later tests expect no warnings
        expect(added).toHaveLength(1);
        expect(added[0]!.details).toEqual({ surveyId: survey.id, userId: user, view });
        expect(JSON.stringify(added)).not.toContain(text);
        warnings.length = before; // later tests assert on an empty log
      }
    });

    it("removes every view of the survey with it, and deleting one without views works", async () => {
      const survey = await freshSurvey();
      const [first, second] = [randomUUID(), randomUUID()];
      for (const user of [first, second]) {
        await store().views.saveView(survey.id, user, "summary", { a: 1 });
        await store().views.saveView(survey.id, user, "table", { a: 2 });
      }
      expect(await viewNames(survey.id)).toHaveLength(4);
      expect(await store().surveys.deleteSurvey(survey.id)).toBe(true);
      expect(await viewNames(survey.id)).toEqual([]);

      const plain = await freshSurvey();
      expect(await store().surveys.deleteSurvey(plain.id)).toBe(true);
    });

    it("never changes the legacy layout blobs of a fixture survey", async () => {
      const user = randomUUID();
      const containers = ["surveyresultsummarystate", "surveyresulttablestate"];
      const read = async (container: string) => {
        const client = blobs.getContainerClient(container).getBlobClient(FIXTURE_SURVEY);
        const properties = await client.getProperties();
        return { etag: properties.etag, text: await blobText(container, FIXTURE_SURVEY) };
      };
      const before = await Promise.all(containers.map(read));
      await store().views.saveView(FIXTURE_SURVEY, user, "summary", { a: 1 });
      await store().views.saveView(FIXTURE_SURVEY, user, "table", { a: 1 });
      await store().views.resetView(FIXTURE_SURVEY, user, "summary");
      await store().views.resetView(FIXTURE_SURVEY, user, "table");
      expect(await Promise.all(containers.map(read))).toEqual(before);
      const views = blobs.getContainerClient(VIEWS);
      await views.getBlobClient(`${FIXTURE_SURVEY}/${user}/summary`).delete();
      await views.getBlobClient(`${FIXTURE_SURVEY}/${user}/table`).delete();
    });

    it("writes no audit row and does not touch Surveys.timestamp", async () => {
      const survey = await freshSurvey();
      const user = randomUUID();
      const before = await rawRow(survey.id);
      const auditBefore = (await auditRows(survey.id)).length;
      await store().views.saveView(survey.id, user, "summary", { a: 1 });
      await store().views.resetView(survey.id, user, "summary");
      const after = await rawRow(survey.id);
      expect((after!.timestamp as Date).getTime()).toBe((before!.timestamp as Date).getTime());
      expect(await auditRows(survey.id)).toHaveLength(auditBefore);
    });

    it("skips a broken row while paging, never repeating a good one", async () => {
      const survey = await freshSurvey();
      const warned = warnings.length;
      const good: string[] = [];
      for (let n = 0; n < 5; n++) {
        const id = randomUUID();
        good.push(id);
        await store().results.appendResponse(survey, {
          id,
          submittedAt: new Date(Date.UTC(2026, 8, 10, 8, 0, n)).toISOString(),
          data: { q1: n },
        });
      }
      const table = localTableClient(
        config.resultsStorageConnectionString,
        `post${compact(survey.postId)}`,
        RESULTS_ACCOUNT,
      );
      const addBroken = (over: Record<string, unknown>) => {
        const id = randomUUID();
        return table.createEntity({
          partitionKey: "*",
          rowKey: id,
          id: { type: "Guid", value: id },
          happendat: new Date(Date.UTC(2026, 8, 10, 8, 0, 2, 500)),
          result: "{}",
          ...over,
        } as never);
      };
      await addBroken({ result: "not json" });
      await addBroken({ happendat: { type: "String", value: "2026-09-10T08:00:03.500Z" } });

      const seen: string[] = [];
      let after;
      let guard = 0;
      do {
        const page = await store().results.listResponsePage(survey, {
          limit: 2,
          ...(after && { after }),
        });
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((item) => item.id));
        after = page.next ?? undefined;
      } while (after && ++guard < 20);
      expect(seen).toEqual(good);
      warnings.length = warned; // the skipped rows were reported by id; later tests expect none
    });
  });

  describe("results", () => {
    const RESULTS_ACCOUNT = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";
    const SUBMITTED_AT = "2026-09-10T08:30:15.250Z";
    const compact = (id: string) => id.replaceAll("-", "");
    const table = (name: string) =>
      localTableClient(config.resultsStorageConnectionString, name, RESULTS_ACCOUNT);
    const rowsTable = (survey: SurveyRecord) => table(`post${compact(survey.postId)}`);
    const markersTable = (survey: SurveyRecord) => table(`SurveyCompletion${compact(survey.id)}`);

    async function tableExists(name: string): Promise<boolean> {
      try {
        await table(name).listEntities().byPage({ maxPageSize: 1 }).next();
        return true;
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) return false;
        throw error;
      }
    }

    /** A new survey of a fresh personal scope. */
    const freshSurvey = (): Promise<SurveyRecord> =>
      store().surveys.createSurvey(newSurvey(personal()));

    const append = (
      survey: SurveyRecord,
      id: string,
      over: Partial<NewResponse> = {},
    ): Promise<AppendOutcome> =>
      store().results.appendResponse(survey, {
        id,
        submittedAt: SUBMITTED_AT,
        data: { q1: "first" },
        ...over,
      });

    /** The row read without type conversion: the other properties come as `{ value, type }`. */
    async function raw(client: TableClient, rowKey: string): Promise<Record<string, unknown>> {
      return (await client.getEntity("*", rowKey, { disableTypeConversion: true })) as Record<
        string,
        unknown
      >;
    }
    const SYSTEM = ["partitionKey", "rowKey", "etag", "timestamp"];
    const propertiesOf = (row: Record<string, unknown>): string[] =>
      Object.keys(row)
        .filter((key) => !SYSTEM.includes(key) && !key.startsWith("odata"))
        .sort();

    it("creates post{postId} with exactly the legacy row properties and Edm types", async () => {
      const survey = await freshSurvey();
      const name = `post${compact(survey.postId)}`;
      expect(await tableExists(name)).toBe(false);
      const id = randomUUID();
      expect(
        await append(survey, id.toUpperCase(), {
          data: { q1: "a", q2: [1, 2] },
          clientId: "client-w1",
          respondentIp: "203.0.113.9",
        }),
      ).toBe("stored");
      expect(await tableExists(name)).toBe(true);

      const row = await raw(rowsTable(survey), id);
      expect(row.partitionKey).toBe("*");
      expect(row.rowKey).toBe(id);
      expect(propertiesOf(row)).toEqual(
        ["id", "type", "happendat", "surveyid", "postid", "result", "clientid", "ipaddress"].sort(),
      );
      expect(row.id).toEqual({ type: "Guid", value: id });
      expect(row.type).toEqual({ type: "String", value: "SURVEY_POSTRESUTL" });
      expect(row.happendat).toEqual({ type: "DateTime", value: SUBMITTED_AT });
      const surveyid = row.surveyid as { type: string; value: string };
      expect(surveyid.type).toBe("Guid");
      expect(surveyid.value).toMatch(GUID);
      expect(surveyid.value).not.toBe(survey.id);
      expect(row.postid).toEqual({ type: "Guid", value: survey.postId });
      expect(row.result).toEqual({ type: "String", value: '{"q1":"a","q2":[1,2]}' });
      expect(row.clientid).toEqual({ type: "String", value: "client-w1" });
      expect(row.ipaddress).toEqual({ type: "String", value: "203.0.113.9" });
      expect(row).not.toHaveProperty("ispartialcompleted");
    });

    it("writes neither clientid nor ipaddress when they are not given", async () => {
      const survey = await freshSurvey();
      const id = randomUUID();
      await append(survey, id);
      const row = await raw(rowsTable(survey), id);
      expect(propertiesOf(row)).toEqual(
        ["id", "type", "happendat", "surveyid", "postid", "result"].sort(),
      );
      expect(await tableExists(`SurveyCompletion${compact(survey.id)}`)).toBe(false);
    });

    it("writes the marker with a Boolean false, and publishid once the survey has one", async () => {
      const survey = await freshSurvey();
      await append(survey, randomUUID(), { clientId: "client-m1" });
      const marker = await raw(markersTable(survey), "client-m1");
      expect(marker.partitionKey).toBe("*");
      expect(marker.rowKey).toBe("client-m1");
      expect(propertiesOf(marker)).toEqual(["ispartialcompleted"]);
      expect(marker.ispartialcompleted).toEqual({ type: "Boolean", value: "false" });
      expect(await store().results.completion(survey, "client-m1")).toBe("completed");

      if (!pool) throw new Error("beforeAll did not connect");
      const publishId = randomUUID().toUpperCase();
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, survey.id)
        .input("p", sql.UniqueIdentifier, publishId)
        .query("UPDATE Surveys SET publishid = @p WHERE id = @id");
      await append(survey, randomUUID(), { clientId: "client-m1" });
      const after = await raw(markersTable(survey), "client-m1");
      expect(propertiesOf(after)).toEqual(["ispartialcompleted", "publishid"]);
      expect(after.publishid).toEqual({ type: "String", value: publishId.toLowerCase() });
      expect(after.ispartialcompleted).toEqual({ type: "Boolean", value: "false" });
    });

    it("round-trips a client id with a quote, an accent and spaces", async () => {
      const survey = await freshSurvey();
      const clientId = "o'Brien é  x";
      await append(survey, randomUUID(), { clientId });
      expect(await store().results.completion(survey, clientId)).toBe("completed");
      expect(await store().results.completion(survey, "O'BRIEN É  X")).toBe("none");
      expect((await store().results.listResponses(survey))[0]?.clientId).toBe(clientId);
    });

    describe("the 32,768 character cap", () => {
      /** Data whose JSON text has exactly `length` characters. */
      const dataOfLength = (length: number): Record<string, unknown> => {
        const base = JSON.stringify({ t: "" }).length;
        return { t: "x".repeat(length - base) };
      };

      it("stores exactly 32,768 and reads it back equal", async () => {
        const survey = await freshSurvey();
        const data = dataOfLength(32_768);
        expect(JSON.stringify(data)).toHaveLength(32_768);
        expect(await append(survey, randomUUID(), { data })).toBe("stored");
        expect((await store().results.listResponses(survey))[0]?.data).toEqual(data);
      });

      it("refuses 32,769 with ResponseTooLargeError and writes nothing", async () => {
        const survey = await freshSurvey();
        const id = randomUUID();
        const data = dataOfLength(32_769);
        const error = await append(survey, id, { data, clientId: "client-big" }).catch(
          (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(ResponseTooLargeError);
        expect(error).toMatchObject({ length: 32_769, max: 32_768 });
        expect(await store().results.hasResponse(survey, id)).toBe(false);
        expect(await tableExists(`post${compact(survey.postId)}`)).toBe(false);
        expect(await store().results.completion(survey, "client-big")).toBe("none");
      });
    });

    it("keeps the first row when the same id comes again", async () => {
      const survey = await freshSurvey();
      const id = randomUUID();
      expect(await append(survey, id, { data: { q1: "first" } })).toBe("stored");
      expect(await append(survey, id, { data: { q1: "second" } })).toBe("exists");
      const row = await raw(rowsTable(survey), id);
      expect(row.result).toEqual({ type: "String", value: '{"q1":"first"}' });
    });

    it("adds no row to the surveys audit table", async () => {
      const survey = await freshSurvey();
      const before = (await auditRows(survey.id)).length;
      await append(survey, randomUUID(), { clientId: "client-audit" });
      await append(survey, randomUUID());
      expect(await auditRows(survey.id)).toHaveLength(before);
    });

    it("is dropped with the survey: post{postId} and SurveyCompletion{surveyId}", async () => {
      const survey = await freshSurvey();
      await append(survey, randomUUID(), { clientId: "client-del" });
      const names = [`post${compact(survey.postId)}`, `SurveyCompletion${compact(survey.id)}`];
      for (const name of names) expect(await tableExists(name), name).toBe(true);
      expect(await store().surveys.deleteSurvey(survey.id)).toBe(true);
      for (const name of names) expect(await tableExists(name), name).toBe(false);
    });

    it("stores a respondent file with the kind response", async () => {
      const survey = await freshSurvey();
      const file: StoredFileRecord = {
        id: newFileId(survey.id),
        surveyId: survey.id,
        kind: "response",
        name: "receipt.bin",
        contentType: "application/octet-stream",
        size: 4,
        createdAt: "2026-09-10T08:30:15.250Z",
      };
      try {
        await store().files.putFile(file, Buffer.from([1, 2, 3, 4]));
        const properties = await blobs
          .getContainerClient("my-surveys-files")
          .getBlobClient(`${survey.id}/${file.id}`)
          .getProperties();
        expect(properties.metadata?.kind).toBe("response");
        expect((await store().files.getFile(file.id))?.file).toEqual(file);
      } finally {
        await store().files.deleteSurveyFiles(survey.id);
      }
    });
  });

  describe("results deletion", () => {
    const RESULTS_ACCOUNT = "LEGACY_RESULTS_STORAGE_CONNECTION_STRING";
    const compact = (id: string) => id.replaceAll("-", "");
    const table = (name: string) =>
      localTableClient(config.resultsStorageConnectionString, name, RESULTS_ACCOUNT);

    async function entityCount(name: string): Promise<number> {
      let count = 0;
      for await (const entity of table(name).listEntities({
        queryOptions: { select: ["RowKey"] },
      })) {
        expect(entity.rowKey).toBeDefined();
        count += 1;
      }
      return count;
    }

    const freshSurvey = (): Promise<SurveyRecord> =>
      store().surveys.createSurvey(newSurvey(personal()));

    it("empties post{postId} and SurveyCompletion{surveyId} in batches, keeps the tables and postdelete, and writes one audit row", async () => {
      const survey = await freshSurvey();
      const postName = `post${compact(survey.postId)}`;
      const markerName = `SurveyCompletion${compact(survey.id)}`;
      const deletedName = `postdelete${compact(survey.postId)}`;
      for (let from = 0; from < 150; from += 25) {
        await Promise.all(
          Array.from({ length: 25 }, (_, offset) => {
            const n = from + offset;
            return store().results.appendResponse(survey, {
              id: randomUUID(),
              submittedAt: new Date(Date.UTC(2026, 8, 10, 8, 0, 0, n)).toISOString(),
              data: { q1: `answer ${String(n)}` },
              ...(n % 5 === 0 && { clientId: `client-del-${String(n)}` }),
            });
          }),
        );
      }
      await table(deletedName).createTable();
      const keptKey = randomUUID();
      await table(deletedName).createEntity({ partitionKey: "*", rowKey: keptKey });
      expect(await entityCount(postName)).toBe(150);
      expect(await entityCount(markerName)).toBe(30);
      const before = await rawRow(survey.id);

      await store().results.deleteAll(survey);

      expect(await entityCount(postName)).toBe(0);
      expect(await entityCount(markerName)).toBe(0);
      expect(await entityCount(deletedName)).toBe(1);
      expect(await table(deletedName).getEntity("*", keptKey)).toBeDefined();
      expect(await store().results.completion(survey, "client-del-0")).toBe("none");
      expect(
        await store().results.appendResponse(survey, {
          id: randomUUID(),
          submittedAt: "2026-09-11T08:00:00.000Z",
          data: { q1: "after" },
        }),
      ).toBe("stored");
      expect(await entityCount(postName)).toBe(1);

      const audit = (await auditRows(survey.id)).filter(
        (row) => typeOf(row) === "SURVEY_DELETEALLRESULTS",
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.surveyid).toEqual({ type: "Guid", value: survey.id });
      expect((await rawRow(survey.id))?.timestamp).toEqual(before?.timestamp);
    });

    it("resolves for a survey that never had a results table", async () => {
      const survey = await freshSurvey();
      await expect(store().results.deleteAll(survey)).resolves.toBeUndefined();
    });
  });

  describe("kind-limited file deletion", () => {
    it("deletes only the files of one kind", async () => {
      const survey = await store().surveys.createSurvey(newSurvey(personal()));
      const make = (kind: "asset" | "response"): StoredFileRecord => ({
        id: newFileId(survey.id),
        surveyId: survey.id,
        kind,
        name: "f.bin",
        contentType: "application/octet-stream",
        size: 2,
        createdAt: "2026-09-10T08:30:15.250Z",
      });
      const asset = make("asset");
      const response = make("response");
      const container = blobs.getContainerClient("my-surveys-files");
      try {
        await store().files.putFile(asset, Buffer.from([1, 2]));
        await store().files.putFile(response, Buffer.from([1, 2]));

        expect(await store().files.deleteSurveyFiles(survey.id, "response")).toBe(1);

        expect(await container.getBlobClient(`${survey.id}/${asset.id}`).exists()).toBe(true);
        expect(await container.getBlobClient(`${survey.id}/${response.id}`).exists()).toBe(false);
      } finally {
        await store().files.deleteSurveyFiles(survey.id);
      }
    });
  });

  describe("public questions", () => {
    const CONTAINER = "surveyresultpermissions";

    it("writes an append blob with the legacy JSON, and no SQL or audit change", async () => {
      const survey = await store().surveys.createSurvey(newSurvey(personal()));
      const before = await rawRow(survey.id);
      const auditBefore = (await auditRows(survey.id)).length;

      await store().views.savePrivateQuestions(survey.id, ["q2", "q1"]);

      expect(await blobType(CONTAINER, survey.id)).toBe("AppendBlob");
      expect(await blobText(CONTAINER, survey.id)).toBe(
        '[{"name":"q2","isPublic":false},{"name":"q1","isPublic":false}]',
      );
      expect(await store().views.getPrivateQuestions(survey.id)).toEqual(["q2", "q1"]);
      await store().views.savePrivateQuestions(survey.id, []);
      expect(await blobText(CONTAINER, survey.id)).toBe("[]");
      expect(await rawRow(survey.id)).toEqual(before);
      expect(await auditRows(survey.id)).toHaveLength(auditBefore);
    });

    it("reads the legacy defaults, and fails closed for a list it cannot read", async () => {
      const survey = await store().surveys.createSurvey(newSurvey(personal()));
      const client = blobs.getContainerClient(CONTAINER);
      await client.createIfNotExists();
      const put = async (text: string) =>
        client.getBlockBlobClient(survey.id).upload(text, Buffer.byteLength(text));

      await put('[{"name":"a"},{"name":"b","isPublic":false}]');
      expect(await store().views.getPrivateQuestions(survey.id)).toEqual(["b"]);

      // Zero bytes (an append blob between its create and its append), text that is no JSON and
      // JSON that is no array: never "every question public".
      const before = warnings.length;
      for (const text of ["", "[{", '{"name":"b"}']) {
        await put(text);
        const read = store().views.getPrivateQuestions(survey.id);
        await expect(read, JSON.stringify(text)).rejects.toThrow(LegacyStoreError);
        await expect(read).rejects.toThrow("Legacy store public questions read failed");
      }
      const empty = client.getAppendBlobClient(survey.id);
      await empty.deleteIfExists();
      await empty.create();
      await expect(store().views.getPrivateQuestions(survey.id)).rejects.toThrow(LegacyStoreError);
      expect(warnings.slice(before)).toEqual([]);
    });

    it("removes the blob with the survey", async () => {
      const survey = await store().surveys.createSurvey(newSurvey(personal()));
      await store().views.savePrivateQuestions(survey.id, ["q1"]);
      expect(await store().surveys.deleteSurvey(survey.id)).toBe(true);
      expect(await blobs.getContainerClient(CONTAINER).getBlobClient(survey.id).exists()).toBe(
        false,
      );
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

  describe("saveDefinition", () => {
    const SAVED_AT = "2026-09-05T08:15:30.250Z";

    async function blobBytes(container: string, name: string): Promise<Buffer> {
      return blobs.getContainerClient(container).getBlobClient(name).downloadToBuffer();
    }

    async function blobProperties(container: string, name: string) {
      return blobs.getContainerClient(container).getBlobClient(name).getProperties();
    }

    /** What the legacy blob reader does: download, decode UTF-8, parse (research-legacy D). */
    async function legacyRead(container: string, name: string): Promise<unknown> {
      return JSON.parse((await blobBytes(container, name)).toString("utf8"));
    }

    it("rewrites surveyjson and surveytext, adds a history point with the user, moves only timestamp", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Before" });
      const [createPoint] = (await historyNames(survey.id)) as [string];
      const before = await rawRow(survey.id);
      const read = (await store().surveys.getDefinition(survey.id))!;
      const definition = {
        title: "After — Größe ✓",
        pages: [{ name: "page1", elements: [{ type: "text", name: "q1" }] }],
      };
      const text = JSON.stringify(definition);

      const outcome = await store().surveys.saveDefinition(survey.id, definition, {
        ifVersion: read.version,
        userId: ADMIN_ID.toUpperCase(),
        savedAt: SAVED_AT,
      });

      // The version is the blob's own ETag, unquoted (R1).
      const etag = (await blobProperties("surveyjson", survey.id)).etag;
      expect(outcome).toEqual({ kind: "saved", version: etag?.replaceAll('"', "") });
      expect((await store().surveys.getDefinition(survey.id))?.version).toBe(
        (outcome as { version: string }).version,
      );
      const json = await blobBytes("surveyjson", survey.id);
      for (const container of ["surveyjson", "surveytext"]) {
        expect(await blobType(container, survey.id), container).toBe("AppendBlob");
        const bytes = await blobBytes(container, survey.id);
        expect(bytes.toString("utf8"), container).toBe(text);
        expect(bytes[0], container).toBe(0x7b); // `{`: no BOM
        expect(bytes.equals(json), container).toBe(true);
      }
      const history = await historyNames(survey.id);
      expect(history).toHaveLength(2);
      const point = history.find((name) => name !== createPoint)!;
      expect(point.slice(survey.id.length + 1)).toMatch(GUID);
      expect(await blobType("surveyjsonhistory", point)).toBe("AppendBlob");
      expect((await blobBytes("surveyjsonhistory", point)).equals(json)).toBe(true);
      expect((await blobProperties("surveyjsonhistory", point)).metadata).toEqual({
        userid: ADMIN_ID,
        savedat: SAVED_AT,
      });

      expect(await rawRow(survey.id)).toEqual({ ...before, timestamp: new Date(SAVED_AT) });
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_UPDATE", SAVED_AT)).toEqual({});
    });

    it("writes blobs a legacy reader reads like the golden fixture's", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const definition = { title: "Legacy reader", pages: [{ name: "p1", elements: [] }] };
      const read = (await store().surveys.getDefinition(survey.id))!;
      await store().surveys.saveDefinition(survey.id, definition, {
        ifVersion: read.version,
        userId: ADMIN_ID,
        savedAt: SAVED_AT,
      });
      const [point] = (await historyNames(survey.id)) as [string];
      const [fixturePoint] = (await historyNames(surveyFeedback.id)) as [string];

      const pairs: [container: string, ours: string, fixture: string][] = [
        ["surveyjson", survey.id, surveyFeedback.id],
        ["surveytext", survey.id, surveyFeedback.id],
        ["surveyjsonhistory", point, fixturePoint],
      ];
      for (const [container, ours, fixture] of pairs) {
        expect(await blobType(container, ours), container).toBe(await blobType(container, fixture));
        const [first] = await blobBytes(container, ours);
        const [fixtureFirst] = await blobBytes(container, fixture);
        expect(first, container).toBe(fixtureFirst); // both start with `{`, neither with a BOM
        const parsed = await legacyRead(container, ours);
        expect(parsed, container).toEqual(definition);
        expect(typeof (await legacyRead(container, fixture)), container).toBe("object");
      }
    });

    it("writes nothing for a stale version", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Start" });
      const start = (await store().surveys.getDefinition(survey.id))!;
      const first = await store().surveys.saveDefinition(
        survey.id,
        { title: "First" },
        { ifVersion: start.version, userId: ADMIN_ID, savedAt: SAVED_AT },
      );
      expect(first.kind).toBe("saved");
      const snapshot = async () => ({
        json: (await blobBytes("surveyjson", survey.id)).toString("utf8"),
        text: (await blobBytes("surveytext", survey.id)).toString("utf8"),
        jsonEtag: (await blobProperties("surveyjson", survey.id)).etag,
        textEtag: (await blobProperties("surveytext", survey.id)).etag,
        history: (await historyNames(survey.id)).sort(),
        row: await rawRow(survey.id),
        audit: (await auditRows(survey.id)).length,
      });
      const before = await snapshot();

      const stale = await store().surveys.saveDefinition(
        survey.id,
        { title: "Second" },
        { ifVersion: start.version, userId: ADMIN_ID, savedAt: "2026-09-05T09:00:00.000Z" },
      );

      expect(stale).toEqual({ kind: "conflict" });
      expect(await snapshot()).toEqual(before);
    });

    /** The write targets of the replica, with `blobsClient` for the surveys account's blobs. */
    function targetsWith(blobsClient: BlobServiceClient): LegacyWriteTargets {
      return {
        pool: () => Promise.resolve(pool!),
        blobs: blobsClient,
        events,
        resultTables: TableServiceClient.fromConnectionString(
          config.resultsStorageConnectionString,
          { allowInsecureConnection: true },
        ),
        resultTable: (name) =>
          localTableClient(
            config.resultsStorageConnectionString,
            name,
            "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
          ),
        logger: { warn: (details, message) => warnings.push({ details, message }) },
      };
    }

    /**
     * A client of the replica's surveys account (the guarded client's URL) whose Append Block
     * requests on `surveyjson/{surveyId}` first go to `intercept`. Throwing there stands for a
     * request that got no answer.
     */
    function blobsWithAppendHook(
      surveyId: string,
      intercept: (request: WebResource) => Promise<void>,
    ): BlobServiceClient {
      const connection = config.surveysStorageConnectionString;
      const account = /(?:^|;)AccountName=([^;]+)/.exec(connection)?.[1];
      const key = /(?:^|;)AccountKey=([^;]+)/.exec(connection)?.[1];
      if (!account || !key) throw new Error("The replica's surveys account has no account key");
      const pipeline = newPipeline(new StorageSharedKeyCredential(account, key));
      const hook: RequestPolicyFactory = {
        create: (next) => ({
          sendRequest: async (request) => {
            const url = new URL(request.url);
            if (
              request.method === "PUT" &&
              url.searchParams.get("comp") === "appendblock" &&
              url.pathname.endsWith(`/surveyjson/${surveyId}`)
            ) {
              await intercept(request);
            }
            return next.sendRequest(request);
          },
        }),
      };
      // First in the list: before the SDK's own retries, so each try of ours is one request.
      pipeline.factories.unshift(hook);
      return new BlobServiceClient(blobs.url, pipeline);
    }

    const noAnswer = () => Promise.reject(new Error("injected: no answer"));

    it("reads surveytext with surveyjson's ETag when surveyjson is empty; the next save rewrites both", async () => {
      // An empty surveyjson is what a save leaves when it fails after Put Blob.
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Before" });
      const emptied = await blobs
        .getContainerClient("surveyjson")
        .getAppendBlobClient(survey.id)
        .create();
      expect((await blobBytes("surveyjson", survey.id)).length).toBe(0);

      const read = await store().surveys.getDefinition(survey.id);

      expect(read).toEqual({
        content: { title: "Before" },
        version: emptied.etag?.replaceAll('"', ""),
      });
      const outcome = await store().surveys.saveDefinition(
        survey.id,
        { title: "After" },
        { ifVersion: read!.version, userId: ADMIN_ID, savedAt: SAVED_AT },
      );
      expect(outcome.kind).toBe("saved");
      for (const container of ["surveyjson", "surveytext"]) {
        expect((await blobBytes(container, survey.id)).toString("utf8"), container).toBe(
          '{"title":"After"}',
        );
      }
      expect((await store().surveys.getDefinition(survey.id))?.content).toEqual({ title: "After" });
    });

    it("tries an append that got no answer again, and saves", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Before" });
      const read = (await store().surveys.getDefinition(survey.id))!;
      let tries = 0;
      const targets = targetsWith(
        blobsWithAppendHook(survey.id, () => (++tries === 1 ? noAnswer() : Promise.resolve())),
      );

      const outcome = await writeDefinitionSave(targets, survey.id, '{"title":"After"}', {
        blobVersion: read.version,
        userId: ADMIN_ID,
        savedAt: SAVED_AT,
      });

      expect(outcome).toEqual({
        kind: "saved",
        version: (await blobProperties("surveyjson", survey.id)).etag?.replaceAll('"', ""),
      });
      expect(tries).toBe(2);
      for (const container of ["surveyjson", "surveytext"]) {
        expect((await blobBytes(container, survey.id)).toString("utf8"), container).toBe(
          '{"title":"After"}',
        );
      }
    });

    it("gives up after three tries; the read then serves the previous text and the next save heals it", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Before" });
      const read = (await store().surveys.getDefinition(survey.id))!;
      let tries = 0;
      const targets = targetsWith(
        blobsWithAppendHook(survey.id, () => {
          tries += 1;
          return noAnswer();
        }),
      );

      await expect(
        writeDefinitionSave(targets, survey.id, '{"title":"Lost"}', {
          blobVersion: read.version,
          userId: ADMIN_ID,
          savedAt: SAVED_AT,
        }),
      ).rejects.toThrow(LegacyStoreError);

      expect(tries).toBe(3);
      expect((await blobBytes("surveyjson", survey.id)).length).toBe(0);
      expect((await blobBytes("surveytext", survey.id)).toString("utf8")).toBe(
        '{"title":"Before"}',
      );
      const after = (await store().surveys.getDefinition(survey.id))!;
      expect(after.content).toEqual({ title: "Before" });
      expect(after.version).not.toBe(read.version);
      // The editor's next save carries the version of that read.
      const healed = await store().surveys.saveDefinition(
        survey.id,
        { title: "Healed" },
        { ifVersion: after.version, userId: ADMIN_ID, savedAt: SAVED_AT },
      );
      expect(healed.kind).toBe("saved");
      for (const container of ["surveyjson", "surveytext"]) {
        expect((await blobBytes(container, survey.id)).toString("utf8"), container).toBe(
          '{"title":"Healed"}',
        );
      }
    });

    it("does not try an append again that storage refused because the blob changed", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey, { title: "Before" });
      const read = (await store().surveys.getDefinition(survey.id))!;
      let tries = 0;
      const other = blobs.getContainerClient("surveyjson").getAppendBlobClient(survey.id);
      // Another writer changes the blob between our Put Blob and our append: storage answers 412.
      const targets = targetsWith(
        blobsWithAppendHook(survey.id, async () => {
          tries += 1;
          await other.appendBlock("{}", 2);
        }),
      );

      const outcome = await writeDefinitionSave(targets, survey.id, '{"title":"Mine"}', {
        blobVersion: read.version,
        userId: ADMIN_ID,
        savedAt: SAVED_AT,
      });

      expect(outcome).toEqual({ kind: "conflict" });
      expect(tries).toBe(1);
      expect((await blobBytes("surveytext", survey.id)).toString("utf8")).toBe(
        '{"title":"Before"}',
      );
    });

    it("creates the blobs on the first save of a survey without a definition", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const read = (await store().surveys.getDefinition(survey.id))!;
      expect(read).toEqual({ content: {}, version: "none" });

      const outcome = await store().surveys.saveDefinition(
        survey.id,
        { title: "First" },
        { ifVersion: "none", userId: ADMIN_ID, savedAt: SAVED_AT },
      );

      expect(outcome.kind).toBe("saved");
      for (const container of ["surveyjson", "surveytext"]) {
        expect(await blobType(container, survey.id), container).toBe("AppendBlob");
        expect((await blobBytes(container, survey.id)).toString("utf8")).toBe('{"title":"First"}');
      }
      expect(await historyNames(survey.id)).toHaveLength(1);
      // "none" no longer matches: the blob exists now (storage answers 409).
      const again = await store().surveys.saveDefinition(
        survey.id,
        { title: "Again" },
        { ifVersion: "none", userId: ADMIN_ID, savedAt: SAVED_AT },
      );
      expect(again).toEqual({ kind: "conflict" });
      expect(await historyNames(survey.id)).toHaveLength(1);
    });
  });

  describe("saveTheme", () => {
    const SAVED_AT = "2026-09-06T14:00:00.000Z";

    async function savedTheme(theme: Record<string, unknown>) {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const before = await rawRow(survey.id);
      const read = (await store().surveys.getTheme(survey.id))!;
      const outcome = await store().surveys.saveTheme(survey.id, theme, {
        ifVersion: read.version,
        savedAt: SAVED_AT,
      });
      return { survey, before, outcome };
    }

    it("sets theme and timestamp only, and writes one SURVEY_THEME_CHANGE row with the theme", async () => {
      const theme = {
        themeName: "default",
        cssVariables: { "--sjs-primary-backcolor": "#19b394" },
      };
      const text = JSON.stringify(theme);
      const { survey, before, outcome } = await savedTheme(theme);

      expect(outcome.kind).toBe("saved");
      expect(await rawRow(survey.id)).toEqual({
        ...before,
        theme: text,
        timestamp: new Date(SAVED_AT),
      });
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_THEME_CHANGE", SAVED_AT)).toEqual({
        theme: { type: "String", value: text },
      });
      expect(await historyNames(survey.id)).toEqual([]);
    });

    it("saves a 40,000-character theme and leaves the theme out of its audit row", async () => {
      const theme = { backgroundImage: `data:image/png;base64,${"A".repeat(40_000)}` };
      const { survey, outcome } = await savedTheme(theme);

      expect(outcome.kind).toBe("saved");
      expect((await rawRow(survey.id))?.theme).toBe(JSON.stringify(theme));
      const audit = await laterAuditRows(survey.id);
      expect(audit).toHaveLength(1);
      expect(payloadOf(audit[0]!, survey.id, "SURVEY_THEME_CHANGE", SAVED_AT)).toEqual({});
      expect(warnings).toEqual([]);
    });

    it("returns the version of the stored text for a non-ASCII theme, so the next save succeeds", async () => {
      const theme = { title: "é ✓ 日本" };
      const { survey, outcome } = await savedTheme(theme);

      expect(outcome.kind).toBe("saved");
      const read = (await store().surveys.getTheme(survey.id))!;
      expect(outcome).toEqual({ kind: "saved", version: read.version });
      const next = await store().surveys.saveTheme(
        survey.id,
        { title: "é again" },
        { ifVersion: read.version, savedAt: "2026-09-06T14:00:01.000Z" },
      );
      expect(next.kind).toBe("saved");
    });

    it("writes nothing for a stale version", async () => {
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const start = (await store().surveys.getTheme(survey.id))!;
      const first = await store().surveys.saveTheme(
        survey.id,
        { themeName: "one" },
        { ifVersion: start.version, savedAt: SAVED_AT },
      );
      expect(first.kind).toBe("saved");
      const row = await rawRow(survey.id);
      const audit = (await auditRows(survey.id)).length;

      const stale = await store().surveys.saveTheme(
        survey.id,
        { themeName: "two" },
        { ifVersion: start.version, savedAt: "2026-09-06T15:00:00.000Z" },
      );

      expect(stale).toEqual({ kind: "conflict" });
      expect(await rawRow(survey.id)).toEqual(row);
      expect(await auditRows(survey.id)).toHaveLength(audit);
    });

    it("refuses in SQL when the column changed after the version check", async () => {
      // writeThemeSave is the write after the provider compared the version: a column that no
      // longer holds the expected text must stay as it is (the check-then-write window, R2).
      const targets: LegacyWriteTargets = {
        pool: () => Promise.resolve(pool!),
        blobs,
        events,
        resultTables: TableServiceClient.fromConnectionString(
          config.resultsStorageConnectionString,
          {
            allowInsecureConnection: true,
          },
        ),
        resultTable: (name) =>
          localTableClient(
            config.resultsStorageConnectionString,
            name,
            "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
          ),
        logger: { warn: (details, message) => warnings.push({ details, message }) },
      };
      const survey = newSurvey(personal());
      await store().surveys.createSurvey(survey);
      const saved = await writeThemeSave(targets, survey.id, '{"themeName":"one"}', {
        expectedRaw: "",
        savedAt: SAVED_AT,
      });
      expect(saved).toEqual({ kind: "saved", stored: '{"themeName":"one"}' });
      const row = await rawRow(survey.id);

      for (const expectedRaw of ["", '{"themeName":"ONE"}', '{"themeName":"one"} ']) {
        const outcome = await writeThemeSave(targets, survey.id, '{"themeName":"two"}', {
          expectedRaw,
          savedAt: "2026-09-06T16:00:00.000Z",
        });
        expect(outcome, JSON.stringify(expectedRaw)).toEqual({ kind: "conflict" });
      }
      expect(await rawRow(survey.id)).toEqual(row);
      expect(
        await writeThemeSave(targets, randomUUID(), "{}", { expectedRaw: "", savedAt: SAVED_AT }),
      ).toEqual({ kind: "not-found" });
    });
  });

  describe("history points", () => {
    async function metadataOf(name: string): Promise<Record<string, string> | undefined> {
      return (
        await blobs.getContainerClient("surveyjsonhistory").getBlobClient(name).getProperties()
      ).metadata;
    }

    it("names the creator and the creation time on the point of a create and of a clone", async () => {
      const survey = newSurvey(engineering, { createdAt: "2026-08-05T12:30:00.123Z" });
      await store().surveys.createSurvey(survey, { title: "Created" });
      const [point] = (await historyNames(survey.id)) as [string];
      expect(await metadataOf(point)).toEqual({
        userid: survey.creatorId,
        savedat: "2026-08-05T12:30:00.123Z",
      });

      const copy = newSurvey(personal(), {
        createdAt: "2026-09-03T09:00:00.000Z",
        updatedAt: "2026-09-03T09:00:00.000Z",
      });
      await store().surveys.cloneSurvey(surveyFeedback.id, copy);
      const [copyPoint] = (await historyNames(copy.id)) as [string];
      expect(await metadataOf(copyPoint)).toEqual({
        userid: copy.creatorId,
        savedat: copy.createdAt,
      });
    });

    it("lists a legacy point without metadata with no user, at its last-modified time", async () => {
      const modified = new Map<string, string>();
      const container = blobs.getContainerClient("surveyjsonhistory");
      for await (const blob of container.listBlobsFlat({
        prefix: `${surveyFeedback.id}/`,
        includeMetadata: true,
      })) {
        expect(blob.metadata ?? {}, blob.name).toEqual({});
        modified.set(
          blob.name.slice(surveyFeedback.id.length + 1),
          blob.properties.lastModified.toISOString(),
        );
      }
      expect(modified.size).toBe(2);

      const { items } = await store().surveys.listHistory({
        surveyId: surveyFeedback.id,
        limit: 50,
      });
      expect(items).toHaveLength(2);
      for (const item of items) {
        expect(item).toEqual({ id: item.id, at: modified.get(item.id), userId: null });
      }
    });
  });

  describe("projects and members", () => {
    // Marketing, Engineering and the fixture memberships are read only (R25): each test creates its
    // own project and deletes it when it finishes. Only fixture users can be members (FK).
    const CREATED_AT = "2026-08-01T10:00:00.000Z";
    const NOW = "2026-08-02T10:00:00.000Z";
    const LATER = "2026-08-03T10:00:00.000Z";
    const lower = (value: unknown) => String(value).toLowerCase();

    /** Creates a project of `creatorId` (Adam by default), deleted when the test finishes. */
    async function ownProject(over: Partial<NewProject> = {}): Promise<NewProject> {
      const id = randomUUID();
      const project: NewProject = {
        id,
        name: `Writes test project ${id}`,
        creatorId: ADMIN_ID,
        createdAt: CREATED_AT,
        ...over,
      };
      onTestFinished(async () => {
        await store().directory.deleteProject(project.id, { receiverId: ADMIN_ID, now: NOW });
      });
      await store().directory.createProject(project);
      return project;
    }

    async function sqlRows(text: string, id: string): Promise<Record<string, unknown>[]> {
      if (!pool) throw new Error("beforeAll did not connect");
      const result = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query<Record<string, unknown>>(text);
      return result.recordset;
    }

    /** The `Organizations` row with a lower-case id. */
    async function projectRow(id: string): Promise<Record<string, unknown> | undefined> {
      const [row] = await sqlRows("SELECT * FROM Organizations WHERE id = @id", id);
      return row && { ...row, id: lower(row.id) };
    }

    /** The project's `OrganizationUsers` rows with lower-case ids, the creator's row first. */
    async function memberRows(projectId: string): Promise<Record<string, unknown>[]> {
      const rows = await sqlRows(
        "SELECT * FROM OrganizationUsers WHERE organizationid = @id ORDER BY happendat, id",
        projectId,
      );
      return rows
        .map((row) => ({
          ...row,
          id: lower(row.id),
          organizationid: lower(row.organizationid),
          userid: lower(row.userid),
        }))
        .sort((a, b) => Number(b.id === projectId) - Number(a.id === projectId));
    }

    const rowsOf = async (projectId: string, userId: string) =>
      (await memberRows(projectId)).filter((row) => row.userid === userId);

    /** A membership row written as another writer (or an old site version) may have left it. */
    async function insertRawMember(projectId: string, userId: string, role: string) {
      if (!pool) throw new Error("beforeAll did not connect");
      await pool
        .request()
        .input("id", sql.UniqueIdentifier, randomUUID())
        .input("project", sql.UniqueIdentifier, projectId)
        .input("user", sql.UniqueIdentifier, userId)
        .input("role", sql.VarChar(sql.MAX), role)
        .input("at", sql.DateTime, new Date(CREATED_AT))
        .query(
          "INSERT INTO OrganizationUsers (id, organizationid, userid, role, type, happendat, " +
            "[timestamp]) VALUES (@id, @project, @user, @role, 'ORGANIZATION_JOIN', @at, @at)",
        );
    }

    /** Event rows of the surveys table that name `id` as survey or user. */
    async function eventsNaming(id: string): Promise<Record<string, unknown>[]> {
      const rows: Record<string, unknown>[] = [];
      for await (const entity of events.listEntities({
        queryOptions: { filter: `surveyid eq guid'${id}' or userid eq guid'${id}'` },
      })) {
        rows.push(entity as Record<string, unknown>);
      }
      return rows;
    }

    /** Two parallel reads, so the provider's pool holds two connections and two writes overlap. */
    async function twoConnections(projectId: string): Promise<void> {
      await Promise.all([
        store().directory.listMembers(projectId),
        store().directory.listMembers(projectId),
      ]);
    }

    it("creates the project row and the creator's admin row, and no audit row", async () => {
      const project = await ownProject();
      const { id, name } = project;
      const at = new Date(CREATED_AT);
      expect(await projectRow(id)).toEqual({
        id,
        name,
        type: "ORGANIZATION_CREATE",
        happendat: at,
        timestamp: at,
        ipaddress: null,
      });
      expect(await memberRows(id)).toEqual([
        {
          id,
          organizationid: id,
          userid: ADMIN_ID,
          role: "admin",
          type: "ORGANIZATION_CREATE",
          name,
          happendat: at,
          timestamp: at,
          ipaddress: null,
        },
      ]);
      expect(await eventsNaming(id)).toEqual([]);
    });

    it("rejects an id in use with a LegacyStoreError and rolls the creator row back", async () => {
      const project = await ownProject();
      const before = await projectRow(project.id);
      const duplicate = { ...project, name: "Second project", creatorId: MEMBER_ID };
      const error: unknown = await store()
        .directory.createProject(duplicate)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LegacyStoreError);
      expect(String(error)).not.toMatch(/Second project|Writes test project/);
      expect(await projectRow(project.id)).toEqual(before);
      expect((await memberRows(project.id)).map((row) => row.userid)).toEqual([ADMIN_ID]);
    });

    it("rolls the project row back when the creator row fails after it", async () => {
      // A creator without a `Users` row: PROJECT_INSERT succeeds, CREATOR_INSERT fails on the FK.
      const id = randomUUID();
      onTestFinished(async () => {
        await store().directory.deleteProject(id, { receiverId: ADMIN_ID, now: NOW });
      });
      const project: NewProject = {
        id,
        name: "Rolled back project",
        creatorId: randomUUID(),
        createdAt: CREATED_AT,
      };
      const error: unknown = await store()
        .directory.createProject(project)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LegacyStoreError);
      expect(String(error)).toMatch(/project create/);
      expect(String(error)).not.toMatch(/Rolled back project/);
      expect(await projectRow(id)).toBeUndefined();
      expect(await memberRows(id)).toEqual([]);
    });

    it("renames: name and timestamp only, the creator row's name stays", async () => {
      const { id } = await ownProject();
      const before = await projectRow(id);
      const members = await memberRows(id);
      const name = `Renamed Ünïcødé 😀 ${randomUUID()}`;
      expect(await store().directory.renameProject(id, name, { now: NOW })).toBe(true);
      expect(await projectRow(id)).toEqual({ ...before, name, timestamp: new Date(NOW) });
      expect(await memberRows(id)).toEqual(members);
    });

    it("adds a member with a new row of its own", async () => {
      const { id } = await ownProject();
      const [creator] = await memberRows(id);
      expect(await store().directory.addMember(id, MEMBER_ID, "user", { now: NOW })).toBe("added");
      const rows = await memberRows(id);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(creator);
      const added = rows[1]!;
      expect(added.id).toMatch(GUID);
      expect(added.id).not.toBe(id);
      expect(added).toEqual({
        id: added.id,
        organizationid: id,
        userid: MEMBER_ID,
        role: "user",
        type: "ORGANIZATION_JOIN",
        name: null,
        happendat: new Date(NOW),
        timestamp: new Date(NOW),
        ipaddress: null,
      });
    });

    it("changes a role in place, the creator's row included", async () => {
      const { id } = await ownProject();
      await store().directory.addMember(id, MEMBER_ID, "admin", { now: NOW });
      const [creator, member] = await memberRows(id);
      expect(await store().directory.setMemberRole(id, ADMIN_ID, "user", { now: LATER })).toBe(
        "changed",
      );
      expect(await memberRows(id)).toEqual([
        { ...creator, role: "user", timestamp: new Date(LATER) },
        member,
      ]);
    });

    it("changes and removes every row of a member with duplicate rows", async () => {
      const { id } = await ownProject();
      await store().directory.addMember(id, MEMBER_ID, "user", { now: NOW });
      await insertRawMember(id, MEMBER_ID, "user");
      expect(await rowsOf(id, MEMBER_ID)).toHaveLength(2);

      expect(await store().directory.setMemberRole(id, MEMBER_ID, "admin", { now: LATER })).toBe(
        "changed",
      );
      const changed = await rowsOf(id, MEMBER_ID);
      expect(changed.map((row) => [row.role, row.timestamp])).toEqual([
        ["admin", new Date(LATER)],
        ["admin", new Date(LATER)],
      ]);

      expect(await store().directory.removeMember(id, MEMBER_ID)).toBe("removed");
      expect(await rowsOf(id, MEMBER_ID)).toEqual([]);
      expect((await memberRows(id)).map((row) => row.userid)).toEqual([ADMIN_ID]);
    });

    it("lets only one of two concurrent demotions of the two admins pass", async () => {
      const { id } = await ownProject();
      const directory = store().directory;
      await directory.addMember(id, MEMBER_ID, "admin", { now: NOW });
      await twoConnections(id);
      const outcomes = await Promise.all([
        directory.setMemberRole(id, ADMIN_ID, "user", { now: LATER }),
        directory.setMemberRole(id, MEMBER_ID, "user", { now: LATER }),
      ]);
      expect([...outcomes].sort()).toEqual(["changed", "last-admin"]);
      const admins = (await memberRows(id)).filter((row) => row.role === "admin");
      expect(admins).toHaveLength(1);
    });

    it("adds a user once when two adds run at the same time", async () => {
      const { id } = await ownProject();
      const directory = store().directory;
      await twoConnections(id);
      const outcomes = await Promise.all([
        directory.addMember(id, MEMBER_ID, "user", { now: NOW }),
        directory.addMember(id, MEMBER_ID, "user", { now: NOW }),
      ]);
      expect([...outcomes].sort()).toEqual(["added", "already-member"]);
      expect(await rowsOf(id, MEMBER_ID)).toHaveLength(1);
    });

    it("counts a user with two admin rows (one stored as Admin) as one admin", async () => {
      const { id } = await ownProject();
      const directory = store().directory;
      await directory.addMember(id, MEMBER_ID, "admin", { now: NOW });
      await insertRawMember(id, ADMIN_ID, "Admin");
      expect(await directory.listMembers(id)).toEqual([
        { user: adminUser, role: "admin" },
        { user: memberUser, role: "admin" },
      ]);
      expect(await directory.setMemberRole(id, MEMBER_ID, "user", { now: LATER })).toBe("changed");
      expect(await directory.setMemberRole(id, ADMIN_ID, "user", { now: LATER })).toBe(
        "last-admin",
      );
    });

    it("skips a member whose only role is unknown and warns with ids only", async () => {
      const { id } = await ownProject();
      await insertRawMember(id, MEMBER_ID, "guest");
      warnings.length = 0;
      expect(await store().directory.listMembers(id)).toEqual([{ user: adminUser, role: "admin" }]);
      expect(warnings).toEqual([
        {
          details: { projectId: id, userId: MEMBER_ID },
          message: "Skipped a project member whose role is unknown.",
        },
      ]);
    });

    it("deletes a project: its surveys, archived ones too, move to the receiver with their creators", async () => {
      const { id } = await ownProject();
      const scope: SurveyOwner = { kind: "project", projectId: id };
      const active = newSurvey(scope, { creatorId: MEMBER_ID });
      const archived = newSurvey(scope, { creatorId: ADMIN_ID });
      await store().surveys.createSurvey(active);
      await store().surveys.createSurvey(archived);
      await store().surveys.updateSurvey(archived.id, { archived: true, updatedAt: CREATED_AT });
      const ids = [active.id, archived.id].sort();
      const receiverId = randomUUID();
      onTestFinished(async () => {
        for (const survey of [active, archived]) await store().surveys.deleteSurvey(survey.id);
      });

      const moved = await store().directory.deleteProject(id, { receiverId, now: NOW });

      expect(moved).toEqual(ids);
      for (const survey of [active, archived]) {
        const row = await rawRow(survey.id);
        expect(lower(row!.userid)).toBe(receiverId);
        expect(lower(row!.creatorid)).toBe(survey.creatorId);
        expect(row!.timestamp).toEqual(new Date(NOW));
        const transfers = (await laterAuditRows(survey.id)).filter(
          (event) => typeOf(event) === "SURVEY_TRANSFER",
        );
        expect(transfers).toHaveLength(1);
        expect(payloadOf(transfers[0]!, survey.id, "SURVEY_TRANSFER", NOW)).toEqual({
          userid: { type: "Guid", value: receiverId },
          creatorid: { type: "Guid", value: survey.creatorId },
        });
      }
      expect(await memberRows(id)).toEqual([]);
      expect(await projectRow(id)).toBeUndefined();
      const personalIds = (
        await store().surveys.listSurveys({ kind: "personal", userId: receiverId })
      ).map((survey) => survey.id);
      expect(personalIds).toEqual(expect.arrayContaining(ids));
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
