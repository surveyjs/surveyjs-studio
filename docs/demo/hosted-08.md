# Demo: hosted Step 8, target provider readiness

This page lets you check hosted Step 8 without reading code. It takes about thirty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root.

What Step 8 delivers: **the new server's stores are ready, and the tools to prove it exist.** On PostgreSQL a survey can
keep only its newest history entries (`HISTORY_MAX_ENTRIES`). The legacy access keys of the old API work on the SQL
providers, and a key can be replaced there. Three archive tables and a command that purges the deleted-response copies
exist. The hosted edition refuses password sign-in. A generator and a check measure a database of production's size
against the targets. The production image runs on PostgreSQL and S3 in Docker. The designs are
[ADR 0036](../adr/0036-history-snapshots-above-a-size-limit.md), [ADR 0037](../adr/0037-access-keys-and-api-tokens.md),
[ADR 0033](../adr/0033-hosted-target-stores.md#readiness-hosted-step-8-2026-11-25) and
[ADR 0043](../adr/0043-hosted-users-on-the-local-directory.md); the operator's page is
[Operations › Mode 1.3](../operations.md#mode-13-the-new-server-postgresql-and-s3). What needs the new server itself (the
scale run at production size, the production measurement and the restore) is not part of this demo.

## Before you start

You need the tools of [the Step 1 demo of the self-hosted track](self-hosted-01.md), Docker, `jq`, and free ports
**3000** (Studio), **3001** (the second Studio of section 4), **3002** (the bridge), **5173** (the web app), **15432**
(PostgreSQL) and **8081** (the production image). Check them (nothing is printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|3001|3002|5173|8081|15432) '
```

Start from a clean database: `pnpm postgres:down` (it deletes the demo database), then `pnpm seed:postgres`. The seed is
demo data only: it writes the fixture users with their legacy access keys, so never run it on a real instance. A shell
helper runs SQL in the demo database (define it in every shell that uses it):

```sh
psql_demo() { docker compose --env-file docker/postgres.env -f docker/compose.postgres.yaml exec -T postgres psql -U surveyjs -d surveyjs_studio -tA "$@"; }
```

## 1. The history keeps the newest entries (checklist 1)

1. Start the app on PostgreSQL with the limit (shell 1; PowerShell: set `$env:HISTORY_MAX_ENTRIES = "3"` first):

   ```sh
   HISTORY_MAX_ENTRIES=3 pnpm dev:postgres
   ```

   - **Check:** a `starting` log line with `"historyMaxEntries":3`.

2. Open <http://localhost:5173> and sign in as Olivia Owner. Open a survey, and save it five times, changing its title
   each time ("v1" to "v5").
3. Open **View History** in the "…" menu.
   - **Check:** three entries: v5, v4 and v3. The older ones are gone.
4. Count the rows (the survey's id is in the editor's address):

   ```sh
   psql_demo -c "select count(*) from survey_history where survey_id = '<the survey id>'"
   ```

   - **Check:** `3`.

5. Stop the app (Ctrl+C) and start it again without the setting: `pnpm dev:postgres`. Save the survey once more.
   - **Check:** History shows four entries: with no limit nothing is deleted, and the three kept entries stay.

## 2. A legacy key signs in, and a new one replaces it (checklist 2)

The seed already wrote the fixtures' keys, Olivia's `access-key-1` among them. Add a second key for her, the way the
migration will: a key is 32 hexadecimal digits, and the table stores its SHA-256 hash and the last four characters.
She then has two working keys.

1. Keep the app running (shell 1), and start the bridge in front of it (shell 2):

   ```sh
   pnpm dev:bridge
   ```

2. In shell 3 (define `psql_demo` there too, from above), insert a key for Olivia (her id is
   `11111111-0000-4000-8000-a00000000001`):

   ```sh
   API=http://localhost:3000/api/v1
   BRIDGE=http://localhost:3002
   KEY=0123456789abcdef0123456789abcdef
   HASH=$(printf %s "$KEY" | sha256sum | cut -d' ' -f1)
   psql_demo -c "insert into legacy_access_keys (key_hash, user_id, last_four, created_at) values ('$HASH', '11111111-0000-4000-8000-a00000000001', 'cdef', now())"
   curl -s -H "Authorization: Bearer $KEY" "$API/me" | jq '{id, name}'
   ```

   - **Check:** `INSERT 0 1`, then Olivia's id and name. The same key as an `accessKey` also works on the bridge's
     actions.

3. Ask for a new key through the bridge, as an old integration does with `generateAccessKey`:

   ```sh
   curl -s "$BRIDGE/private/v1/Surveys/generateAccessKey?accessKey=$KEY"
   ```

   - **Check:** a JSON string of 32 hexadecimal digits. Call it `NEWKEY`:

   ```sh
   NEWKEY=<the new key, without quotes>
   ```

4. The old key is refused, and the new one signs in:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $KEY" "$API/me"
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $NEWKEY" "$API/me"
   curl -s "$BRIDGE/private/v1/Surveys/generateAccessKey?accessKey=$KEY"
   psql_demo -c "select last_four, revoked_at is not null as revoked from legacy_access_keys where user_id = '11111111-0000-4000-8000-a00000000001' order by created_at"
   ```

   - **Check:** `401`, then `200`, then `The accessKey '<the old key>' is incorrect.` (the old API's answer for a key it
     does not accept), then Olivia's three rows (the seed's `access-key-1`, with last four `ey-1`, then `cdef`, then the new
     key's): the first two revoked and the newest not. Replacing a key revokes all of the user's other unrevoked rows,
     the one that was not presented (`access-key-1`) included, so only the new one works.

## 3. The purge (checklist 3)

1. Put two copies in the archive, one from 2020 and one from the far future:

   ```sh
   S=22222222-0000-4000-8000-000000000001
   psql_demo -c "insert into deleted_responses (survey_id, response_id, deleted_at, response) values ('$S', '33333333-0000-4000-8000-000000000001', '2020-01-01T00:00:00Z', '{}'), ('$S', '33333333-0000-4000-8000-000000000002', '2099-01-01T00:00:00Z', '{}')"
   ```

2. A dry run, then a run that is refused in read-only mode, then the real one:

   ```sh
   pnpm purge:deleted-responses --before 2021-01-01 --env-file docker/postgres.env
   READ_ONLY=true pnpm purge:deleted-responses --before 2021-01-01 --apply --env-file docker/postgres.env; echo "exit $?"
   pnpm purge:deleted-responses --before 2021-01-01 --apply --env-file docker/postgres.env
   psql_demo -c "select count(*) from deleted_responses"
   ```

   - **Check:** the dry run says `1 deleted-response copies before 2021-01-01T00:00:00.000Z. Run again with --apply to
delete them.` and deletes nothing; the read-only run prints `Refused: READ_ONLY=true. Nothing was deleted.` and
     `exit 2`; the third says `Deleted 1 deleted-response copies …`; the count is `1` (the 2099 row stays: only rows
     strictly before the date go).

## 4. The scale tools (checklist 4)

`scale:generate` refuses a database that holds data, so this section uses a new SQLite file in a folder of its own.
Stop the app and the bridge first (Ctrl+C), then:

```sh
DEMO=~/hosted-08-demo; mkdir -p "$DEMO"
SQLITE_PATH="$DEMO/scale.db" pnpm scale:generate --users 3 --surveys 20 --responses 2000 --largest 5000
```

- **Check:** counts for users, surveys, history entries and responses, `generated in … s`, and a last line,
  `--survey <id> --token sjs_…`: the largest survey and an API token of its owner. The data is the same for the same
  `--seed`. Run it again on the same file:
  - **Check:** `Error: the database already holds data (users); use an empty one`, exit code 2.

Start a Studio on the file (shell 1; the generated users are local accounts), and check it (shell 3, with the values
the generator printed):

```sh
STORAGE_PROVIDER=sqlite SQLITE_PATH="$DEMO/scale.db" FILES_PATH="$DEMO/files" USER_DIRECTORY=local \
  IDENTITY_PROVIDER=dev PUBLIC_BASE_URL=http://localhost:5173 HOST=127.0.0.1 PORT=3001 \
  pnpm --filter @surveyjs-studio/server exec node --import tsx src/main.ts
```

```sh
pnpm scale:check --base http://127.0.0.1:3001 --token <the token> --survey <the survey id> --runs 5
```

- **Check:** one line per operation (the survey list, the first page of the results, the export's first byte and its
  total, and a save), each `ok` with its median and 95th percentile and the target. The command exits 1 when a target
  is missed. It prints times only, never a name or an id.

The figures of a real run on the new server are kept private; they go, rounded, into ADR 0033.

## 5. The production image on PostgreSQL and S3 (checklist 5)

Stop the shells of the earlier sections, then:

```sh
pnpm prod-like-sql:up
curl -s http://localhost:8081/readyz | jq .
```

- **Check:** the image builds and starts (the first run takes a few minutes), and `/readyz` answers `200` with the
  stores ready: the database and the files, the bucket reached through S3. The profile is
  `docker/prod-like.sql.env`: the hosted edition, PostgreSQL, S3 and `HISTORY_MAX_ENTRIES=20`. Try that the hosted edition
  refuses passwords: add `AUTH_METHODS=surveyjs,password` to a copy of the file and the app stops at start-up with
  `AUTH_METHODS: password is not available with APP_EDITION=hosted`.

Remove it: `pnpm prod-like-sql:down` (deletes its data).

## 6. The Phase 1 end-to-end specs on PostgreSQL (checklist 6)

```sh
pnpm postgres:up
pnpm s3:up
pnpm e2e:postgres
```

- **Check:** the specs pass. Each run makes its own database and bucket. The same specs run in CI, with
  `pnpm test:conformance:postgres:hosted`, which runs the hosted edition on PostgreSQL with the mock sign-in server.

## On the new server (with the operator)

When the new server is built, empty:

1. Studio and the bridge answer on their test host names, and Prometheus scrapes both.
2. Run `scale:generate` at production size on a scratch database, then `scale:check` against a Studio on it: the largest
   survey's export and paging meet the targets.
3. Restore once into a scratch instance, from the backups and from the bucket's old versions, and see a deleted survey
   and a deleted file come back ([Operations](../operations.md#restoring-once)).

## Clean up

Stop the shells with Ctrl+C, then `pnpm postgres:down`, `pnpm s3:down` and `rm -r ~/hosted-08-demo`.
