import sql from "mssql";
import { LegacyStoreError } from "../../providers/azure-legacy/errors.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
  LegacyUserRow,
} from "../../providers/azure-legacy/rows.js";

/**
 * The legacy SQL tables, read only (SELECT with the optional `[timestamp]` window; a row with no
 * `[timestamp]` is in every window, so a `since` read never misses it). Ids come back
 * as the driver gives them (upper-case GUIDs); the mapping lower-cases later. Surveys come in
 * pages by id (each row holds its theme, so the table is never in memory at once); the other
 * tables are small and read whole, by time.
 */
export interface SqlSource {
  users(since?: Date): AsyncIterable<LegacyUserRow & { accesskey: string | null; timestamp: Date }>;
  surveys(since?: Date): AsyncIterable<LegacySurveyRow & { theme: string | null }>;
  organizations(since?: Date): AsyncIterable<LegacyOrganizationRow & { timestamp: Date | null }>;
  organizationUsers(
    since?: Date,
  ): AsyncIterable<LegacyOrganizationUserRow & { timestamp: Date | null }>;
  /**
   * Each table's latest `[timestamp]` (null for a table with none) and the SQL server's UTC clock,
   * read in one statement (high-water marks).
   */
  latestChanges(): Promise<LatestChanges>;
  /**
   * The defaults of the tables' change-time columns and the SQL server's UTC offset, from the
   * catalog (read only): the marks assume the database stamps those times on one UTC clock.
   */
  changeTimeDefaults(): Promise<ChangeTimeDefaults>;
  close(): Promise<void>;
}

/**
 * A change-time column's default: its SQL text, `none` without one, `unreadable` when the login
 * may not read its text (no VIEW DEFINITION).
 */
export type ColumnDefault = string | "none" | "unreadable";
export interface ChangeTimeDefaults {
  /** The SQL server's offset from UTC, in minutes (0 on a server that runs on UTC). */
  utcOffsetMinutes: number;
  defaults: Record<SqlTable, ColumnDefault>;
}

/** The SQL tables the tool reads, by their high-water mark names. */
export type SqlTable = "users" | "surveys" | "organizations" | "organizationUsers";
export type LatestChanges = Record<SqlTable, Date | null> & { now: Date };

const EPOCH = new Date(0);

const USERS = "SELECT id, email, displayname, blocked, accesskey, [timestamp] FROM Users";
const SURVEY_COLUMNS =
  "id, name, userid, creatorid, postid, resultid, createdat, [timestamp], ispublished, " +
  "isarchived, allowaccessresult, storeipaddress, usecookies, publishid, theme";
const ORGANIZATIONS = "SELECT id, name, happendat, [timestamp] FROM Organizations";
const ORGANIZATION_USERS =
  "SELECT id, organizationid, userid, role, happendat, [timestamp] FROM OrganizationUsers";
const LATEST =
  "SELECT (SELECT MAX([timestamp]) FROM Users) AS users, " +
  "(SELECT MAX([timestamp]) FROM Surveys) AS surveys, " +
  "(SELECT MAX([timestamp]) FROM Organizations) AS organizations, " +
  "(SELECT MAX([timestamp]) FROM OrganizationUsers) AS organizationUsers, " +
  "SYSUTCDATETIME() AS now";
/** The SQL tables by their names in the database. */
const SQL_TABLES: Record<string, SqlTable> = {
  users: "users",
  surveys: "surveys",
  organizations: "organizations",
  organizationusers: "organizationUsers",
};
/**
 * The change-time columns' defaults (catalog views only: no table is read), then the server's
 * offset from UTC.
 */
const DEFAULTS =
  "SELECT t.name AS tableName, d.object_id AS defaultId, d.definition AS definition " +
  "FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id AND c.name = 'timestamp' " +
  "LEFT JOIN sys.default_constraints d " +
  "ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id " +
  "WHERE t.name IN ('Users', 'Surveys', 'Organizations', 'OrganizationUsers'); " +
  "SELECT DATEPART(TZOFFSET, SYSDATETIMEOFFSET()) AS utcOffset";
/** The `since` window; a row with no change time is in every one. */
const SINCE = "([timestamp] > @since OR [timestamp] IS NULL)";

/** Surveys per page. */
const SURVEY_PAGE = 200;

