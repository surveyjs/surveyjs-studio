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

## Consequences

- The legacy site and the new application can write to the same stores. Surveys created by one show
  in the list of the other.
- A step that adds a write extends `writes.ts`; the reviewer has one file to read.
- A survey created without a definition has no blobs, so reading its definition gives `{}`.
- An orphan blob can remain after a failed create. It is invisible and small; nothing cleans it up.
- The audit table can miss a `SURVEY_CREATE` row for a survey that exists. No reader depends on it.
- A name longer than 200 characters is refused at the API, not only by the store.
