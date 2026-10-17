import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { Edm, TableClient, TableEntity, TableServiceClient } from "@azure/data-tables";
import type {
  AppendBlobClient,
  BlobRequestConditions,
  BlobServiceClient,
  ContainerClient,
} from "@azure/storage-blob";
import sql from "mssql";
import { FILE_ID_PATTERN, newFileId, surveyIdOfFile } from "../../domain/file-id.js";
import type {
  NewSurvey,
  SaveOutcome,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  StoredFileRecord,
} from "../../domain/types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import { fileRecordFromBlob, isGuid } from "./mapping.js";

/**
 * The only module allowed to write to the legacy stores; ESLint keeps the rest of the
 * azure-legacy folder read-only. Step 4: survey creation; Step 5: update, clone and delete;
 * Step 6: definition and theme saves; Step 7: editor files (in a container of our own, which
 * legacy code never reads) and clone rewriting. Each survey write uses the format the legacy site
 * writes (layout section 5.3).
 *
 * Errors and log lines built here hold operation names, driver codes and row ids only, never row
 * content or a connection string.
 */

/** The stores the survey writes go to. */
export interface LegacyWriteTargets {
  /** The connected pool of the legacy database. */
  readonly pool: () => Promise<sql.ConnectionPool>;
  /** Blob service of the surveys account. */
  readonly blobs: BlobServiceClient;
  /** Table `surveys` of the surveys account: the survey event log (layout section 3.5). */
  readonly events: TableClient;
  /** Table service of the results account: `post…`, `SurveyCompletion…`, `postdelete…` tables. */
  readonly resultTables: TableServiceClient;
  readonly logger: LegacyWarningLogger;
}

/** Surveys.name is nvarchar(200) (layout section 3.1). */
const MAX_NAME_LENGTH = 200;
const APPEND_BLOCK_BYTES = 4 * 1024 * 1024;

const SURVEY_INSERT =
  "INSERT INTO Surveys (id, name, userid, creatorid, postid, resultid, createdat, [timestamp]) " +
  "VALUES (@id, @name, @userid, @creatorid, @postid, @resultid, @createdat, @timestamp)";
const SURVEY_EXISTS = "SELECT 1 AS found FROM Surveys WHERE id = @id";
const SURVEY_THEME_SELECT = "SELECT theme FROM Surveys WHERE id = @id";
const SURVEY_THEME_UPDATE = "UPDATE Surveys SET theme = @theme WHERE id = @id";
const SURVEY_DELETE = "DELETE FROM Surveys WHERE id = @id";
const SURVEY_TIMESTAMP_UPDATE = "UPDATE Surveys SET [timestamp] = @timestamp WHERE id = @id";
/**
 * Compare-and-set of the theme (ADR 0012 R2): writes only while the column still holds the text
 * the caller's version was computed from. The binary collation and the byte length make the
 * comparison exact (`=` alone follows the database collation and ignores trailing spaces).
 * OUTPUT returns the text as stored: `varchar` can change non-ASCII characters.
 */
const SURVEY_THEME_SAVE =
  "UPDATE Surveys SET theme = @theme, [timestamp] = @timestamp OUTPUT inserted.theme " +
  "WHERE id = @id AND ISNULL(theme, '') COLLATE Latin1_General_BIN2 = @expected " +
  "AND DATALENGTH(ISNULL(theme, '')) = DATALENGTH(@expected)";
/** Azure Table strings hold 64 KiB (32,768 UTF-16 code units); the rest of the row needs room. */
const MAX_AUDIT_THEME_LENGTH = 32_000;

/** Containers of the saved results layouts; each blob is named by the survey id (layout 3.10). */
const LAYOUT_CONTAINERS = [
  "surveyresulttablestate",
  "surveyresultsummarystate",
  "surveyresultpermissions",
  "surveyresultcolumns",
] as const;

type SqlType = (() => sql.ISqlType) | sql.ISqlType;

/**
 * A survey with this id exists already. It carries SQL Server's primary-key violation number, so
 * the LegacyStoreError reads the same as when the INSERT itself hits the key.
 */
class DuplicateSurveyIdError extends Error {
  readonly number = 2627;
  constructor() {
    super("A survey with this id exists");
    this.name = "DuplicateSurveyIdError";
  }
}

const ownerIdOf = (owner: SurveyOwner): string =>
  owner.kind === "personal" ? owner.userId : owner.projectId;

