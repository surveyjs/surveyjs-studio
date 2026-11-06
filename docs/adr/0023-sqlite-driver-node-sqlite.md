# 23. The SQLite driver: Node's built-in `node:sqlite`

Date: 2026-10-28

## Status

Accepted.

## Context

The self-hosted image keeps its data in SQLite by default, and the SQL providers reach SQLite through Kysely
([ADR 0024](0024-kysely-and-plain-sql-migrations.md)). The spec (spec-self-hosted.md › SQL providers) leaves the
driver to this ADR: "Node's built-in `node:sqlite` if it is stable on the pinned Node.js LTS, otherwise
better-sqlite3".

On the pinned Node.js 24.21.0:

- `node:sqlite` is **Stability 1.2, Release candidate** since v24.15.0. It is no longer behind a flag (since v22.13.0)
  and prints no experimental warning. It is not yet Stability 2, Stable.
- It ships SQLite 3.53, with the JSON functions, partial indexes and WAL.
- Its `DatabaseSync` API is synchronous, like better-sqlite3's, and `StatementSync#columns()` tells a statement that
  returns rows from one that does not.
- better-sqlite3 is a native module: it needs a build step (or a prebuilt binary for the platform), an `allowBuilds`
  entry in `pnpm-workspace.yaml`, and a matching binary in the production image.

## Decision

**Use `node:sqlite`.** A Release candidate is feature-complete, and its API changes only for a critical problem; the
gain of not shipping a native module is larger than the gap to the "Stable" label.

`server/src/sql/node-sqlite.ts` adapts a `DatabaseSync` to the database shape Kysely's `SqliteDialect` drives (about
twenty lines: parameters are passed spread, not as an array, and `reader` comes from `columns()`). Every connection:

- runs in WAL mode (readers never wait for the writer);
- enforces foreign keys (`PRAGMA foreign_keys = ON`), so `survey_history` is deleted with its survey;
- waits up to five seconds for a lock (`timeout`) before `SQLITE_BUSY`.

The driver binds JS booleans as the integers 1 and 0, so the stores pass booleans in both dialects.

The file is `SQLITE_PATH`, default `/data/surveyjs-studio.db` (the image's data volume); a relative path is resolved
against the working directory. Its folder is created on the first connection.

## Consequences

- No native module: the image, the lockfile and `pnpm install` stay as they are. The PostgreSQL driver (`pg`) is
  plain JavaScript too.
- The API is synchronous: a long query blocks the event loop. The survey list and history are keyed seeks, so this is
  not felt at the sizes SQLite is meant for; large installations use PostgreSQL.
- Kysely runs one SQLite connection per process and serialises transactions on it. Two processes on one file (the
  server and `pnpm db:migrate`, say) rely on SQLite's file lock and the busy timeout.
- If `node:sqlite` changes its API before it is Stable, the fix is in `node-sqlite.ts` only. If it is withdrawn,
  better-sqlite3 fits the same Kysely dialect: the adapter is replaced, nothing else.
- When Node.js marks `node:sqlite` Stable, this ADR needs no change.
