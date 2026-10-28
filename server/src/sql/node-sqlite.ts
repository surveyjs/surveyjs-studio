import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";

/** How long a write waits for another connection's lock before it fails (SQLITE_BUSY). */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Opens a SQLite database with Node's built-in `node:sqlite` (ADR 0023) in the shape Kysely's
 * `SqliteDialect` drives. The connection uses WAL (readers never wait for the writer), enforces
 * foreign keys and waits up to five seconds for a lock. `path` is a file, or `:memory:`.
 */
export function openNodeSqlite(path: string): SqliteDatabase {
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  return {
    close: () => db.close(),
    prepare(text: string): SqliteStatement {
      const statement = db.prepare(text);
      const args = (parameters: readonly unknown[]) => parameters as SQLInputValue[];
      return {
        // A statement that returns columns is read with all(); any other is run().
        reader: statement.columns().length > 0,
        all: (parameters) => statement.all(...args(parameters)),
        run: (parameters) => statement.run(...args(parameters)),
        iterate: (parameters) => statement.iterate(...args(parameters)),
      };
    },
  };
}
