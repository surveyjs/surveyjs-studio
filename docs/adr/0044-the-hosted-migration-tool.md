# ADR 0044: The hosted migration tool

Status: Accepted (hosted Step 9, 2026-11-25). Settles how the data of today's service reaches the new server, inside
the order set by [ADR 0042](0042-one-switch-to-the-new-server.md). Changes [ADR 0037](0037-access-keys-and-api-tokens.md)
point 4 (revocations), [ADR 0043](0043-hosted-users-on-the-local-directory.md) point 6 (who is seeded, what `reconcile`
removes) and the stale lines of spec-hosted.md (member ids, API tokens, licence notices). The commands and the
operator's order of work are in [Operations › Hosted migration](../operations/hosted-migration.md). Changed
2026-11-26: a correctness review of the tool (copy fidelity, the published snapshot, source safety, delta and
reconcile, verify as the go/no-go) and the privacy rule (point 4); see the end.

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

`plan`, `copy`, `delta`, `reconcile`, `verify` and `wipe`. `plan` opens no target; without `--target`, `copy` works on a
scratch target (a temporary SQLite database and folder, printed). `verify`, `delta`, `reconcile` and `wipe` refuse to run
without `--target`: they act on what a copy already put there. `wipe` also needs `--confirm` with the target's name.

- **`copy`** takes the high-water marks first, then copies survey by survey (a few at once), checkpointing each, and
  names each survey's history authors from the history it copies. It records its sample (or none) and, at the end of a
  whole pass, that it finished: `delta` and `reconcile` refuse a target whose copy has not finished, and `verify`,
  `delta` and `reconcile` refuse a `--sample` or `--include` other than the copy's. A later `copy` refuses them too once
  the target holds any part of a copy: the sample is recorded before the copy's first write, so a run that stopped
  early counts. Only `wipe` lets a target take another sample.
- **`delta`** finds changes without listing the large stores: the SQL tables by their change time; a changed survey's
  history by its own prefix; responses, completion markers and deletion copies by change time, survey by survey, in
  parallel; the small containers listed and filtered by last-modified time. A survey the target lacks is copied whole,
  with its saved views, Studio's own files and (in a sample) events of any time. Then the marks move forward. Marks are
  taken a safety margin back, so a write in flight is read again, and never later than the database's own clock (a row
  stamped in the future is reported, not allowed to hide later changes).
- **`reconcile`** removes from the target what the source no longer has, and maps again the surveys whose project or
  settings a deletion changed. It compares response counts first and the ids only where they differ, streamed through
  the target, and the completion markers of every survey with a deletion since its last run. A full count of every
  survey's responses is never part of the window.
- **`verify`** is the go or no-go (point 6). **`wipe`** keeps the schema.
- **`--sample <share>` and `--include <file>`** select whole accounts (point 7).

The tool runs inside the hosted image on the new server (`surveyjs-studio migrate-hosted <command>`), so the bytes
cross the network once, into the new server's object storage. `pnpm migrate:hosted` runs the same code from a checkout
for development and tests. The self-hosted image does not hold the tool: its stage removes `server/src/migrate`, and
`migrate-hosted` refuses there (exit 2) rather than only being left out of the usage. Every report and progress line
gives each phase's duration, so the window's runs are timed by the daily ones.

### 3. Files: only those the copied data links

