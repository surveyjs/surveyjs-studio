import { TableClient, TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import type { Clock } from "../../auth/session.js";
import type { AccountNoticesSetting, LegacyConfig } from "../../config.js";
import type {
  HistoryEntryRecord,
  NewSurvey,
  ProjectMembership,
  SaveOutcome,
  SurveyChanges,
  SurveyDefinition,
  SurveyOwner,
  SurveyTheme,
  Versioned,
} from "../../domain/types.js";
import { contentVersion } from "../../domain/content-version.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { demoAccountNotices, type AccountNotices } from "../../notices/account-notices.js";
import { licenceNotices } from "../../notices/licence-rule.js";
import { historyOrder, isAfterHistory, projectListOrder, surveyListOrder } from "../ordering.js";
import type {
  CloneOptions,
  HistoryPage,
  HistoryQuery,
  ProviderSet,
  SurveyPage,
  SurveyPageQuery,
  SurveyPosition,
} from "../types.js";
import { LegacyStoreError, statusOf } from "./errors.js";
import { createAzureFileStore } from "./files.js";
import {
  UnmappableLegacyRowError,
  definitionFromLegacy,
  historyEntryFromBlob,
  isGuid,
  licenceExpiriesFromLegacy,
  membershipFromLegacy,
  projectFromLegacy,
  surveyFromLegacy,
  themeFromLegacy,
  userFromLegacy,
} from "./mapping.js";
import type {
  LegacyLicenceRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";
import {
  writeClonedSurvey,
  writeDefinitionSave,
  writeNewSurvey,
  writeSurveyChanges,
  writeSurveyDeletion,
  writeThemeSave,
  type LegacyWriteTargets,
} from "./writes.js";

/**
 * Provider over the legacy surveyjs.io stores (layout: docs/architecture/legacy-data-layout.md).
 * Survey records and the Directory come from SQL, survey definitions from the `surveyjson` blobs.
 * With `ACCOUNT_NOTICES=surveyjs-licenses` the account notices come from the site's licence
 * tables in the same database.
 *
 * This file holds SELECT statements and read-only SDK calls only (ESLint enforces it for the
 * folder): survey creation, update, clone, delete and the definition and theme saves call the
 * writers of writes.ts. Editor files live in a container of their own (files.ts).
 * Connection strings are secrets: no error or log line built here holds one.
 */

/** Reads a download stream to the end (a missing body is empty). */
async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  const chunks: Buffer[] = [];
  if (stream) for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export { LegacyStoreError } from "./errors.js";

/** Pino-compatible warning sink (Fastify's `app.log` fits). */
export interface LegacyWarningLogger {
  warn(details: Readonly<Record<string, string>>, message: string): void;
}

export interface AzureLegacyOptions {
  /** Upper bound for `ready()`; default 5 s. */
  readonly readyTimeoutMs?: number;
  /**
   * Told about each legacy row that is skipped because the domain cannot represent it. The
   * details hold row ids only. Default: no-op.
   */
  readonly logger?: LegacyWarningLogger;
  /** `ACCOUNT_NOTICES`; default `none`. `surveyjs-licenses` reads the legacy licence tables. */
  readonly accountNotices?: AccountNoticesSetting;
  /** Clock for the licence-expiry rule and the survey-delete audit row; default `Date.now`. */
  readonly now?: Clock;
  /** Blob container of the editor files in the surveys account; default `my-surveys-files`. Tests only. */
  readonly filesContainer?: string;
}

/** The editor files' container (Step 7, R2), invisible to legacy code. */
const FILES_CONTAINER = "my-surveys-files";

/** Users.email is varchar(200) (layout section 3.11). */
const MAX_EMAIL_LENGTH = 200;
const EPOCH = new Date(0);

const SURVEY_COLUMNS =
  "s.id, s.name, s.userid, s.creatorid, s.postid, s.resultid, s.createdat, s.[timestamp], " +
  "s.ispublished, s.isarchived, s.allowaccessresult, s.storeipaddress, s.usecookies, " +
  "CASE WHEN EXISTS (SELECT 1 FROM Organizations o WHERE o.id = s.userid) THEN 1 ELSE 0 END " +
  "AS isproject";
const SURVEY_SELECT = `SELECT ${SURVEY_COLUMNS} FROM Surveys s`;
const IS_PROJECT_SURVEY = "EXISTS (SELECT 1 FROM Organizations o WHERE o.id = s.userid)";

/**
 * List order of ordering.ts in SQL. The sort time has the mapping's `updatedAt` fallback. The
 * tie-break is the id text under a binary collation: SQL Server's own uniqueidentifier order is
 * not the text order, and a linguistic collation may ignore `-`. The cast text is upper-case,
 * whose binary order equals the code-point order of the lower-case ids.
 */
const SURVEY_SORT_TIME = "COALESCE(s.[timestamp], s.createdat, CAST('1970-01-01' AS datetime))";
const SURVEY_TIE_BREAK = "CAST(s.id AS char(36)) COLLATE Latin1_General_BIN2";
const ACTIVE_SURVEY = "(s.isarchived IS NULL OR s.isarchived <> 1)";
const ARCHIVED_SURVEY = "s.isarchived = 1";

/**
 * Every licence of a user (layout section 3.15): owned rows, each joined to its parent licence
 * (developer seats), then the licences transferred to the user.
 */
const LICENCE_SELECT =
  "SELECT l.id, l.expirationdate, l.parentlicenseid, p.id AS parentid, " +
  "p.expirationdate AS parentexpirationdate " +
  "FROM UserLicenses l LEFT JOIN UserLicenses p ON p.id = l.parentlicenseid " +
  "WHERE l.userid = @user " +
  "UNION ALL " +
  "SELECT t.id, l.expirationdate, NULL, NULL, NULL " +
  "FROM LicenseTransfers t LEFT JOIN UserLicenses l ON l.id = t.licenseid " +
  "WHERE t.userid = @user";

/**
 * Every membership row of every project the user belongs to, with its project's columns, so
 * projectFromLegacy can infer owner, creation time and member count (layout section 9.3).
 */
const PROJECT_MEMBERS_SELECT =
  "SELECT m.id, m.organizationid, m.userid, m.role, m.happendat, o.name, " +
  "o.happendat AS orghappendat " +
  "FROM OrganizationUsers m JOIN Organizations o ON o.id = m.organizationid " +
  "WHERE m.organizationid IN (SELECT organizationid FROM OrganizationUsers WHERE userid = @user)";

type SurveyQueryRow = LegacySurveyRow & { isproject: number };
type ProjectMemberQueryRow = LegacyOrganizationUserRow & {
  name: string | null;
  orghappendat: Date | null;
};

const ownerIdOf = (owner: SurveyOwner): string =>
  owner.kind === "personal" ? owner.userId : owner.projectId;

/** The list position of a raw row, with the mapping's `updatedAt` fallback. */
const positionOfRow = (row: LegacySurveyRow): SurveyPosition => ({
  updatedAt: (row.timestamp ?? row.createdat ?? EPOCH).toISOString(),
  id: row.id.toLowerCase(),
});

function sqlPool(connectionString: string): sql.ConnectionPool {
  let pool: sql.ConnectionPool;
  try {
    pool = new sql.ConnectionPool(connectionString);
  } catch {
    throw new Error("LEGACY_SQL_CONNECTION_STRING is not a valid SQL Server connection string");
  }
  // Failures reach callers through rejected promises; without a listener an emitted 'error'
  // event would crash the process.
  pool.on("error", () => undefined);
  return pool;
}

/** Table `surveys` of the surveys account, the survey event log (layout section 3.5). */
function surveyEventsTable(connectionString: string): TableClient {
  try {
    return TableClient.fromConnectionString(connectionString, "surveys", {
      allowInsecureConnection: isLocalStorageString(connectionString),
    });
  } catch {
    throw new Error(
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING is not a valid Azure Storage connection string",
    );
  }
}

function storageClients(
  variable: string,
  connectionString: string,
): { blobs: BlobServiceClient; tables: TableServiceClient } {
  try {
    return {
      blobs: BlobServiceClient.fromConnectionString(connectionString),
      tables: TableServiceClient.fromConnectionString(connectionString, {
        // Plain http is allowed for a local emulator only.
        allowInsecureConnection: isLocalStorageString(connectionString),
      }),
    };
  } catch {
    throw new Error(`${variable} is not a valid Azure Storage connection string`);
  }
}

export function createAzureLegacyProviders(
  legacy: LegacyConfig,
  options: AzureLegacyOptions = {},
): ProviderSet {
  const readyTimeoutMs = options.readyTimeoutMs ?? 5_000;
  const logger = options.logger ?? { warn: () => undefined };
  const now = options.now ?? Date.now;

  /** Maps each row; a row the domain cannot represent is skipped and reported by its ids. */
  function mapRows<R, T>(rows: readonly R[], map: (row: R) => T): T[] {
    const mapped: T[] = [];
    for (const row of rows) {
      try {
        mapped.push(map(row));
      } catch (error) {
        if (!(error instanceof UnmappableLegacyRowError)) throw error;
        logger.warn({ ...error.ids }, `Skipped a legacy row. ${error.message}`);
      }
    }
    return mapped;
  }
  const pool = sqlPool(legacy.sqlConnectionString);
  const surveysAccount = storageClients(
    "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
    legacy.surveysStorageConnectionString,
  );
  const resultsAccount = storageClients(
    "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
    legacy.resultsStorageConnectionString,
  );
  const accounts = [surveysAccount, resultsAccount];
  const surveyEvents = surveyEventsTable(legacy.surveysStorageConnectionString);

  // The pool connects on first use, so the server starts (and /readyz answers 503) while the
  // database is down, and recovers when it comes back.
  let connecting: Promise<sql.ConnectionPool> | null = null;
  let closing: Promise<void> | null = null;
  const closedError = () => new Error("The azure-legacy provider is closed");
  /** The connected pool; refuses once close() has started, also for a connect already in flight. */
  async function connected(): Promise<sql.ConnectionPool> {
    if (closing) throw closedError();
    connecting ??= pool.connect().catch((error: unknown) => {
      connecting = null;
      throw error;
    });
    const ready = await connecting;
    if (closing) throw closedError();
    return ready;
  }

  /** Runs one parameterised SELECT; driver errors become LegacyStoreError. */
  async function select<T>(
    operation: string,
    text: string,
    bind: (request: sql.Request) => sql.Request = (request) => request,
  ): Promise<T[]> {
    try {
      const result = await bind((await connected()).request()).query<T>(text);
      return result.recordset;
    } catch (error) {
      throw new LegacyStoreError(operation, error);
    }
  }

  /** The surveyjs.io licence-expiry notices of a user, from the legacy licence tables. */
  const licenceNoticesFromSql: AccountNotices = {
    async noticesFor(userId) {
      if (!isGuid(userId)) return [];
      const rows = await select<LegacyLicenceRow>("licence list", LICENCE_SELECT, (request) =>
        request.input("user", sql.UniqueIdentifier, userId),
      );
      try {
        return licenceNotices(licenceExpiriesFromLegacy(rows), now());
      } catch (error) {
        // The legacy site fails the whole check on such a row and shows no dialog.
        if (!(error instanceof UnmappableLegacyRowError)) throw error;
        logger.warn({ ...error.ids }, `Skipped the licence notices. ${error.message}`);
        return [];
      }
    },
  };
  const accountNotices = options.accountNotices ?? "none";
  const notices =
    accountNotices === "surveyjs-licenses"
      ? licenceNoticesFromSql
      : demoAccountNotices(accountNotices);

  /** The user's memberships among the rows of PROJECT_MEMBERS_SELECT. */
  function membershipsFromRows(
    rows: readonly ProjectMemberQueryRow[],
    userId: string,
  ): ProjectMembership[] {
    const projectOf = (row: ProjectMemberQueryRow) => row.organizationid.toLowerCase();
    const user = userId.toLowerCase();
    const memberships: ProjectMembership[] = [];
    for (const projectId of new Set(rows.map(projectOf))) {
      const members = rows.filter((row) => projectOf(row) === projectId);
      const [first] = members as [ProjectMemberQueryRow]; // never empty: projectId comes from rows
      const project = projectFromLegacy(
        { id: first.organizationid, name: first.name, happendat: first.orghappendat },
        members,
      );
      const own = members.filter((row) => row.userid.toLowerCase() === user);
      memberships.push(...mapRows(own, (row) => membershipFromLegacy(project, row)));
    }
    return memberships.sort(projectListOrder);
  }

  async function getSurvey(id: string) {
    if (!isGuid(id)) return null;
    const rows = await select<SurveyQueryRow>(
      "survey lookup",
      `${SURVEY_SELECT} WHERE s.id = @id`,
      (request) => request.input("id", sql.UniqueIdentifier, id),
    );
    const [survey] = mapRows(rows, (row) =>
      surveyFromLegacy(row, row.isproject === 1 ? "project" : "personal"),
    );
    return survey ?? null;
  }

  /**
   * One page in list order, read with one SELECT of at most `limit + 1` rows. The extra row only
   * tells whether more follow. `next` is the position of the last row the page covered, also when
   * that row was skipped as unmappable, so a walk never loops or misses a row.
   */
  async function listSurveyPage({
    owner,
    archived,
    after,
    limit,
  }: SurveyPageQuery): Promise<SurveyPage> {
    const ownerId = ownerIdOf(owner);
    if (!isGuid(ownerId)) return { items: [], next: null };
    const conditions = [
      "s.userid = @owner",
      owner.kind === "project" ? IS_PROJECT_SURVEY : `NOT ${IS_PROJECT_SURVEY}`,
      archived ? ARCHIVED_SURVEY : ACTIVE_SURVEY,
    ];
    if (after) {
      conditions.push(
        `(${SURVEY_SORT_TIME} < @afterAt OR ` +
          `(${SURVEY_SORT_TIME} = @afterAt AND ${SURVEY_TIE_BREAK} > @afterId))`,
      );
    }
    const rows = await select<SurveyQueryRow>(
      "survey page",
      `SELECT TOP (@take) ${SURVEY_COLUMNS} FROM Surveys s WHERE ${conditions.join(" AND ")} ` +
        `ORDER BY ${SURVEY_SORT_TIME} DESC, ${SURVEY_TIE_BREAK} ASC`,
      (request) => {
        request.input("owner", sql.UniqueIdentifier, ownerId).input("take", sql.Int, limit + 1);
        if (after) {
          request
            .input("afterAt", sql.DateTime, new Date(after.updatedAt))
            .input("afterId", sql.VarChar(64), after.id.toUpperCase());
        }
        return request;
      },
    );
    const covered = rows.slice(0, limit);
    const last = covered.at(-1);
    return {
      items: mapRows(covered, (row) => surveyFromLegacy(row, owner.kind)),
      next: rows.length > limit && last ? positionOfRow(last) : null,
    };
  }

  async function getDefinition(id: string): Promise<Versioned<SurveyDefinition> | null> {
    const survey = await getSurvey(id);
    if (!survey) return null;
    let text: string;
    let version: string;
    try {
      const response = await surveysAccount.blobs
        .getContainerClient("surveyjson")
        .getBlobClient(survey.id)
        .download();
      // Body and ETag come from the same response, so the version names the text read.
      text = (await streamToBuffer(response.readableStreamBody)).toString("utf8");
      version = (response.etag ?? "").replaceAll('"', "");
    } catch (error) {
      // No blob until the first save (layout section 3.2).
      if (statusOf(error) === 404) return { content: {}, version: "none" };
      throw new LegacyStoreError("definition read", error);
    }
    // An empty surveyjson is a save that failed after replacing it (writeDefinitionSave): the
    // text is still in surveytext, written after it. The version stays surveyjson's, so the next
    // save with it rewrites both blobs.
    if (text === "") text = await surveyTextBlob(survey.id);
    // A version is never empty: without an ETag no save could be checked against this read.
    if (version === "") throw new LegacyStoreError("definition read", new Error("no ETag"));
    try {
      return { content: definitionFromLegacy(survey.id, text), version };
    } catch (error) {
      if (!(error instanceof UnmappableLegacyRowError)) throw error;
      logger.warn({ ...error.ids }, `Ignored a legacy survey definition. ${error.message}`);
      return { content: {}, version };
    }
  }

  /** The text of `surveytext/{id}`; "" when there is no such blob. */
  async function surveyTextBlob(id: string): Promise<string> {
    try {
      const response = await surveysAccount.blobs
        .getContainerClient("surveytext")
        .getBlobClient(id)
        .download();
      return (await streamToBuffer(response.readableStreamBody)).toString("utf8");
    } catch (error) {
      if (statusOf(error) === 404) return "";
      throw new LegacyStoreError("definition read", error);
    }
  }

  /** The raw `Surveys.theme` text of a survey; undefined when no survey has this id. */
  async function rawTheme(id: string): Promise<{ id: string; theme: string | null } | undefined> {
    const rows = await select<{ id: string; theme: string | null }>(
      "theme read",
      "SELECT id, theme FROM Surveys WHERE id = @id",
      (request) => request.input("id", sql.UniqueIdentifier, id),
    );
    return rows[0];
  }

  async function getTheme(id: string): Promise<Versioned<SurveyTheme> | null> {
    if (!isGuid(id)) return null;
    const row = await rawTheme(id);
    return row
      ? {
          content: themeFromLegacy(row.id, row.theme, logger),
          version: contentVersion(row.theme ?? ""),
        }
      : null;
  }

  /** Whether a `Surveys` row has this id (also one the mapping would skip). */
  async function surveyExists(operation: string, id: string): Promise<boolean> {
    const rows = await select(
      operation,
      "SELECT 1 AS found FROM Surveys WHERE id = @id",
      (request) => request.input("id", sql.UniqueIdentifier, id),
    );
    return rows.length > 0;
  }

  /** The history container of the surveys account (layout section 3.4). */
  const historyContainer = () => surveysAccount.blobs.getContainerClient("surveyjsonhistory");

  const writeTargets: LegacyWriteTargets = {
    pool: connected,
    blobs: surveysAccount.blobs,
    events: surveyEvents,
    resultTables: resultsAccount.tables,
    logger,
  };

  /** The survey as stored, read back after a write that made it. */
  async function storedSurvey(id: string) {
    const stored = await getSurvey(id);
    if (!stored) throw new Error(`Survey ${id} cannot be read back after it was stored`);
    return stored;
  }

  async function createSurvey(survey: NewSurvey, definition?: SurveyDefinition) {
    return storedSurvey(await writeNewSurvey(writeTargets, survey, definition));
  }

  async function updateSurvey(id: string, changes: SurveyChanges) {
    if (!isGuid(id)) return null;
    return (await writeSurveyChanges(writeTargets, id, changes)) ? getSurvey(id) : null;
  }

  async function cloneSurvey(sourceId: string, copy: NewSurvey, options?: CloneOptions) {
    if (!isGuid(sourceId)) return null;
    const id = await writeClonedSurvey(writeTargets, sourceId, copy, options?.rewriteText);
    return id === null ? null : storedSurvey(id);
  }

  async function saveDefinition(
    id: string,
    definition: SurveyDefinition,
    save: { readonly ifVersion: string; readonly userId: string; readonly savedAt: string },
  ): Promise<SaveOutcome> {
    if (!isGuid(id)) return { kind: "not-found" };
    return writeDefinitionSave(writeTargets, id, JSON.stringify(definition), {
      blobVersion: save.ifVersion,
      userId: save.userId,
      savedAt: save.savedAt,
    });
  }

  /**
   * The theme column has no version of its own: the stored text is read, its hash compared with
   * `ifVersion`, and the write is made only while the column still holds that text (R2).
   */
  async function saveTheme(
    id: string,
    theme: SurveyTheme,
    save: { readonly ifVersion: string; readonly savedAt: string },
  ): Promise<SaveOutcome> {
    if (!isGuid(id)) return { kind: "not-found" };
    const row = await rawTheme(id);
    if (!row) return { kind: "not-found" };
    const expectedRaw = row.theme ?? "";
    if (contentVersion(expectedRaw) !== save.ifVersion) return { kind: "conflict" };
    const outcome = await writeThemeSave(writeTargets, id, JSON.stringify(theme), {
      expectedRaw,
      savedAt: save.savedAt,
    });
    // The version of what the column holds now, which the next getTheme hashes too.
    return outcome.kind === "saved"
      ? { kind: "saved", version: contentVersion(outcome.stored) }
      : outcome;
  }

  /**
   * Every point under `surveyjsonhistory/{id}/` with its metadata, sorted in history order, then
   * paged (R9). An unknown survey has no history, whatever blobs are left under its id.
   */
  async function listHistory({ surveyId, after, limit }: HistoryQuery): Promise<HistoryPage> {
    const empty: HistoryPage = { items: [], next: null };
    if (!isGuid(surveyId)) return empty;
    const id = surveyId.toLowerCase();
    if (!(await surveyExists("history list", id))) return empty;
    const entries: HistoryEntryRecord[] = [];
    try {
      const blobs = historyContainer().listBlobsFlat({ prefix: `${id}/`, includeMetadata: true });
      for await (const blob of blobs) {
        const entry = historyEntryFromBlob(
          id,
          blob.name,
          blob.metadata,
          blob.properties.lastModified,
        );
        if (entry) entries.push(entry);
      }
    } catch (error) {
      if (statusOf(error) === 404) return empty; // no history container yet
      throw new LegacyStoreError("history list", error);
    }
    const matching = entries.sort(historyOrder).filter((e) => !after || isAfterHistory(e, after));
    const items = matching.slice(0, limit);
    const last = items.at(-1);
    return {
      items,
      next: matching.length > items.length && last ? { at: last.at, id: last.id } : null,
    };
  }

  async function getHistorySnapshot(
    surveyId: string,
    entryId: string,
  ): Promise<SurveyDefinition | null> {
    if (!isGuid(surveyId) || !isGuid(entryId)) return null;
    const id = surveyId.toLowerCase();
    if (!(await surveyExists("history read", id))) return null;
    let text: string;
    try {
      const blob = historyContainer().getBlobClient(`${id}/${entryId.toLowerCase()}`);
      text = (await blob.downloadToBuffer()).toString("utf8");
    } catch (error) {
      if (statusOf(error) === 404) return null;
      throw new LegacyStoreError("history read", error);
    }
    try {
      return definitionFromLegacy(id, text);
    } catch (error) {
      if (!(error instanceof UnmappableLegacyRowError)) throw error;
      logger.warn({ ...error.ids }, `Ignored a legacy history point. ${error.message}`);
      return {};
    }
  }

  async function deleteSurvey(id: string): Promise<boolean> {
    // The record names the children: the results tables are keyed by its post id.
    const survey = await getSurvey(id);
    if (!survey) return false;
    return writeSurveyDeletion(writeTargets, survey, new Date(now()).toISOString());
  }

  async function sqlReady(): Promise<void> {
    await select("readiness check", "SELECT 1 AS ok");
  }

  // Both probes are account-level calls. A least-privilege container SAS cannot make them, so
  // /readyz would stay at 503 with such credentials. A narrower probe is open for Step 14
  // (docs/architecture.md, "Open for later steps").
  async function storageReady(account: (typeof accounts)[number], signal: AbortSignal) {
    await account.blobs.getProperties({ abortSignal: signal });
    await account.tables.listTables({ abortSignal: signal }).byPage({ maxPageSize: 1 }).next();
  }

  return {
    name: "azure-legacy",
    surveys: {
      getSurvey,

      async listSurveys(owner: SurveyOwner) {
        const ownerId = ownerIdOf(owner);
        if (!isGuid(ownerId)) return [];
        const scope = owner.kind === "project" ? IS_PROJECT_SURVEY : `NOT ${IS_PROJECT_SURVEY}`;
        const rows = await select<SurveyQueryRow>(
          "survey list",
          `${SURVEY_SELECT} WHERE s.userid = @owner AND ${scope}`,
          (request) => request.input("owner", sql.UniqueIdentifier, ownerId),
        );
        return mapRows(rows, (row) => surveyFromLegacy(row, owner.kind)).sort(surveyListOrder);
      },

      listSurveyPage,
      createSurvey,
      getDefinition,
      getTheme,
      saveDefinition,
      saveTheme,
      listHistory,
      getHistorySnapshot,
      updateSurvey,
      cloneSurvey,
      deleteSurvey,
    },

    files: createAzureFileStore(surveysAccount.blobs, {
      container: options.filesContainer ?? FILES_CONTAINER,
    }),

    directory: {
      async getUser(id) {
        if (!isGuid(id)) return null;
        const rows = await select<LegacyUserRow>(
          "user lookup",
          "SELECT id, email, displayname, blocked FROM Users WHERE id = @id",
          (request) => request.input("id", sql.UniqueIdentifier, id),
        );
        return rows[0] ? userFromLegacy(rows[0]) : null;
      },

      async findUserByEmail(email) {
        // The legacy site stores and looks up lower-cased emails, and the database collation
        // (case-insensitive on Azure SQL by default) also finds rows stored in another case.
        // SQL only narrows the candidates; the exact case-insensitive match is checked here
        // (SQL Server would also ignore trailing spaces).
        const wanted = email.toLowerCase();
        if (wanted.trim() === "" || wanted.length > MAX_EMAIL_LENGTH) return null;
        const rows = await select<LegacyUserRow>(
          "user lookup by email",
          "SELECT id, email, displayname, blocked FROM Users WHERE email = @email",
          // varchar, like the column, so the email index can be used.
          (request) => request.input("email", sql.VarChar(MAX_EMAIL_LENGTH), wanted),
        );
        const found = rows.find((row) => row.email?.toLowerCase() === wanted);
        return found ? userFromLegacy(found) : null;
      },

      async listUserProjects(userId) {
        if (!isGuid(userId)) return [];
        const rows = await select<ProjectMemberQueryRow>(
          "project list",
          PROJECT_MEMBERS_SELECT,
          (request) => request.input("user", sql.UniqueIdentifier, userId),
        );
        return membershipsFromRows(rows, userId);
      },

      async getUserProject(userId, projectId) {
        if (!isGuid(userId) || !isGuid(projectId)) return null;
        const rows = await select<ProjectMemberQueryRow>(
          "project lookup",
          `${PROJECT_MEMBERS_SELECT} AND m.organizationid = @project`,
          (request) =>
            request
              .input("user", sql.UniqueIdentifier, userId)
              .input("project", sql.UniqueIdentifier, projectId),
        );
        return membershipsFromRows(rows, userId)[0] ?? null;
      },
    },

    notices,

    async ready() {
      const signal = AbortSignal.timeout(readyTimeoutMs);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), readyTimeoutMs);
      });
      const checks = Promise.all([
        sqlReady(),
        ...accounts.map((account) => storageReady(account, signal)),
      ]).then(
        () => true,
        () => false,
      );
      try {
        return await Promise.race([checks, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },

    close() {
      // mssql refuses to close a pool that is still connecting, so wait for an in-flight connect
      // (it may fail; that is fine here). Idempotent, and never rejects because of that connect.
      closing ??= (async () => {
        await connecting?.catch(() => undefined);
        await pool.close();
      })();
      return closing;
    },
  };
}
