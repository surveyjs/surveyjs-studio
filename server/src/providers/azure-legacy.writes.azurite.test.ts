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
import { PROJECT_B_ID } from "./suite/expected.js";
import type { ProviderSet } from "./types.js";

// Runs in the `providers-azurite` Vitest project. Checks that survey creation writes exactly the
// legacy format (layout section 5.3), by reading the replica directly. Writes go to fresh personal
// scopes and to Engineering (project B) only, and afterAll restores the golden fixtures.

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

describe("azure-legacy survey creation writes the legacy format (local replica)", () => {
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
});