The exporter scans the copied definitions, themes, history entries and responses for file references and copies just
those files. Each gets a deterministic id from its kind, old name and size, the all-zero survey (so outside every quota,
as today's service serves them), and a row in `legacy_files` that maps the old name to it. `delta` copies files linked
after the pre-copy. Files nobody links stay behind in the old shares; a file the target holds that no copied record
links any more is kept, and `verify` counts those as a note. Studio's own file container keeps
its ids and surveys. A file whose bytes match no allowed type is stored as `application/octet-stream`.

### 4. Privacy: the old public results' rule

A survey's `private_questions` follows the rule the old public results applied, so nothing the old public results hid
becomes public on Studio's public page or through the bridge:

- without a column layout, or with one listing no columns: the questions its permissions setting marked not public;
- with a layout listing columns and no permissions setting: the answer columns the layout marked hidden or not public;
- with both: every answer is private except those the permissions setting marked public **and** the layout lists (at
  any visibility); answers added later, answers only responses hold, and the response time and id are private too
  (see "Changed 2026-11-26", the privacy rule). That holds for the names known to the copy: once Studio runs, its
  private questions are a deny-list, so a name first seen after the switch is public, as in all of Studio.

While a copy or `delta` writes a survey's responses, the stored list only grows: before a batch brings an answer name
the list was not computed with, the rule is applied to it, so no answer is public, even for a moment, that the finished
copy hides.

The old public results read a layout without a permissions setting this way, and the tool keeps the rule. When the
layout lists at least one column, every answer it does not list takes the layout's "new columns" visibility. The
response time and response id columns are private when the layout hides them or does not list them. Answer names come
from the definition (question, value and comment names) and, in the copy, from the response keys. An empty layout is
no layout. If the permissions setting or the layout cannot be read, public results are turned off for that survey
(`public_results` false) and it is reported; the owner can turn them on again. The layout itself is kept, with the
other saved layouts, in `survey_layouts` (the bridge computes columns from it,
[ADR 0040](0040-bridge-access-key-actions.md)).

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
  sign-in). A person with no email, or with an email that differs from another site user's only in letter case (any
  user's, named or not, so the decision does not depend on who else a run names), gets no profile and is listed for the
  SurveyJS team; the data keeps their ids. Duplicates must be resolved on the site first.
  `reconcile` removes only profiles the migration made and nobody has used since.
- **Legacy access keys** are copied hashed (`hashCredential(key, "legacy-key")`) with their last four characters and
  `created_at` of the run. A blocked person's key is refused by `site_blocked`, not revoked.
- **Members:** one row per project and person; an admin row wins; the old member id is dropped. A member is created at
  the earliest time of the person's rows and updated at their latest change time (a row without one: its join time,
  then the epoch).

### 6. What "go" means

`verify` compares through both providers' domain reads, as of the high-water marks. A source record that changed after
the marks is listed as **pending**, never as a difference; the next `delta` copies it. So is a deletion after the marks
(see "Changed 2026-11-26", verify, for which). Any difference makes the run red (exit 1). There are two
modes:

- **Full** (`--full`), the day before the window, after a daily `delta` and `reconcile`: every survey's record,
  definition, theme, history, layouts, private questions and response counts (complete and all rows); every table by
  count; checksums; and a random sample of surveys (every survey of a sample run) read in depth through both providers,
  response by response. A survey above `--deep-max-responses` gets counts and checksums only, and is noted.
- **Incremental,** in the window, after the final `delta` and `reconcile`: what changed since the last full verify
  (changed surveys in full, new responses by count, deletions) and the small tables in full; the history of an
  unchanged survey is not listed again. A full recount of every response cannot fit the hour: the old store cannot
  count rows without reading them, and one survey holds about two thirds of them.

People are compared as `reconcile` keeps them: an account the migration did not create (an administrator, an account
made at sign-in) is noted, not a difference; so is a named person the copy could not write because the target holds
their email or sign-in. Of a profile somebody has used, only what the migration owns is compared (id, email, name,
block flag, the surveyjs.io sign-in). A stored private-question list that keeps a name only since-deleted responses
used is accepted and noted (it hides more, never less).

Two changes only the full verify sees: a delete-all of a survey's responses whose best-effort audit event is missing
(`reconcile` and the incremental verify find deletions by their copies and that event), and a key changed on the site
without a change time (`delta` reads by change time; `copy` writes every key again; both verifies compare every key).

Both modes flag what the copy does not take (point 9).

### 7. The sample

An account is in when a hash of its id falls below the share, or it is listed in `--include`, so every run picks the
same set. The closure: the account's personal surveys; every project it is a member of, with the project's surveys and
members; profiles of everyone the included data names. It is not transitive: a member's own personal surveys are not
pulled in. Members are the copy's own (point 5): only an admin or user role makes one, and a survey of a project the
copy skips as member-less is in the sample when it moves to a sample account. The keys of everyone the sample names are
copied with their profiles, people outside the sample included (a member of a sampled project, a survey's creator), as
a full copy would hold them. `plan --sample` also writes the sample's survey ids and key hashes for the replay's filter
(ADR 0042); those hashes are the sample accounts' keys only.

### 8. The decisions on data

- **History:** the 20 newest entries per survey, by time then id ([ADR 0036](0036-history-snapshots-above-a-size-limit.md));
  a published snapshot only through its own time; `delta` deletes target entries beyond 20.
- **A survey's publish id** goes to `surveys.legacy_publish_id`.
- **Answers are copied as stored,** entities included ([ADR 0039](0039-bridge-public-actions.md)); rows one to one with
  client id and partial flag ([ADR 0038](0038-partial-responses.md)).
- **A `\u0000` inside a JSON string** becomes U+FFFD on both dialects and is reported by id. A BOM is removed. Text that
  is not a JSON object is reported and skipped.
- **Rows are read as the app reads them:** a response's id is the key the old service stored the row under (a row
  whose own id field differs is reported), and a response or event without a stored time is skipped and reported. A
  completion marker whose partial flag is not a Boolean is copied as complete and reported.
