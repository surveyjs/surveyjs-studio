# ADR 0044: The hosted migration tool

Status: Accepted (hosted Step 9, 2026-11-25). Settles how the data of today's service reaches the new server, inside
the order set by [ADR 0042](0042-one-switch-to-the-new-server.md). Changes [ADR 0037](0037-access-keys-and-api-tokens.md)
point 4 (revocations) and the stale lines of spec-hosted.md (member ids, API tokens, licence notices). The commands and
the operator's order of work are in [Operations › Hosted migration](../operations/hosted-migration.md).

## Context

On the switch day users and API callers must see the same surveys, responses, files, layouts, projects and members,
with the same ids and times. The copy has to be provable, repeatable without harm, resumable after a crash, and fast
enough inside the window ([ADR 0033](0033-hosted-target-stores.md): under one hour). The same tool makes the test
migration of about a tenth of the accounts and wipes it afterwards (ADR 0042). The old stores are only ever read.

The entity-by-entity mapping, with the old store, table and column names, is kept in the private legacy documentation
(plan-hosted rule 6). This page records the decisions and the reasons.

## Decision

### 1. One process, a stream of records

An exporter reads the old stores through the rules the old-store provider already uses, and yields normalised records.
An importer consumes them and writes the target in batches. `--dump <dir>` also writes the stream as NDJSON for
inspection. The importer is its own port, not the request-path stores: those stamp new times and ids, cannot upsert, and
are far too slow.

- **Writes are upserts** keyed by the primary key, with exact timestamps, lower-case GUIDs and file bytes before the row
  that names them. Running a batch again changes nothing; a run that was killed is resumed by running it again.
- **State is a table in the target,** `migration_state` (migration `0012`, hosted only, empty elsewhere): the run, the
  checkpoint of each survey, the high-water marks and the sample. `wipe` empties it with the rest.
- **The source is read only.** Every module that reads it is in the read-only block of the lint configuration.

### 2. Commands

`plan`, `copy`, `delta`, `reconcile`, `verify` and `wipe`. Without `--target`, `copy` and `plan` work on a scratch
target (a temporary SQLite database and folder, printed). `verify`, `delta`, `reconcile` and `wipe` refuse to run
without `--target`: they act on what a copy already put there. `wipe` also needs `--confirm` with the target's name.

- **`copy`** takes the high-water marks first, then copies survey by survey, checkpointing each.
- **`delta`** finds changes without listing the large stores: the SQL tables by their change time; a changed survey's
  history by its own prefix; responses, completion markers and deletion copies by change time, survey by survey, in
  parallel; the small containers listed and filtered by last-modified time. Then the marks move forward. Marks are
  taken a safety margin back, so a write in flight is read again, and never later than the database's own clock (a row
  stamped in the future is reported, not allowed to hide later changes).
- **`reconcile`** removes from the target what the source no longer has, and maps again the surveys whose project or
  settings a deletion changed. A full count of every survey's responses is never part of the window.
- **`verify`** is the go or no-go (point 6). **`wipe`** keeps the schema.
- **`--sample <share>` and `--include <file>`** select whole accounts (point 7).

The tool runs inside the hosted image on the new server (`surveyjs-studio migrate-hosted <command>`), so the bytes
cross the network once, into the new server's object storage. `pnpm migrate:hosted` runs the same code from a checkout
for development and tests.

### 3. Files: only those the copied data links

