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
  FileKind,
  NewProject,
  NewResponse,
  NewSurvey,
  ProjectRole,
  SaveOutcome,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyRecord,
  StoredFileRecord,
} from "../../domain/types.js";
import {
  decideMemberErasure,
  decideRemoval,
  decideRoleChange,
  type ErasureFacts,
  type MembershipFacts,
} from "../../projects/rules.js";
import {
  ResponseTooLargeError,
  type AddMemberOutcome,
  type AppendOutcome,
  type MemberErasure,
  type RemovalOutcome,
  type RoleChangeOutcome,
} from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import { fileRecordFromBlob, isGuid, privateQuestionsToLegacy, userFromLegacy } from "./mapping.js";

/**
 * The only module allowed to write to the legacy stores; ESLint keeps the rest of the
 * azure-legacy folder read-only. Step 4: survey creation; Step 5: update, clone and delete;
 * Step 6: definition and theme saves; Step 7: editor files (in a container of our own, which
 * legacy code never reads) and clone rewriting; Step 8: result rows and completion markers; Step 9: results layouts (views) in a container of
 * our own; Step 10: deleting all results and the public-question list; Step 11: projects and
 * members (Organizations and OrganizationUsers rows, project deletion), in SQL transactions;
 * Step 12: member erasure (an erased account's membership rows, a successor made admin). Each
 * survey write uses the format the legacy site
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
  /** One table of the results account, by name (result rows and completion markers). */
  readonly resultTable: (name: string) => TableClient;
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

/** Azure Table strings hold 64 KiB = 32,768 UTF-16 code units: the longest `result` we store. */
const MAX_RESULT_LENGTH = 32_768;

/** Container of the public-question lists (layout section 10), each blob named by the survey id. */
export const PERMISSIONS_CONTAINER = "surveyresultpermissions";

