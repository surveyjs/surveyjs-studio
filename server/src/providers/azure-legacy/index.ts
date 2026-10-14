import { TableServiceClient } from "@azure/data-tables";
import { BlobServiceClient } from "@azure/storage-blob";
import sql from "mssql";
import type { LegacyConfig } from "../../config.js";
import type { SurveyOwner } from "../../domain/types.js";
import { isLocalStorageString } from "../../legacy/endpoint-guard.js";
import { projectListOrder, surveyListOrder } from "../ordering.js";
import type { ProviderSet } from "../types.js";
import { membershipFromLegacy, surveyFromLegacy, userFromLegacy } from "./mapping.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
  LegacyUserRow,
} from "./rows.js";

/**
 * Provider over the legacy surveyjs.io stores (layout: docs/architecture/legacy-data-layout.md).
 * Step 2 serves the read path only: survey records and the Directory from SQL. The storage
 * accounts are only probed by `ready()`.
 *
 * Read-only by construction: SELECT statements and read-only SDK calls only (ESLint enforces it
 * for this folder). Connection strings are secrets: no error or log line built here holds one.
 */

export interface AzureLegacyOptions {
  /** Upper bound for `ready()`; default 5 s. */
  readonly readyTimeoutMs?: number;
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

type SurveyQueryRow = LegacySurveyRow & { isproject: number };
type MembershipQueryRow = LegacyOrganizationRow & LegacyOrganizationUserRow;

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
  let closed = false;
  function connected(): Promise<sql.ConnectionPool> {
    if (closed) return Promise.reject(new Error("The azure-legacy provider is closed"));
    connecting ??= pool.connect().catch((error: unknown) => {
      connecting = null;
      throw error;
    });
    return connecting;
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

  async function sqlReady(): Promise<void> {
    await select("readiness check", "SELECT 1 AS ok");
  }

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
        const row = rows[0];
        return row ? surveyFromLegacy(row, row.isproject === 1 ? "project" : "personal") : null;
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
        return rows.map((row) => surveyFromLegacy(row, owner.kind)).sort(surveyListOrder);
      },
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
        if (wanted === "" || wanted.length > MAX_EMAIL_LENGTH) return null;
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
        const rows = await select<MembershipQueryRow>(
          "project list",
          "SELECT o.id, o.name, m.organizationid, m.userid, m.role FROM OrganizationUsers m " +
            "JOIN Organizations o ON o.id = m.organizationid WHERE m.userid = @user",
          (request) => request.input("user", sql.UniqueIdentifier, userId),
        );
        return rows.map((row) => membershipFromLegacy(row, row)).sort(projectListOrder);
      },
    },

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

    async close() {
      closed = true;
      await pool.close();
    },
  };
}