The exporter scans the copied definitions, themes, history entries and responses for file references and copies just
those files. Each gets a deterministic id from its kind, old name and size, the all-zero survey (so outside every quota,
as today's service serves them), and a row in `legacy_files` that maps the old name to it. `delta` copies files linked
after the pre-copy. Files nobody links stay behind; `verify` counts them as a note. Studio's own file container keeps
its ids and surveys. A file whose bytes match no allowed type is stored as `application/octet-stream`.

### 4. Privacy: hidden if either old rule hid it

A survey's `private_questions` is the union of two sets, so nothing private becomes public on Studio's public page or
through the bridge:

- the questions its permissions setting marked not public;
- the answer columns its saved column layout marked hidden or not public.

The old public results read the layout this way, and the tool keeps the rule. When the layout lists at least one
column, every answer it does not list takes the layout's "new columns" visibility. The response time and response id
columns are private when the layout hides them or does not list them. Answer names come from the definition (question,
value and comment names) and, in the copy, from the response keys. An empty layout is no layout. If the permissions
setting or the layout cannot be read, public results are turned off for that survey (`public_results` false) and it is
reported; the owner can turn them on again. The layout itself is kept, with the other saved layouts, in
`survey_layouts` (the bridge computes columns from it, [ADR 0040](0040-bridge-access-key-actions.md)).

### 5. Projects, people and keys

- **A survey whose project no longer exists,** or has no members, moves to its creator's personal surveys and keeps its
  archived flag, as Studio's own project delete does. When the creator is none, the zero id, unknown or without a
  profile, the survey is copied as it is today (naming the project, visible to nobody) and listed in the report. A
  project with no members is skipped and reported.
- **People are pre-created profiles,** not accounts ([ADR 0043](0043-hosted-users-on-the-local-directory.md) point 6):
  for every person the copied data names (owners, creators, members, history authors, view owners, key holders) one
  `users` row and one linked sign-in for the surveyjs.io id. The id and email are lower-case; a blank name becomes the
  email; the role is `user`, the status `active`, and the site's block flag goes to `site_blocked`; no password, no
  licence date; `created_at` is the start of the run. There are no instance admin rows (`ADMIN_EMAIL` promotes at
  sign-in). A person with no email, or with an email that differs from another's only in letter case, gets no profile
  and is listed for the SurveyJS team; the data keeps their ids. Duplicates must be resolved on the site first.
  `reconcile` removes only profiles the migration made and nobody has used since.
- **Legacy access keys** are copied hashed (`hashCredential(key, "legacy-key")`) with their last four characters and
  `created_at` of the run. A blocked person's key is refused by `site_blocked`, not revoked.
- **Members:** one row per project and person; an admin row wins; the old member id is dropped.

### 6. What "go" means

`verify` compares through both providers' domain reads, as of the high-water marks. A source record that changed after
the marks is listed as **pending**, never as a difference; the next `delta` copies it. Any difference makes the run red
(exit 1). There are two modes:

- **Full** (`--full`), the day before the window, after a daily `delta`: every survey's record, definition, theme,
  history, layouts, private questions and response count; every table by count; checksums; and a random sample of
  surveys (every survey of a sample run) read in depth through both providers, response by response. A survey above
  `--deep-max-responses` gets counts and checksums only, and is noted.
- **Incremental,** in the window, after the final `delta`: what changed since the last full verify (changed surveys in
  full, new responses by count, deletions) and the small tables in full. A full recount of every response cannot fit the
  hour: the old store cannot count rows without reading them, and one survey holds about two thirds of them.

Both modes flag what the copy does not take (point 9).

### 7. The sample

An account is in when a hash of its id falls below the share, or it is listed in `--include`, so every run picks the
same set. The closure: the account's personal surveys; every project it is a member of, with the project's surveys and
members; profiles of everyone the included data names. It is not transitive: a member's own personal surveys are not
pulled in. `plan --sample` also writes the sample's survey ids and key hashes for the replay's filter (ADR 0042).

### 8. The decisions on data

- **History:** the 20 newest entries per survey, by time then id ([ADR 0036](0036-history-snapshots-above-a-size-limit.md));
  a published snapshot only through its own time; `delta` deletes target entries beyond 20.
- **A survey's publish id** goes to `surveys.legacy_publish_id`.
- **Answers are copied as stored,** entities included ([ADR 0039](0039-bridge-public-actions.md)); rows one to one with
  client id and partial flag ([ADR 0038](0038-partial-responses.md)).
- **A `\u0000` inside a JSON string** becomes U+FFFD on both dialects and is reported by id. A BOM is removed. Text that
  is not a JSON object is reported and skipped.
- **Deleted responses** keep the answers, client id, partial flag and respondent address as one JSON object, with the
  deletion time of the copy. Events keep their ids, types, times and payload text.
- **Local times** the old servers wrote without a zone (survey created, project and member times) are read as UTC until
  the SurveyJS team says otherwise.
- **An id that is not a GUID** is skipped and reported, never a crash. Completion markers keep their client id as stored.

### 9. Not copied, by decision

- Studio's own legacy-key revocations, API tokens and uploads that belong to no survey. Production has none; `verify`
  reports any it finds as a difference, so a surprise is not hidden.
- Files nobody links; licences; accounts.

### 10. Reports and private data

Reports hold ids and counts, never content, and go only where `--report` points: the private location (rule 6). A dump
holds full records and is private data. Nothing from a production run goes into the repository, a pull request or an
Actions log.

### 11. Inputs from the SurveyJS team, before the real runs

- **The old servers' time zone.** Until it is known, local times are read as UTC.
- **Whether the old app writes its SQL change-time columns in UTC.** If it writes local time behind UTC, `delta` could
  miss its changes. The marks are capped at the database's own clock and a future time is reported, but a writer behind
  UTC is not covered.
- **The real column list of the old SQL tables** (run `pnpm inspect:legacy-schema`, read only, again).
- **Read-only credentials:** a read-only SQL login; the storage accounts and file shares with read and list only.

## Why not the alternatives

| Alternative                                   | Why not                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Export to files, then import                  | A second copy of tens of gigabytes of responses and a second pass inside the window |
| Copy through the request-path stores          | They stamp new times and ids, cannot upsert, and are too slow                       |
| Copy every file                               | Files nobody links have no survey to belong to, and add days of copying             |
| Hide only what the permissions hid            | A question hidden in the saved layout would become public                           |
| A full recount of all responses in the window | The old store cannot count rows without reading them; it does not fit the hour      |

## Consequences

- The window's work is `delta`, `reconcile` and an incremental `verify`; the bulk is copied days before and shrinks
  with each daily `delta`.
- A `verify` that passes means no known difference as of the marks. Pending items are the next `delta`'s work, and the
  run order in Operations makes the last `delta` come after the freeze.
- People who sign in before the cutover through another provider, or accounts the target holds that the migration did not
  create (the test migration), show as differences in `verify`'s people check. That is expected; read the report with it
  in mind.
- Migration `0012` adds `migration_state`; nothing else in the schema changes.
- Open: the four inputs of point 11.
