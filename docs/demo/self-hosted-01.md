# Demo: self-hosted Step 1, the data model, migrations and the SQL survey store

This page lets you check self-hosted Step 1 without reading code. It takes about twenty minutes (part 2 pulls the
PostgreSQL image on the first run). Commands are for Git Bash (or any POSIX shell), from the repository root.

What Step 1 delivers: **surveys can live in a database.** The server keeps survey records, definitions, themes and
history in **SQLite** (a file) or **PostgreSQL**, with one implementation for both. The database's schema is changed
by numbered SQL migrations, which the server applies when it starts; a database that a newer version changed is
refused, so an old build never runs on a schema it does not know. Everything else (users, projects, results, files)
is still kept in memory until Step 2, and the server says so when it starts. The design is in
[the data model](../architecture/data-model.md), [ADR 0023](../adr/0023-sqlite-driver-node-sqlite.md) (the SQLite driver)
and [ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md) (queries and migrations). Production
(studio.surveyjs.io, `STORAGE_PROVIDER=azure-legacy`) is not affected.

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2), and Docker with
Compose for part 2. Run `pnpm install` once. Ports 3000 and 5173 must be free, and 15432 on 127.0.0.1 for part 2.

If the default `node` of your machine is older than 24, put Node 24 first once in each Git Bash window:
`export PATH="$APPDATA/nvm/v24.21.0:$PATH"`. Check with `node --version`; it must print `v24.21.0`.

Sign-in is the "Sign in as…" page of the memory demo, with the same seed users. **Owner** is `owner@example.com`.

## 1. SQLite: a survey survives a restart

1. Start from an empty database and load the seed:

   ```sh
   rm -rf server/.data
   pnpm seed:sqlite
   ```

   It prints the file, `Applied 1 migration: 0001-surveys` and `Seeded 9 surveys.`

2. Start the app: `pnpm dev:sqlite`. In the server output, find the warning
   `STORAGE_PROVIDER=sqlite stores surveys in the database; users, projects, results, views and files are still kept in
memory and lost on restart (self-hosted track Step 2)`.

3. Open <http://localhost:5173>, choose **Owner** on the "Sign in as…" page. My Surveys lists the seed surveys
   (Customer feedback, Draft form, …).

4. Click **Create Survey**. In the editor, add a question (drag a **Single-Line Input** onto the page) and wait for
   **All changes saved**. Go back to My Surveys and rename the new survey to `Kept in SQLite` (click its name).

5. Stop the app with Ctrl+C and start it again: `pnpm dev:sqlite`. Sign in as **Owner** again.
   - **Check:** `Kept in SQLite` is in the list, and its editor shows the question you added.
   - **Check:** its **History** lists your save, by Owner.

## 2. PostgreSQL: the same

1. Load the seed (this starts PostgreSQL in Docker and waits until it is ready):

   ```sh
   pnpm seed:postgres
   ```

   It prints `postgres, 127.0.0.1:15432/surveyjs_studio`, the migration and `Seeded 9 surveys.`

2. Repeat steps 2–5 of part 1 with `pnpm dev:postgres` (the warning names `STORAGE_PROVIDER=postgres`), and name the
   survey `Kept in PostgreSQL`. The same checks hold.

## 3. Migrations: status, and a database from a newer version

1. Show what the PostgreSQL database has:

   ```sh
   pnpm db:status --env-file docker/postgres.env
   ```

   - **Check:** `Applied:` lists `0001-surveys` with the time it was applied, and `Pending: none`.

2. Pretend a newer version migrated the database, by recording a migration this build does not have:

   ```sh
   docker compose --env-file docker/postgres.env -f docker/compose.postgres.yaml exec postgres \
     psql -U surveyjs -d surveyjs_studio -c "insert into schema_migrations values (2, 'from-a-newer-version', now())"
   ```

3. Start the app: `pnpm dev:postgres`.
   - **Check:** the server stops at once with
     `The database has migration 0002-from-a-newer-version, which this version of SurveyJS Studio does not know: a
newer version migrated it. Run that version or a newer one.` Press Ctrl+C to stop the web app.
   - **Check:** `pnpm db:status --env-file docker/postgres.env` lists the migration under
     `Applied by a newer version:` and exits with that message too.

4. Clean up: `pnpm postgres:down` (stops PostgreSQL and deletes its data), and `rm -rf server/.data`.

## What the automated tests cover

- `pnpm test:unit`: the migrator (order, a second run, a newer database, a renamed migration, a failed run rolled back,
  two processes migrating one file at once), the SQLite driver adapter, the settings, the `db` commands, and the
  provider suite's survey sections on SQLite.
- `pnpm test:providers:postgres` (after `pnpm postgres:up`): the same suites on PostgreSQL.
- `pnpm test:conformance:sqlite` and `pnpm test:conformance:postgres`: the HTTP conformance suite on each database (all
  files but project deletion, which needs Step 2).
- `pnpm e2e:sqlite`: the survey list, paging, editor and history browser tests on SQLite.
