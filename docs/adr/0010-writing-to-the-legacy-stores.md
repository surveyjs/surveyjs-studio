# 10. Writing to the legacy stores

Date: 2026-10-15

## Status

Accepted

## Context

Until Step 4 the `azure-legacy` provider only read the live surveyjs.io stores, and ESLint forbade
every write call in its folder. Creating a survey is the first write. The stores are shared with
the current site, which keeps running during the transition, so a write must leave data that the
legacy code reads without trouble
([layout, section 5.3](../architecture/legacy-data-layout.md#53-what-a-writer-must-do-so-legacy-readers-see-a-change)).

## Decision

- **One file writes.** Every write call and every SQL write text lives in
  `server/src/providers/azure-legacy/writes.ts`. `eslint.config.js` keeps the read-only rule for the
  rest of the folder and lists that one file in the rule block's `ignores`. A later step that needs
  another write adds it to `writes.ts` and extends this ADR, not a new file.
- **Exactly the legacy column set.** The `Surveys` row is inserted with `id`, `name`, `userid`,
  `creatorid`, `postid`, `resultid`, `createdat` and `timestamp`. Every other column stays `NULL`,
  as the legacy create leaves it. `userid` is the user id (personal) or the project id. Parameters
  are typed (`UniqueIdentifier`, `NVarChar(200)`, `DateTime`).
- **The id is checked first.** `createSurvey` first looks for a survey with that id (one `SELECT`).
  A duplicate is refused before anything is written, because the definition blobs are named by the
  survey id: an orphan blob of a duplicate attempt would otherwise be read as the definition of the
  existing survey. The primary key of the `INSERT` still guards against a race.
- **Write order: blobs, then the row, then the audit row.**
  1. When a definition is given: append blobs `surveyjson/{id}` and `surveytext/{id}` with the same
     JSON text, and `surveyjsonhistory/{id}/{newGuid}` (the legacy definition save also writes a
     history point). Existing blobs are never replaced. Without a definition nothing is written
     (the legacy create writes no blob either).
  2. The `Surveys` row.
  3. The `SURVEY_CREATE` audit row in table `surveys`: `PartitionKey` `*`, a new GUID as `RowKey`,
     and the properties of
     [layout, section 3.5](../architecture/legacy-data-layout.md#35-survey-event-log-azure-table-surveys).
     The table is created if it is missing.

  The reason for the order: a failure before the row leaves only orphan blobs that no reader finds,
  never a visible survey without its definition. The row is what makes the survey exist.

- **The audit row is best effort.** Legacy readers use the SQL and blob projections only
  (layout, section 5), so a failed audit write is logged as a warning with the survey id and the
  create still succeeds. Failing the whole create after the row exists would leave a stored survey
  and an error answer.
- **Errors carry no content.** A failed write rejects with `LegacyStoreError`
  (`providers/azure-legacy/errors.ts`, also exported from the provider). Its message reads
  "Legacy store `<operation>` failed" plus driver error codes (a SQL error number, an HTTP status).
  It never holds a connection string, a driver message or row content, and the same goes for log
  lines.
- **The name must fit.** `SurveyName.maxLength` in the contract is 200 (it was 256), because
  `Surveys.name` is `nvarchar(200)`: a longer name could not be stored by this provider, or by any
  port that keeps the legacy database. `Survey.name` in responses has no `minLength` (a legacy
  `NULL` name reads as `""`). JSON Schema counts characters, the column counts UTF-16 code units,
  so the survey service also answers `422` at `/name` for a name longer than 200 UTF-16 code units,
  and the writer refuses such a name instead of cutting it.
- **Tests write to the local replica only.** Write tests use the replica configuration and the
  loader's endpoint guard, which refuses any endpoint that is not local. See
  [ADR 0006](0006-legacy-replica.md).

## Step 5: update, clone and delete

Step 5 adds three writes to the same file, under the same rules (one file, legacy columns only, typed
parameters, ids checked as GUIDs first, errors without content). Reasons for the product rulings behind
them are in [ADR 0011](0011-survey-actions.md).

### Update

`writeSurveyChanges(targets, id, changes)` sends **one** parameterised
`UPDATE Surveys SET <changed columns>, [timestamp] = @timestamp WHERE id = @id`, with only the columns
that the changes name. All fields of a request are applied by this one statement, so a combined change
is atomic.

| Change                       | Columns (SQL type)                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `name`                       | `name` (`NVarChar(200)`)                                                             |
| `move`                       | `userid` (project id, or the user id for Personal), `creatorid` (`UniqueIdentifier`) |
| `published`                  | `ispublished` (`TinyInt`, 1 or 0)                                                    |
| `archived`                   | `isarchived` (`TinyInt`, 1 or 0)                                                     |
| `settings.publicResults`     | `allowaccessresult` (`TinyInt`, 1 or 0)                                              |
| `settings.storeRespondentIp` | `storeipaddress` (`VarChar(200)`, `"1"` or `"0"`)                                    |
| always                       | `[timestamp]` (`DateTime`, the request's `updatedAt`)                                |

Zero rows affected means no such survey (the provider answers `null`). A patch that changes no column
(for example `{ "settings": {} }`) still rewrites `timestamp`, as every legacy action does.

The audit rows follow, **best effort** (each in its own `try`; a failure is a warning with the survey id
and the event type). They are written to table `surveys` with `PartitionKey` `*`, a new GUID as `RowKey`
and `id`, `happendat` = `updatedAt` and `surveyid`, one per change present, in this order:

| Change                       | `type`                                      | Payload                            |
| ---------------------------- | ------------------------------------------- | ---------------------------------- |
| `name`                       | `SURVEY_UPDATE`                             | `name` (`Edm.String`)              |
| `move`                       | `SURVEY_TRANSFER`                           | `userid`, `creatorid` (`Edm.Guid`) |
| `published`                  | `SURVEY_PUBLISHED`                          | `ispublished` (`Edm.Boolean`)      |
| `archived`                   | `SURVEY_ARCHIVE` (true) or `SURVEY_RESTORE` | none                               |
| `settings.publicResults`     | `SURVEY_ACCESSRESUTL` (sic)                 | `grantaccess` (`Edm.Boolean`)      |
| `settings.storeRespondentIp` | `SURVEY_POSTRESUTL` (sic)                   | `storeipaddress` (`Edm.Boolean`)   |

The two misspelt type codes are what the legacy code writes; changing them would make the log
inconsistent. A move changes `creatorid` to the acting user, as legacy does (ADR 0011, R5). The legacy
code deletes and rewrites the row for a move; one `UPDATE` gives the same stored result.

### Clone

`writeClonedSurvey(targets, sourceId, copy)` first reads the source row's raw `theme` and the raw
`surveyjson/{sourceId}` blob (a missing blob means none). With no source row it returns `null` and
writes nothing. Then it runs the create sequence above (blobs, then the row, then `SURVEY_CREATE`),
with the definition **text copied unchanged** into `surveyjson`, `surveytext` and one
`surveyjsonhistory/{copyId}/{newGuid}`. A source without a definition blob gives a copy without blobs.
When the source theme is not empty it then runs
`UPDATE Surveys SET theme = @theme WHERE id = @copyId` (`VarChar(max)`, text unchanged, `timestamp`
untouched) and writes a best-effort `SURVEY_THEME_CHANGE` row with `theme`. The extra empty
`SURVEY_UPDATE` row of the legacy clone is not written.

The theme `UPDATE` is **not** best effort: if it fails after the row was inserted, the clone fails
(`500`) and leaves a copy without its theme. There is no rollback. A compensating delete of the copy is
the natural fix if this ever matters.

### Delete

`writeSurveyDeletion(targets, survey, deletedAt)` deletes **children first**, and each step accepts
"not found" (a missing child is fine, so the call can be repeated). Any other error fails the call.

1. Results-account tables `post{postId}`, `SurveyCompletion{surveyId}` and `postdelete{postId}` (ids
   without dashes). `LegacyWriteTargets` gained `resultTables` for them.
2. Surveys-account blobs: `surveyjson/{id}`, `surveytext/{id}`, every blob under
   `surveyjsonhistory/{id}/`, and the four results-layout blobs named `{surveyId}` in the containers
   `surveyresulttablestate`, `surveyresultsummarystate`, `surveyresultpermissions` and
   `surveyresultcolumns` ([layout, section 3.10](../architecture/legacy-data-layout.md#310-results-layouts-the-only-saved-ui-state)).
   Legacy leaves the layout blobs behind; a deleted survey should leave nothing.
3. `DELETE FROM Surveys WHERE id = @id`. Zero rows returns `false`.
4. The `SURVEY_DELETE` audit row (no payload), best effort. Its `happendat` is `deletedAt`, which the
   provider takes from its own clock (`now`), so tests and the server share one time source.

The record goes last, so a failure in step 1 or 2 leaves a survey that is still visible (it is archived,
because only archived surveys can be deleted) and can be deleted again.

### Consequences of Step 5

- A failed delete can leave some children removed and the survey visible. Deleting again finishes it.
- A failed theme `UPDATE` in a clone leaves a copy without its theme (see above).
- A survey row that cannot be mapped (a NULL `postid` or `userid`) is invisible to the API and cannot
  be deleted through it.
- Files are not deleted: no file store exists yet. Step 7 adds them to the cascade.

## Step 6: definition and theme saves

Step 6 adds two writes to `writes.ts` under the same rules. The rulings behind them (versions, the
compare-and-set, history metadata) are in [ADR 0012](0012-editor-content-and-history.md). A save
replaces the text of a document that already exists, so unlike the create it needs a condition.

### Save definition

`writeDefinitionSave(targets, id, text, { blobVersion, userId, savedAt })` runs in this order:

1. **Existence check** (`SELECT 1 ... WHERE id`). An unknown survey is `not-found` before any blob is
   written, so a save for a missing survey leaves nothing behind.
2. **`surveyjson/{id}`** is replaced (Put Blob, then appends of at most 4 MiB) with
   `ifMatch: "<blobVersion>"`, or `ifNoneMatch: "*"` when the version is `"none"` (no blob yet). A storage
   `412` (condition not met) or `409` (blob already exists) is a **conflict**: the call returns at once and
   nothing else is written. A version that is empty or contains `"` is a conflict without a call. Each
   append is conditioned on the ETag of the write before it, so if another writer replaces the blob between
   the Put Blob and an append, the append fails and two texts never share a blob.
3. **`surveytext/{id}`** is replaced with the same text (no condition).
4. **A new history point** `surveyjsonhistory/{id}/{newGuid}` with the same text and the blob metadata
   `userid` (lower-case GUID of the saving user) and `savedat` (ISO 8601 UTC with milliseconds).
5. **`UPDATE Surveys SET [timestamp] = @timestamp WHERE id = @id`.** Zero rows is `not-found`; the blobs stay,
   which is harmless because the survey is gone.
6. **`SURVEY_UPDATE`** audit row without a payload, best effort.

It returns the version for the next save: the ETag of the `surveyjson` blob after its last append, without
quotes. The blob is replaced as a whole, as in legacy, and a replacement is **not atomic**: a failure after
the Put Blob can leave `surveyjson` empty or partial (it then reads as `{}`), and the caller gets
a `LegacyStoreError` and can save again.

### Save theme

`writeThemeSave(targets, id, text, { expectedRaw, savedAt })` is one statement:

```sql
UPDATE Surveys SET theme = @theme, [timestamp] = @timestamp
OUTPUT inserted.theme
WHERE id = @id
  AND ISNULL(theme, '') COLLATE Latin1_General_BIN2 = @expected
  AND DATALENGTH(ISNULL(theme, '')) = DATALENGTH(@expected)
```

`theme` and `expected` are `VarChar(max)`, `timestamp` is `DateTime`. `@expected` is the raw column text whose
hash matched the version the client sent (the provider reads it first and compares the hash). The binary
collation makes the comparison exact, and `DATALENGTH` makes it see trailing spaces. Zero rows are
re-checked: the survey is gone (`not-found`) or the text changed (`conflict`). The version returned to the
client is computed from the `OUTPUT` text, because a `varchar` column can change non-ASCII characters.

The `SURVEY_THEME_CHANGE` audit row follows, best effort, with `theme`; when the text is longer than 32,000
UTF-16 code units it is written **without** `theme` (the 64 KiB limit of an Azure Table string).

### Create and clone

The history point that create and clone already write now carries the metadata `userid` (the creator) and
`savedat` (the creation time). Nothing else changes.

### Reads

Reads stay in `index.ts`: `getDefinition` uses one `download()` for the text and the ETag,
`getTheme` hashes the raw column text, `listHistory` lists `surveyjsonhistory` with the prefix `{id}/` and
metadata, and `getHistorySnapshot` downloads one point.

### Consequences of Step 6

- A conflict is detected by the store (blob `ifMatch`, SQL `WHERE`), not before it, so there is no window
  for a lost update between two new-application writers. The legacy editor sends no condition, so it can
  still overwrite a save, and the new one then sees a conflict at its next save.
- A save by the legacy editor in parallel rewrites the alphabetically first history point of the survey,
  which then has no `userid`.
- A non-conflict failure after the Put Blob can leave `surveyjson` empty (see above).
- The preview image (`my-surveys-survey-preview-image-{id}` in the `surveyfiles` share) that legacy deletes
  on a save is not deleted, because there is no file store yet (Step 7).
- `ESLint` lists "Step 6: definition and theme saves" in the comment of the rule block's `ignores`;
  `writes.ts` is still the only file that writes.

## Step 8: result rows and completion markers

Step 8 adds the writes that store a respondent's answers, under the same rules: all of them are in
`writes.ts`, with the ESLint `ignores` comment extended by "Step 8: result rows and completion markers". The
rulings behind them (idempotent ids, the one-response rule, the size cap) are in
[ADR 0014](0014-run-page-and-response-collection.md). The format is
[layout, 3.6 and 3.7](../architecture/legacy-data-layout.md#36-results-azure-tables-postpostid).

### Write a response

`writeResponse(targets, survey, response, publishId)` runs in this order:

1. **Checks.** `survey.id`, `survey.postId` and `response.id` must be GUIDs. `result = JSON.stringify(data)`;
   when it is longer than **32,768 UTF-16 code units** the function throws `ResponseTooLargeError(length, max)`
   before any call. The error carries two numbers, never the content. (One Azure Table string holds 64 KiB; the
   same precedent as the 32,000 of the audit `theme`, but exact.)
2. **The row** in `post{postId}` (the post id without dashes, lower case; **not** the survey id): `PartitionKey`
   `*`, `RowKey` the response id, `id` `Edm.Guid`, `type` `SURVEY_POSTRESUTL`, `happendat` `Edm.DateTime` (the
   response's `submittedAt`), `surveyid` `Edm.Guid` (a random GUID: the legacy post path never sets it, layout
   3.6), `postid` `Edm.Guid` (the survey's post id), `result` (`Edm.String`), `clientid` (`Edm.String`, only when
   given) and `ipaddress` (`Edm.String`, only when given). **`ispartialcompleted` is never written** (partial
   responses are ignored, S6) and no other property is. `createEntity`; a `409` means the id exists: the row is
   left as it is and the outcome is `exists`. A `404` means the table is missing: `createTable()` (a `409`
   from a race is fine) and `createEntity` once more.
3. **The marker**, when a `clientId` is given, also for `exists`: `upsertEntity` with `Replace` into
   `SurveyCompletion{surveyId}` (the survey id without dashes, lower case) at the row key `clientId`, with
   `ispartialcompleted` `Edm.Boolean` false and `publishid` `Edm.String` only when the survey has one. The same
   `404` then `createTable()` then retry. At the store level, `appendResponse` with an id that
   already exists writes the marker again, which would repair a marker lost between the row and the marker
   (for example when two identical requests race). The HTTP service does not reach this path for a keyed
   retry: `submit` answers from `hasResponse` before it calls `appendResponse`.

Failures are `LegacyStoreError("response write")` and `LegacyStoreError("completion marker write")`, with the
operation and the driver's codes only.

### Rulings

- **Direct writes.** The rows are written to the table, not through the legacy `POST post`, so the legacy HTML
  cleaner does not run. This is condition 3 of [ADR 0005](0005-respondent-files-as-urls.md). New rows hold the
  text as typed; old rows may hold entities (layout, 3.6). The readers treat `result` as an opaque JSON text, so
  both read.
- **Deterministic ids.** The row key is the response id, which the service derives from the `Idempotency-Key`
  (a version 5 UUID) or makes at random. Insert-if-absent therefore makes a retry idempotent with no extra
  store. The legacy write was an upsert at the row key; this one is an insert, so an existing row is never
  changed.
- **`publishid` is read, not written.** The marker carries the survey's `Surveys.publishid` as legacy does. It is
  not in `SurveyRecord`, so the store reads it with one `SELECT publishid FROM Surveys WHERE id = @id`
  (`UniqueIdentifier`, lower-cased; `NULL` or no row gives no property) for each submission that carries a
  `clientId`. That select is in `index.ts` with the other reads; the write only receives the value.
- **No audit row.** Layout 5.2: for a post, "the row is the event". `Surveys.timestamp` is not touched either (a
  post never moved it).
- **The cap.** 32,768 UTF-16 code units for `result`, refused as a typed error before any write, answered with
  `413` by the service. It is checked in the writes test and not in conformance, because the `memory` provider
  has no such cap.
- **The target.** `LegacyWriteTargets` gains `resultTable(name)`, a table client of the results account built
  in `index.ts` with `TableClient.fromConnectionString(...)` (and `allowInsecureConnection` only for a local
  emulator string; a throw is wrapped like `storageClients`, because the SDK message may quote the string).
  The `resultTables` service client stays for the delete.
- **Respondent files** use the Step 7 container and blob layout unchanged: the metadata `kind` is `response`.
  `isFileKind` in the mapping accepts both kinds.
- **A response row the mapping cannot read** (`result` is not a JSON object) is skipped and reported by id, as
  other unmappable rows are.

### Consequences of Step 8

- A response and its marker are two writes. A failure between them leaves a row without a marker. A retry with
  the same `Idempotency-Key` does **not** repair it: the service finds the response with `hasResponse` and
  writes nothing. Only the next response of that client writes the marker. (The store itself writes the marker
  for `exists`, which matters only for a race between two identical requests.)
- The first response of a survey creates two tables on the fly (`post{postId}` and, with a client id,
  `SurveyCompletion{surveyId}`). The credentials of a production deployment need the right to create tables.
- A table is deleted with its survey (`writeSurveyDeletion` already drops both).
- A response of more than 32,768 characters is refused with `413` on this provider and accepted by `memory`.

## Step 9: results layouts

Step 9 adds the writes of the saved results layouts (the Summary and the Table of a user and a survey), under the
same rules: they are in `writes.ts`, with the ESLint `ignores` comment extended by "Step 9: results layouts
(views) in a container of our own". The rulings behind them (per user, the legacy fallback, no side effects) are
in [ADR 0015](0015-results-summary-table-and-views.md). The format is
[layout, 3.10](../architecture/legacy-data-layout.md#310-results-layouts-the-only-saved-ui-state).

### Where a layout is stored

- **A new container.** `my-surveys-views` in the surveys account (`VIEWS_CONTAINER`), private, created on the
  first save: a `404` on the upload runs `createIfNotExists()` and the upload once more, as `uploadNewFile` does.
  Legacy code never reads it (layout 5.3).
- **One block blob for each user, survey and view**: `{surveyId}/{userId}/{view}`, every part in lower case, with
  `view` `summary` or `table`. The content is `JSON.stringify(state)` in UTF-8, content type `application/json`.
  A save is an unconditional overwrite: the latest save wins, and there is no ETag, because a layout has no
  conflict to detect.
- **The reset marker is the same blob with zero bytes.** A reset overwrites the user's blob with an empty one
  instead of deleting it. A blob of zero bytes means "reset"; any other blob holds a state. So a view is always
  one blob, a save and a reset are single overwrites, and there is no second name to keep in step. The reader
  answers "no layout" for the marker and does not look at the legacy blob (ADR 0015, R4).
- **The legacy layout blobs are never written or deleted by a view** (`surveyresultsummarystate/{id}`,
  `surveyresulttablestate/{id}`). They are read as the fallback when a user has no blob of their own.

### The writes

- `writeView(blobs, surveyId, userId, view, state)`: the overwrite above. The ids go through `checkedId` (a
  non-GUID is refused before any call). A failure is `LegacyStoreError("view save")`.
- `writeViewReset(blobs, surveyId, userId, view)`: the zero-byte overwrite. A failure is
  `LegacyStoreError("view reset")`.
- **The survey deletion** (`writeSurveyDeletion`, step 2) also lists and deletes every blob under
  `my-surveys-views/{surveyId}/` (a missing container holds none). The four legacy layout blobs are deleted as
  before.
- **A clone does not copy layouts**, and copying nothing needs no write.
- **No audit row, no `Surveys.timestamp` change, no history entry.** Moving a survey to the top of the list on
  every chart drag would surprise users. The legacy save did bump `timestamp` and wrote the layout into the audit
  row; this one does neither (layout 5.3 notes the departure).
- Errors and logs carry the operation name, the driver's codes and ids, never a connection string or the
  layout's content. A layout text that is not a JSON object is ignored by the reader with a warning that
  carries the ids only.

### Outside the read-only folder

The read side (`providers/azure-legacy/views.ts`, `listResponsePage` in `results.ts`) lives in the folder the
ESLint rule keeps read only, and calls the two functions above for the writes. Two more things touch the
stores and sit **outside** that folder: the fixture loader (`server/src/legacy/load-fixtures.ts`), which now
writes result rows in **batches** (table transactions of at most 100 actions, the deletes and the creates in
separate transactions, because a transaction takes one action for each entity) and **clears the views
container** on every load, so a layout saved by hand in a demo does not leak into the test runs. Like the rest of
the loader, it refuses an endpoint that is not local.

### Consequences of Step 9

- A user's first save creates the container. The credentials of a production deployment need the right to create
  containers in the surveys account (as for `my-surveys-files`).
- A layout is at most as large as the request body limit (`LIMIT_MAX_RESPONSE_BYTES`, 1 MB by default); the
  service adds no limit of its own.
- A layout of a survey that is deleted by the legacy site is not deleted (legacy code does not know the
  container). It is invisible and small, as the orphan blobs of Step 4.
- A reset leaves a blob (zero bytes) behind until the survey is deleted.

## Step 10: deleting all results and the public-question list

Step 10 adds three writes, under the same rules: they are in `writes.ts`, with the ESLint `ignores` comment
extended by "Step 10: deleting all results and the public-question list". The rulings behind them (what is
deleted, the tables kept, the private list in the old blob) are in
[ADR 0016](0016-results-details-exports-and-public-results.md). The formats are
[layout, 3.10](../architecture/legacy-data-layout.md#310-results-layouts-the-only-saved-ui-state).

### The three writes

- **Delete all results** (`writeResultsDeletion(targets, survey, deletedAt)`). The ids go through `checkedId`. It
  lists every row of `post{postId}` and of `SurveyCompletion{surveyId}` (keys only, `select`) and deletes them in
  Table transactions of at most 100 rows (`TRANSACTION_ROWS`), one partition at a time, because a transaction
  holds one partition and one action for each row. A transaction that fails with `404` (a row was deleted
  meanwhile) is redone row by row, ignoring `404`. A missing table is fine. A failure is
  `LegacyStoreError("results delete")`.
- **The kind-limited file delete.** `writeSurveyFilesDeletion(blobs, container, surveyId, kind?)` deletes the blobs
  under `{surveyId}/` and, with a `kind`, only those whose metadata `kind` matches. The service calls it with
  `response` before the rows are deleted; the editor's assets stay. The survey deletion still passes no kind.
- **The public-question list** (`writePrivateQuestions(blobs, surveyId, names)`). It writes the append blob
  `surveyresultpermissions/{surveyId}` with the old JSON, `[{ "name": "…", "isPublic": false }]`, **one element for
  each private question** and none for public ones (`privateQuestionsToLegacy`). The blob is replaced as the other
  append blobs are (`replaceAppendBlob`); a `404` for the container runs `createIfNotExists()` and the write once
  more. A failure is `LegacyStoreError("public questions save")`.

### Rulings

- **Batched deletes, no dropped tables.** The old code dropped both tables. Azure then refuses to create a table of
  that name for about 40 seconds (`TableBeingDeleted`), so a response sent right after **Delete Results** would fail.
  Deleting the rows has no such window. The cost is a longer delete on a very large survey and the row keys held in
  memory while it runs. Done in Step 14 (fcf2f68): each listing page of keys is deleted before the next is read.
- **`postdelete{postId}` stays.** It holds copies of results deleted one by one, a feature that does not exist
  yet; delete all never wrote to it in the old code either.
- **The audit row.** After the rows are gone, a best-effort `SURVEY_DELETEALLRESULTS` row (survey id, the
  provider's clock) is appended to the `surveys` table, as the old delete wrote one. A failure of that row is a
  warning with ids only and the delete stays done. The row holds no answer. `Surveys.timestamp` and the
  history are not touched: a delete of results is not an edit of the survey.
- **The permissions blob format.** Read with the old defaults: one leading U+FEFF is removed; text that is not a
  JSON array is "no list" (a warning with ids only, every question public); of an array, only an object with a
  non-empty string `name` and `isPublic` equal to the boolean `false` is private, first occurrence only; a missing
  `isPublic`, `true`, `"false"` and non-objects are public. Written for the private names only, so the public
  entries of an older blob are dropped on the first save. For an old reader that reads a missing entry as public
  this means the same.
- **No audit row for the list.** A save of the list writes no event (the old layout save put the permissions
  into its `SURVEY_UPDATE` row). It leaves `timestamp` alone in the write; `updateSurvey` moves `updatedAt` as
  for any patch (Step 9 R7 precedent for the layouts).
- **The survey deletion** already removed `surveyresultpermissions/{surveyId}` as one of the four legacy layout
  blobs, so the list goes with its survey. A clone does not copy it.
- Errors and logs carry the operation name, the driver's codes and ids, never a connection string, an answer, a
  file name, a client id or an address.

### Consequences of Step 10

- **Delete Results** needs the right to delete table entities in the results account and blobs in the surveys
  account (as the survey deletion does).
- A deletion that fails part-way leaves part of the rows and markers; calling it again finishes it. The
  respondent files are deleted first, so after a failure the remaining rows may point at deleted files.
- The permissions blob written here is read by the old site as a list of private columns; an old reader that
  expected a public entry for every question treats a missing entry as public, so it is safe.
- Replacing the append blob creates an empty blob before it appends the text, so a read can find it empty (or
  find it so after a failed append). The read side fails closed: it reads once more and then rejects, and never
  takes an unreadable list for "every question public" (ADR 0016, R1). `updateSurvey` writes the list only after
  the survey update succeeded.
- The web saves only the names a user changed, onto a fresh read of the list, so writers on different pages keep
  each other's changes; two saves at the very same moment can still race, and then the later write wins.

## Step 11: projects and members

Step 11 adds the six writes of projects and members, under the same rules: they are in `writes.ts`, with the
ESLint `ignores` comment extended by "Step 11: projects and members (Organizations and OrganizationUsers rows,
project deletion)". The rulings behind them (the owner, the last admin, the survey move) are in
[ADR 0017](0017-projects-and-members.md); the tables are
[layout, 3.12 and 3.13](../architecture/legacy-data-layout.md).

### The six writes

| Write                  | What it does                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `writeProjectCreation` | One transaction, two rows: `Organizations` (`ORGANIZATION_CREATE`) and the creator's `OrganizationUsers` row (`id` = the project id, role `admin`). No audit row                                                                                        |
| `writeProjectRename`   | One `UPDATE` of `name` and `timestamp`; `type` and `happendat` stay (legacy rewrites them)                                                                                                                                                              |
| `writeMemberAddition`  | A transaction: lock, refuse when the user already has a row, else insert a row (new id, `ORGANIZATION_JOIN`, role in lower case, no name)                                                                                                               |
| `writeMemberRole`      | A transaction: lock, decide with the last-admin rule, then `UPDATE` the role and `timestamp` of the user's rows **in place**. Legacy deletes the row and inserts a new one (new id, `ORGANIZATION_LEAVE`); the in-place update keeps the creator marker |
| `writeMemberRemoval`   | A transaction: lock, decide, then delete every row of the user in the project                                                                                                                                                                           |
| `writeProjectDeletion` | A transaction in the order below, then one best-effort `SURVEY_TRANSFER` row for each moved survey                                                                                                                                                      |

### Transactions and their lock order

These are the first SQL transactions in the repository. `inTransaction` runs the body one request at a time (a
transaction takes one request at a time), commits when the body says so, rolls back on every other path (a failing
rollback is ignored) and wraps the final error in `LegacyStoreError(operation)`.

- **Lock order.** Every membership and delete transaction first locks the project's `Organizations` row
  (`UPDLOCK, HOLDLOCK`), then reads and locks the project's `OrganizationUsers` rows, in this order every time. Writes to
  one project therefore run one after the other and cannot deadlock each other. The same lock makes the double
  add safe: the second adder waits, then finds the row and answers `already-member`. A missing project row means
  "no such project" and writes nothing.
- **Deadlock retry.** A transaction that SQL Server picks as a deadlock victim (error 1205) is run again, at
  most 3 attempts in all, after a short jittered wait (`attempt` times 20 to 60 ms), and each retry is logged
  with the operation and the attempt only (`isDeadlockVictim`, `withDeadlockRetry`). A failed commit is never
  retried, because its outcome is unknown, and no other error is. The bodies have no effect outside the
  transaction, so running them again is safe. The reason: the `OrganizationUsers` tables of the replica are tiny
  and are scanned, so locks taken by writes to different projects can still collide under parallel load. The
  implementer measured about 6 deadlock victims in 160 writes under parallel load (the conformance suite runs its files in parallel).
- **Delete order.** One transaction: (1) `UPDATE Surveys SET userid = @receiver, timestamp` for every survey whose
  `userid` is the project id, archived ones too, with `OUTPUT` of the id and the creator; (2) delete the
  project's `OrganizationUsers` rows; (3) delete the `Organizations` row. The surveys and the directory share one
  SQL database ([layout, 2.2](../architecture/legacy-data-layout.md)), so one transaction covers all three. Legacy
  does none of the first step and orphans the surveys.
- **`SURVEY_TRANSFER` rows.** After the commit, for each moved survey (sorted by id) one row goes to the
  `surveys` events table, as `appendEventBestEffort` writes it: `userid` is the receiver and `creatorid` is the
  survey's **unchanged** creator. When the creator is `NULL` the row leaves `creatorid` out (no legacy convention
  is known). A failed append is a warning with ids only and the delete stays done.
- **No audit rows for project writes.** Legacy writes none for create, rename, add, role change, remove or
  delete, and this application writes none either. Only the survey move of a delete leaves its
  `SURVEY_TRANSFER` rows.
- Errors and logs name the operation, the driver's codes and ids, never a project name, a display name or an
  email. Every id is checked to be a GUID before any SQL is built; the values go in as parameters.

### Consequences of Step 11

- The survey move of a project delete collects its ids with `OUTPUT … INTO` a table variable, because SQL Server
  refuses a bare `OUTPUT` on a table with enabled triggers and the production `Surveys` table may have some.
  (Step 14: production has none, checked on 2026-10-22 with `pnpm inspect:legacy-schema`; the `OUTPUT … INTO` stays,
  as it costs nothing and survives a trigger added later.)

- A role change no longer replaces the row, so the legacy site, which reads `role` only, shows the same
  result, and the project's `createdAt` and creator marker survive.
- A survey created or moved into a project can race a delete of that project on Azure: under `READ COMMITTED` a
  survey inserted while the delete runs would keep the deleted project id. The memory provider does both in one
  step. Open: carried to the hosted-migration track ([operations](../operations.md), the handover list).
- The `SURVEY_TRANSFER` rows are appended one after the other, so a slow audit table stretches the delete.
- SQL `datetime` rounds the `createdAt` of a new project to about 3 ms; the service answers the value it reads
  back, so one answer stays consistent, but memory and Azure differ in the last digit.

## Step 12: member erasure

Step 12 adds one write, `writeMemberErasure`, in `writes.ts` (the file header and the ESLint `ignores` comment
gain "Step 12: member erasure"). It is what `projects.eraseMember` does on Azure when an account is erased
([ADR 0018](0018-accounts-by-deployment-mode.md)). The `surveyjs-sql` user directory and the new reads
(`listMemberUserIds`, `listPersonalOwnerIds`, `missingUsers`, and the raw id reads erasure walks,
`listUserProjectIds` and `listSurveyIds`) are `SELECT`s in `index.ts`.

- **One transaction, the Step 11 lock order.** It locks the project's `Organizations` row first (`UPDLOCK,
HOLDLOCK`; no row means "no such project" and nothing is written), then reads and locks the project's
  `OrganizationUsers` rows with whether each user exists and the names `listMembers` shows. It decides with the
  pure rule `decideMemberErasure` and writes the decision: `remove` deletes every row of the user (orphan rows
  too); `promote` deletes them and sets every row of the successor to `admin` in place; `not-member` and
  `last-member` write nothing and roll back (the service deletes the project's surveys and the project itself in
  that case, with the Step 11 delete).
- **A project whose row is gone.** When the lock finds no `Organizations` row, the user's rows that still name that
  project (a dangling organization; the replica's foreign key forbids it, older production rows may hold it) are
  deleted in the same transaction and the answer is `remove`; without such rows it is `not-member` and nothing is
  written. Erasure must reach every row the reconciliation counts (Step 12 final review).
- **Surveys the mapping skips.** The survey delete (Step 5) now reads the row raw (`id`, `postid`) instead of through
  the mapping, so erasure can delete a survey with a NULL `postid` or `resultid`. A NULL `postid` names no
  `post…` or `postdelete…` table; the rest of the delete is unchanged.
- **The last-admin refusal does not apply.** The erased user has to leave, so a sole admin is removed and the
  next member is promoted. This is the one place where a project can lose its admin without the rule saying so.
- **No audit row**, as for every project write. Errors and logs carry the operation name (`member erase`), the
  driver's codes and ids only.
- **Foreign key.** On the replica `OrganizationUsers.userid` references `Users.id`, so the tests write member
  rows only for fixture users; orphan rows are tested on the memory provider ([testing](../testing.md)).

## Consequences

- The legacy site and the new application can write to the same stores. Surveys created by one show
  in the list of the other.
- A step that adds a write extends `writes.ts`; the reviewer has one file to read.
- A survey created without a definition has no blobs, so reading its definition gives `{}`.
- An orphan blob can remain after a failed create. It is invisible and small; nothing cleans it up.
- The audit table can miss a `SURVEY_CREATE` row for a survey that exists. No reader depends on it.
- A name longer than 200 characters is refused at the API, not only by the store.
