# Hosted migration: running the tool

`migrate:hosted` copies the data of today's service from the old stores into Studio's database and file store, checks
the copy, and keeps it current until the switch. The decisions behind it are in
[ADR 0044](../adr/0044-the-hosted-migration-tool.md); the order of the whole cutover is in
[ADR 0042](../adr/0042-one-switch-to-the-new-server.md). The old stores are only read: nothing the tool does can change
them.

## Where it runs

- **On the new server,** in the hosted image: `surveyjs-studio migrate-hosted <command> [options]`. The bytes then cross
  the network once, into the new server's object storage.
- **From a checkout,** for development and tests: `pnpm migrate:hosted <command> [options]`.

Both run the same code. `--help` prints the usage.

On the server the command runs in a one-off container of the hosted image, next to the running app. The two env files
(`--source`, `--target`) and the folders for `--report` and `--dump` live in one private folder on the host, mounted
into the container; the paths given to the flags are the paths inside it. With the deployment's Compose file, for
example:

```sh
docker compose run --rm -v /srv/migration:/migration <the app service> \
  surveyjs-studio migrate-hosted copy --source /migration/source.env --target /migration/target.env \
  --report /migration/reports/copy.json
```

The image runs as the user `node` (uid 1000): the mounted folder must be writable by it. The target file names the same
database and bucket as the app's own settings; a progress line goes to the error output at the end of every phase, so
run long commands under `nohup` or in a terminal multiplexer, and keep their output with the report.

## The settings

**The source** (the old stores) comes from three variables. Given `--source`, they come from that file only: the
environment's are not used (in the hosted image the app's own read-write settings are in the environment, and must not
stand in for the file's read-only ones; the tool prints a note naming any it ignores). Without `--source` they come from
the environment.

| Variable                                   | What it is                                          |
| ------------------------------------------ | --------------------------------------------------- |
| `LEGACY_SQL_CONNECTION_STRING`             | The old database                                    |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | The old storage account of definitions and history  |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | The old storage account of responses and event logs |

Use read-only credentials: a read-only SQL login, and storage and file-share access that can read and list only. The
tool never writes, but a credential that cannot write is a second guard. For the local replica use
`--source docker/azurite.env`.

Every command but `wipe` prints the source it opened, by names only (the SQL server and database, the two storage
accounts; never a key or a password), and first checks that every store it reads answers: the file shares, the
containers and the event table every source holds, and the results account's table list. One that does not answer is
named and the command refuses (exit 2) before anything is written: credentials that cannot read the file shares would
otherwise read as "no file", and the copy would take none. `copy` records the source in the target; `verify`, `delta`
and `reconcile` refuse (exit 2) another one, so a `reconcile` against the wrong stores cannot remove what they lack. The
names are the same for a read-only and a read-write login to the same stores. A target copied before sources were
recorded takes the source of its next run, with a printed note.

`plan` and `copy` also print the SQL server's offset from UTC and the defaults of the change-time columns: the
high-water marks assume the database stamps those times on UTC. `copy` refuses (exit 2) when a default takes the
server's local time and the server is not on UTC, before the target is opened.

**The target** comes from the file given to `--target`; the environment is not used, so a shell that happens to hold
the production settings cannot reach production by mistake.

| Variable                        | What it is                                             |
| ------------------------------- | ------------------------------------------------------ |
| `STORAGE_PROVIDER`              | `sqlite` or `postgres`                                 |
| `SQLITE_PATH` or `DATABASE_URL` | The database file, or the PostgreSQL connection string |
| `FILE_STORE`                    | `local` or `s3`                                        |
| `FILES_PATH` or the `S3_*`      | The files folder, or the bucket settings               |

`plan` opens no target. Without `--target`, `copy` uses a scratch target: a SQLite database and a files folder in a new
temporary folder, which the tool prints and leaves in place. `verify`, `delta`, `reconcile` and `wipe` need `--target`:
they act on what a copy already put there, and a scratch target is empty. `delta` and `reconcile` also refuse a target
whose `copy` has not finished (a stopped copy is run again until it ends with `copy: done`): what it never reached, no
`delta` would read.