- **Deleted responses** keep the answers, client id, partial flag and respondent address as one JSON object, with the
  deletion time of the copy; a copy without one is kept at its storage time, and noted. Events keep their ids, types, times and payload text,
  without the respondent address older rows carry; the ids in the payload are lower-cased.
- **Local times** written without a zone (survey created, project and member times) are read as UTC.
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

The time zone and clock questions are settled (see "Changed 2026-11-26", delta and reconcile).

- **The real column list of the old SQL tables** (run `pnpm inspect:legacy-schema`, read only, again).
- **Read-only credentials:** a read-only SQL login; the storage accounts and file shares with read and list only.
- **Can the site clear a user's access key?** `delta` removes the stored key when the source holds none (see "Changed
  2026-11-26"); whether that can happen is not confirmed.

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
  with each daily `delta`. The daily runs' phase durations are the window's estimate: the old store answers a filter by
  change time with a full scan on its side, so those reads cost the same however little changed.
- A `verify` that passes means no known difference as of the marks. Pending items are the next `delta`'s work, and the
  run order in Operations makes the last `delta` come after the freeze.
- Migration `0012` adds `migration_state`; nothing else in the schema changes.
- Open: the two inputs of point 11.

## Changed 2026-11-26

A correctness review of the tool found records the copy took differently from the old service or the app, ways a
misconfigured source could make it copy nothing or delete data, changes `delta` and `reconcile` missed, ways `verify`
reported green while the target differed or red for nothing, and a rule for public answers that was too open. Each is
fixed and recorded above in its point; the changes are kept here, by area.

### Copy and mapping

- **Point 2, another sample:** the guard looked at checkpoints, so a sample run stopped before its first checkpoint (its
  profiles, keys, projects and some surveys already written) let another sample through. A copy now records its sample
  before its first write of any kind, and the record decides; a full copy's record is "none", not missing.
- **Point 3, files:** editor asset links through the old API's `/private/v1/Surveys/files` route are found too, as are
  links in any letter case and with `name` anywhere in the query string.
- **Point 5, members:** a member's update time is the latest change time of its rows, as the mapping says, not the
  latest join or role-change time (a row without one: its join time, then the epoch).
- **Point 7, the sample:** it took any member row as membership, whatever its role, while the copy keeps only admin
  and user rows; both now use the copy's rule. The copy keeps copying the keys of named people outside the sample, now
  written down.
- **Point 8, rows:** responses took their id from a field of the row rather than its key, and a row without a time got
  the change time instead of being skipped; deletion copies and events did the same. Events kept the respondent
  address of older rows and upper-case ids in their payload. Completion markers with a flag of another type were not
  reported. Each is now as point 8 says, and the report counts the skipped and re-keyed rows.

### The published snapshot

- **Point 8, history:** the published snapshot was never read, so it was never copied and `verify` agreed. It is now
  an entry at its own time (its last change), by nobody, kept only when that time puts it among the 20 newest; `delta`
  takes one changed after the marks, and both `verify` history checks expect it.

### Source safety and the command line

- **Every store answers, or the command refuses.** Opening a remote source first checks that both file shares can be
  listed, and opening any source that the containers and the event table every source holds exist and the results
  account's tables can be listed; a store that does not answer is named and the command refuses (exit 2) before
  anything is written. A share the credentials could not read used to read as "no file": the copy took none and
  `verify` agreed. The share reader's warnings are printed, no longer muted. The local replica has no file service: its
  shares are not checked.
- **A missing store is an error, not "empty".** A container or table that answers "not found" fails the run for every
  command, except the stores a source may lack because they are made on first use: a survey's response, deletion-copy
  and completion tables, the app's own token table, its file and view containers, and the published-snapshot
  container. An empty listing of the wrong account would have made `reconcile` remove what the copy took.
