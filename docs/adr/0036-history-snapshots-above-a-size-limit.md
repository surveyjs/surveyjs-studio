# ADR 0036: History snapshots above a size limit go to the byte store

Status: Accepted (hosted Step 1, 2026-11-18); **its decision is replaced** by
[the history limit of 2026-11-25](#changed-2026-11-25-at-most-n-history-entries-per-survey): the byte store for
snapshots is not built.

## Context

Every save of a survey adds a history entry with the whole definition as its snapshot
([ADR 0012](0012-editor-content-and-history.md)). In the SQL providers the snapshot is a JSON column of
`survey_history`, so the history lives in the database with everything else.

The production volumes measured in hosted Step 1 (kept private, plan-hosted.md rule 6) change the picture for the
hosted service:

- **The survey history is the largest store by far:** in the order of a terabyte of JSON in over ten million
  entries, as big as all respondent files together and over a hundred times the current definitions.
- Everything else that moves into the database (users, surveys, projects, responses, events) is in the order of tens
  of gigabytes.

With the snapshots in PostgreSQL the database is several times larger than its other data. That needs a server type
with a much bigger local disk or network-attached storage
([ADR 0033](0033-hosted-target-stores.md)), and every full backup to the other location, every point-in-time restore
and the backup taken before each deploy carries it. Yet the snapshots are written once, never changed, and read
rarely: the history list shows only the time and the author (`listSurveyHistory`), and one snapshot is read when a
user opens or restores that entry (`getSurveyHistoryEntry`).

The SQL providers already keep respondent files and editor assets as **metadata in the database, bytes in a byte
store** (`FILE_STORE=local|s3`, [ADR 0025](0025-file-storage-for-the-sql-providers.md)).

## Decision

**A history entry's row always stays in `survey_history`. Its snapshot stays in the row up to a size limit; above it,
the snapshot goes to the byte store.**

1. **One setting, `HISTORY_INLINE_MAX_BYTES`:** the largest snapshot, in bytes of its JSON text, kept in the row.
   - **Not set (the default): no limit.** Every snapshot stays in the row, as today. Existing self-hosted
     installations need no data migration, SQLite and the demo data work without a file store, and nothing changes
     for them.
   - **A number:** a larger snapshot goes to the byte store. `0` sends every snapshot there.
   - **The hosted service sets a small limit** (in the order of kilobytes), chosen from the size distribution of the
     history (hosted Step 8): small snapshots stay in the database, where they cost little and are read without a
     second request; object stores bill a small object as a minimum size, so moving them would cost more than they
     weigh.
   - The limit applies to new writes. Changing it moves nothing that is already stored.
2. **The row says where its snapshot is.** `snapshot` becomes nullable and a new `snapshot_key` names the object; a
   check constraint holds exactly one of the two. A reader needs no setting to read any entry.
3. **The same byte store as the files.** `FILE_STORE=local` or `s3` and its settings serve both. Snapshot keys have
   their own prefix, `history/{survey id}/{entry id}.json`, so they never collide with file keys and a survey's
   snapshots are one prefix. Setting a limit without a file store is a start-up error.
4. **Write order: the object first, then the row.** A save stores the snapshot object, then commits the definition
   and the history row in one transaction as today. When the transaction fails (a version conflict, a lost
   connection) the app deletes the object at once. Only a crash between the two leaves an object no row names: a
   weekly sweep in the app, active only when a limit is set, deletes objects under `history/` that no row names and
   that are older than a day (listing ten million keys is about ten thousand list requests). A row therefore never names a missing object. This is the reverse of the
   files' order ([ADR 0025](0025-file-storage-for-the-sql-providers.md)) because a snapshot, unlike an upload, has no
   reader before its row exists.
5. **Delete order: as the files.** Deleting a survey deletes its `history/{survey id}/` objects first, then the rows
   (`on delete cascade`). When the objects cannot be deleted the delete fails and is retried, as for files.
6. **Backups.** The rows are in the database's point-in-time restore; the objects in the bucket's versioning. A
   restore to a time before a survey was deleted needs that survey's objects back too, so **the bucket keeps old
   versions at least as long as the database's restore window** (hosted: 30 days for both, H25).
7. **What does not change:**
   - the provider interface (`listHistory`, `getHistorySnapshot`) and the public API: where a snapshot is stored is
     the provider's business;
   - the history order, ids, times and authors;
   - the memory provider and the Azure legacy provider, which keep their own history stores;
   - `surveyjs-studio backup`/`restore` for SQLite with local files, which already covers both.

### Why not the alternatives

| Option                                                  | Why not                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Every snapshot in PostgreSQL, on a bigger disk          | A much bigger server or network-attached storage, and backups, restores and the pre-deploy backup that carry a terabyte of rarely read JSON     |
| Every snapshot in the byte store                        | Self-hosted installations and SQLite would need a file store and a data migration for nothing; small snapshots cost more as objects than inline |
| A separate store just for history                       | A second set of settings and credentials for the same kind of data the byte store already holds                                                 |
| Compress snapshots in the database and keep them inline | PostgreSQL already compresses large JSON values (TOAST); even compressed, the history stays several times the rest of the database              |
| Keep fewer history entries                              | Spec-hosted moves every history entry with its id and time (H1); pruning is a product decision, not a storage one                               |

## Consequences

- **The hosted database stays in the order of tens of gigabytes,** so a dedicated-vCPU server with local NVMe in the
  smaller sizes fits it ([ADR 0033](0033-hosted-target-stores.md)), and backups and restores stay quick.
- **Object storage grows** by the history snapshots above the limit: in the order of a terabyte, at the store's
  per-TB price above the base fee.
- **Opening or restoring a large history entry** makes one more request, to the byte store. The history list does
  not.
- **The migration tool** (hosted Step 9) writes each migrated snapshot inline or as an object by the same rule, with
  the object written before its row, so a resumed `copy` is safe.
- **Hosted Step 8** adds the migration of `survey_history`, the setting, the sweep, the conformance cases (inline,
  object, the limit at its edge, a failed save, a survey delete with objects, a restore) and measures the size
  distribution that sets the hosted limit.
- **Self-hosting docs** describe the setting as an option for large installations; the default needs no action.

## Changed 2026-11-25: at most N history entries per survey

The SurveyJS team decided (2026-11-24) that a survey keeps its **20 newest history entries**, from the cutover on, and
that the migration copies at most the 20 newest of each survey. Bounded per survey, the history no longer needs the
byte store above; this replaces the Decision (points 1–4) and its sweep.

- **A setting, `HISTORY_MAX_ENTRIES`:** a positive integer; **not set (the default) keeps every entry**, so self-hosted
  installations are unchanged. The hosted server sets **20**.
- **Pruned on save.** Every write that adds a history entry (a save of the definition, a restore of an older entry)
  deletes, in the same transaction, the survey's entries beyond the newest N (by entry time, then id). Nothing prunes in
  the background; an installation that sets the limit later is pruned survey by survey at its next save.
- **SQL and memory providers.** The setting with `STORAGE_PROVIDER=azure-legacy` is a start-up error: today's server
  runs the `production` branch and keeps the legacy history as it is until the cutover.
- **The migration** (hosted Step 9) exports the 20 newest entries of each survey; a published snapshot is one of them
  only when its time places it among the 20 newest (nothing has served it since the old run page).
- **The measurement that sizes the database:** `pnpm inspect:legacy --stats` gains the bytes and count of the 20 newest
  history entries of each survey, summed over all surveys. Run once on production; the figures stay private
  (plan-hosted rule 6).
- **Unchanged from above:** the snapshot stays a JSON column of `survey_history`; there is no
  `HISTORY_INLINE_MAX_BYTES`, `snapshot_key` or sweep. Users see at most 20 entries from the cutover on; the migration
  announcement says so (hosted Step 11). [ADR 0033](0033-hosted-target-stores.md)'s volumes and window estimate shrink
  accordingly.
