import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDatabase, SqliteStatement } from "kysely";

/** How long a write waits for another connection's lock before it fails (SQLITE_BUSY). */
const BUSY_TIMEOUT_MS = 5000;

/** SQLite's result code for a lock held by another connection. */
const SQLITE_BUSY = 5;
const RETRY_DELAY_MS = 20;

/**
 * Puts the file in WAL mode. The pragma does not wait for the busy timeout: on a file that is not
 * WAL yet it fails at once while another connection holds a write lock (two processes opening a new
 * file together), so it is retried, synchronously like everything here, for up to the busy timeout.
 */
function switchToWal(db: DatabaseSync): void {
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (error) {
      const busy = (error as { errcode?: unknown }).errcode === SQLITE_BUSY;
      if (!busy || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAY_MS);
    }
  }
}

/**
 * Opens a SQLite database with Node's built-in `node:sqlite` (ADR 0023) in the shape Kysely's
 * `SqliteDialect` drives. The connection uses WAL (readers never wait for the writer), enforces
 * foreign keys and waits up to five seconds for a lock. `path` is a file, or `:memory:`.
 */
export function openNodeSqlite(path: string): SqliteDatabase {
  const db = new DatabaseSync(path, { timeout: BUSY_TIMEOUT_MS });
  db.exec("PRAGMA foreign_keys = ON;");
  switchToWal(db);
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