- **The source is the copy's.** `--source` settings come from the file only: the environment's are not used (in the
  hosted image they are the app's read-write ones). Every command but `wipe` prints the source it opened by names only
  (the SQL server and database, the two storage accounts). `copy` records those names in the target; `verify`, `delta`
  and `reconcile` refuse (exit 2) another source, and a later `copy` does too. A target copied before this change has
  no record: its next run records its source with a printed note rather than refusing, so the earlier test targets
  keep working; a mismatch is refused once one is stored.
- **`verify --no-pending`:** a pending item fails the run (exit 1). The window's `verify` uses it: after the freeze
  nothing may be pending, so "green with pending" no longer passes as "go". The summary line gives the pending count.
  The marks are taken a margin (5 minutes) back of the source's clocks, so the final `delta` must start at least that
  margin, plus any storage clock skew, after the freeze: otherwise the live service's last writes before the freeze
  count as after the marks and fail the run. A run that fails on pending items only prints the marks' times and this
  rule.
- **`wipe` refuses a target that shows use** (a user who signed in, or a sign-in other than the migrated surveyjs.io
  one) unless `--even-if-used` is given, and a target whose settings name no database, so `--confirm ""` cannot match
  it. After the cutover the target is production.
- **`migrate-hosted` without the tool:** an image without `server/src/migrate` refuses the command (exit 2) whatever
  `APP_EDITION` says, rather than failing on the missing module.

### Delta and reconcile

- **Completion markers of deleted responses.** The old app deletes a response's completion marker with it, which leaves
  no change time, and `reconcile` compared markers only after a delete-all. It now compares the marker keys with the
  source for every survey with a deletion copy since its last run (every survey with `--full`), and removes those the
  source lacks; a stale marker would answer "already completed" after the cutover.
- **A survey that enters through `delta`** (one newly in a sample, or one the copy skipped and that was corrected) was
  copied whole, but its saved views, Studio's own files and, in a sample, its events were read by change time only, so
  what predated the marks was lost. They are now taken whatever their time: the views by the survey's prefix, the files
  from the file listing `delta` reads anyway, the events by one read of the whole log (a full copy took them all). Such a
  survey is recorded in the target before it is copied and forgotten after the files phase, so a `delta` that stops
  after copying it leaves them to the next one.
- **The interim private list.** When `delta` or `reconcile` rewrites a copied survey, the list stored until its new
  responses are read is now computed with the checkpoint's answer names too, so an answer only responses carry is
  private from the first write under a new layout, not only once the run finishes the survey.
- **A cleared access key.** `delta` wrote a changed person again but only ever added keys; it now removes the stored key
  of every person it writes whose source row holds none. Whether the site can clear a key is not confirmed; a key the
  target kept would stay valid after the cutover.
- **A response posted again after its deletion.** `reconcile` deleted every id a deletion copy named. An
  `Idempotency-Key` gives a response the same id again, so it now reads each such id in the source first: one the
  source holds again stays, and is copied again (through the privacy guard) if the target lacks it.
- **A survey `reconcile` removes** loses its checkpoint too, so if it comes back a later `copy` copies it rather than
  skipping it as copied.
- **Point 11, clocks (product owner, 2026-11-26):** the old stores set the change times themselves (the SQL database,
  the storage service), not the servers that write to them: one clock per store, which the marks already follow. The
  two questions on the old servers' time zone and on the change-time columns' clock are no longer inputs; local times
  stay read as UTC. One assumption is left and guarded: `plan` and `copy` read, read only, the defaults of the SQL
  change-time columns and the SQL server's offset from UTC, and print them; `copy` refuses (exit 2) when a default takes
  the server's local time and the server is not on UTC.

### Verify as the go/no-go

- **Deletions after the marks are pending, by their dated traces.** The day-before full verify runs for hours while the
  old service is live, after that day's `delta` and `reconcile`; every deletion in that time was a difference. A target
  item the source lacks is now pending when the source holds a dated trace of its deletion after the marks: the
  survey-delete or delete-all event (the survey's record, rows, markers and the views and files of a deleted survey), a
  deletion copy (the response, and the completion marker of its client, which the old app deletes with it). The
  traces are judged by their storage times, the clock of the marks, not by the time they hold (their writer's).
- **What the old app deletes without a trace,** in a full verify only: a layout or permissions blob, a member, a
  project, a saved view or Studio's own file, and what follows from them (a survey moved off a project gone, a person
  no longer named). Such an item the source lacks is pending when the last `reconcile` ran after the marks: that
  `reconcile` compared the full key sets and kept the item, so it was deleted since. Without such a `reconcile` it
  stays a difference (one is due). Of a project that lost a member, only the members and the member count are
  pending; the rest of its record is compared.
- **The window stays strict.** Its verify is incremental and runs after the final `delta` and `reconcile`, with the
  old service frozen before the marks: no dated trace can come after them, the trace-less rule above does not apply
  to the incremental verify, and `--no-pending` fails any pending item. A deletion `reconcile` missed is red there:
  the incremental verify compares the members, projects and people in full, and the key sets `reconcile` compares
  (every layout, permissions record, saved view and Studio's own file the target holds of a copied survey must be in
  the source's listings: the same small listings `reconcile` reads, so about the cost of its first phases).
  An incremental verify after a `delta` with no `reconcile` after it is a difference (`reconcile`): deletions since
  the last `reconcile` are not applied.
- **The incremental verify sees a delete-all.** It read deletions only by their copies, and a delete-all writes none:
  green while the target served every deleted response. It now reads the delete-all events since the last full verify
  and counts those surveys' responses and completion markers, and counts the markers of every survey with a deletion
  copy since.
- **A full verify forgets the last green one when it starts,** so an incremental verify never builds on an older green
  run after a red one; it refuses without one. A full verify whose only remaining items are pending is green and
  becomes the baseline.
- **Smaller gaps.** A response deleted twice (a retried delete leaves two copies) counted twice against one target row.
  Keys were compared by their last four: a key changed to another with the same last four stayed green; each source
  key is now looked up by its hash, as the target's credentials do. The incremental private-question check fed the rule
  the target's own list; it now uses the checkpoint's answer names, as `delta` does. The deep walk compared only the
  responses runs fold into, so a partial save's value a later save overwrote never showed; it now also compares each
  run's rows, and a row changed after the marks makes only its own run pending, not every run of its client.
- **A deletion copy without a time,** which the copy-fidelity change made the copy skip, is kept instead, deleted at
  its storage time, and noted (`deleted_copy_undated`): the deleted response's answers are kept nowhere else (point 8).
  `copy`, `delta`, `reconcile` and `verify` take it alike.

### The privacy rule

Point 4 took the union of the two settings. The old public results did not: with a column layout listing columns and a
permissions setting, only the answers the permissions marked public that the layout also lists were public, and
everything else was hidden. The union kept some of those public. Decided by the product owner: match the old public
results exactly (point 4 now says so). Example: a customer-feedback survey has the questions q1 and q2; its layout lists
the response time, q1 and q2, all shown; its permissions, saved before q2 was added, mark q1 public. The old public
results showed q1 only. The union kept q2 and the response time public too; the tool now keeps them private, and so
would an answer only some responses hold.

The rule applies to every permissions list, including those Studio wrote, which list only the private questions: with a
layout listing columns, such a survey has no public answer, which is what the old public API answers for it today. Each
survey whose public results are on and end with no public answer under this case is reported
(`public_results_no_public_answer`, the survey id only), so the operator can tell its owner. The rule is one function
of the column-layout package, shared by `copy`, `delta`, `reconcile` and `verify`, so `verify` cannot disagree with
what the copy writes. Without a layout, a permissions list still hides its private entries, though the old public
results then hid nothing: stricter, as before. The report applies to this case (a layout listing columns and a
permissions list) only, and can over-report: it cannot tell a list Studio wrote from a list the owner set.

Malformed permission lists are read more strictly than the old service read them: an `isPublic` that is not a Boolean
(the text "true", say), and a name with both a true and a false entry, make the answer private. The old service
would have accepted such a list; failing closed costs at most an answer that stays hidden until the owner publishes it
again.

Studio on the old stores applies the same function since 2026-11-26 and now saves the permissions in the old service's
full form, so a list Studio writes from then on keeps the owner's public questions public ([ADR 0016](0016-results-details-exports-and-public-results.md#changed-2026-11-26-public-results-on-the-old-stores)).
Lists written before stay as described above.
