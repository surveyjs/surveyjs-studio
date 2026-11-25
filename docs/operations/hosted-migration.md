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

## The settings

**The source** (the old stores) comes from three variables, read from the environment or from the file given to
`--source` (a variable already set wins over the file):

| Variable                                   | What it is                                          |
| ------------------------------------------ | --------------------------------------------------- |
| `LEGACY_SQL_CONNECTION_STRING`             | The old database                                    |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | The old storage account of definitions and history  |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | The old storage account of responses and event logs |

Use read-only credentials: a read-only SQL login, and storage and file-share access that can read and list only. The
tool never writes, but a credential that cannot write is a second guard. For the local replica use
`--source docker/azurite.env`.

**The target** comes from the file given to `--target`; the environment is not used, so a shell that happens to hold
the production settings cannot reach production by mistake.

| Variable                        | What it is                                             |
| ------------------------------- | ------------------------------------------------------ |
| `STORAGE_PROVIDER`              | `sqlite` or `postgres`                                 |
| `SQLITE_PATH` or `DATABASE_URL` | The database file, or the PostgreSQL connection string |
| `FILE_STORE`                    | `local` or `s3`                                        |
| `FILES_PATH` or the `S3_*`      | The files folder, or the bucket settings               |

Without `--target`, `copy` and `plan` use a scratch target: a SQLite database and a files folder in a new temporary
folder, which the tool prints and leaves in place. `verify`, `delta`, `reconcile` and `wipe` need `--target`: they act on
what a copy already put there, and a scratch target is empty.

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
| `--source <env file>`      | The source settings, when they are not in the environment                                                                |
| `--target <env file>`      | The target settings (see above)                                                                                          |
| `--sample <share>`         | Only a share (0 to 1) of the accounts, with their projects: `plan`, `copy`, `verify`, `delta`, `reconcile`               |
| `--include <file>`         | Accounts always in the sample: a file of account ids, one per line                                                       |
| `--report <path>`          | Writes the report (ids and counts) as JSON to this file                                                                  |
| `--dump <dir>`             | `copy` and `delta`: also writes every record, in full, as NDJSON in this folder                                          |
| `--full`                   | `copy`: copy again the surveys already copied. `verify`: compare everything. `reconcile`: count every survey's responses |
| `--deep-sample <n>`        | `verify --full`: how many surveys are compared response by response (default 20)                                         |
| `--deep-max-responses <n>` | `verify`: surveys with more responses get counts and checksums only (default 50000)                                      |
| `--confirm <name>`         | `wipe`: the target's name, the PostgreSQL database name or the SQLite file's name                                        |

Exit codes: 0 done or green, 1 failed or differences found, 2 a usage error (a missing flag, a refused `wipe`). The
progress goes to the error output; the summary and the counts of the report go to the standard output.

### The sample

An account is in the sample when a hash of its id falls below the share, or when it is listed in `--include`, so every
run picks the same set. The sample holds whole accounts: the account's personal surveys; every project it belongs to,
with that project's surveys and members; and profiles of everyone the included data names. It is not transitive: a
member's own personal surveys are not pulled in. Use the same `--sample` and `--include` on every command of a test
migration. `plan --sample` also writes the survey ids and key hashes of the sample, which the replay's filter needs.

## The run order

1. **Before everything:** the SurveyJS team's inputs (below); `plan` on the real source for the volumes; a test
   migration (`copy --sample`, `verify --sample`, then `wipe`).
2. **Pre-copy,** days before the window, the old service live: `copy` on the real target. It takes about a day.
3. **Daily:** `delta`, and `reconcile`, until the window. Each is smaller than the one before, and each measures the
   time of the window's own `delta`.
4. **The day before the window,** after that day's `delta`: `verify --full`. Read the report; fix or explain every
   difference.
5. **In the window,** once the old service is stopped and today's Studio is read-only: the final `delta` (its marks are
   taken after the freeze), `reconcile`, then an incremental `verify`. All three pass: go. Any difference: no-go, and the
   old side starts again ([ADR 0042](../adr/0042-one-switch-to-the-new-server.md)).

Do not run two commands against one target at the same time.

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

`plan` adds the volumes and the estimate under `plan`.

### What is skipped

A row is skipped and reported by its ids when the data cannot be mapped: an id that is not a GUID, a survey with no
owner, a project none of whose members has a known role, a history snapshot that is not a JSON object, a file blob that
is not a file of the app. The run goes on. Open each skipped row with the SurveyJS team; none is copied until the source
is corrected and a `delta` or `copy --full` runs again.

### Notes worth reading

