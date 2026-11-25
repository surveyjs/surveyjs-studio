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
 * as the driver gives them (upper-case GUIDs); the mapping lower-cases later.
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
const SURVEYS =
  "SELECT id, name, userid, creatorid, postid, resultid, createdat, [timestamp], ispublished, " +
  "isarchived, allowaccessresult, storeipaddress, usecookies, publishid, theme FROM Surveys";
const ORGANIZATIONS = "SELECT id, name, happendat, [timestamp] FROM Organizations";
const ORGANIZATION_USERS =
  "SELECT id, organizationid, userid, role, happendat, [timestamp] FROM OrganizationUsers";

export function openSqlSource(connectionString: string): SqlSource {
  let pool: sql.ConnectionPool;
  try {
    pool = new sql.ConnectionPool(connectionString);
  } catch {
    throw new Error("LEGACY_SQL_CONNECTION_STRING is not a valid SQL Server connection string");
  }
  // Failures reach callers through rejected promises; an unhandled 'error' event would crash.
  pool.on("error", () => undefined);
  let connecting: Promise<sql.ConnectionPool> | undefined;
  const connected = () => (connecting ??= pool.connect());

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

  return {
    async *users(since) {
      for await (const row of rowsOf<
        LegacyUserRow & { accesskey: string | null; timestamp: Date | null }
      >("user read", USERS, since)) {
        yield { ...row, timestamp: row.timestamp ?? EPOCH };
      }
    },
    surveys: (since) => rowsOf("survey read", SURVEYS, since),
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
