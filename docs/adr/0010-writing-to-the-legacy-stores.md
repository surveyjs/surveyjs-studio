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

## Consequences

- The legacy site and the new application can write to the same stores. Surveys created by one show
  in the list of the other.
- A step that adds a write extends `writes.ts`; the reviewer has one file to read.
- A survey created without a definition has no blobs, so reading its definition gives `{}`.
- An orphan blob can remain after a failed create. It is invisible and small; nothing cleans it up.
- The audit table can miss a `SURVEY_CREATE` row for a survey that exists. No reader depends on it.
- A name longer than 200 characters is refused at the API, not only by the store.