/** Containers of the saved results layouts; each blob is named by the survey id (layout 3.10). */
const LAYOUT_CONTAINERS = [
  "surveyresulttablestate",
  "surveyresultsummarystate",
  PERMISSIONS_CONTAINER,
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

/** Creates the entity; creates the table when it is missing (a race for the table is fine). */
async function createEntityInTable(table: TableClient, entity: TableEntity): Promise<void> {
  try {
    await table.createEntity(entity);
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await createTableIfMissing(table);
    await table.createEntity(entity);
  }
}

async function createTableIfMissing(table: TableClient): Promise<void> {
  try {
    await table.createTable();
  } catch (error) {
    if (statusOf(error) !== 409) throw error;
  }
}

/**
 * Stores a response as the legacy post does (layout sections 3.6, 3.7 and 5.2): a row in
 * `post{postId}` (created when missing), then, for a response with a client id, that client's
 * marker in `SurveyCompletion{surveyId}` as complete. The row's key is the response id, so an id
 * that exists answers "exists" and leaves the row alone; the marker is still written, which repairs
 * one lost to a failure after the row. No audit row: the row is the event.
 *
 * Refuses (nothing written) an id that is not a GUID and answers that do not fit one table string.
 * Store failures reject with LegacyStoreError, which names the operation and driver code only.
 */
export async function writeResponse(
  targets: LegacyWriteTargets,
  survey: SurveyRecord,
  response: NewResponse,
  publishId: string | null,
): Promise<AppendOutcome> {
  const surveyId = checkedId("response write", survey.id);
  const postId = checkedId("response write", survey.postId);
  const id = checkedId("response write", response.id);
  const result = JSON.stringify(response.data);
  if (result.length > MAX_RESULT_LENGTH) {
    throw new ResponseTooLargeError(result.length, MAX_RESULT_LENGTH);
  }
  const row: TableEntity<Record<string, unknown>> = {
    partitionKey: "*",
    rowKey: id,
    id: guid(id),
    type: "SURVEY_POSTRESUTL",
    happendat: { type: "DateTime", value: response.submittedAt } satisfies Edm<"DateTime">,
    // Legacy never sets it: a random GUID, not the survey (layout section 3.6).
    surveyid: guid(randomUUID()),
    postid: guid(postId),
    result,
    ...(response.clientId !== undefined && { clientid: response.clientId }),
    ...(response.respondentIp !== undefined && { ipaddress: response.respondentIp }),
  };

  let outcome: AppendOutcome = "stored";
  try {
    await createEntityInTable(targets.resultTable(`post${postId.replaceAll("-", "")}`), row);
  } catch (error) {
    if (statusOf(error) !== 409) throw new LegacyStoreError("response write", error);
    outcome = "exists";
  }

  if (response.clientId !== undefined) {
    const marker: TableEntity<Record<string, unknown>> = {
      partitionKey: "*",
      rowKey: response.clientId,
      ispartialcompleted: false,
      ...(publishId !== null && { publishid: publishId }),
    };
    const table = targets.resultTable(`SurveyCompletion${surveyId.replaceAll("-", "")}`);
    try {
      try {
        await table.upsertEntity(marker, "Replace");
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
        await createTableIfMissing(table);
        await table.upsertEntity(marker, "Replace");
      }
    } catch (error) {
      throw new LegacyStoreError("completion marker write", error);
    }
  }
  return outcome;
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
 *    point, the four results-layout blobs `{container}/{id}` (layout sections 3.2, 3.4, 3.10) and
 *    every saved view under `my-surveys-views/{id}/` (Step 9).
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
    for (const name of await blobNames(targets.blobs, VIEWS_CONTAINER, `${id}/`)) {
      await deleteBlobIfPresent(targets.blobs, VIEWS_CONTAINER, name);
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
 * Deletes every blob under `{container}/{surveyId}/` (R3), or only those whose metadata `kind` is
 * `kind` when given (Step 10); returns how many were deleted. A missing container holds none.
 */
export async function writeSurveyFilesDeletion(
  blobs: BlobServiceClient,
  container: string,
  surveyId: string,
  kind?: FileKind,
): Promise<number> {
  const id = checkedId("file delete", surveyId);
  try {
    const names: string[] = [];
    await ignoringNotFound(async () => {
      const listing = blobs.getContainerClient(container).listBlobsFlat({
        prefix: `${id}/`,
        includeMetadata: kind !== undefined,
      });
      for await (const blob of listing) {
        if (kind === undefined || blob.metadata?.kind === kind) names.push(blob.name);
      }
    });
    let deleted = 0;
    for (const name of names) {
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

/** Container of the saved results layouts (Step 9, R4): invisible to legacy code. */
export const VIEWS_CONTAINER = "my-surveys-views";

/**
 * Put Blob of block blob `{surveyId}/{userId}/{view}` in the views container, replacing any blob.
 * A missing container is created (private) and the upload tried once more.
 */
async function uploadView(blobs: BlobServiceClient, name: string, content: Buffer): Promise<void> {
  const views = blobs.getContainerClient(VIEWS_CONTAINER);
  const upload = () =>
    views.getBlockBlobClient(name).uploadData(content, {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
  try {
    await upload();
  } catch (error) {
    if (statusOf(error) !== 404) throw error;
    await views.createIfNotExists();
    await upload();
  }
}

/** The blob name of a user's view, every part in lower case; refuses ids that are not GUIDs. */
function viewBlobName(operation: string, surveyId: string, userId: string, view: string): string {
  return `${checkedId(operation, surveyId)}/${checkedId(operation, userId)}/${view}`;
}

/**
 * Stores the user's state of a view as JSON (UTF-8) in `my-surveys-views/{surveyId}/{userId}/{view}`,
 * the latest save wins. No audit row, no change of the survey record (R7).
 */
export async function writeView(
  blobs: BlobServiceClient,
  surveyId: string,
  userId: string,
  view: string,
  state: Readonly<Record<string, unknown>>,
): Promise<void> {
  const name = viewBlobName("view save", surveyId, userId, view);
  try {
    await uploadView(blobs, name, Buffer.from(JSON.stringify(state), "utf8"));
  } catch (error) {
    throw new LegacyStoreError("view save", error);
  }
}

/** Replaces the user's view blob with zero bytes, the reset marker (R5). */
export async function writeViewReset(
  blobs: BlobServiceClient,
  surveyId: string,
  userId: string,
  view: string,
): Promise<void> {
  const name = viewBlobName("view reset", surveyId, userId, view);
  try {
    await uploadView(blobs, name, Buffer.alloc(0));
  } catch (error) {
    throw new LegacyStoreError("view reset", error);
  }
}

/** Rows of one transaction: the Table service accepts at most 100. */
const TRANSACTION_ROWS = 100;

/** Deletes every row of `table` (keys only listed), 100 per transaction; a missing table is fine. */
async function deleteAllRows(table: TableClient): Promise<void> {
  const keys = new Map<string, string[]>();
  try {
    const listing = table.listEntities({ queryOptions: { select: ["PartitionKey", "RowKey"] } });
    for await (const { partitionKey, rowKey } of listing) {
      if (partitionKey === undefined || rowKey === undefined) continue;
      const rows = keys.get(partitionKey) ?? [];
      rows.push(rowKey);
      keys.set(partitionKey, rows);
    }
  } catch (error) {
    if (statusOf(error) === 404) return;
    throw error;
  }
  for (const [partitionKey, rowKeys] of keys) {
    for (let from = 0; from < rowKeys.length; from += TRANSACTION_ROWS) {
      const batch = rowKeys.slice(from, from + TRANSACTION_ROWS);
      try {
        await table.submitTransaction(
          batch.map((rowKey): ["delete", { partitionKey: string; rowKey: string }] => [
            "delete",
            { partitionKey, rowKey },
          ]),
        );
      } catch (error) {
        if (statusOf(error) !== 404) throw error;
        // A row was deleted meanwhile: the batch fails as a whole, so go row by row.
        for (const rowKey of batch) {
          await ignoringNotFound(() => table.deleteEntity(partitionKey, rowKey));
        }
      }
    }
  }
}

/**
 * Deletes every response row of `post{postKey}` and every marker of `SurveyCompletion{surveyKey}`
 * in batches (Step 10, R7). The tables stay, so the next response is stored as before, and
 * `postdelete{postKey}` is not touched. Then a best-effort `SURVEY_DELETEALLRESULTS` audit row at
 * `deletedAt`. Store failures reject with LegacyStoreError.
 */
export async function writeResultsDeletion(
  targets: LegacyWriteTargets,
  survey: SurveyRecord,
  deletedAt: string,
): Promise<void> {
  const id = checkedId("results delete", survey.id);
  const postKey = checkedId("results delete", survey.postId).replaceAll("-", "");
  try {
    await deleteAllRows(targets.resultTable(`post${postKey}`));
    await deleteAllRows(targets.resultTable(`SurveyCompletion${id.replaceAll("-", "")}`));
  } catch (error) {
    throw new LegacyStoreError("results delete", error);
  }
  const event = surveyEvent("SURVEY_DELETEALLRESULTS", id, deletedAt);
  await appendEventBestEffort(targets, id, event, "the results are deleted.");
}

/**
 * Replaces the survey's public-question list: append blob `surveyresultpermissions/{surveyId}`, as
 * the legacy writers do (layout section 10). No SQL change and no audit row.
 */
export async function writePrivateQuestions(
  blobs: BlobServiceClient,
  surveyId: string,
  names: readonly string[],
): Promise<void> {
  const id = checkedId("public questions save", surveyId);
  const container = PERMISSIONS_CONTAINER;
  const content = Buffer.from(privateQuestionsToLegacy(names), "utf8");
  try {
    try {
      await replaceAppendBlob(blobs, container, id, content);
    } catch (error) {
      if (statusOf(error) !== 404) throw error;
      await blobs.getContainerClient(container).createIfNotExists();
      await replaceAppendBlob(blobs, container, id, content);
    }
  } catch (error) {
    throw new LegacyStoreError("public questions save", error);
  }
}

// Step 11: projects and members (layout sections 3.12 and 3.13). Every write that reads before it
// writes runs in one SQL transaction that first locks the project's `Organizations` row, so two
// writes to one project run one after the other and always take their locks in the same order.

/** Locks the project row until the transaction ends; no row: no such project. */
const PROJECT_LOCK = "SELECT id FROM Organizations WITH (UPDLOCK, HOLDLOCK) WHERE id = @project";
const PROJECT_INSERT =
  "INSERT INTO Organizations (id, name, type, happendat, [timestamp]) " +
  "VALUES (@project, @name, 'ORGANIZATION_CREATE', @now, @now)";
/** The creator's row: its id equals the project id, the marker of the creator (R2). */
const CREATOR_INSERT =
  "INSERT INTO OrganizationUsers (id, organizationid, userid, role, type, name, happendat, [timestamp]) " +
  "VALUES (@project, @project, @user, 'admin', 'ORGANIZATION_CREATE', @name, @now, @now)";
const PROJECT_RENAME =
  "UPDATE Organizations SET name = @name, [timestamp] = @now WHERE id = @project";
/** Every membership row of the project, locked until the transaction ends, and whether its user exists. */
const MEMBER_ROWS =
  "SELECT m.userid, m.role, CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS userexists " +
  "FROM OrganizationUsers m WITH (UPDLOCK, HOLDLOCK) LEFT JOIN Users u ON u.id = m.userid " +
  "WHERE m.organizationid = @project";
const MEMBER_INSERT =
  "INSERT INTO OrganizationUsers (id, organizationid, userid, role, type, happendat, [timestamp]) " +
  "VALUES (@id, @project, @user, @role, 'ORGANIZATION_JOIN', @now, @now)";
const MEMBER_ROLE_UPDATE =
  "UPDATE OrganizationUsers SET role = @role, [timestamp] = @now " +
  "WHERE organizationid = @project AND userid = @user";
const MEMBER_DELETE =
  "DELETE FROM OrganizationUsers WHERE organizationid = @project AND userid = @user";
/** Moves every survey of the project, archived ones too; `creatorid` stays (R9). */
const PROJECT_SURVEYS_MOVE =
  "DECLARE @moved TABLE (id uniqueidentifier, creatorid uniqueidentifier); " +
  "UPDATE Surveys SET userid = @receiver, [timestamp] = @now " +
  "OUTPUT inserted.id, inserted.creatorid INTO @moved WHERE userid = @project; " +
  "SELECT id, creatorid FROM @moved";
const PROJECT_MEMBERS_DELETE = "DELETE FROM OrganizationUsers WHERE organizationid = @project";
const PROJECT_DELETE = "DELETE FROM Organizations WHERE id = @project";

/** The id in lower case; refuses anything but a GUID before a project or member write. */
function checkedProjectId(operation: string, value: string): string {
  if (!isGuid(value)) throw new Error(`Project ${operation} refused: every id must be a GUID`);
  return value.toLowerCase();
}

/** What a transaction body found: the value to return, and whether its writes are kept. */
interface TransactionEnd<T> {
  readonly value: T;
  readonly commit: boolean;
}

/** Tries of a transaction that SQL Server chose as a deadlock victim, the first included. */
const DEADLOCK_ATTEMPTS = 3;

const sqlErrorNumber = (error: unknown): unknown =>
  typeof error === "object" && error !== null ? (error as { number?: unknown }).number : undefined;

/**
 * Whether the error is SQL Server's "chosen as deadlock victim" (error 1205), on the driver error
 * or on its original error. The server has then rolled the whole transaction back.
 */
export function isDeadlockVictim(error: unknown): boolean {
  const original =
    typeof error === "object" && error !== null
      ? (error as { originalError?: unknown }).originalError
      : undefined;
  return sqlErrorNumber(error) === 1205 || sqlErrorNumber(original) === 1205;
}

/** Wait before try `attempt + 1`: attempt × a random 20–60 ms, so two victims do not meet again. */
const deadlockBackOff = (attempt: number): Promise<void> =>
  setTimeout(attempt * (20 + Math.random() * 40));

/**
 * Runs `run(attempt)` and runs it again, after `wait(attempt)`, while it fails as a deadlock victim,
 * up to `attempts` tries in all. Any other error, and the error of the last try, rejects at once.
 */
export async function withDeadlockRetry<T>(
  run: (attempt: number) => Promise<T>,
  attempts = DEADLOCK_ATTEMPTS,
  wait: (attempt: number) => Promise<void> = deadlockBackOff,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      if (attempt >= attempts || !isDeadlockVictim(error)) throw error;
      await wait(attempt);
    }
  }
}

/** A commit that failed: its outcome is unknown, so it is never tried again. */
class CommitFailedError extends Error {
  constructor(readonly driverError: unknown) {
    super("The commit failed");
    this.name = "CommitFailedError";
  }
}

/**
 * One try of `body` in a new SQL transaction. The body runs its requests one at a time (a
 * transaction takes one request at a time). The transaction commits when the body says so, else
 * it rolls back. On any error it rolls back (a failing rollback is ignored: the transaction was
 * not begun or has already ended) and rethrows; a failed commit rethrows as CommitFailedError.
 */
async function transactionAttempt<T>(
  pool: sql.ConnectionPool,
  body: (request: () => sql.Request) => Promise<TransactionEnd<T>>,
): Promise<T> {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    const end = await body(() => new sql.Request(transaction));
    if (!end.commit) {
      await transaction.rollback();
      return end.value;
    }
    try {
      await transaction.commit();
    } catch (error) {
      throw new CommitFailedError(error);
    }
    return end.value;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Not begun, already ended, or aborted by the server: nothing is kept either way.
    }
    throw error;
  }
}

/**
 * Runs `body` in one SQL transaction (transactionAttempt). A deadlock victim is run again in a new
 * transaction, up to DEADLOCK_ATTEMPTS tries (the bodies have no effect outside the transaction);
 * each retry is logged with the operation and the try only. The final failure rejects with
 * LegacyStoreError(operation).
 */
async function inTransaction<T>(
  targets: LegacyWriteTargets,
  operation: string,
  body: (request: () => sql.Request) => Promise<TransactionEnd<T>>,
): Promise<T> {
  try {
    const pool = await targets.pool();
    return await withDeadlockRetry(
      () => transactionAttempt(pool, body),
      DEADLOCK_ATTEMPTS,
      (attempt) => {
        targets.logger.warn(
          { operation, attempt: String(attempt) },
          "Retrying a transaction chosen as deadlock victim.",
        );
        return deadlockBackOff(attempt);
      },
    );
  } catch (error) {
    const driverError = error instanceof CommitFailedError ? error.driverError : error;
    throw new LegacyStoreError(operation, driverError);
  }
}

/** Locks the project row (PROJECT_LOCK); false when there is no such project. */
async function lockProject(request: () => sql.Request, projectId: string): Promise<boolean> {
  const locked = await request()
    .input("project", sql.UniqueIdentifier, projectId)
    .query(PROJECT_LOCK);
  return locked.recordset.length > 0;
}

/**
 * Locks the project row, then reads and locks its membership rows (in this order in every
 * transaction). null when there is no such project.
 */
async function lockedMembers(
  request: () => sql.Request,
  projectId: string,
): Promise<MembershipFacts[] | null> {
  if (!(await lockProject(request, projectId))) return null;
  const rows = await request()
    .input("project", sql.UniqueIdentifier, projectId)
    .query<{ userid: string; role: string | null; userexists: number }>(MEMBER_ROWS);
  return rows.recordset.map((row) => ({
    userId: row.userid.toLowerCase(),
    role: row.role,
    userExists: row.userexists === 1,
  }));
}

/**
 * Stores a new project as the legacy create does (R4), in one transaction: the `Organizations`
 * row (`ORGANIZATION_CREATE`, `happendat` = `timestamp` = `createdAt`), then the creator's
 * `OrganizationUsers` row (id = project id, role `admin`, the project name). An id in use fails on
 * the primary key and nothing is stored. No audit row (legacy writes none).
 */
export async function writeProjectCreation(
  targets: LegacyWriteTargets,
  project: NewProject,
): Promise<void> {
  const id = checkedProjectId("create", project.id);
  const creatorId = checkedProjectId("create", project.creatorId);
  const at = new Date(project.createdAt);
  await inTransaction(targets, "project create", async (request) => {
    await request()
      .input("project", sql.UniqueIdentifier, id)
      .input("name", sql.NVarChar(sql.MAX), project.name)
      .input("now", sql.DateTime, at)
      .query(PROJECT_INSERT);
    await request()
      .input("project", sql.UniqueIdentifier, id)
      .input("user", sql.UniqueIdentifier, creatorId)
      .input("name", sql.NVarChar(sql.MAX), project.name)
      .input("now", sql.DateTime, at)
      .query(CREATOR_INSERT);
    return { value: undefined, commit: true };
  });
}

/**
 * Renames a project (R5): `name` and `timestamp` only; `type`, `happendat` and the creator row's
 * `name` stay. false when no project has this id.
 */
export async function writeProjectRename(
  targets: LegacyWriteTargets,
  projectId: string,
  name: string,
  now: string,
): Promise<boolean> {
  const id = checkedProjectId("rename", projectId);
  try {
    const result = await (
      await targets.pool()
    )
      .request()
      .input("project", sql.UniqueIdentifier, id)
      .input("name", sql.NVarChar(sql.MAX), name)
      .input("now", sql.DateTime, new Date(now))
      .query(PROJECT_RENAME);
    return (result.rowsAffected[0] ?? 0) > 0;
  } catch (error) {
    throw new LegacyStoreError("project rename", error);
  }
}

/**
 * Adds a member (R6) in one transaction: `already-member` when the user has any row in the
 * project, else a new row (random id, `ORGANIZATION_JOIN`, the role in lower case, no name).
 */
export async function writeMemberAddition(
  targets: LegacyWriteTargets,
  projectId: string,
  userId: string,
  role: ProjectRole,
  now: string,
): Promise<AddMemberOutcome> {
  const project = checkedProjectId("member add", projectId);
  const user = checkedProjectId("member add", userId);
  return inTransaction<AddMemberOutcome>(targets, "member add", async (request) => {
    const members = await lockedMembers(request, project);
    if (members === null) return { value: "not-found", commit: false };
    if (members.some((member) => member.userId === user)) {
      return { value: "already-member", commit: false };
    }
    await request()
      .input("id", sql.UniqueIdentifier, randomUUID())
      .input("project", sql.UniqueIdentifier, project)
      .input("user", sql.UniqueIdentifier, user)
      .input("role", sql.VarChar(sql.MAX), role.toLowerCase())
      .input("now", sql.DateTime, new Date(now))
      .query(MEMBER_INSERT);
    return { value: "added", commit: true };
  });
}

/**
 * Sets the role of every row of the member in place (R3) when decideRoleChange allows it (R8):
 * only `role` and `timestamp` change, so the row's id (the creator marker), `type`, `happendat`
 * and `name` stay. The check and the write are one transaction.
 */
export async function writeMemberRole(
  targets: LegacyWriteTargets,
  projectId: string,
  userId: string,
  role: ProjectRole,
  now: string,
): Promise<RoleChangeOutcome> {
  const project = checkedProjectId("member role", projectId);
  const user = checkedProjectId("member role", userId);
  return inTransaction<RoleChangeOutcome>(targets, "member role", async (request) => {
    const members = await lockedMembers(request, project);
    if (members === null) return { value: "not-found", commit: false };
    const outcome = decideRoleChange(members, user, role);
    if (outcome !== "changed") return { value: outcome, commit: false };
    await request()
      .input("project", sql.UniqueIdentifier, project)
      .input("user", sql.UniqueIdentifier, user)
      .input("role", sql.VarChar(sql.MAX), role.toLowerCase())
      .input("now", sql.DateTime, new Date(now))
      .query(MEMBER_ROLE_UPDATE);
    return { value: outcome, commit: true };
  });
}

/**
 * Deletes every row of the member, duplicates included (R7), when decideRemoval allows it (R8).
 * The check and the write are one transaction.
 */
export async function writeMemberRemoval(
  targets: LegacyWriteTargets,
  projectId: string,
  userId: string,
): Promise<RemovalOutcome> {
  const project = checkedProjectId("member remove", projectId);
  const user = checkedProjectId("member remove", userId);
  return inTransaction<RemovalOutcome>(targets, "member remove", async (request) => {
    const members = await lockedMembers(request, project);
    if (members === null) return { value: "not-found", commit: false };
    const outcome = decideRemoval(members, user);
    if (outcome !== "removed") return { value: outcome, commit: false };
    await request()
      .input("project", sql.UniqueIdentifier, project)
      .input("user", sql.UniqueIdentifier, user)
      .query(MEMBER_DELETE);
    return { value: outcome, commit: true };
  });
}

/** A survey moved out of a deleted project, with its unchanged creator. */
interface MovedSurvey {
  readonly id: string;
  readonly creatorId: string | null;
}

/**
 * Deletes a project (R9) in one transaction: every survey of the project, archived ones included,
 * moves to the personal scope of `receiverId` (`userid` and `timestamp` change, `creatorid`
 * stays), then the membership rows and the `Organizations` row are deleted. Then, best effort, a
 * `SURVEY_TRANSFER` audit row per moved survey with the receiver and the unchanged creator.
 *
 * Returns the moved survey ids in lower case, sorted; null when no project has this id (nothing
 * is written).
 */
export async function writeProjectDeletion(
  targets: LegacyWriteTargets,
  projectId: string,
  receiverId: string,
  now: string,
): Promise<string[] | null> {
  const project = checkedProjectId("delete", projectId);
  const receiver = checkedProjectId("delete", receiverId);
  const moved = await inTransaction<MovedSurvey[] | null>(
    targets,
    "project delete",
    async (request) => {
      if (!(await lockProject(request, project))) return { value: null, commit: false };
      const surveys = await request()
        .input("receiver", sql.UniqueIdentifier, receiver)
        .input("now", sql.DateTime, new Date(now))
        .input("project", sql.UniqueIdentifier, project)
        .query<{ id: string; creatorid: string | null }>(PROJECT_SURVEYS_MOVE);
      await request().input("project", sql.UniqueIdentifier, project).query(PROJECT_MEMBERS_DELETE);
      await request().input("project", sql.UniqueIdentifier, project).query(PROJECT_DELETE);
      const value = surveys.recordset.map((row) => ({
        id: row.id.toLowerCase(),
        creatorId: row.creatorid === null ? null : row.creatorid.toLowerCase(),
      }));
      return { value, commit: true };
    },
  );
  if (moved === null) return null;

  moved.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const survey of moved) {
    const event = surveyEvent("SURVEY_TRANSFER", survey.id, now, {
      userid: guid(receiver),
      ...(survey.creatorId !== null && { creatorid: guid(survey.creatorId) }),
    });
    await appendEventBestEffort(targets, survey.id, event, "the project is deleted.");
  }
  return moved.map((survey) => survey.id);
}

// Step 12: member erasure (R11). MEMBER_DELETE and MEMBER_ROLE_UPDATE of Step 11 are reused.

/** Every membership row of the project, locked, with whether its user exists and the user's names. */
const MEMBER_ROWS_WITH_NAMES =
  "SELECT m.userid, m.role, CASE WHEN u.id IS NULL THEN 0 ELSE 1 END AS userexists, u.email, u.displayname " +
  "FROM OrganizationUsers m WITH (UPDLOCK, HOLDLOCK) LEFT JOIN Users u ON u.id = m.userid " +
  "WHERE m.organizationid = @project";

/**
 * Erases one member of a project (R11) in one transaction: locks the project row, then reads and
 * locks its membership rows with the users' names, and decides with decideMemberErasure.
 * `remove`: every row of the user is deleted (orphan or not). `promote`: the same, then every row
 * of the successor gets `admin` and `timestamp` = `now` in place (id, `type`, `happendat` stay).
 * `not-member` (also for no such project) and `last-member` write nothing. No audit row (project
 * writes write none).
 */
export async function writeMemberErasure(
  targets: LegacyWriteTargets,
  projectId: string,
  userId: string,
  now: string,
): Promise<MemberErasure> {
  const project = checkedProjectId("member erase", projectId);
  const user = checkedProjectId("member erase", userId);
  return inTransaction<MemberErasure>(targets, "member erase", async (request) => {
    if (!(await lockProject(request, project))) {
      return { value: { kind: "not-member" }, commit: false };
    }
    const rows = await request().input("project", sql.UniqueIdentifier, project).query<{
      userid: string;
      role: string | null;
      userexists: number;
      email: string | null;
      displayname: string | null;
    }>(MEMBER_ROWS_WITH_NAMES);
    const facts: ErasureFacts[] = rows.recordset.map((row) => ({
      userId: row.userid.toLowerCase(),
      role: row.role,
      userExists: row.userexists === 1,
      displayName:
        row.userexists === 1
          ? userFromLegacy({
              id: row.userid,
              email: row.email,
              displayname: row.displayname,
              blocked: null,
            }).displayName
          : "",
    }));
    const decision = decideMemberErasure(facts, user);
    if (decision.kind !== "remove" && decision.kind !== "promote") {
      return { value: decision, commit: false };
    }
    await request()
      .input("project", sql.UniqueIdentifier, project)
      .input("user", sql.UniqueIdentifier, user)
      .query(MEMBER_DELETE);
    if (decision.kind === "promote") {
      await request()
        .input("project", sql.UniqueIdentifier, project)
        .input("user", sql.UniqueIdentifier, decision.successorId)
        .input("role", sql.VarChar(sql.MAX), "admin")
        .input("now", sql.DateTime, new Date(now))
        .query(MEMBER_ROLE_UPDATE);
    }
    return { value: decision, commit: true };
  });
}
