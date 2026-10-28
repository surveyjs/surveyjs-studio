import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import pg from "pg";
import { openNodeSqlite } from "./node-sqlite.js";
import type { DatabaseSchema } from "./schema.js";

export type SqlDialectName = "sqlite" | "postgres";

/** Where the database is: a SQLite file (or `:memory:`), or a PostgreSQL connection URL (a secret). */
export type DatabaseTarget =
  | { readonly dialect: "sqlite"; readonly path: string }
  | { readonly dialect: "postgres"; readonly url: string };

export interface SqlDatabase {
  readonly dialect: SqlDialectName;
  readonly db: Kysely<DatabaseSchema>;
  close(): Promise<void>;
}

/** Connections the server keeps open to PostgreSQL. */
const POSTGRES_POOL_SIZE = 10;

export interface DatabaseOptions {
  /**
   * PostgreSQL: an idle pooled connection failed (the server restarted or ended it); the pool
   * drops it and the next query connects again. Gets the error's code only: the error object
   * holds the client, and the client the password.
   */
  readonly onConnectionError?: (code: string) => void;
}

/** The SQLSTATE or system code of a driver error; `unknown` when it has none. */
const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "unknown";
};

/** Opens the database lazily: nothing connects until the first query. */
export function openDatabase(target: DatabaseTarget, options: DatabaseOptions = {}): SqlDatabase {
  if (target.dialect === "sqlite") {
    const { path } = target;
    const dialect = new SqliteDialect({
      database: () => {
        if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
        return Promise.resolve(openNodeSqlite(path));
      },
    });
    const db = new Kysely<DatabaseSchema>({ dialect });
    return { dialect: "sqlite", db, close: () => db.destroy() };
  }
  const pool = new pg.Pool({ connectionString: target.url, max: POSTGRES_POOL_SIZE });
  // Without a listener the pool's `error` event ends the process (and prints the client).
  pool.on("error", (error) => options.onConnectionError?.(codeOf(error)));
  const db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  return { dialect: "postgres", db, close: () => db.destroy() };
}