/** The id in lower case; refuses anything but a GUID before a write (ids name blobs and tables). */
function checkedId(operation: string, value: string): string {
  if (!isGuid(value)) throw new Error(`Survey ${operation} refused: every id must be a GUID`);
  return value.toLowerCase();
}

/** Refuses a name that does not fit `Surveys.name`: a longer one must not be cut. */
function checkName(operation: string, name: string): void {
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`Survey ${operation} refused: the name is longer than ${MAX_NAME_LENGTH}`);
  }
}

/**
 * The survey with lower-case ids, checked before anything is written: every id must be a GUID
 * (they also name blobs) and the name must fit `Surveys.name` (a longer one must not be cut).
 */
function checked(survey: NewSurvey, operation: "create" | "clone"): NewSurvey {
  const ids = [
    survey.id,
    ownerIdOf(survey.owner),
    survey.creatorId,
    survey.postId,
    survey.resultId,
  ];
  if (!ids.every(isGuid)) throw new Error(`Survey ${operation} refused: every id must be a GUID`);
  checkName(operation, survey.name);
  return {
    ...survey,
    id: survey.id.toLowerCase(),
    owner:
      survey.owner.kind === "personal"
        ? { kind: "personal", userId: survey.owner.userId.toLowerCase() }
        : { kind: "project", projectId: survey.owner.projectId.toLowerCase() },
    creatorId: survey.creatorId.toLowerCase(),
    postId: survey.postId.toLowerCase(),
    resultId: survey.resultId.toLowerCase(),
  };
}

/** Runs `action`; a "not found" (HTTP 404) answer counts as done. */
async function ignoringNotFound(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
  }
}

/** Blob metadata of a history point: who saved it and when (ADR 0012 R8). */
interface HistoryPointMetadata {
  /** Lower-case GUID of the saving user. */
  readonly userid: string;
  /** ISO 8601 UTC with milliseconds. */
  readonly savedat: string;
}

/** Tries of one Append Block, the first included (ADR 0012, Consequences). */
const APPEND_ATTEMPTS = 3;
/** Wait before the second try; it doubles before each later one. */
const APPEND_RETRY_DELAY_MS = 100;

/** A failed storage call that may pass when tried again: no answer, 408, 429 or a 5xx. */
function mayPassOnRetry(error: unknown): boolean {
  const status = statusOf(error);
  return (
    status === undefined ||
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500)
  );
}

/**
 * Append Block of `chunk`, conditioned on `etag`. After Put Blob the blob holds only part of the
 * text, so a failure that may pass is tried again, up to APPEND_ATTEMPTS tries, with the same
 * condition: a 412 (the blob changed) is a conflict and never tried again.
 */