export function openSqlSource(
  connectionString: string,
  options: { surveyPageSize?: number } = {},
): SqlSource {
  const surveyPage = options.surveyPageSize ?? SURVEY_PAGE;
  let pool: sql.ConnectionPool;
  try {
    pool = new sql.ConnectionPool(connectionString);
  } catch {
    throw new Error("LEGACY_SQL_CONNECTION_STRING is not a valid SQL Server connection string");
  }
  // Failures reach callers through rejected promises; an unhandled 'error' event would crash.
  pool.on("error", () => undefined);
  let connecting: Promise<sql.ConnectionPool> | undefined;
  // A failed connect is forgotten, so the next read tries again.
  const connected = () =>
    (connecting ??= pool.connect().catch((error: unknown) => {
      connecting = undefined;
      throw error;
    }));

  async function* rowsOf<T>(operation: string, select: string, since?: Date): AsyncGenerator<T> {
    let rows: T[];
    try {
      const request = (await connected()).request();
      if (since) request.input("since", sql.DateTime, since);
      const text = since ? `${select} WHERE ${SINCE}` : select;
      rows = (await request.query<T>(`${text} ORDER BY [timestamp], id`)).recordset;
    } catch (error) {
      throw new LegacyStoreError(operation, error);
    }
    yield* rows;
  }

  /** The surveys in pages of `surveyPage`, by id (keyset: each page starts after the last id). */
  async function* surveyPages(
    since?: Date,
  ): AsyncGenerator<LegacySurveyRow & { theme: string | null }> {
    let after: string | null = null;
    for (;;) {
      let rows: (LegacySurveyRow & { theme: string | null })[];
      try {
        const request = (await connected()).request();
        request.input("page", sql.Int, surveyPage);
        const where: string[] = [];
        if (since) {
          request.input("since", sql.DateTime, since);
          where.push(SINCE);
        }
        if (after !== null) {
          request.input("after", sql.UniqueIdentifier, after);
          where.push("id > @after");
        }
        const filter = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
        rows = (
          await request.query<LegacySurveyRow & { theme: string | null }>(
            `SELECT TOP (@page) ${SURVEY_COLUMNS} FROM Surveys${filter} ORDER BY id`,
          )
        ).recordset;
      } catch (error) {
        throw new LegacyStoreError("survey read", error);
      }
      yield* rows;
      if (rows.length < surveyPage) return;
      after = rows[rows.length - 1]!.id;
    }
  }

  return {
    async *users(since) {
      for await (const row of rowsOf<
        LegacyUserRow & { accesskey: string | null; timestamp: Date | null }
      >("user read", USERS, since)) {
        yield { ...row, timestamp: row.timestamp ?? EPOCH };
      }
    },
    surveys: surveyPages,
    async *organizations(since) {
      for await (const row of rowsOf<LegacyOrganizationRow & { timestamp: Date | null }>(
        "project read",
        ORGANIZATIONS,
        since,
      )) {
        yield { id: row.id, name: row.name, happendat: row.happendat, timestamp: row.timestamp };
      }
    },
    async *organizationUsers(since) {
      for await (const row of rowsOf<LegacyOrganizationUserRow & { timestamp: Date | null }>(
        "member read",
        ORGANIZATION_USERS,
        since,
      )) {
        yield {
          id: row.id,
          organizationid: row.organizationid,
          userid: row.userid,
          role: row.role,
          happendat: row.happendat,
          timestamp: row.timestamp,
        };
      }
    },
    async latestChanges() {
      try {
        const request = (await connected()).request();
        const row = (await request.query<LatestChanges>(LATEST)).recordset[0];
        if (!row) throw new Error("no row");
        return {
          now: row.now,
          users: row.users ?? null,
          surveys: row.surveys ?? null,
          organizations: row.organizations ?? null,
          organizationUsers: row.organizationUsers ?? null,
        };
      } catch (error) {
        throw new LegacyStoreError("latest change read", error);
      }
    },
    async changeTimeDefaults() {
      try {
        const request = (await connected()).request();
        const result = await request.query(DEFAULTS);
        const sets = result.recordsets as unknown as [
          { tableName: string; defaultId: number | null; definition: string | null }[],
          { utcOffset: number }[],
        ];
        const defaults: Record<SqlTable, ColumnDefault> = {
          users: "none",
          surveys: "none",
          organizations: "none",
          organizationUsers: "none",
        };
        for (const { tableName, defaultId, definition } of sets[0]) {
          const table = SQL_TABLES[tableName.toLowerCase()];
          if (table === undefined || defaultId === null) continue;
          defaults[table] = definition ?? "unreadable";
        }
        const offset = sets[1]?.[0]?.utcOffset;
        if (typeof offset !== "number") throw new Error("no offset");
        return { utcOffsetMinutes: offset, defaults };
      } catch (error) {
        throw new LegacyStoreError("change-time default read", error);
      }
    },
    async close() {
      if (connecting) await connecting.catch(() => undefined);
      await pool.close();
    },
  };
}
