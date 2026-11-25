import sql from "mssql";
import { LegacyStoreError } from "../../providers/azure-legacy/errors.js";
import type {
  LegacyOrganizationRow,
  LegacyOrganizationUserRow,
  LegacySurveyRow,
  LegacyUserRow,
} from "../../providers/azure-legacy/rows.js";

/**
 * The legacy SQL tables, read only (SELECT with the optional `[timestamp]` window). Ids come back
 * as the driver gives them (upper-case GUIDs); the mapping lower-cases later. Surveys come in
 * pages by id (each row holds its theme, so the table is never in memory at once); the other
 * tables are small and read whole, by time.
 */
export interface SqlSource {
  users(since?: Date): AsyncIterable<LegacyUserRow & { accesskey: string | null; timestamp: Date }>;
  surveys(since?: Date): AsyncIterable<LegacySurveyRow & { theme: string | null }>;
  organizations(since?: Date): AsyncIterable<LegacyOrganizationRow>;
  organizationUsers(since?: Date): AsyncIterable<LegacyOrganizationUserRow>;
  close(): Promise<void>;
}

const EPOCH = new Date(0);

const USERS = "SELECT id, email, displayname, blocked, accesskey, [timestamp] FROM Users";
const SURVEY_COLUMNS =
  "id, name, userid, creatorid, postid, resultid, createdat, [timestamp], ispublished, " +
  "isarchived, allowaccessresult, storeipaddress, usecookies, publishid, theme";
const ORGANIZATIONS = "SELECT id, name, happendat, [timestamp] FROM Organizations";
const ORGANIZATION_USERS =
  "SELECT id, organizationid, userid, role, happendat, [timestamp] FROM OrganizationUsers";

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
      const text = since ? `${select} WHERE [timestamp] > @since` : select;
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
          where.push("[timestamp] > @since");
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
      for await (const row of rowsOf<LegacyOrganizationRow>("project read", ORGANIZATIONS, since)) {
        yield { id: row.id, name: row.name, happendat: row.happendat };
      }
    },
    async *organizationUsers(since) {
      for await (const row of rowsOf<LegacyOrganizationUserRow>(
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
        };
      }
    },
    async close() {
      if (connecting) await connecting.catch(() => undefined);
      await pool.close();
    },
  };
}