## Commands

| Command     | What it does                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `plan`      | Counts what a copy would move and estimates its size and time. Writes nothing to the target.       |
| `copy`      | Copies everything (or the sample). A stopped run is resumed by running the same command again.     |
| `delta`     | Copies what changed in the source since the last `copy` or `delta`.                                |
| `reconcile` | Removes from the target what the source deleted, and maps again surveys that a deletion changed.   |
| `verify`    | Compares the target with the source as of the high-water marks. Exit 1 on any difference.          |
| `wipe`      | Empties the target: every table but `schema_migrations`, and every stored file. Needs `--confirm`. |

| Option                     | Meaning                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--source <env file>`      | The source settings; given, the environment's are not used                                                               |
| `--target <env file>`      | The target settings (see above)                                                                                          |
| `--sample <share>`         | Only a share (0 to 1) of the accounts, with their projects: `plan`, `copy`, `verify`, `delta`, `reconcile`               |
| `--include <file>`         | Accounts always in the sample: a file of account ids, one per line                                                       |
| `--report <path>`          | Writes the report (ids and counts) as JSON to this file                                                                  |
| `--dump <dir>`             | `copy` and `delta`: also writes every record, in full, as NDJSON in this folder                                          |
| `--full`                   | `copy`: copy again the surveys already copied. `verify`: compare everything. `reconcile`: count every survey's responses |
| `--deep-sample <n>`        | `verify --full`: how many surveys are compared response by response (default 20)                                         |
| `--deep-max-responses <n>` | `verify`: surveys with more responses get counts and checksums only (default 50000)                                      |
| `--no-pending`             | `verify`: a pending item fails the run too (exit 1). The window's `verify` uses it                                       |
| `--confirm <name>`         | `wipe`: the target's name, the PostgreSQL database name or the SQLite file's name                                        |
| `--even-if-used`           | `wipe`: wipe a target that shows use ([`wipe`](#wipe)); without it such a target is refused                              |

Exit codes: 0 done or green, 1 failed or differences found, 2 a usage error or a refusal (a missing flag, a refused
`wipe`, a store of the source that does not answer, a source or a sample other than the copy's, a copy that has not
finished, a change-time default in local time on a SQL server not on UTC). A refused command changes nothing. The
progress goes to the error output; the summary and the counts of the report go to the standard output.

### The sample

An account is in the sample when a hash of its id falls below the share, or when it is listed in `--include`, so every
run picks the same set. The sample holds whole accounts: the account's personal surveys; every project it belongs to,
with that project's surveys and members; and profiles of everyone the included data names. It is not transitive: a
member's own personal surveys are not pulled in. Use the same `--sample` and `--include` on every command of a test
migration: `copy` records them in the target, and `verify`, `delta` and `reconcile` refuse others (exit 2), so a
`reconcile --sample` cannot empty a full target and a `delta` without `--sample` cannot grow a sample into a full copy.
Once a copy has started in the target (one that stopped early too), a later `copy` refuses another sample, or none on a
sample target, for the same reason: it would rewrite the recorded sample and a `reconcile --sample` after it would
delete everything outside the new one. To copy something else into a target, `wipe` it first.
`plan --sample` also writes the survey ids and key hashes of the sample, which the replay's filter needs.

## The run order

1. **Before everything:** the SurveyJS team's inputs (below); `plan` on the real source for the volumes; a test
   migration (`copy --sample`, `verify --sample`, then `wipe`).
2. **Pre-copy,** days before the window, the old service live: `copy` on the real target. It takes about a day.
3. **Daily:** `delta`, then `reconcile`, until the window. Each is smaller than the one before, and each measures the
   time of the window's own runs ([Timing the window](#timing-the-window)).
4. **The day before the window,** after that day's `delta` and then `reconcile`: `verify --full`. Read the report; fix
   or explain every difference. The `reconcile` must come after the `delta`: only then are deletions the old app leaves
   no trace of (a layout, a member, a saved view) made during the long run pending rather than differences.
5. **In the window,** once the old service is stopped and today's Studio is read-only: the final `delta` (its marks are
   taken after the freeze), `reconcile`, then an incremental `verify --no-pending` (after the freeze nothing may be
   pending). Start the final `delta` at least 5 minutes after the freeze (the marks' safety margin, plus any skew of the
   old storage's clock): its marks are taken that margin back, so writes the live service made in the last minutes
   before the freeze would otherwise count as after the marks, and the `verify` would fail on them. An incremental
   `verify` after a `delta` with no `reconcile` after it fails (the difference `reconcile`). All three pass: go. Any
   difference: no-go, and the old side starts again ([ADR 0042](../adr/0042-one-switch-to-the-new-server.md)).

Do not run two commands against one target at the same time.

## Timing the window

The window holds the final `delta`, `reconcile` and an incremental `verify`, and must fit the hour of
[ADR 0033](../adr/0033-hosted-target-stores.md). Their time is measured, not estimated: every report has `durations`,
each phase's milliseconds, and each phase ends with a progress line that gives the same figure. Time the daily runs
from the first `delta` on; the last few, made when little changes, are the closest to the window's.

What each phase reads, and why some cost the same whatever changed:

| Command     | Phase                | What it reads                                                                                                               |
| ----------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `delta`     | `changes`            | The SQL rows changed since the marks; the layout, permission and published-snapshot containers listed (small)               |
|             | `people`             | Every user, project and member row (small tables); the history of the changed surveys only                                  |
|             | `surveys`            | Each survey's responses, markers and deletion copies changed since the marks, 16 surveys at once                            |
|             | `events`             | The event log changed since the marks (a sample that gained a survey: the whole log, once)                                  |
|             | `views`, `files`     | The view and file containers listed (small), the changed blobs read; a survey copied whole: all its views and files         |
| `reconcile` | the first four       | `surveys`, `projects`, `remap`, `people_views_files`: the SQL rows; the layout, permission, view and file containers listed |
|             | `responses`          | The deletion copies since the last `reconcile` (each id read once), their surveys' markers; the changed surveys counted     |
| `verify`    | `stores`             | The token table and the file container (listings); the results account's table list; the event log since the last verify    |
|             | `people`, `projects` | The user, project and member rows; the target's rows of each                                                                |
|             | `surveys`            | Each survey's record; its responses and deletion copies since the last full verify; the changed surveys in full; counts     |
|             | `keys`               | Incremental: the layout, permission, view and file containers listed (small, as `reconcile`), against the target's keys     |
| `copy`      | `surveys`            | Every survey in full, 8 at once; `events`, `views` and `files` after it                                                     |

The event log and each survey's response, marker and deletion-copy tables are read by change time, and the old store
answers such a filter with a full scan on its side: the time those scans take grows with the size of the tables, not
with the number of changes. That is why the window's runs cost about as much as the last daily ones, and why the daily
figures are the estimate.

## The report

`--report` writes one JSON file. It holds ids and counts, never content, so it can be read and kept without exposing
survey data, but the ids still identify records: **it goes to the private location, never to the repository, a pull
request or an Actions log** (plan-hosted rule 6). The fields:

| Field         | Holds                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `counts`      | A number for each kind of finding: `skipped:<entity>`, each note kind, `difference:<check>`, `pending:<check>` |
| `skipped`     | Rows left out of the copy: the entity, its ids and the reason                                                  |
| `notes`       | Things the owners should know that did not stop a row: the kind and its ids                                    |
| `checks`      | `verify` only: for each check, how many items were compared, how many differences, how many pending, `pass`    |
| `differences` | `verify` only: each difference, with its check, ids and counts                                                 |
| `pending`     | `verify` only: each record that changed in the source after the marks                                          |
| `durations`   | Each phase's time in milliseconds ([Timing the window](#timing-the-window))                                    |

`plan` adds the volumes and the estimate under `plan`.

### What is skipped

A row is skipped and reported by its ids when the data cannot be mapped: an id that is not a GUID, a survey with no
owner, a project none of whose members has a known role, a history snapshot that is not a JSON object, a file blob that
is not a file of the app. The run goes on. Open each skipped row with the SurveyJS team; none is copied until the source
is corrected and a `delta` or `copy --full` runs again.

### Notes worth reading

| Note                                                              | Meaning                                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `person_without_email`, `person_email_conflict`                   | A person has no profile: no email, or an email equal to another's after lower-casing. Resolve on the site first                   |
| `survey_moved_to_creator`, `survey_moved_from_memberless_project` | The survey's project is gone or has no members; it is now the creator's personal survey                                           |
| `survey_kept_in_missing_project`                                  | No creator can take the survey: it is copied naming the missing project, visible to nobody                                        |
| `public_results_off_unreadable_setting`                           | The hidden-questions setting or the column layout could not be read; public results are off for that survey                       |
| `nul_replaced`                                                    | A `\u0000` in a JSON string became U+FFFD                                                                                         |
| `definition_unreadable`, `theme_unreadable`, `view_unreadable`    | Stored text that is not a JSON object; the survey reads as an empty one, as today                                                 |
| `future_change_time`                                              | A SQL table holds a change time later than the database's own clock; the mark was capped at the clock. Ask the SurveyJS team why  |
| `change_time_missing`                                             | A row has no change time, so `delta` reads it every time                                                                          |
| `delta_new_survey`                                                | A survey that was created after the copy and was copied by `delta`                                                                |
| `legacy_files_unlinked`                                           | `verify`: files the target holds that no copied record links any more (an image dropped, a response deleted). Kept, by decision   |
| `deep_skipped_size`                                               | `verify`: a survey above `--deep-max-responses` was compared by counts and checksums, not response by response                    |
| `reconcile_*`                                                     | `reconcile` removed rows, replaced a project's members, or maps a survey again (`reconcile_remapped_survey`)                      |
| `reconcile_response_copied_again`                                 | A response a deletion copy names that the source holds again (posted again, same id): kept, and copied back                       |
| `reconcile_count_skipped_size`                                    | `reconcile` did not count the responses of a very large survey inside the window                                                  |
| `person_kept_unseeded`                                            | `reconcile` kept, and `verify` found, an account the migration did not create (an administrator, an account made at sign-in)      |
| `person_held_elsewhere`                                           | `verify`: a named person the copy could not write, because another account holds the email or the surveyjs.io sign-in             |
| `person_used`                                                     | `verify`: a profile somebody has used since the copy; only what the migration owns (id, email, name, block flag, sign-in) is read |
| `private_questions_superset`                                      | `verify`: the stored private questions keep a name that only responses deleted since used. Safe: nothing is more public           |
| `deleted_copy_undated`                                            | A deletion copy holds no deletion time: it is kept, deleted at the time the old storage stamped it                                |

## Reading a `verify`

`verify` writes `verify: OK` or `verify: FAILED`, then `<n> differences, <m> pending`, and exits 0 or 1. With
`--no-pending` a pending item fails the run as a difference does.

- **A difference** means the target does not match the source as of the high-water marks. Any difference is a no-go:
  find the cause (the ids are in the report), correct it, and run `delta` or `copy --full` and `verify` again. Never
  start the window with a known difference.
- **Pending** is not a difference. A record that changed in the source after the marks is listed under `pending` and
  left out of the comparison on both sides. The next `delta` copies it. Many pending items before the window are normal
  (the old service is live); in the window, after the freeze, there must be none: the window's `verify` runs with
  `--no-pending`, so one fails it. The marks are taken 5 minutes back of the source's clocks, so the final `delta` must
  start at least that long after the freeze; when only pending items fail the run, it prints the marks' times and this
  rule.
- **Deletions after the marks are pending too,** when the old service left a dated trace after the marks: a survey's
  deletion event (its record, and the views and files the target still holds of it), a delete-all event (the survey's
  response and marker counts), a deletion copy (the response, and its client's completion marker, which goes with it).
  The full `verify` also counts as pending what the old app deletes without a trace (a layout or permissions blob, a
  member, a project, a saved view or file, a person no longer named) when the last `reconcile` ran after the marks; that
  is why the day-before run follows a `reconcile`. Without one, those are differences. Of a project that lost a member,
  only its members and member count are pending. The incremental `verify` never takes that rule: in the window the old
  service is frozen, so such an item is a deletion `reconcile` missed. It compares the members, projects and people in
  full, and every layout, permissions record, saved view and own file the target holds against the source's listings;
  one the source lacks is a difference.
- **`reconcile`:** the incremental `verify` reports this difference when a `delta` ran after the last `reconcile`: the
  deletions since are not applied. Run `reconcile`, then `verify` again.
- **`full_verify`:** the incremental `verify` builds on the last full one that ended with no difference (pending items
  allowed). A full `verify` forgets it when it starts, so after a red full run the incremental one reports
  `full_verify` until a full run passes.
- **People:** an account the migration did not create (an administrator, an account made at sign-in) is noted, not a
  difference; so is a person the copy could not write because the target holds their email or sign-in. Of a profile
  somebody has used since the copy, only what the migration owns is compared. A profile the migration created that the
  source no longer names is a difference until `reconcile` removes it.
- **Not copied, by decision:** `verify` flags any key revocation made in Studio, API tokens, and uploaded files that
  belong to no survey, as differences. Production has none. If one appears, someone used the target, or the source has
  a kind of data this tool does not know: stop and find out.
- **A full `verify` is exact on the rows that existed before the marks.** The incremental one does not recount every
  response (the old store cannot count rows without reading them); it compares what changed since the last full verify.
- **What only the full `verify` sees.** When the old app deletes every response of a survey, the incremental `verify`
  counts that survey's responses and markers by the audit event; when the event is missing (the app writes it last, on
  a best-effort basis), neither `reconcile` nor the incremental `verify` notices; the full `verify` counts the rows and
  does. A key changed or cleared on the site is taken by `delta` when the
  person's change time moves; one changed without a change time is not read by `delta`: `verify` compares every key
  and reports it, and `copy` (or `copy --full`) writes it again.

## Private data

- **The dump** (`--dump`) holds every record in full: answers, emails, keys' hashes. From production it is private data,
  like the old stores themselves. Give it a folder in the private location and delete it when done.
- **The report** holds ids and counts only, and goes to the private location too.
- **The log** the tool prints holds counts and ids, never content.

## `wipe`

`wipe` empties the target after the test migration, or for a restart before the cutover. It needs `--target`, and
`--confirm` with the target's name, and refuses otherwise (and it never wipes a scratch target, nor a target whose
settings name no database).

```sh
pnpm migrate:hosted wipe --target <env file> --confirm <the database name or the SQLite file name>
```

- **A target that shows use is refused:** a user who has signed in, or a sign-in other than the surveyjs.io one the
  migration writes for each person. After the cutover the target is production, and its env file names the production
  database. `--even-if-used` wipes such a target anyway; it is meant for a rehearsal target someone signed in to.

- It deletes every table's rows in one transaction, children before parents, and keeps the schema and
  `schema_migrations`. It deletes the stored bytes first, so a stop in between leaves rows that a second `wipe` finds.
- **On S3** it removes the bytes the `files` table names. Stray bytes of a copy that crashed before it wrote its row may
  remain; list the bucket if the test migration crashed.
- **On a local files folder** it empties the folder. The folder must not be shared with anything else.
- A table that `wipe` does not know is an error before anything is deleted, so a new migration cannot leave rows behind.

## Inputs still needed from the SurveyJS team

Before the real runs:

1. **The real column list of the old SQL tables.** Run `pnpm inspect:legacy-schema` against the real database, read
   only, and compare it with what the mapping expects.
2. **Read-only credentials:** a read-only SQL login; storage and file shares with read and list only.

Settled (2026-11-26): the old stores set their change times themselves (the database, the storage service), not the
servers that write to them, so each store has one clock and the marks follow it; local times are read as UTC. `plan`
and `copy` print the one thing left to check, the SQL change-time defaults and the server's offset from UTC, and `copy`
refuses a default in local time on a server not on UTC.
