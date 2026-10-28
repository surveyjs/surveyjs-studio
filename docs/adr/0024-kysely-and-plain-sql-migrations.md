# 24. Kysely and plain-SQL migrations

Date: 2026-10-28

## Status

Accepted.

## Context

The SQL providers serve SQLite (the self-hosted default) and PostgreSQL (larger self-hosted installations, and the
hosted service from mode 1.3), with one implementation (spec-self-hosted.md › SQL providers, idea §7.5). They need a
way to write queries for both dialects, and a way to change the schema that:

- runs at start-up, so an upgrade is "start the new image";
- is safe when two servers (or a server and `pnpm db:migrate`) start together;
- refuses a database a newer version migrated (S6), instead of running against a schema it does not know;
- leaves the database as it was when a migration fails.

## Decision

### Queries: Kysely

**Kysely** (`kysely` 0.29) builds the queries, typed by `server/src/sql/schema.ts`. It has dialects for SQLite
(over `node:sqlite`, [ADR 0023](0023-sqlite-driver-node-sqlite.md)) and PostgreSQL (over `pg`), and it is a query
builder, not an ORM: the stores keep their SQL visible and their own row mapping. Values that come back differently by
dialect (timestamps, booleans, JSON) are read through three helpers in `server/src/sql/values.ts`
([data model › Conventions](../architecture/data-model.md#conventions)).

### Schema changes: plain SQL files

- **One set of files per dialect:** `server/sql/sqlite/NNNN-name.sql` and `server/sql/postgres/NNNN-name.sql`, with the
  same versions and names in both (a test checks this). Numbers start at 0001 and have no gaps. The folder ships in the
  image (`server/package.json` › `files`).
- **Statements end with a semicolon at the end of a line.** The migrator splits a file there and runs the statements
  one by one, because Kysely prepares one statement at a time. A `;` inside a statement never ends a line (so a file
  has no triggers with bodies). Lines starting with `--` are comments.
- **The `schema_migrations` table** records each applied migration: `version`, `name`, `applied_at`.

### The migrator (`server/src/sql/migrator.ts`)

`migrate` applies the pending migrations **in one transaction, under a lock**:

- SQLite: `BEGIN IMMEDIATE`, which takes the file's write lock at once;
- PostgreSQL: `pg_advisory_xact_lock` with the migrator's own key, held until commit.

Inside, before changing anything, it reads `schema_migrations` and refuses:

- a version this build does not know: `DatabaseTooNewError` ("The database has migration 0002-…, which this version of
  SurveyJS Studio does not know: a newer version migrated it. Run that version or a newer one.");
- a recorded name that differs from this build's file of that number: `MigrationMismatchError`.

A failing statement rolls the whole run back. A server that waited for the lock finds nothing pending.

**At start-up** the SQL providers migrate before they serve. With `READ_ONLY=true` they never migrate: a pending
migration refuses the start (`PendingMigrationsError`, which names `pnpm db:migrate`). The three errors stop the server
with their message and exit code 1.

**Commands:** `pnpm db:migrate` (the same `migrate`), `pnpm db:status` (applied, pending, and migrations of a newer
version; writes nothing) and `pnpm seed` (migrate, then load the shared seed).

## Consequences

- A schema change is two small SQL files and, where the stores read it, a `schema.ts` change. Reviewers see the exact
  DDL each database runs.
- Dialect differences live in the SQL files (column types, `timestamptz` against ISO text) and in the three value
  helpers, not in the stores.
- Migrations that cannot run inside a transaction (PostgreSQL's `create index concurrently`) are not possible with
  this migrator. A large hosted table that needs one gets a separate, documented operator step.
- Rolling back to an older image after a migration is refused by design. The rollback path is a restore of the backup
  taken before the upgrade (operations).
- Another database (S39) is added as a Kysely dialect, a folder of migration files and the same provider suite.