| Note                                                              | Meaning                                                                                                                          |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `person_without_email`, `person_email_conflict`                   | A person has no profile: no email, or an email equal to another's after lower-casing. Resolve on the site first                  |
| `survey_moved_to_creator`, `survey_moved_from_memberless_project` | The survey's project is gone or has no members; it is now the creator's personal survey                                          |
| `survey_kept_in_missing_project`                                  | No creator can take the survey: it is copied naming the missing project, visible to nobody                                       |
| `public_results_off_unreadable_setting`                           | The hidden-questions setting or the column layout could not be read; public results are off for that survey                      |
| `nul_replaced`                                                    | A `\u0000` in a JSON string became U+FFFD                                                                                        |
| `definition_unreadable`, `theme_unreadable`, `view_unreadable`    | Stored text that is not a JSON object; the survey reads as an empty one, as today                                                |
| `future_change_time`                                              | A SQL table holds a change time later than the database's own clock; the mark was capped at the clock. Ask the SurveyJS team why |
| `change_time_missing`                                             | A row has no change time, so `delta` reads it every time                                                                         |
| `delta_new_survey`                                                | A survey that was created after the copy and was copied by `delta`                                                               |
| `legacy_files_unlinked`                                           | `verify`: files in the old shares that no copied record links. They stay behind, by decision                                     |
| `deep_skipped_size`                                               | `verify`: a survey above `--deep-max-responses` was compared by counts and checksums, not response by response                   |
| `reconcile_*`                                                     | `reconcile` removed rows, replaced a project's members, or maps a survey again (`reconcile_remapped_survey`)                     |
| `reconcile_count_skipped_size`                                    | `reconcile` did not count the responses of a very large survey inside the window                                                 |
| `person_kept_unseeded`                                            | `reconcile` kept an account the migration did not create (somebody signed in)                                                    |

## Reading a `verify`

`verify` writes `verify: OK` or `verify: FAILED, <n> differences`, and exits 0 or 1.

- **A difference** means the target does not match the source as of the high-water marks. Any difference is a no-go:
  find the cause (the ids are in the report), correct it, and run `delta` or `copy --full` and `verify` again. Never
  start the window with a known difference.
- **Pending** is not a difference. A record that changed in the source after the marks is listed under `pending` and
  left out of the comparison on both sides. The next `delta` copies it. Many pending items before the window are normal
  (the old service is live); in the window, after the freeze, there should be none.
- **A person differs** when someone signs in to the target before the cutover through another provider, or when the
  target holds accounts the migration did not create (a test migration, an administrator). Read the people check with
  that in mind: it is the one difference that can be expected.
- **Not copied, by decision:** `verify` flags any key revocation made in Studio, API tokens, and uploaded files that
  belong to no survey, as differences. Production has none. If one appears, someone used the target, or the source has
  a kind of data this tool does not know: stop and find out.
- **A full `verify` is exact on the rows that existed before the marks.** The incremental one does not recount every
  response (the old store cannot count rows without reading them); it compares what changed since the last full verify.

## Private data

- **The dump** (`--dump`) holds every record in full: answers, emails, keys' hashes. From production it is private data,
  like the old stores themselves. Give it a folder in the private location and delete it when done.
- **The report** holds ids and counts only, and goes to the private location too.
- **The log** the tool prints holds counts and ids, never content.

## `wipe`

`wipe` empties the target after the test migration, or for a restart before the cutover. It needs `--target`, and
`--confirm` with the target's name, and refuses otherwise (and it never wipes a scratch target).

```sh
pnpm migrate:hosted wipe --target <env file> --confirm <the database name or the SQLite file name>
```

- It deletes every table's rows in one transaction, children before parents, and keeps the schema and
  `schema_migrations`. It deletes the stored bytes first, so a stop in between leaves rows that a second `wipe` finds.
- **On S3** it removes the bytes the `files` table names. Stray bytes of a copy that crashed before it wrote its row may
  remain; list the bucket if the test migration crashed.
- **On a local files folder** it empties the folder. The folder must not be shared with anything else.
- A table that `wipe` does not know is an error before anything is deleted, so a new migration cannot leave rows behind.

## Inputs still needed from the SurveyJS team

Before the real runs:

1. **The old servers' time zone.** Local times (a survey's created time, project and member times) are read as UTC until
   it is known.
2. **Whether the old app writes its SQL change-time columns in UTC.** If it writes local time behind UTC, `delta` could
   miss its changes. The marks are capped at the database's own clock and a future time is reported
   (`future_change_time`), but a writer behind UTC is not covered.
3. **The real column list of the old SQL tables.** Run `pnpm inspect:legacy-schema` against the real database, read
   only, and compare it with what the mapping expects.
4. **Read-only credentials:** a read-only SQL login; storage and file shares with read and list only.
