import { randomUUID } from "node:crypto";
import type { Edm, TableClient, TableEntity } from "@azure/data-tables";
import type { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import type { NewSurvey, SurveyDefinition } from "../../domain/types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import type { LegacyWarningLogger } from "./index.js";
import { isGuid } from "./mapping.js";

/**
 * The only module allowed to write to the legacy stores; ESLint keeps the rest of the
 * azure-legacy folder read-only. Step 4: survey creation, in the format the legacy site writes
 * (layout section 5.3, "Create survey").
 *
 * Errors and log lines built here hold operation names, driver codes and row ids only, never row
 * content or a connection string.
 */

/** The stores a survey creation writes to. */
export interface LegacyWriteTargets {
  /** The connected pool of the legacy database. */
  readonly pool: () => Promise<sql.ConnectionPool>;
  /** Blob service of the surveys account. */
  readonly blobs: BlobServiceClient;
  /** Table `surveys` of the surveys account: the survey event log (layout section 3.5). */
  readonly events: TableClient;
  readonly logger: LegacyWarningLogger;
}

/** Surveys.name is nvarchar(200) (layout section 3.1). */
const MAX_NAME_LENGTH = 200;
const APPEND_BLOCK_BYTES = 4 * 1024 * 1024;

const SURVEY_INSERT =
  "INSERT INTO Surveys (id, name, userid, creatorid, postid, resultid, createdat, [timestamp]) " +
  "VALUES (@id, @name, @userid, @creatorid, @postid, @resultid, @createdat, @timestamp)";

const ownerIdOf = (survey: NewSurvey): string =>
  survey.owner.kind === "personal" ? survey.owner.userId : survey.owner.projectId;

/**
 * The survey with lower-case ids, checked before anything is written: every id must be a GUID
 * (they also name blobs) and the name must fit `Surveys.name` (a longer one must not be cut).
 */
function checked(survey: NewSurvey): NewSurvey {
  const ids = [survey.id, ownerIdOf(survey), survey.creatorId, survey.postId, survey.resultId];
  if (!ids.every(isGuid)) throw new Error("Survey create refused: every id must be a GUID");
  if (survey.name.length > MAX_NAME_LENGTH) {
    throw new Error(`Survey create refused: the name is longer than ${MAX_NAME_LENGTH}`);
  }
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

/**
 * Creates append blob `{container}/{name}` holding `content`. Refuses to replace an existing
 * blob, so a duplicate survey id never overwrites another survey's definition.
 */
async function writeNewAppendBlob(
  blobs: BlobServiceClient,
  container: string,
  name: string,
  content: Buffer,
): Promise<void> {
  const blob = blobs.getContainerClient(container).getAppendBlobClient(name);
  await blob.create({ conditions: { ifNoneMatch: "*" } });
  for (let offset = 0; offset < content.length; offset += APPEND_BLOCK_BYTES) {
    const chunk = content.subarray(offset, offset + APPEND_BLOCK_BYTES);
    await blob.appendBlock(chunk, chunk.length);
  }
}

const guid = (value: string): Edm<"Guid"> => ({ type: "Guid", value });

/** The `SURVEY_CREATE` event row (layout sections 3.5 and 5.1). */
function createEvent(survey: NewSurvey): TableEntity {
  const eventId = randomUUID();
  const event: TableEntity<Record<string, unknown>> = {
    partitionKey: "*",
    rowKey: eventId,
    id: guid(eventId),
    type: "SURVEY_CREATE",
    happendat: { type: "DateTime", value: survey.createdAt } satisfies Edm<"DateTime">,
    surveyid: guid(survey.id),
    postid: guid(survey.postId),
    resultid: guid(survey.resultId),
    userid: guid(ownerIdOf(survey)),
    creatorid: guid(survey.creatorId),
    name: survey.name,
  };
  return event;
}

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
 * Stores a new survey as the legacy create does: the definition blobs first (when given), then
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
  const survey = checked(input);
  try {
    if (definition !== undefined) {
      const text = Buffer.from(JSON.stringify(definition), "utf8");
      await writeNewAppendBlob(targets.blobs, "surveyjson", survey.id, text);
      await writeNewAppendBlob(targets.blobs, "surveytext", survey.id, text);
      // The legacy definition save also writes a history point.
      const point = `${survey.id}/${randomUUID()}`;
      await writeNewAppendBlob(targets.blobs, "surveyjsonhistory", point, text);
    }
    await (
      await targets.pool()
    )
      .request()
      .input("id", sql.UniqueIdentifier, survey.id)
      .input("name", sql.NVarChar(MAX_NAME_LENGTH), survey.name)
      .input("userid", sql.UniqueIdentifier, ownerIdOf(survey))
      .input("creatorid", sql.UniqueIdentifier, survey.creatorId)
      .input("postid", sql.UniqueIdentifier, survey.postId)
      .input("resultid", sql.UniqueIdentifier, survey.resultId)
      .input("createdat", sql.DateTime, new Date(survey.createdAt))
      .input("timestamp", sql.DateTime, new Date(survey.updatedAt))
      .query(SURVEY_INSERT);
  } catch (error) {
    throw new LegacyStoreError("survey create", error);
  }

  try {
    await appendEvent(targets.events, createEvent(survey));
  } catch {
    targets.logger.warn(
      { surveyId: survey.id },
      "Could not write the SURVEY_CREATE audit row; the survey is stored.",
    );
  }
  return survey.id;
}
