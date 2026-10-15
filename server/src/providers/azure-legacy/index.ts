import { TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import type { Clock } from "../../auth/session.js";
import type { AccountNoticesSetting, LegacyConfig } from "../../config.js";
import type { ProjectMembership, SurveyOwner } from "../../domain/types.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { demoAccountNotices, type AccountNotices } from "../../notices/account-notices.js";
import { licenceNotices } from "../../notices/licence-rule.js";
import { projectListOrder, surveyListOrder } from "../ordering.js";
import type { ProviderSet } from "../types.js";
import {
  UnmappableLegacyRowError,
  licenceExpiriesFromLegacy,
  membershipFromLegacy,
  projectFromLegacy,
  surveyFromLegacy,
  userFromLegacy,
} from "./mapping.js";
import type {
  LegacyLicenceRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

/**
 * Provider over the legacy surveyjs.io stores (layout: docs/architecture/legacy-data-layout.md).
 * Step 2 serves the read path only: survey records and the Directory from SQL. The storage
 * accounts are only probed by `ready()`. With `ACCOUNT_NOTICES=surveyjs-licenses` the account
 * notices come from the site's licence tables in the same database.
 *
 * Read-only by construction: SELECT statements and read-only SDK calls only (ESLint enforces it
 * for this folder). Connection strings are secrets: no error or log line built here holds one.
 */

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
  /** Clock for the licence-expiry rule; default `Date.now`. */
  readonly now?: Clock;
}

/** Error from a legacy store operation. The message names the operation and the driver's error code only. */
export class LegacyStoreError extends Error {
  constructor(operation: string, error: unknown) {
    super(`Legacy SQL ${operation} failed${describeDriverError(error)}`);
    this.name = "LegacyStoreError";
  }
}

/** Codes such as ESOCKET or ELOGIN and SQL error numbers are safe; driver messages may name the host. */
function describeDriverError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const { code, number } = error as { code?: unknown; number?: unknown };
  const parts: string[] = [];
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) parts.push(code);
  if (typeof number === "number") parts.push(`SQL error ${number}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGuid = (value: string): boolean => GUID.test(value);

/** Users.email is varchar(200) (layout section 3.11). */
const MAX_EMAIL_LENGTH = 200;

const SURVEY_SELECT =
  "SELECT s.id, s.name, s.userid, s.creatorid, s.postid, s.resultid, s.createdat, s.[timestamp], " +
  "s.ispublished, s.isarchived, s.allowaccessresult, s.storeipaddress, s.usecookies, " +
  "CASE WHEN EXISTS (SELECT 1 FROM Organizations o WHERE o.id = s.userid) THEN 1 ELSE 0 END " +
  "AS isproject FROM Surveys s";
const IS_PROJECT_SURVEY = "EXISTS (SELECT 1 FROM Organizations o WHERE o.id = s.userid)";

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

/** Not yet implemented for this provider; Task 2 of Step 4 replaces these. */
const notImplemented = () => Promise.reject(new Error("not implemented until Task 2"));

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
  const accounts = [
    storageClients(
      "LEGACY_SURVEYS_STORAGE_CONNECTION_STRING",
      legacy.surveysStorageConnectionString,
    ),
    storageClients(
      "LEGACY_RESULTS_STORAGE_CONNECTION_STRING",
      legacy.resultsStorageConnectionString,
    ),
  ];

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
      async getSurvey(id) {
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
      },

      async listSurveys(owner: SurveyOwner) {
        const ownerId = owner.kind === "personal" ? owner.userId : owner.projectId;
        if (!isGuid(ownerId)) return [];
        const scope = owner.kind === "project" ? IS_PROJECT_SURVEY : `NOT ${IS_PROJECT_SURVEY}`;
        const rows = await select<SurveyQueryRow>(
          "survey list",
          `${SURVEY_SELECT} WHERE s.userid = @owner AND ${scope}`,
          (request) => request.input("owner", sql.UniqueIdentifier, ownerId),
        );
        return mapRows(rows, (row) => surveyFromLegacy(row, owner.kind)).sort(surveyListOrder);
      },

      listSurveyPage: notImplemented,
      createSurvey: notImplemented,
      getDefinition: notImplemented,
    },

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