async function appendWithRetry(
  blob: AppendBlobClient,
  chunk: Buffer,
  etag: string | undefined,
): Promise<string | undefined> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const appended = await blob.appendBlock(chunk, chunk.length, {
        ...(etag !== undefined && { conditions: { ifMatch: etag } }),
      });
      return appended.etag;
    } catch (error) {
      if (attempt >= APPEND_ATTEMPTS || !mayPassOnRetry(error)) throw error;
      await setTimeout(APPEND_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
}

/**
 * Writes append blob `{container}/{name}` holding `content`: Put Blob (`create`) under
 * `conditions`, which replaces an existing blob, then Append Block in 4 MiB chunks. Each append
 * is conditioned on the ETag of the write before, so a writer that replaces the blob in between
 * makes the append fail instead of mixing two texts; an append that fails otherwise is tried
 * again (appendWithRetry). Returns the ETag after the last write.
 */
async function writeAppendBlob(
  blobs: BlobServiceClient,
  container: string,
  name: string,
  content: Buffer,
  conditions: BlobRequestConditions,
  metadata?: HistoryPointMetadata,
): Promise<string> {
  const blob = blobs.getContainerClient(container).getAppendBlobClient(name);
  const created = await blob.create({ conditions, ...(metadata && { metadata: { ...metadata } }) });
  let etag = created.etag;
  for (let offset = 0; offset < content.length; offset += APPEND_BLOCK_BYTES) {
    const chunk = content.subarray(offset, offset + APPEND_BLOCK_BYTES);
    etag = await appendWithRetry(blob, chunk, etag);
  }
  if (etag === undefined) throw new Error("The blob write answered without an ETag");
  return etag;
}

/**
 * Creates append blob `{container}/{name}` holding `content`. Refuses to replace an existing
 * blob, so a duplicate survey id never overwrites another survey's definition.
 */
async function writeNewAppendBlob(
  blobs: BlobServiceClient,
  container: string,
  name: string,
  content: Buffer,
  metadata?: HistoryPointMetadata,
): Promise<void> {
  await writeAppendBlob(blobs, container, name, content, { ifNoneMatch: "*" }, metadata);
}

/**
 * Replaces append blob `{container}/{name}` with `content`, as the legacy `OpenWrite(true)`
 * does, under `conditions` (none: replace whatever is there). Returns the ETag after the write.
 */
async function replaceAppendBlob(
  blobs: BlobServiceClient,
  container: string,
  name: string,
  content: Buffer,
  conditions: BlobRequestConditions = {},
): Promise<string> {
  return writeAppendBlob(blobs, container, name, content, conditions);
}

/** The bytes of blob `{container}/{name}`; undefined when it does not exist. */
async function readBlob(
  blobs: BlobServiceClient,
  container: string,
  name: string,
): Promise<Buffer | undefined> {
  try {
    return await blobs.getContainerClient(container).getBlobClient(name).downloadToBuffer();
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw error;
  }
}

/** Deletes blob `{container}/{name}` with any snapshots; a missing blob or container is fine. */
async function deleteBlobIfPresent(
  blobs: BlobServiceClient,
  container: string,
  name: string,
): Promise<void> {
  const blob = blobs.getContainerClient(container).getBlobClient(name);
  await ignoringNotFound(() => blob.delete({ deleteSnapshots: "include" }));
}

/** The names of the blobs in `container` under `prefix`; none when the container is missing. */
async function blobNames(
  blobs: BlobServiceClient,
  container: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  await ignoringNotFound(async () => {
    for await (const blob of blobs.getContainerClient(container).listBlobsFlat({ prefix })) {
      names.push(blob.name);
    }
  });
  return names;
}

const guid = (value: string): Edm<"Guid"> => ({ type: "Guid", value });

/**
 * A row of the survey event log (layout sections 3.5 and 5.1): `PartitionKey` `*`, a new GUID as
 * `RowKey` and `id`, the event type, the time and the survey, then the event's own properties.
 */
function surveyEvent(
  type: string,
  surveyId: string,
  happenedAt: string,
  payload: Record<string, unknown> = {},
): TableEntity {
  const eventId = randomUUID();
  const event: TableEntity<Record<string, unknown>> = {
    partitionKey: "*",
    rowKey: eventId,
    id: guid(eventId),
    type,
    happendat: { type: "DateTime", value: happenedAt } satisfies Edm<"DateTime">,
    surveyid: guid(surveyId),
    ...payload,
  };
  return event;
}

/** The `SURVEY_CREATE` event row. */
const createEvent = (survey: NewSurvey): TableEntity =>
  surveyEvent("SURVEY_CREATE", survey.id, survey.createdAt, {
    postid: guid(survey.postId),
    resultid: guid(survey.resultId),
    userid: guid(ownerIdOf(survey.owner)),
    creatorid: guid(survey.creatorId),
    name: survey.name,
  });

/** Appends the event row; creates the table when it is missing. */
async function appendEvent(events: TableClient, event: TableEntity): Promise<void> {
  try {
    await events.createEntity(event);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await events.createTable();
    await events.createEntity(event);
  }
}

/**
 * Appends an audit row, best effort: legacy readers use the projections only (layout section 5),
 * so a failure is logged with the survey id and the event type, and the write stands.
 */
async function appendEventBestEffort(
  targets: LegacyWriteTargets,
  surveyId: string,
  event: TableEntity,
  outcome: string,
): Promise<void> {
  try {
    await appendEvent(targets.events, event);
  } catch {
    targets.logger.warn(
      { surveyId },
      `Could not write the ${String(event.type)} audit row; ${outcome}`,
    );
  }
}

/**
 * Stores a new survey as the legacy create does, after checking that the id is free: the
 * definition blobs first (when given), then
 * the `Surveys` row with exactly the legacy create columns (all others stay NULL), then the audit
 * row. A failure before the row leaves only orphan blobs that no reader finds, never a survey
 * without its definition. The audit row is best effort: legacy readers use the projections only
 * (layout section 5), so a failure there is logged and the survey stays created.
 *
 * Returns the lower-case survey id. Store failures reject with LegacyStoreError.
 */
export async function writeNewSurvey(
  targets: LegacyWriteTargets,
  input: NewSurvey,
  definition?: SurveyDefinition,
): Promise<string> {
  const survey = checked(input, "create");
  const text = definition === undefined ? undefined : JSON.stringify(definition);
  return storeNewSurvey(
    targets,
    survey,
    text === undefined ? undefined : Buffer.from(text, "utf8"),
    "create",
  );
}

/**
 * The create sequence of writeNewSurvey for a checked survey. `definition` is the blob content,
 * written unchanged to `surveyjson`, `surveytext` and one history point.
 */
async function storeNewSurvey(
  targets: LegacyWriteTargets,
  survey: NewSurvey,
  definition: Buffer | undefined,
  operation: "create" | "clone",
): Promise<string> {
  try {
    const pool = await targets.pool();
    // Before any blob: a duplicate id must not leave blobs that an existing survey would read
    // as its definition. The INSERT's primary key still guards against a race.
    const existing = await pool
      .request()
      .input("id", sql.UniqueIdentifier, survey.id)
      .query(SURVEY_EXISTS);
    if (existing.recordset.length > 0) throw new DuplicateSurveyIdError();
    if (definition !== undefined) {
      await writeNewAppendBlob(targets.blobs, "surveyjson", survey.id, definition);
      await writeNewAppendBlob(targets.blobs, "surveytext", survey.id, definition);
      // The legacy definition save also writes a history point; ours names the creator.
      const point = `${survey.id}/${randomUUID()}`;
      await writeNewAppendBlob(targets.blobs, "surveyjsonhistory", point, definition, {
        userid: survey.creatorId,
        savedat: new Date(survey.createdAt).toISOString(),
      });
    }
    await pool
      .request()
      .input("id", sql.UniqueIdentifier, survey.id)
      .input("name", sql.NVarChar(MAX_NAME_LENGTH), survey.name)
      .input("userid", sql.UniqueIdentifier, ownerIdOf(survey.owner))
      .input("creatorid", sql.UniqueIdentifier, survey.creatorId)
      .input("postid", sql.UniqueIdentifier, survey.postId)
      .input("resultid", sql.UniqueIdentifier, survey.resultId)
      .input("createdat", sql.DateTime, new Date(survey.createdAt))
      .input("timestamp", sql.DateTime, new Date(survey.updatedAt))
      .query(SURVEY_INSERT);
  } catch (error) {
    throw new LegacyStoreError(`survey ${operation}`, error);
  }

  await appendEventBestEffort(targets, survey.id, createEvent(survey), "the survey is stored.");
  return survey.id;
}

/**
 * Applies `changes` to the `Surveys` row in one parameterised UPDATE that sets only the columns
 * the changes name, plus `timestamp` (layout section 5.3: every row write moves it). Then one
 * best-effort audit row per change, in a fixed order (layout section 5.1). A move stores the
 * target scope's id in `userid` (the user id for Personal) and the mover in `creatorid`, as the
 * legacy `SURVEY_TRANSFER` does.
 *
 * Returns false when no survey has this id (nothing is written). Store failures reject with
 * LegacyStoreError.
 */
export async function writeSurveyChanges(
  targets: LegacyWriteTargets,
  surveyId: string,
  changes: SurveyChanges,
): Promise<boolean> {
  const id = checkedId("update", surveyId);
  const { name, published, archived, settings = {}, updatedAt } = changes;
  const move = changes.move && {
    userId: checkedId("update", ownerIdOf(changes.move.owner)),
    creatorId: checkedId("update", changes.move.creatorId),
  };
  if (name !== undefined) checkName("update", name);
  const flag = (value: boolean) => (value ? 1 : 0);

  const columns: [column: string, type: SqlType, value: unknown][] = [];
  const events: TableEntity[] = [];
  const event = (type: string, payload?: Record<string, unknown>) =>
    events.push(surveyEvent(type, id, updatedAt, payload));
  if (name !== undefined) {
    columns.push(["name", sql.NVarChar(MAX_NAME_LENGTH), name]);
    event("SURVEY_UPDATE", { name });
  }
  if (move) {
    columns.push(["userid", sql.UniqueIdentifier, move.userId]);
    columns.push(["creatorid", sql.UniqueIdentifier, move.creatorId]);
    event("SURVEY_TRANSFER", { userid: guid(move.userId), creatorid: guid(move.creatorId) });
  }
  if (published !== undefined) {
    columns.push(["ispublished", sql.TinyInt, flag(published)]);
    event("SURVEY_PUBLISHED", { ispublished: published });
  }
  if (archived !== undefined) {
    columns.push(["isarchived", sql.TinyInt, flag(archived)]);
    event(archived ? "SURVEY_ARCHIVE" : "SURVEY_RESTORE");
  }
  if (settings.publicResults !== undefined) {
    columns.push(["allowaccessresult", sql.TinyInt, flag(settings.publicResults)]);
    // The legacy type code is misspelt; readers of the log expect it as it is.
    event("SURVEY_ACCESSRESUTL", { grantaccess: settings.publicResults });
  }
  if (settings.storeRespondentIp !== undefined) {
    // A varchar column: the legacy reader takes only "1" as true.
    columns.push(["storeipaddress", sql.VarChar(200), String(flag(settings.storeRespondentIp))]);
    // The type legacy writes for this change (layout section 5.1), misspelling included.
    event("SURVEY_POSTRESUTL", { storeipaddress: settings.storeRespondentIp });
  }

  try {
    const request = (await targets.pool()).request().input("id", sql.UniqueIdentifier, id);
    const assignments = columns.map(([column, type, value]) => {
      request.input(column, type, value);
      return `${column} = @${column}`;
    });
    request.input("timestamp", sql.DateTime, new Date(updatedAt));
    assignments.push("[timestamp] = @timestamp");
    const result = await request.query(
      `UPDATE Surveys SET ${assignments.join(", ")} WHERE id = @id`,
    );
    if ((result.rowsAffected[0] ?? 0) === 0) return false;
  } catch (error) {
    throw new LegacyStoreError("survey update", error);
  }

  for (const row of events) {
    await appendEventBestEffort(targets, id, row, "the survey is updated.");
  }
  return true;
}

/**
 * Creates `input` as a copy of survey `sourceId`: the create sequence of writeNewSurvey with the
 * source's `surveyjson` blob copied byte for byte (no blobs when the source has none), then the
 * source's raw `theme` text on the copy's row (without moving `timestamp`) and a best-effort
 * `SURVEY_THEME_CHANGE` audit row. Results, history, layouts and settings are not copied.
 * `rewriteText`, when given, is applied to the definition text (read as UTF-8) and the theme text
 * before they are stored for the copy (Step 7, R11); without it the copy is byte for byte.
 *
 * Returns the copy's lower-case id, or null when no survey has `sourceId` (nothing is written).
 * Store failures reject with LegacyStoreError; a duplicate copy id fails as in writeNewSurvey.
 */
export async function writeClonedSurvey(
  targets: LegacyWriteTargets,
  sourceId: string,
  input: NewSurvey,
  rewriteText?: (text: string) => string,
): Promise<string | null> {
  const source = checkedId("clone", sourceId);
  const copy = checked(input, "clone");
  let theme: string | null;
  let definition: Buffer | undefined;
  try {
    const rows = await (
      await targets.pool()
    )
      .request()
      .input("id", sql.UniqueIdentifier, source)
      .query<{ theme: string | null }>(SURVEY_THEME_SELECT);
    const [row] = rows.recordset;
    if (!row) return null;
    theme = row.theme;
    // No blob until the first definition save (layout section 3.2).
    definition = await readBlob(targets.blobs, "surveyjson", source);
    if (rewriteText) {
      // One buffer for surveyjson, surveytext and the history point, so they stay byte-equal.
      if (definition) definition = Buffer.from(rewriteText(definition.toString("utf8")), "utf8");
      if (theme !== null && theme !== "") theme = rewriteText(theme);
    }
  } catch (error) {
    throw new LegacyStoreError("survey clone", error);
  }

  await storeNewSurvey(targets, copy, definition, "clone");
  if (theme === null || theme === "") return copy.id;

  try {
    await (
      await targets.pool()
    )
      .request()
      .input("id", sql.UniqueIdentifier, copy.id)
      .input("theme", sql.VarChar(sql.MAX), theme)
      .query(SURVEY_THEME_UPDATE);
  } catch (error) {
    throw new LegacyStoreError("survey clone", error);
  }
  const event = surveyEvent("SURVEY_THEME_CHANGE", copy.id, copy.updatedAt, { theme });
  await appendEventBestEffort(targets, copy.id, event, "the survey copy is stored.");
  return copy.id;
}

/**
 * Deletes a survey and everything stored for it, children first and the `Surveys` row last, so a
 * failure leaves the survey visible and the delete can run again. Each step accepts "not found":
 *
 * 1. Results account tables `post{postId}`, `SurveyCompletion{surveyId}` and `postdelete{postId}`
 *    (ids without dashes; layout sections 3.6 to 3.8).
 * 2. Surveys account blobs `surveyjson/{id}`, `surveytext/{id}`, every `surveyjsonhistory/{id}/…`
 *    point and the four results-layout blobs `{container}/{id}` (layout sections 3.2, 3.4, 3.10).
 * 3. The `Surveys` row, which holds the theme.
 * 4. A best-effort `SURVEY_DELETE` audit row at `deletedAt`.
 *
 * Returns false when the row was already gone. Store failures reject with LegacyStoreError.
 */
export async function writeSurveyDeletion(
  targets: LegacyWriteTargets,
  survey: SurveyRecord,
  deletedAt: string,
): Promise<boolean> {
  const id = checkedId("delete", survey.id);
  const postKey = checkedId("delete", survey.postId).replaceAll("-", "");
  const tables = [
    `post${postKey}`,
    `SurveyCompletion${id.replaceAll("-", "")}`,
    `postdelete${postKey}`,
  ];
  try {
    for (const table of tables) {
      await ignoringNotFound(() => targets.resultTables.deleteTable(table));
    }
    await deleteBlobIfPresent(targets.blobs, "surveyjson", id);
    await deleteBlobIfPresent(targets.blobs, "surveytext", id);
    for (const point of await blobNames(targets.blobs, "surveyjsonhistory", `${id}/`)) {
      await deleteBlobIfPresent(targets.blobs, "surveyjsonhistory", point);
    }
    for (const container of LAYOUT_CONTAINERS) {
      await deleteBlobIfPresent(targets.blobs, container, id);
    }
    const result = await (
      await targets.pool()
    )
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(SURVEY_DELETE);
    if ((result.rowsAffected[0] ?? 0) === 0) return false;
  } catch (error) {
    throw new LegacyStoreError("survey delete", error);
  }

  const event = surveyEvent("SURVEY_DELETE", id, deletedAt);
  await appendEventBestEffort(targets, id, event, "the survey is deleted.");
  return true;
}

/** A storage answer that means "the blob is not the version the save was based on". */
function isBlobConflict(error: unknown): boolean {
  const status = statusOf(error);
  return status === 412 || status === 409;
}

/**
 * Saves a survey definition as the legacy save does (layout section 5.3; ADR 0012 R2, R8, R13):
 *
 * 1. `surveyjson/{id}` replaced only while its ETag is still `blobVersion` (`"none"`: only while
 *    no blob exists). A storage 412 or 409 is a conflict, and nothing is written.
 * 2. `surveytext/{id}` replaced with the same text.
 * 3. A new history point `surveyjsonhistory/{id}/{new GUID}` with the text and the metadata
 *    `userid` and `savedat`.
 * 4. `Surveys.timestamp` set to `savedAt`.
 * 5. A best-effort `SURVEY_UPDATE` audit row without payload.
 *
 * An unknown survey is `not-found` before any blob is written; a survey deleted during the save
 * is `not-found` after step 4 (its blobs stay; no reader finds them without the row). The saved
 * version is the ETag of `surveyjson` after the write, without quotes. Store failures reject
 * with LegacyStoreError. When step 1 fails after its Put Blob (an append failed on every try),
 * `surveyjson` is left empty with a new ETag while `surveytext` still holds the previous text:
 * the definition read then serves that text with the empty blob's ETag, and the next save with
 * it rewrites both blobs (ADR 0012, Consequences).
 */
export async function writeDefinitionSave(
  targets: LegacyWriteTargets,
  surveyId: string,
  text: string,
  save: { readonly blobVersion: string; readonly userId: string; readonly savedAt: string },
): Promise<SaveOutcome> {
  const id = checkedId("definition save", surveyId);
  const userId = checkedId("definition save", save.userId);
  // A version is an unquoted ETag; anything else cannot match the blob.
  if (save.blobVersion === "" || save.blobVersion.includes('"')) return { kind: "conflict" };
  const content = Buffer.from(text, "utf8");
  const savedAt = new Date(save.savedAt);
  let version: string;
  try {
    const pool = await targets.pool();
    const existing = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .query(SURVEY_EXISTS);
    if (existing.recordset.length === 0) return { kind: "not-found" };
    const conditions: BlobRequestConditions =
      save.blobVersion === "none" ? { ifNoneMatch: "*" } : { ifMatch: `"${save.blobVersion}"` };
    try {
      version = await replaceAppendBlob(targets.blobs, "surveyjson", id, content, conditions);
    } catch (error) {
      if (isBlobConflict(error)) return { kind: "conflict" };
      throw error;
    }
    await replaceAppendBlob(targets.blobs, "surveytext", id, content);
    const point = `${id}/${randomUUID()}`;
    await writeNewAppendBlob(targets.blobs, "surveyjsonhistory", point, content, {
      userid: userId,
      savedat: savedAt.toISOString(),
    });
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .input("timestamp", sql.DateTime, savedAt)
      .query(SURVEY_TIMESTAMP_UPDATE);
    if ((result.rowsAffected[0] ?? 0) === 0) return { kind: "not-found" };
  } catch (error) {
    throw new LegacyStoreError("definition save", error);
  }

  const event = surveyEvent("SURVEY_UPDATE", id, savedAt.toISOString());
  await appendEventBestEffort(targets, id, event, "the definition is saved.");
  return { kind: "saved", version: version.replaceAll('"', "") };
}

/** What writeThemeSave did; `stored` is the column text after the save. */
export type ThemeSaveOutcome =
  | { readonly kind: "saved"; readonly stored: string }
  | { readonly kind: "conflict" }
  | { readonly kind: "not-found" };

/**
 * Saves a survey theme as the legacy `changeTheme` does (layout sections 3.3 and 5.3; ADR 0012
 * R2, R13): one UPDATE sets `Surveys.theme` to `text` and `timestamp` to `savedAt`, only while
 * the column (NULL read as "") still holds `expectedRaw`. Then a best-effort
 * `SURVEY_THEME_CHANGE` audit row with `theme`, or without it when the text is longer than an
 * Azure Table string holds.
 *
 * When no row changed, the survey is looked up again: gone is `not-found`, else `conflict`.
 * Store failures reject with LegacyStoreError.
 */
export async function writeThemeSave(
  targets: LegacyWriteTargets,
  surveyId: string,
  text: string,
  save: { readonly expectedRaw: string; readonly savedAt: string },
): Promise<ThemeSaveOutcome> {
  const id = checkedId("theme save", surveyId);
  const savedAt = new Date(save.savedAt);
  let stored: string;
  try {
    const pool = await targets.pool();
    const result = await pool
      .request()
      .input("id", sql.UniqueIdentifier, id)
      .input("theme", sql.VarChar(sql.MAX), text)
      .input("timestamp", sql.DateTime, savedAt)
      .input("expected", sql.VarChar(sql.MAX), save.expectedRaw)
      .query<{ theme: string | null }>(SURVEY_THEME_SAVE);
    const [row] = result.recordset;
    if (!row) {
      const existing = await pool
        .request()
        .input("id", sql.UniqueIdentifier, id)
        .query(SURVEY_EXISTS);
      return existing.recordset.length === 0 ? { kind: "not-found" } : { kind: "conflict" };
    }
    stored = row.theme ?? "";
  } catch (error) {
    throw new LegacyStoreError("theme save", error);
  }

  const payload = text.length > MAX_AUDIT_THEME_LENGTH ? {} : { theme: text };
  const event = surveyEvent("SURVEY_THEME_CHANGE", id, savedAt.toISOString(), payload);
  await appendEventBestEffort(targets, id, event, "the theme is saved.");
  return { kind: "saved", stored };
}

/**
 * Put Blob of block blob `{surveyId}/{fileId}` in `files`, refusing to replace a blob (R2). A
 * missing container is created (private) and the upload tried once more.
 */
async function uploadNewFile(
  files: ContainerClient,
  file: StoredFileRecord,
  content: Buffer,
): Promise<void> {
  const upload = () =>
    files.getBlockBlobClient(`${file.surveyId}/${file.id}`).uploadData(content, {
      blobHTTPHeaders: { blobContentType: file.contentType },
      // Metadata is ASCII only, so the name is URI-encoded.
      metadata: {
        kind: file.kind,
        name: encodeURIComponent(file.name),
        createdat: new Date(file.createdAt).toISOString(),
      },
      conditions: { ifNoneMatch: "*" },
    });
  try {
    await upload();
  } catch (error) {
    // A 404 is the container: Put Blob creates the blob itself.
    if (statusOf(error) !== 404) throw error;
    await files.createIfNotExists();
    await upload();
  }
}

/**
 * Stores a new editor file as block blob `{container}/{surveyId}/{fileId}` (Step 7, R2): the type
 * as the blob's content type, metadata `kind`, `name` and `createdat`. Never replaces a blob: when
 * a file with this id exists it rejects and nothing is changed.
 *
 * Store failures reject with LegacyStoreError, which names the file operation only.
 */
export async function writeFile(
  blobs: BlobServiceClient,
  container: string,
  file: StoredFileRecord,
  content: Buffer,
): Promise<void> {
  if (!FILE_ID_PATTERN.test(file.id) || surveyIdOfFile(file.id) !== file.surveyId) {
    throw new Error("File upload refused: the file id must belong to the file's survey");
  }
  if (content.length !== file.size) {
    throw new Error("File upload refused: the size does not match the content");
  }
  try {
    await uploadNewFile(blobs.getContainerClient(container), file, content);
  } catch (error) {
    throw new LegacyStoreError("file upload", error);
  }
}

/** Deletes blob `{container}/{surveyId}/{fileId}`; false when there was none. */
export async function writeFileDeletion(
  blobs: BlobServiceClient,
  container: string,
  fileId: string,
): Promise<boolean> {
  const id = fileId.toLowerCase();
  const surveyId = surveyIdOfFile(id);
  if (surveyId === null) return false;
  try {
    await blobs
      .getContainerClient(container)
      .getBlobClient(`${surveyId}/${id}`)
      .delete({ deleteSnapshots: "include" });
    return true;
  } catch (error) {
    if (statusOf(error) === 404) return false;
    throw new LegacyStoreError("file delete", error);
  }
}

/**
 * Deletes every blob under `{container}/{surveyId}/`, of every kind (R3); returns how many were
 * deleted. A missing container holds none.
 */
export async function writeSurveyFilesDeletion(
  blobs: BlobServiceClient,
  container: string,
  surveyId: string,
): Promise<number> {
  const id = checkedId("file delete", surveyId);
  try {
    let deleted = 0;
    for (const name of await blobNames(blobs, container, `${id}/`)) {
      try {
        await blobs.getContainerClient(container).getBlobClient(name).delete({
          deleteSnapshots: "include",
        });
        deleted += 1;
      } catch (error) {
        // Deleted by someone else since the listing.
        if (statusOf(error) !== 404) throw error;
      }
    }
    return deleted;
  } catch (error) {
    throw new LegacyStoreError("file delete", error);
  }
}

/**
 * Copies each asset of `fromSurveyId` to `toSurveyId` under a new id, with the same name, type and
 * bytes and `createdAt` = `copiedAt` (R11). Returns old id → new id. On a failure part-way the
 * copies made so far are deleted (best effort), then it rejects with LegacyStoreError.
 */
export async function writeSurveyAssetsCopy(
  blobs: BlobServiceClient,
  container: string,
  fromSurveyId: string,
  toSurveyId: string,
  copiedAt: string,
): Promise<ReadonlyMap<string, string>> {
  const from = checkedId("file copy", fromSurveyId);
  const to = checkedId("file copy", toSurveyId);
  const files = blobs.getContainerClient(container);
  const copied = new Map<string, string>();
  try {
    const sources: StoredFileRecord[] = [];
    await ignoringNotFound(async () => {
      for await (const blob of files.listBlobsFlat({ prefix: `${from}/`, includeMetadata: true })) {
        const file = fileRecordFromBlob(blob.name, blob.properties, blob.metadata);
        if (file?.kind === "asset") sources.push(file);
      }
    });
    for (const source of sources) {
      const content = await files.getBlobClient(`${from}/${source.id}`).downloadToBuffer();
      const copy: StoredFileRecord = {
        ...source,
        id: newFileId(to),
        surveyId: to,
        size: content.length,
        createdAt: copiedAt,
      };
      await uploadNewFile(files, copy, content);
      copied.set(source.id, copy.id);
    }
    return copied;
  } catch (error) {
    for (const id of copied.values()) {
      await writeFileDeletion(blobs, container, id).catch(() => false);
    }
    throw new LegacyStoreError("file copy", error);
  }
}
