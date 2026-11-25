# Demo: hosted Step 9, the migration tool

This page lets you check hosted Step 9 without reading code. It takes about thirty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root; answers are shown with `jq`.

What Step 9 delivers: **a tool that copies the old stores into Studio's database and file store, proves the copy, keeps
it current, and wipes a test migration.** `pnpm migrate:hosted plan | copy | delta | reconcile | verify | wipe` reads the
old stores only. A killed `copy` is resumed by running it again, and a second `copy` changes nothing. `verify` is the
go or no-go. `--sample` copies whole accounts. The design is [ADR 0044](../adr/0044-the-hosted-migration-tool.md); the
operator's page is [Hosted migration](../operations/hosted-migration.md). This demo uses the local replica of the old
stores. The real runs (the test migration, the pre-copy, the window) need the new server and the SurveyJS team's inputs,
and are not part of it.

## Before you start

You need the tools of [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start), Docker, `jq`, and free ports
**3000** (Studio on the replica), **3001** (Studio on the migrated copy) and **5173** (the web app of the first). Check
them (nothing is printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|3001|5173) '
```

Start the replica, and make a folder and a target settings file for the copy (a SQLite database and a files folder):

```sh
pnpm demo:azurite:up
DEMO=~/hosted-09-demo; mkdir -p "$DEMO"
cat > "$DEMO/target.env" <<EOF
STORAGE_PROVIDER=sqlite
SQLITE_PATH=$DEMO/target.db
FILE_STORE=local
FILES_PATH=$DEMO/files
EOF
```

`--source docker/azurite.env` names the replica in every command below. Reports hold ids and counts only, but keep real
ones private; here they go into `$DEMO`.

## 1. Copy, then verify (checklist 1)

1. Ask what a copy would move. Nothing is written:

   ```sh
   pnpm migrate:hosted plan --source docker/azurite.env
   ```

   - **Check:** a line `Plan: <n> users (<k> with an access key), <n> surveys, <n> projects, <n> members.` and an
     estimate.

2. Copy everything into the target, then check it:

   ```sh
   pnpm migrate:hosted copy --source docker/azurite.env --target "$DEMO/target.env" --report "$DEMO/copy.json"
   pnpm migrate:hosted verify --full --source docker/azurite.env --target "$DEMO/target.env" --report "$DEMO/verify.json"; echo "exit $?"
   ```

   - **Check:** `copy: done`, then `verify --full: OK, 0 differences` and `exit 0`. The replica's data, with its edge
     cases (surveys in projects that no longer exist, partial responses), is copied; the report counts show what was
     noted or skipped.

3. Open the report:

   ```sh
   jq '.counts, (.checks | keys | length), ([.differences[]?] | length)' "$DEMO/verify.json"
   ```

   - **Check:** the counts of notes and skips, a number of checks, and `0` differences.

4. Run `copy` again.

   ```sh
   pnpm migrate:hosted copy --source docker/azurite.env --target "$DEMO/target.env"
   pnpm migrate:hosted verify --full --source docker/azurite.env --target "$DEMO/target.env"
   ```

   - **Check:** `copy: done` and again `OK, 0 differences`. Nothing doubled: a copy is a set of upserts.

5. Run `verify` without `--target`.

   ```sh
   pnpm migrate:hosted verify --source docker/azurite.env; echo "exit $?"
   ```

   - **Check:** `verify needs --target: …` and `exit 2`. `verify`, `delta`, `reconcile` and `wipe` never work on a scratch
     target.

## 2. Changes in the source: delta, reconcile, verify (checklist 2)

Start Studio on the replica (shell 1; it reads and writes the old stores as today's service does):

```sh
pnpm demo:azurite
```

In shell 2, use Olivia's access key to change the old data:

```sh
API=http://localhost:3000/api/v1
KEY=access-key-1
AUTH="Authorization: Bearer $KEY"
curl -s -H "$AUTH" "$API/surveys" | jq -r '.items[] | "\(.id)  \(.name)"' | head
```

Pick two surveys from the list: `KEEP` (it gets a change and a response) and `GONE` (it is deleted).

```sh
KEEP=<a survey id>
GONE=<another survey id>
OLIVIA=$(curl -s -H "$AUTH" "$API/me" | jq -r .id)
```

1. Rename `KEEP`, add a response to it, and delete `GONE`:

   ```sh
   curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" -d '{"name":"Renamed for the delta demo"}' \
     "$API/surveys/$KEEP" | jq '{id, name}'
   curl -s -X POST -H "Content-Type: application/json" -d '{"data":{"demo":"delta"}}' "$API/public/surveys/$KEEP/responses"
   curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "$AUTH" "$API/surveys/$GONE"
   ```

   - **Check:** the new name, `{"id":"…"}` for the response (if it answers an error, pick another survey for `KEEP`),
     and `204`.

2. Verify before copying the changes (an incremental verify, which is what the window ends with):

   ```sh
   pnpm migrate:hosted verify --source docker/azurite.env --target "$DEMO/target.env" --report "$DEMO/before.json"; echo "exit $?"
   ```

   - **Check:** a red result is possible and correct here: the target still holds the old name, the missing response is
     listed under `pending` (it changed after the marks), and the deleted survey is still in the target. Read it:
     `jq '.counts' "$DEMO/before.json"`.

3. Copy the changes and remove the deletion:

   ```sh
   pnpm migrate:hosted delta --source docker/azurite.env --target "$DEMO/target.env"
   pnpm migrate:hosted reconcile --source docker/azurite.env --target "$DEMO/target.env"
   pnpm migrate:hosted verify --full --source docker/azurite.env --target "$DEMO/target.env"; echo "exit $?"
   ```

   - **Check:** `delta: done`, `reconcile: done` (the counts say it removed the deleted survey's rows), then
     `verify --full: OK, 0 differences` and `exit 0`.

4. See the changes in the app on the target. Start Studio on the migrated copy (shell 3); the migrated people sign in
   with their old access keys here:

   ```sh
   DEMO=~/hosted-09-demo
   STORAGE_PROVIDER=sqlite SQLITE_PATH="$DEMO/target.db" FILE_STORE=local FILES_PATH="$DEMO/files" USER_DIRECTORY=local \
     IDENTITY_PROVIDER=dev PUBLIC_BASE_URL=http://localhost:5173 HOST=127.0.0.1 PORT=3001 \
     pnpm --filter @surveyjs-studio/server exec node --import tsx src/main.ts
   ```

   In shell 2:

   ```sh
   T=http://127.0.0.1:3001/api/v1
   curl -s -H "$AUTH" "$T/surveys/$KEEP" | jq '{id, name}'
   curl -s -H "$AUTH" "$T/surveys/$KEEP/results/stats" | jq .
   curl -s -o /dev/null -w "%{http_code}\n" -H "$AUTH" "$T/surveys/$GONE"
   ```

   - **Check:** the new name, statistics that count the response you added, and `404` for the deleted survey. Access key
     `access-key-1` works on the target: the keys were copied, hashed.

Stop shells 1 and 3 with Ctrl+C.

## 3. A killed copy resumes (checklist 3)

1. Wipe the target to start from empty (the confirmation is the file name of the database):

   ```sh
   pnpm migrate:hosted wipe --target "$DEMO/target.env" --confirm target.db
   ```

   - **Check:** `Wiped target.db: <n> rows in <n> tables, <n> stored files deleted …`. A wrong `--confirm` is refused
     with exit 2 and changes nothing (try it first: `--confirm nope`).

2. Start a copy and stop it while it works:

   ```sh
   pnpm migrate:hosted copy --source docker/azurite.env --target "$DEMO/target.env"
   ```

   Press Ctrl+C when the progress lines scroll. (The replica is small; if the copy ends first, wipe and try again, or
   accept that the test below covers it: `server/src/migrate/copy.azurite.test.ts` kills a run after one batch of a
   survey's responses.)

3. Run the same command again, then verify:

   ```sh
   pnpm migrate:hosted copy --source docker/azurite.env --target "$DEMO/target.env"
   pnpm migrate:hosted verify --full --source docker/azurite.env --target "$DEMO/target.env"; echo "exit $?"
   ```

   - **Check:** `copy: done`, then `OK, 0 differences` and `exit 0`. The surveys copied before the stop are not copied
     again, and the one that was cut off starts afresh: no duplicate responses.

## 4. A sample of whole accounts, then wipe (checklist 4)

1. Wipe, then copy half of the accounts, and name one that must be in:

   ```sh
   pnpm migrate:hosted wipe --target "$DEMO/target.env" --confirm target.db
   echo "$OLIVIA" > "$DEMO/include.txt"
   ```

   `OLIVIA` is the account of the access key, set in section 2 (set it again with the `curl` line there if your shell
   is new; Studio on the replica must be running for that).

   ```sh
   pnpm migrate:hosted copy --sample 0.5 --include "$DEMO/include.txt" --source docker/azurite.env --target "$DEMO/target.env"
   pnpm migrate:hosted verify --sample 0.5 --include "$DEMO/include.txt" --full --source docker/azurite.env \
     --target "$DEMO/target.env"; echo "exit $?"
   ```

   - **Check:** `Sample: <a> accounts, <p> projects, <s> surveys.` (fewer than the whole), `OK, 0 differences` and
     `exit 0`. The same share and include file always pick the same accounts. The sample holds whole accounts: every
     survey in it has its owner or its project, with the project's members.

2. Empty the target:

   ```sh
   pnpm migrate:hosted wipe --target "$DEMO/target.env" --confirm target.db
   pnpm migrate:hosted wipe --target "$DEMO/target.env" --confirm target.db
   ```

   - **Check:** the first says `Wiped target.db: <n> rows …`; the second says `0 rows` (a wipe repeated is harmless).
     The schema stays, so a `copy` can start again.

## On the new server (with the operator)

When the new server is built and the SurveyJS team's inputs are in ([Operations](../operations/hosted-migration.md#inputs-still-needed-from-the-surveyjs-team)):

1. Run `plan` on the real source, with read-only credentials, and keep its figures private.
2. The test migration: `copy --sample`, `verify --sample --full`, the replay and the load test of ADR 0042, then `wipe`.
3. The pre-copy, the daily `delta` and `reconcile`, a full `verify` the day before, and the window's final `delta`,
   `reconcile` and incremental `verify`.

## Clean up

Stop the shells with Ctrl+C, then `pnpm demo:azurite:down` (deletes the replica's data) and `rm -r ~/hosted-09-demo`.
