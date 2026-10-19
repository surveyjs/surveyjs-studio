# Architecture

This page describes what is built now (Steps 1 to 6). The final design is in `spec.md`; the later steps
are listed at the end.

## Principles

- **The contract is the source of truth.** `contract/openapi.yaml` defines every route, parameter,
  body and error. The server builds its routes and validators from it, the web app takes its types
  from it, and the conformance suite checks servers against it.
- **Replaceable back end.** Anything that passes the conformance suite can replace the Node.js
  server. Storage sits behind provider interfaces.
- **Configuration from the environment.** Everything is read and validated at start-up.

## Packages

```mermaid
flowchart LR
  contract["contract<br/>openapi.yaml + generated types"]
  server["server<br/>Fastify"]
  web["web<br/>React + Vite"]
  conf["conformance-tests<br/>Vitest, HTTP only"]
  e2e["e2e<br/>Playwright"]
  contract -->|routes, validators, types| server
  contract -->|types| web
  contract -->|schemas| conf
  conf -.->|HTTP| server
  e2e -.->|browser| web
  web -.->|"/api (proxy)"| server
```

| Package             | Role                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `contract`          | The OpenAPI file, `openapiPath`, generated types (`paths`, `components`, `operations`), and `build:docs` for the API reference |
| `server`            | Reference back end                                                                                                             |
| `web`               | Front end                                                                                                                      |
| `conformance-tests` | Checks every response of a running server against the contract; can target any server                                          |
| `e2e`               | Starts the server and the built web app and drives them in three browsers                                                      |

## Server modules (`server/src`)

| File             | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`        | Loads configuration, creates providers, listens, shuts down on SIGINT and SIGTERM. A bad configuration prints every problem and exits with code 1                                                                                                                                                                                                                                                                                                   |
| `config.ts`      | `loadConfig(env)`: validates environment variables with zod, returns a frozen `AppConfig`, or throws `ConfigError` listing all problems                                                                                                                                                                                                                                                                                                             |
| `app.ts`         | `buildApp(config, providers)`: creates the Fastify instance, error handling, `/healthz`, `/readyz`, the API routes and (when enabled) `/api/docs`                                                                                                                                                                                                                                                                                                   |
| `contract.ts`    | Reads the contract and builds, for each operation, a Fastify route (`/api/v1/...`) and Ajv (JSON Schema 2020-12) validators for path, query, headers and body. See [ADR 0003](adr/0003-custom-contract-loader.md)                                                                                                                                                                                                                                   |
| `api.ts`         | Registers one route per operation, with the authentication hook for its `security` and the sign-in rate limit. The handler is looked up by `operationId`; if there is none, the route answers `501`                                                                                                                                                                                                                                                 |
| `handlers.ts`    | The implemented operations that need no session, keyed by `operationId`: `getConfig` (including `links`)                                                                                                                                                                                                                                                                                                                                            |
| `errors.ts`      | Error mapper: turns any error into a Problem Details body. Body validation errors become `422`; path, query and header errors `400`; an unknown error becomes `500 internal-error` with no internal detail                                                                                                                                                                                                                                          |
| `docs.ts`        | `GET /api/docs`: serves `contract/dist/reference.html`; answers `404` with the hint "Run pnpm build:docs" if it was not built                                                                                                                                                                                                                                                                                                                       |
| `providers/`     | Provider registry (`createProviders`), the store interfaces, the `memory` and `azure-legacy` providers and the shared list order. See [Storage providers](#storage-providers)                                                                                                                                                                                                                                                                       |
| `domain/`        | Domain types shared by every provider (`types.ts`) and `survey-changes.ts`, the pure `applySurveyChanges`. See [Domain types](#domain-types)                                                                                                                                                                                                                                                                                                        |
| `auth/`          | Identity and session: the `IdentityProvider` interface and its two providers, the sealed cookies, CSRF, `returnTo`, the authentication hook and the handlers of `login`, `loginCallback`, `logout` and `getCurrentUser`. See [Identity and session](#identity-and-session)                                                                                                                                                                          |
| `surveys/`       | `access.ts` (the shared 404 and 403 rules of the surveys and content services), `listSurveys`, `createSurvey`, `getSurvey`, `updateSurvey`, `deleteSurvey` and `cloneSurvey`: the service (scopes, paging, creation, the survey actions), the pure rules (`permissions.ts`, `naming.ts` for "New Survey N" and "Copy of ...", `patch.ts` for the record changes of a patch) and the JSON mapping. See [Surveys and projects](#surveys-and-projects) |
| `content/`       | `getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme` and `listSurveyHistory`: the service, the handlers and `etag.ts` (pure: `formatEtag`, `ifMatchAllows`). See [Survey content and history](#survey-content-and-history)                                                                                                                                                                                            |
| `projects/`      | `listProjects` and `getProject`: the service, the handlers and the JSON mapping                                                                                                                                                                                                                                                                                                                                                                     |
| `paging/`        | `cursor.ts`: the opaque cursors of the two lists and of the history (pure). See [Paging](api/paging.md)                                                                                                                                                                                                                                                                                                                                             |
| `notices/`       | `AccountNotices` (`CurrentUser.notices`): the demo settings, and the surveyjs.io licence-expiry rule used by the `azure-legacy` provider                                                                                                                                                                                                                                                                                                            |
| `shell-links.ts` | The built-in surveyjs.io account links and their merge with `SHELL_LINKS` (`/config.links`)                                                                                                                                                                                                                                                                                                                                                         |
| `legacy/`        | Tools for the offline replica of the legacy stores: the fixture loader, its endpoint safety guard and Edm validation. Not used by the server at run time                                                                                                                                                                                                                                                                                            |
| `cli/`           | `inspect-legacy.ts`, a read-only command-line inspector (`pnpm inspect:legacy`)                                                                                                                                                                                                                                                                                                                                                                     |

Rules that hold everywhere:

- Every API path is under `/api/v1`. The only other routes are `/healthz`, `/readyz`,
  `/api/docs` (off in production unless `API_DOCS=true`) and, with the dev identity provider only,
  `/__dev/sign-in`.
- Every error body is `application/problem+json` with `type`, `title`, `status` and a stable
  `code`. Unknown URLs give `404 not-found`.
- Every response carries `x-request-id`. An incoming `x-request-id` (up to 128 characters) is reused.
- Request logs never show the values of the `code` and `state` query parameters (the sign-in
  callback): they are written as `[redacted]` (`server/src/logging.ts`).
- The request body limit is `LIMIT_MAX_RESPONSE_BYTES` ([ADR 0004](adr/0004-body-limit.md)), except for the
  definition and theme saves, which use `LIMIT_MAX_DOCUMENT_BYTES` (see [Body limits](#body-limits)).
- `/readyz` returns `503` when the provider's `ready()` is false.

## Storage providers

Storage sits behind three interfaces in `server/src/providers/types.ts`. Nothing outside
`providers/` knows which implementation runs.

| Interface     | Methods                                                                                                                                                                                                                                                                                                                                                       | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SurveyStore` | `getSurvey(id)`, `listSurveys(owner)`, `listSurveyPage(query)`, `createSurvey(survey, definition?)`, `getDefinition(id)`, `getTheme(id)`, `saveDefinition(id, definition, save)`, `saveTheme(id, theme, save)`, `listHistory(query)`, `getHistorySnapshot(surveyId, entryId)`, `updateSurvey(id, changes)`, `cloneSurvey(sourceId, copy)`, `deleteSurvey(id)` | `null` when not found. `listSurveys` includes archived surveys, ordered by `updatedAt` descending, then `id`. `listSurveyPage` returns the rows of that list that match `archived`, after a position, at most `limit` of them, with the position of the last row when more follow. `createSurvey` stores the legacy defaults and returns the record as stored; it throws on a duplicate id. `getDefinition` returns the definition (`{}` when the survey has none) with its version token as a `Versioned`, `null` for an unknown id. `getTheme` is the same for the theme (`SurveyTheme`). `saveDefinition` and `saveTheme` write only when the current version equals `save.ifVersion` and answer a `SaveOutcome` (`saved` with the new version, `conflict`, or `not-found`); a definition save also adds a history entry. `listHistory` returns a page of `HistoryEntryRecord`s, newest first, and an empty page for an unknown survey. `getHistorySnapshot` returns the definition stored with an entry, or `null`. `updateSurvey` applies a `SurveyChanges` in one write and returns the record as stored, `null` for an unknown id. `cloneSurvey` creates `copy` with the source's definition and theme (`null` for an unknown source; it throws on a duplicate id). `deleteSurvey` removes the survey and everything stored for it, `false` for an unknown id |
| `Directory`   | `getUser(id)`, `findUserByEmail(email)`, `listUserProjects(userId)`, `getUserProject(userId, projectId)`                                                                                                                                                                                                                                                      | Email match ignores case. Projects are ordered by project name ignoring case, then project id. `getUserProject` returns `null` when the user is not a member or the project does not exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ProviderSet` | `name`, `surveys`, `directory`, `notices`, `ready()`, `close()`                                                                                                                                                                                                                                                                                               | What the server holds. `ready()` feeds `/readyz`. `notices` is `AccountNotices` (see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Ids are GUIDs. Stores match them case-insensitively and return them in lower case. The list orders
live in `providers/ordering.ts`, so every provider sorts the same way. The writes in the interfaces are
`createSurvey` (Step 4), `updateSurvey`, `cloneSurvey` and `deleteSurvey` (Step 5) and `saveDefinition`
and `saveTheme` (Step 6); the other writes arrive with the steps that need them.

| Provider       | `STORAGE_PROVIDER` | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`       | `memory` (default) | Holds records in memory and returns copies. Empty unless `MEMORY_SEED=legacy-fixtures`, which loads the golden fixtures in `server/fixtures/legacy/` through the same mapping as the legacy provider                                                                                                                                                                                                                                                                                                       |
| `azure-legacy` | `azure-legacy`     | Works on the real surveyjs.io stores: SQL for users, surveys, projects and memberships, through a lazily created pool. `ready()` checks SQL and both storage accounts. A skipped row is reported as a warning with ids only. It reads everything and writes only survey creation, update, clone, delete and the definition and theme saves, in `providers/azure-legacy/writes.ts`; ESLint forbids write calls in the rest of the folder. See [Writing to the legacy stores](#writing-to-the-legacy-stores) |

`createProviders` picks the provider from `STORAGE_PROVIDER`. The settings are described in
[Development](development.md#environment-variables-server): `STORAGE_PROVIDER`, `MEMORY_SEED`
(`empty` or `legacy-fixtures`) and, for `azure-legacy`, all three of
`LEGACY_SQL_CONNECTION_STRING`, `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` and
`LEGACY_RESULTS_STORAGE_CONNECTION_STRING`. The connection strings are secrets: no error message or
log line includes one.

`legacy/` and the `docker/` folder build an offline replica of the legacy stores (Azurite for tables
and blobs, SQL Server for the directory) that the `azure-legacy` provider can run against. Why SQL
Server, and what is not emulated: [ADR 0006](adr/0006-legacy-replica.md).

## Domain types

`server/src/domain/types.ts` holds what the providers return.

| Type                 | Holds                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SurveyOwner`        | A user (`kind: "personal"`, `userId`) or a project (`kind: "project"`, `projectId`)                                                                                             |
| `SurveyRecord`       | Survey metadata: `id`, `name`, `owner`, `creatorId`, `postId`, `resultId`, `published`, `archived`, `createdAt` and `updatedAt` (ISO 8601 UTC), `settings`                      |
| `User`               | `id`, `email`, `displayName` (the email when the legacy name is blank), `blocked`                                                                                               |
| `ProjectRecord`      | A project as the Directory returns it: `id`, `name`, `ownerId`, `createdAt` (ISO 8601 UTC), `memberCount` (at least 1)                                                          |
| `ProjectMembership`  | A `ProjectRecord` and the user's `role` (`admin` or `user`)                                                                                                                     |
| `NewSurvey`          | What the service decides for a new survey: `id`, `name`, `owner`, `creatorId`, `postId`, `resultId`, `createdAt` and `updatedAt` (equal). The store adds the legacy defaults    |
| `SurveyDefinition`   | The survey definition, a JSON object (`Record<string, unknown>`)                                                                                                                |
| `SurveyTheme`        | The survey theme, a JSON object (`Record<string, unknown>`); `{}` when a survey has none                                                                                        |
| `Versioned<T>`       | A stored document (`content`) and its opaque version token (`version`, never contains `"`)                                                                                      |
| `HistoryEntryRecord` | One saved version of a definition: `id` (lower-case GUID), `at` (ISO 8601 UTC) and `userId` (`null` for legacy entries). The snapshot is read with `getHistorySnapshot`         |
| `SaveOutcome`        | The result of a compare-and-set save: `{ kind: "saved", version }`, `{ kind: "conflict" }` or `{ kind: "not-found" }`                                                           |
| `SurveyChanges`      | A change of a survey record: optional `name`, `move` (`owner` and `creatorId`), `published`, `archived` and `settings`, and always `updatedAt`. `applySurveyChanges` applies it |
| `SurveyResponse`     | Declared for the results steps: `id`, `submittedAt`, `data`, optional `clientId` and `respondentIp`, `partial`                                                                  |

## Surveys and projects

Step 4 builds `listSurveys`, `createSurvey`, `getSurvey`, `listProjects` and `getProject`; Step 5 adds
`updateSurvey`, `deleteSurvey` and `cloneSurvey` ([Survey actions](#survey-actions)). The routes come
from the contract like every other; the handlers are in `surveys/handlers.ts` and
`projects/handlers.ts` and call a service that holds the rules. The client view is
[API: What is implemented](api/README.md#what-is-implemented) and [Paging](api/paging.md).

### Permissions

`surveys/permissions.ts` (pure) follows the legacy rule; the reason and what changes if the product
owner chooses otherwise are in [ADR 0009](adr/0009-survey-permissions-follow-legacy.md).

| Question                | Personal survey                 | Project survey                                         |
| ----------------------- | ------------------------------- | ------------------------------------------------------ |
| Can see (list, get)     | The user is the owner           | The user is a member of the project, in any role       |
| `permissions.canModify` | `true` (only the owner sees it) | The user's role is `admin`, **or** the user created it |
| Can create in the scope | Always                          | Any member                                             |

A survey the user cannot see answers `404 not-found`, like an unknown id.

### Listing

`listSurveys` takes `project` (`personal` or a project id). Any other value must be the id of a project
the user belongs to (`Directory.getUserProject`); an unknown id, text that is no id and a project of
others all answer `404 not-found`. The service cuts the page with `SurveyStore.listSurveyPage`, using the
position decoded from the cursor, and turns the store's `next` position into `nextCursor`.
`listProjects` asks the Directory for the whole list (it is short) and cuts the page itself. Cursors are
in `paging/cursor.ts`: the format is a reference, not part of the contract, and is written down for ports in
[Paging](api/paging.md#for-ports-the-reference-cursor-format). A cursor belongs to one list (scope and
`archived`), so a mismatch is `400 bad-request`.

### Creation

`createSurvey` checks, in this order: a given name is not blank and fits (`422`, see below); the
`projectId`, if any, is a project of the user (`403 forbidden` otherwise). Without a name the service
reads the **active** surveys of the scope and calls `nextNewSurveyName` (`surveys/naming.ts`, pure), which
reproduces the legacy rule: start at 1; for each name that starts with the exact text `New Survey` and
whose rest is a number (optional sign, surrounding white space allowed, at most `2147483647`), take the
highest; answer `New Survey <highest + 1>`. Gaps are not filled and archived names are ignored. The ids
come from `crypto.randomUUID()`, the time from `BuildOptions.now` (default `Date.now`), and the answer is
`201` with `Location`.

**Name length.** The contract says `maxLength: 200`. JSON Schema counts characters (code points); the
legacy column holds 200 UTF-16 code units. The service therefore also refuses a name longer than 200
UTF-16 code units with `422` at `/name`. ([ADR 0010](adr/0010-writing-to-the-legacy-stores.md))

### Survey actions

Step 5 builds `updateSurvey`, `deleteSurvey` and `cloneSurvey` in `surveys/service.ts`. The client view
(rules and examples) is in [API: Step 5](api/README.md#step-5-survey-actions); the reasons for each
ruling are in [ADR 0011](adr/0011-survey-actions.md). The service checks, in this order:

| Operation      | Checks and effect                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `updateSurvey` | A given `name` (`422`); the survey is visible (`404`); the user can modify it (`403`); `projectId`, if present, resolves to a scope (`null` is the caller's Personal scope; a project needs membership, `403`); one `SurveyStore.updateSurvey`; `200`  |
| `deleteSurvey` | Visible (`404`); can modify (`403`); archived (`409 survey-not-archived`); `SurveyStore.deleteSurvey`; `204`                                                                                                                                           |
| `cloneSurvey`  | A given `name` (`422`); the source is visible (`404`); the target scope (the source's, the caller's Personal scope or a project the caller belongs to, `403`); new ids and `Copy of ...` name, the caller as creator; `SurveyStore.cloneSurvey`; `201` |

Two pure helpers hold the rules. `surveys/patch.ts` (`surveyChangesFromPatch`) turns a validated patch
and the resolved target scope into a `SurveyChanges`: it copies `name`, `published`, `archived` and the
given `settings` keys, makes a `move` only when the target differs from the current scope (with the
caller as `creatorId`), and always sets `updatedAt` to the clock. `domain/survey-changes.ts`
(`applySurveyChanges`) applies a `SurveyChanges` to a record; the memory provider uses it. `naming.ts`
gains `cloneName` (`Copy of {name}`, cut to 200 UTF-16 code units without splitting a surrogate pair).

`canModify` in every answer is worked out again for the stored survey, so a move shows the rights the
user has in the new scope.

### Survey content and history

Step 6 builds `getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme` and
`listSurveyHistory` in `content/` (`service.ts`, `handlers.ts`, `etag.ts`). The handlers are added to the
handler map in `app.ts` next to the surveys' ones. The client view is
[API: Step 6](api/README.md#step-6-definition-theme-and-history) and
[Concurrent editing with ETags](api/concurrency.md); the reasons for each ruling are in
[ADR 0012](adr/0012-editor-content-and-history.md). The `404` and `403` checks are the same as those of
the surveys service. They live in `surveys/access.ts` (`visible`, `modifiable`), and both services call
them.

| Operation                           | Checks and effect                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSurveyDefinition`               | Visible (`404`); `SurveyStore.getDefinition`; `200`, the content, header `ETag: "<version>"`                                                                                                                                                         |
| `saveSurveyDefinition`              | Visible (`404`), can modify (`403`), `If-Match` present (`428`), read the current version and compare (`412`), `SurveyStore.saveDefinition` with `ifVersion`, the caller and the clock (`conflict` is `412`, `not-found` is `404`), `204` and `ETag` |
| `getSurveyTheme`, `saveSurveyTheme` | The same, with the theme and `saveTheme` (no user, no history entry)                                                                                                                                                                                 |
| `listSurveyHistory`                 | Visible (`404`); the cursor (`400` when invalid); `SurveyStore.listHistory`; the user of each entry from `Directory.getUser` (one lookup for each distinct user on the page); `200`                                                                  |

`etag.ts` is pure. `formatEtag(version)` gives the strong tag `"<version>"`, and
`ifMatchAllows(header, version)` implements the `If-Match` rules (a list of tags, `*`, no weak tags, a
malformed header matches nothing).

**Version tokens.** A document read returns a `version`. The service never looks inside it.

| Provider       | Version of the definition                                                                                                        | Version of the theme                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `memory`       | `contentVersion` of the stored compact JSON, or of the empty text when none                                                      | The same                                                                 |
| `azure-legacy` | The `surveyjson/{id}` blob's own ETag without quotes, from the same `download()` that returned the text; `"none"` without a blob | `contentVersion` of the raw `theme` column text (`NULL` counts as empty) |

`contentVersion(text)` (`domain/content-version.ts`, pure) is the SHA-256 of the UTF-8 text in base64url
without padding (43 characters). The azure theme is hashed because a SQL column has no version.

**Compare-and-set.** The store does the comparison itself, so there is no gap between the check and the
write. `memory` compares and replaces in one synchronous step. `azure-legacy` replaces `surveyjson` with
the blob condition `ifMatch` (or `ifNoneMatch: "*"` when there was no blob), and updates the theme with
`WHERE ... theme = @expected` (an exact comparison). The service also reads the current version first, to
answer `412` early; the store's check is what guarantees the result. The version returned after a save
is computed from what is stored (the blob's last ETag; the theme's `OUTPUT` text).

**History storage.** `memory` keeps an array of `{ id, at, userId, snapshot }` for each survey (a seed
can carry entries; `legacyFixtureSeed()` loads the fixture points with `at` = the survey's `updatedAt`
and no user). `azure-legacy` keeps each entry as a point `surveyjsonhistory/{surveyId}/{pointId}` with the
metadata `userid` and `savedat`
([layout, 3.4](architecture/legacy-data-layout.md#34-survey-history-blob-container-surveyjsonhistory)).
`listHistory` lists the blobs with the prefix `{surveyId}/` and their metadata, orders them with the shared
`historyOrder` (`providers/ordering.ts`: `at` descending as instants, then id descending), and cuts the
page after a position. Create and clone add an entry too, and delete removes the history.

#### Body limits

`apiRoutes` takes a `bodyLimits` option, a map from `operationId` to a limit. `app.ts` fills it with
`LIMIT_MAX_DOCUMENT_BYTES` for `saveSurveyDefinition` and `saveSurveyTheme`. A route without an entry keeps
the global limit.

### Writing to the legacy stores

The `azure-legacy` provider was read-only until Step 4. Its first write is survey creation, and the
rule is: **every write lives in `providers/azure-legacy/writes.ts`**. ESLint keeps the read-only rule
for the rest of the folder and lists that one file in the rule block's `ignores`. Details and reasons:
[ADR 0010](adr/0010-writing-to-the-legacy-stores.md). In short, `createSurvey`:

1. checks that the id is free (one `SELECT`);
2. when a definition is given, writes the append blobs `surveyjson/{id}`, `surveytext/{id}` and
   `surveyjsonhistory/{id}/{newGuid}`;
3. inserts the `Surveys` row with exactly the legacy create columns (all others stay `NULL`);
4. appends the `SURVEY_CREATE` audit row to table `surveys`, **best effort**: a failure is a warning
   with the survey id and the create still succeeds;
5. reads the survey back and returns it.

Blobs come before the row, so a failure leaves invisible orphan blobs and never a survey without its
definition.

Step 5 adds three writes to the same file (the exact rules and the reasons are in ADR 0010):

- **Update** (`writeSurveyChanges`): one `UPDATE Surveys` that sets only the columns the changes name
  (`name`; `userid` and `creatorid` for a move; `ispublished`; `isarchived`; `allowaccessresult`;
  `storeipaddress`) and always `timestamp`. Zero rows means no such survey. Then one best-effort audit
  row per change, in the order `SURVEY_UPDATE`, `SURVEY_TRANSFER`, `SURVEY_PUBLISHED`, `SURVEY_ARCHIVE`
  or `SURVEY_RESTORE`, `SURVEY_ACCESSRESUTL`, `SURVEY_POSTRESUTL`. A patch with no such change writes
  only `timestamp` and no audit row.
- **Clone** (`writeClonedSurvey`): reads the source row's `theme` and the raw `surveyjson` blob, then
  runs the create sequence above with the blob text copied unchanged (so a source with a definition
  gives the copy the three definition blobs, one history point), then `UPDATE Surveys SET theme` for the
  copy when the source has one (`timestamp` untouched), then a best-effort `SURVEY_THEME_CHANGE` row. A
  failure of that `UPDATE` fails the clone and leaves a copy without its theme.
- **Delete** (`writeSurveyDeletion`): children first, a missing child is fine. The results-account
  tables `post{postId}`, `SurveyCompletion{surveyId}` and `postdelete{postId}` (ids without dashes);
  then the surveys-account blobs `surveyjson`, `surveytext`, every `surveyjsonhistory/{id}/...` and the
  four results-layout blobs; then `DELETE FROM Surveys`; then a best-effort `SURVEY_DELETE` row stamped
  with the provider's clock. The record goes last, so a failure leaves an archived survey that is
  still visible and can be deleted again.

Step 6 adds two more (ADR 0010, "Step 6"):

- **Save definition** (`writeDefinitionSave`): an existence check; `surveyjson/{id}` replaced with the
  condition `ifMatch` of the blob version (or `ifNoneMatch: "*"`; a storage `412` or `409` is a conflict
  and nothing else is written; each append is conditioned on the ETag of the write before);
  `surveytext/{id}` replaced; a new point `surveyjsonhistory/{id}/{newGuid}` with the metadata `userid` and
  `savedat`; `UPDATE Surveys SET [timestamp]`; a best-effort `SURVEY_UPDATE` row. The replacement of an
  append blob is not atomic (as in legacy): a failed append after the Put Blob can leave `surveyjson` empty.
- **Save theme** (`writeThemeSave`): one `UPDATE ... OUTPUT inserted.theme` whose `WHERE` compares the old
  text exactly; a best-effort `SURVEY_THEME_CHANGE` row, without `theme` above 32,000 UTF-16 code units.
- Create and clone put the same metadata on the point they already write.

`LegacyWriteTargets` gained `resultTables` (the results account's table client) for the delete. A store failure is a `LegacyStoreError` (`providers/azure-legacy/errors.ts`, re-exported from
`index.ts`), whose message reads "Legacy store <operation> failed" plus driver codes and never a
connection string or row content. The layout reference is
[section 5.3](architecture/legacy-data-layout.md#53-what-a-writer-must-do-so-legacy-readers-see-a-change).

### Projects

`ProjectRecord` has `ownerId`, `createdAt` and `memberCount`, which legacy does not store. The read side
infers them in `projectFromLegacy` (`providers/azure-legacy/mapping.ts`,
[layout, 9.3](architecture/legacy-data-layout.md#93-project-project)): the owner is the user of the
membership row whose id equals the project id (the creator's row), else the earliest admin, else the
earliest member; `createdAt` is that row's `happendat` (else the project's, else
`1970-01-01T00:00:00.000Z`), read as UTC; `memberCount` is the number of membership rows. Step 11 only adds
the writes.

## Legacy mapping

The current surveyjs.io site keeps its data in SQL, Azure Tables, Blobs and Files. How, and how
each field maps to the domain, is written in
[legacy-data-layout.md](architecture/legacy-data-layout.md) (mapping: section 9). This section only
summarises it.

| Legacy                                   | Domain                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `Surveys.userid`                         | A project id when it is an organization id, otherwise the personal owner |
| `Surveys.ispublished` (`NULL`)           | `published = false`                                                      |
| `Surveys.creatorid` (all zeros)          | `creatorId = null`                                                       |
| `Surveys.createdat`, `Surveys.timestamp` | `createdAt`, `updatedAt`, read as UTC                                    |
| `OrganizationUsers.role`                 | `admin` or `user` (case is ignored)                                      |
| `Users.displayname` (NULL or blank)      | The email                                                                |

Rules decided in Step 2:

- **NULL columns map with defaults.** A NULL name becomes `""`. A NULL `createdat` takes the
  `timestamp` value and the other way round; if both are NULL, both become
  `1970-01-01T00:00:00.000Z`. A NULL email becomes `""`, and `findUserByEmail` with a blank email
  finds no user. A NULL project name becomes `""`.
- **Rows the domain cannot represent are skipped and reported.** A survey with a NULL `postid`,
  `resultid` or `userid`, and a membership with a NULL or unknown role, are left out. Each one is
  reported as a warning that carries ids only.
- **Ids are case-insensitive**, and returned in lower case.

D11 (respondent files stored as URLs in place of inline content) has the verdict "Yes, with
conditions": [ADR 0005](adr/0005-respondent-files-as-urls.md).

### Open for later steps

Steps 2 to 5 leave these points open. The first group are differences between the legacy system and the
contract; the last rows come from Step 3.

| Point                                                                                                                                                                                                                             | To settle in                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| ~~`canModify`: legacy allows a project admin or the survey's creator; the spec allows any member~~ Settled in Step 4: the legacy rule ([ADR 0009](adr/0009-survey-permissions-follow-legacy.md)); the product owner is to confirm | Step 4 (done)                       |
| ~~Survey name length: 200 in SQL, 256 in the contract~~ Settled in Step 4: the contract says 200, plus a server check in UTF-16 code units ([ADR 0010](adr/0010-writing-to-the-legacy-stores.md))                                 | Step 4 (done)                       |
| Results layouts: legacy keeps them per survey, the contract per user                                                                                                                                                              | Step 9 or 10                        |
| The editor's preview image (`my-surveys-survey-preview-image-{id}` in the `surveyfiles` share) is not deleted on a save, as legacy does, because no file store exists yet                                                         | Step 7                              |
| Files join the delete cascade: `deleteSurvey` removes no files yet, because no file store exists (legacy editor assets are not linked to a survey)                                                                                | Step 7                              |
| The survey menu's last items can sit under the fixed cookie banner and footer on short viewports for a first-time visitor                                                                                                         | Step 13                             |
| Project `ownerId` and `createdAt`: legacy has no columns; they are inferred from the creator's membership row. The read side is settled in Step 4 ([Projects](#projects)); the writes remain                                      | Step 11 (writes)                    |
| Fixtures are synthetic; the spec wants them copied from storage. Check them on a read-only copy (site team)                                                                                                                       | Step 14                             |
| `azure-legacy` readiness makes account-level calls; a container SAS keeps `/readyz` at 503. Narrow the probe                                                                                                                      | Step 14                             |
| Sign-in rate limit keys on the socket IP and does not trust `X-Forwarded-For`; behind a reverse proxy all users share one counter                                                                                                 | Step 14 (trusted proxy)             |
| Keyboard and ARIA polish of the copied surveyjs.io header; the Open Sans font is not self-hosted (the text falls back to Helvetica)                                                                                               | Step 13                             |
| The copied cookie banner mentions advertising partners (Google, Reddit, X) that My Surveys does not use; the hosted deployment needs reviewed text                                                                                | Step 13 or before the hosted launch |
| Session revocation: the session is a stateless sealed cookie (12 h, no renewal), so a session cannot be ended on the server. Changing `SESSION_SECRET` ends all of them                                                           | Not planned; stateless by design    |

## Request flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant V as Vite (:5173)
  participant F as Fastify (:3000)
  participant A as Authentication hook
  participant R as Contract route
  participant H as Handler
  B->>V: GET /api/v1/surveys
  V->>F: proxy (/api, /__dev, /healthz, /readyz)
  F->>A: onRequest, from the operation's security
  alt no valid msid
    A-->>B: 401 unauthenticated
  else CSRF header missing or wrong
    A-->>B: 403 csrf-token-invalid
  else allowed (or public)
    A->>R: match route, validate with Ajv
    alt validation fails
      R-->>B: 400 or 422 Problem
    else handler exists for operationId
      R->>H: call (request.user is set)
      H-->>B: 200 JSON
    else no handler yet
      R-->>B: 501 Problem (not-implemented)
    end
  end
```

In production the web bundle is static files and a reverse proxy sends `/api` to the server.
The server does not serve the web app.

## Identity and session

Step 3 adds sign-in. The client-facing description (flow, cookies, errors, CSRF example) is in
[Authentication, sessions and CSRF](api/authentication.md). This section is for implementers.

### `IdentityProvider`

`server/src/auth/identity.ts`. The caller (the `login` and `loginCallback` handlers) makes the random
sign-in parameters and keeps them in a sealed transaction cookie, `msid_auth_<state key>`. A
provider only talks to the identity service.

| Member                              | Does                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `authorizationUrl(params)`          | The URL to send the browser to. `params` are `state`, `nonce` and the PKCE `codeVerifier`         |
| `finishSignIn(callbackUrl, params)` | Checks what came back and returns `{ sub, email?, name?, picture? }`. A bad code is a `400` error |
| `endSessionUrl()`                   | Where the browser goes after local sign-out                                                       |
| `routes` (optional)                 | Fastify routes the provider serves itself, outside `/api/v1`                                      |

`IDENTITY_PROVIDER` selects the implementation (`auth/providers/index.ts`).

| Provider                              | What it does                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev` (`providers/dev.ts`)            | A "Sign in as…" page at `GET /__dev/sign-in` lists the users of the memory seed. A choice goes to the regular callback with the user id as `code`. See [ADR 0007](adr/0007-dev-identity-provider.md). Refused with `NODE_ENV=production`, `APP_EDITION=hosted` and any storage other than `memory`                                                                                                         |
| `surveyjs-oidc` (`providers/oidc.ts`) | Authorization code flow with PKCE (S256) and `state`, through `openid-client`, with `client_secret_post`. The identity always comes from the UserInfo endpoint ([ADR 0008](adr/0008-surveyjs-auth-oauth2-userinfo.md)). Discovery is **lazy**: done at the first sign-in, cached, and retried after a failure, so start-up and `/readyz` never depend on the issuer. Tokens are dropped after the callback |

`surveyjs-oidc` has two modes (`OIDC_DISCOVERY`):

| Mode                                   | For                                                                                                                                                           | Metadata                                                                                                          | ID token                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `oauth-authorization-server` (default) | `auth.surveyjs.io` and the mock OIDC server. It is OAuth 2.0, not OpenID ([layout, 6.1](architecture/legacy-data-layout.md#61-sign-in-server-authsurveyjsio)) | RFC 8414. When the issuer has a path, the metadata is also tried under the issuer path (the mock serves it there) | None is expected. If one comes back, it is validated and its `sub` must equal the UserInfo `sub`                                                 |
| `openid-configuration`                 | A real OpenID provider                                                                                                                                        | `/.well-known/openid-configuration`                                                                               | Required, and a `nonce` is sent, **only when** `OIDC_SCOPES` also holds `openid`. Without `openid`, no nonce is sent and no ID token is expected |

Other rules:

- A token or UserInfo failure that means "this sign-in is not valid" (bad or reused code, an error
  sent back by the provider, an ID token that fails validation) is `400 bad-request`. Network
  failures and a rejected client secret are `500 internal-error`, logged with the cause.
- `endSessionUrl` is the provider's `end_session_endpoint` with `client_id` and
  `post_logout_redirect_uri=PUBLIC_BASE_URL/`. If that cannot be built (unreachable, or no
  end-session endpoint), it is `PUBLIC_BASE_URL/`.
- `OIDC_ISSUER_URL` must be https unless its host is `localhost`, `127.0.0.1` or `[::1]` (the mock
  OIDC server): the server refuses to start otherwise.
- The redirect URI is `PUBLIC_BASE_URL + /api/v1/auth/callback`. `PUBLIC_BASE_URL` must be an
  **origin** (no path, query or fragment): the server refuses to start otherwise. In local
  development it is the Vite origin (`http://localhost:5173`), so the browser stays on one origin and
  the cookies are first-party.

### The sealed cookie format

`msid` and the `msid_auth_*` cookies hold **sealed** values (`auth/seal.ts`). The format is fixed so that a server
in another language can read the cookies of this one (and so that a sign-in can move between them).

```text
v1.<iv>.<ciphertext+tag>
```

| Part             | Definition                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Algorithm        | AES-256-GCM                                                                                                                                                                         |
| Key              | HKDF-SHA256 with the secret (`SESSION_SECRET`, UTF-8 bytes) as input key material, **no salt** (RFC 5869 zero-length salt), `info` = the purpose string (UTF-8), 32 bytes of output |
| Purpose          | `msid-session-v1` for `msid`; `msid-auth-v1` for `msid_auth_*`. It is the `info` of the key **and** the GCM additional authenticated data, so one cookie never opens as the other   |
| `iv`             | 12 random bytes per value                                                                                                                                                           |
| `ciphertext+tag` | The ciphertext, then the 16-byte GCM tag                                                                                                                                            |
| Encoding         | `iv` and `ciphertext+tag` in base64url **without padding**. Only the canonical form is accepted: a value that does not re-encode to itself is rejected                              |
| Plaintext        | UTF-8 JSON (below)                                                                                                                                                                  |

Any failure reads as "no value": a bad shape, another version, a wrong purpose or secret, tampering,
a payload with a wrong field type, or an expired `exp`. The reader never tells which.

`msid` payload (`auth/session.ts`):

```json
{
  "sub": "11111111-0000-4000-8000-a00000000001",
  "name": "Olivia Owner",
  "email": "owner@example.com",
  "avatarUrl": null,
  "csrf": "<base64url, 32 random bytes>",
  "exp": 1791998762
}
```

`exp` is epoch **seconds**; the session is expired when `now >= exp`. `csrf` equals the `msid_csrf` cookie
issued with it. A transaction cookie holds `{ state, nonce, codeVerifier, returnTo, exp }` with `exp`
ten minutes ahead. Its name is `msid_auth_` plus the first 16 characters of `state` (base64url), so
each sign-in has its own cookie and sign-ins in several tabs do not overwrite each other. The callback
reads the cookie named by its `state` query parameter and still compares the full `state`. `Secure` is set on the cookies when `PUBLIC_BASE_URL` is https; the other attributes are in
[the API guide](api/authentication.md#cookies). When a `Cookie` header repeats a name, the first
value wins.

What this means, honestly:

- The session is **stateless**. Nothing is stored on the server, so a session **cannot be revoked**
  before its 12 hours end (absolute; it does not slide). Changing `SESSION_SECRET` ends all of them.
- The secret must be shared by every instance behind a load balancer. `SESSION_SECRET` is required
  when `NODE_ENV=production`, and also when `PUBLIC_BASE_URL` is https or its host is not
  `localhost`, `127.0.0.1` or `[::1]`, so a deployment that forgets `NODE_ENV` cannot run with the
  public development constant. Otherwise, when it is unset, that constant is used and a warning is
  logged at start-up.
- A user's name or email changes only at the next sign-in.

### The authentication hook

`auth/authenticate.ts`. For each contract operation, `api.ts` turns its effective `security`
(operation-level, else the document's top level) into an access rule:

| `security`                                                 | Rule                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `[]`, or an empty requirement and no session one           | Public: no hook                                                                         |
| A session requirement and an empty one (`logout`)          | Optional session: without a valid `msid` the call is anonymous; with one, CSRF as below |
| Only `bearerAuth` (P1)                                     | Never satisfied: `401`                                                                  |
| `cookieAuth`, with `csrfToken` in every usable requirement | Session and CSRF                                                                        |
| `cookieAuth` alone                                         | Session                                                                                 |

The hook runs in `onRequest`, before body parsing and validation. The order is therefore
authentication (`401`), CSRF (`403`), validation (`400`/`422`), handler (or `501`). On success it sets
`request.user` (`{ id, displayName, email, avatarUrl }`). CSRF means: `X-CSRF-Token`, the `msid_csrf`
cookie and the session's `csrf` are all present and equal (`auth/csrf.ts`, constant time).

The sign-in operations are public and rate limited (`@fastify/rate-limit`, registered with
`global: false`, so only routes that ask for a limit have one): `SIGN_IN_RATE_LIMIT` per minute, per
operation, keyed by the socket IP. A limited request answers `429 rate-limited` with `Retry-After`.

### Handlers (`auth/session-handlers.ts`)

| Operation        | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`          | Validates `returnTo` (`auth/return-to.ts`), creates the transaction, sets its `msid_auth_<state key>` cookie, redirects to `authorizationUrl`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `loginCallback`  | Clears the transaction cookie named by `state` whatever happens (other sign-ins' cookies stay). Opens it, compares the full `state`; when that fails but the request has a valid `msid`, redirects to `PUBLIC_BASE_URL/` instead of `400`. Calls `finishSignIn`, then `Directory.getUser(sub)`: when found, its `displayName` and `email` win over the claims; otherwise the claims are used (`name`, else `email`). A blocked user is `403 forbidden`; no email at all is `400 bad-request`. Sets `msid` and `msid_csrf`, redirects to `PUBLIC_BASE_URL + returnTo`. The avatar is the `picture` claim when it is an absolute http(s) URL, else `null` |
| `logout`         | With or without a session: clears `msid`, `msid_csrf` and every `msid_auth_*` cookie received, returns `{ redirectUrl }` from `endSessionUrl()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `getCurrentUser` | `request.user` plus `notices`. If the notice store fails, `notices` is `[]`, the error is logged, and the answer is still `200`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Account notices

`AccountNotices.noticesFor(userId)` (`notices/account-notices.ts`) is the fourth member of the provider
set. `ACCOUNT_NOTICES` selects it:

| Value                                      | Notices                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default)                           | None                                                                                                                                                                                                                                                                                                                                                  |
| `license-expired`, `license-expires-soon`  | Every user gets that notice. A demo setting, for any provider                                                                                                                                                                                                                                                                                         |
| `surveyjs-licenses` (needs `azure-legacy`) | Read from the legacy licence tables with the legacy rule (`notices/licence-rule.ts`; [layout, 3.15](architecture/legacy-data-layout.md#315-licences-and-the-licence-expiry-dialogs)): a licence is expired when its expiry is past, "expires soon" when fewer than 15 whole days are left, and "expired" wins. A licence without an expiry is ignored |

A notice has `code`, `message`, `actionUrl` and `actionLabel`. `linkNotices` points the action of the two
licence notices at the `settings` link of `/config.links`, so `SHELL_LINKS` moves the Settings menu item
and the Renew button together. My Surveys cannot see the dismissals that surveyjs.io keeps, so a user who
has dismissed the dialog on surveyjs.io still gets the notice here; the browser keeps its own dismissal.

### Shell selection (web)

`/config.shell` names the shell and `/config.links` its links. `web/src/shell/registry.tsx` maps the name
to a component: `surveyjs-site`, or `plain` for any other name (and for tests). Every shell takes the same
props: `user`, `notices`, `links`, `onSignOut` (plus `signingOut` and `signOutError`) and `children`.

| Shell            | What it is                                                                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlainShell`     | A minimal header with the links, the user's name and a Sign Out button, the notices as plain lines. The fallback, and the shell of unit tests                                                                                                                       |
| `AnonymousShell` | The plain frame without account controls, for when no user is known: the root error page ("Could not load the application") uses it. It lives in `PlainShell.tsx`                                                                                                   |
| `surveyjs-site`  | The surveyjs.io header, footer, cookie banner and licence dialogs, copied from the site on purpose (D14). Loaded lazily, so its styles reach the browser only when it is chosen. Origins and licences of the copies: `web/src/shell/surveyjs-site/assets/README.md` |

The private routes sit under the pathless layout route `routes/_private.tsx`. Its `beforeLoad` ensures
`GET /me`; on `401` it navigates (a full page load) to `/api/v1/auth/login?returnTo=<path, query and
hash>`. The route never settles while the browser leaves, so no private page flashes. `/` is private.
`api/csrf.ts` adds `X-CSRF-Token` (from `msid_csrf`) to every unsafe request. Sign-out posts to
`logout`, clears the query cache, and navigates to `redirectUrl`. `logout` answers also without a
session, so an expired session still leaves the provider's session.

## Web modules (`web/src`)

| Path                                                                | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx`                                                          | Creates the TanStack Query client and the router, renders the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `router.ts`, `routeTree.gen.ts`                                     | TanStack Router. The route tree is generated by the Vite plugin from `routes/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `routes/__root.tsx`                                                 | Root route. Its loader fetches `/config` and starts applying the SurveyJS licence key in the background (not awaited; a failure is logged with `console.warn` and does not affect the page; the editor page awaits the same call before it builds the Creator); an error component shows a retry button                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `shell/`                                                            | Replaceable shells with a narrow interface (`ShellProps` in `types.ts`: `user`, `notices`, `links`, `onSignOut`, `children`). `registry.tsx` picks one by `/config.shell`; `PlainShell.tsx` holds `PlainShell` and `AnonymousShell`; `surveyjs-site/` is the surveyjs.io look                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `routes/_private.tsx`                                               | Pathless layout of the private pages: ensures the current user, redirects to sign-in on `401`, renders the shell                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `routes/_private/index.tsx`, `index.lazy.tsx`                       | The survey list at `/` (private). The route validates `project` and `archived` (`surveyList/search.ts`) and its loader fetches the first page, the archived check and the projects; a `404` for the project redirects to `/`. The lazy file renders `SurveyListPage`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `routes/_private/surveys/$surveyId/edit.tsx`, `edit.lazy.tsx`       | The editor route: the loader reads the survey; the lazy file renders `editor/EditorPage` (below). A `404` shows "This survey is not available."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `routes/_private/surveys/$surveyId/results.tsx` (and `.lazy.tsx`)   | The results placeholder (shared `surveyList/surveyPlaceholder.tsx` and `surveyLoader.ts`): the survey name and "Survey results arrive in a later version." Step 9 replaces it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `routes/_private/surveys/$surveyId/history.tsx`, `history.lazy.tsx` | The history route: the lazy file renders `history/HistoryPage` (the legacy heading, the entries, "Show more", "No edits yet.", the error texts)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `api/content.ts`                                                    | The content query layer: `contentKeys`, `definitionQueryOptions`, `themeQueryOptions` (`staleTime: Infinity`, no refetch on focus or reconnect, `gcTime: 0`, so each open of the editor reads fresh), `saveDefinition` and `saveTheme` (`PUT` with `If-Match`, resolve to the new `ETag`, a missing `ETag` is an error), `historyInfiniteQueryOptions` and `markSavedContentStale`                                                                                                                                                                                                                                                                                                                                          |
| `editor/`                                                           | The editor, in two halves. **Without Creator imports:** `EditorPage.tsx` (the survey record, the licence applied before the Creator is built, the savers, the bottom bar with status and name, the conflict notice, the `React.lazy` boundary), `autosave.ts` (pure: `createDocumentSaver`, `editorStatus`), `FooterNameEditor.tsx`, `editor.module.css`. **Only in the Creator chunk:** `SurveyEditor.tsx` (the only module that imports `survey-creator-react` and the CSS; builds the Creator once per mount, wires the savers, disposes it), `creatorSetup.ts` (options, Ace, themes, the toolbar items, Clear Survey, Help, Run), `obfuscate.ts` (pure), `embed/` (`embedCode.ts`, pure templates, and `EmbedTab.tsx`) |
| `history/`                                                          | `HistoryPage.tsx` and its CSS. `surveyList/formatDate.ts` gained `formatHistoryTime` (date, time and short zone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `routes/s/$surveyId.tsx`                                            | The public Run placeholder, outside `_private`: no sign-in, no shell, no API call. Step 8 replaces it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `surveyList/`                                                       | The list page in the surveyjs.io markup (D14): `SurveyListPage`, `SurveyRow` (the pencil and inline rename, `SurveyNameEditor`; a click on the row opens the editor; the rename state is `useRenameEditor`, shared with the editor's bottom bar), `SurveyMenu` (the "…" menu and its submenus), `useSurveyActions` (the row actions, confirmations, clipboard and the error message), `menuItems.ts` (pure: which items show, and the Move targets), `ProjectSelector`, `ActiveArchivedSwitch`, the pure `search.ts` (URL search, with defaults omitted in links) and `formatDate.ts` (`4/14/2026`)                                                                                                                         |
| `api/session.ts`, `api/csrf.ts`                                     | The `GET /me` query and the sign-out hook; the middleware that adds `X-CSRF-Token` on unsafe methods                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `api/client.ts`                                                     | openapi-fetch client typed by the contract. Base URL is `VITE_API_BASE_URL`, default `/api/v1`; cookies are sent (`credentials: "include"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `api/surveys.ts`, `api/projects.ts`                                 | The query modules (`queryOptions`/`infiniteQueryOptions` on the typed client) and the key builders `surveyKeys` and `projectKeys`; `useCreateSurvey`, `useUpdateSurvey`, `useCloneSurvey`, `useDeleteSurvey` and the cache functions `addCreatedSurvey`, `applyUpdatedSurvey` and `removeDeletedSurvey` (below)                                                                                                                                                                                                                                                                                                                                                                                                             |
| `api/config.ts`                                                     | Query options for `GET /config` (cached 5 minutes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `surveyjs/license.ts`                                               | `applySurveyJSLicense(key)`: imports `survey-core` lazily and calls `setLicenseKey`; concurrent calls share one in-flight promise. With no key it does nothing and `survey-core` is not downloaded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Query keys and the cache rules

| Key                                                                        | Data                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `["surveys", "list", project, archived]`                                   | Infinite query of `GET /surveys` with `limit=50` (`SURVEY_PAGE_SIZE`), following `nextCursor` |
| `["surveys", "has-archived", project]`                                     | `GET /surveys?archived=true&limit=1`: whether to show the Active/Archived switch              |
| `["surveys", "detail", surveyId]`                                          | `GET /surveys/{surveyId}`                                                                     |
| `["projects", "list"]`                                                     | Every page of `GET /projects` as one array                                                    |
| `["projects", "detail", projectId]`                                        | `GET /projects/{projectId}`                                                                   |
| `["content", surveyId, "definition"]` and `["content", surveyId, "theme"]` | The document and its `ETag` (`VersionedDocument`). `staleTime: Infinity`, `gcTime: 0`         |
| `["content", surveyId, "history"]`                                         | Infinite query of `GET /surveys/{surveyId}/history`, following `nextCursor`                   |

`addCreatedSurvey` runs when a creation succeeds: it stores the survey as `detail`, puts it at the top of
the scope's cached **active** list (unless a page already holds it), and marks the scope's lists stale
without refetching (`refetchType: "none"`), so the list shows the new survey at once and refetches the next
time it is shown. Other scopes, `has-archived` and the projects are left alone. The list shows a **Load
more** button only when the infinite query has a next page.

**Retry policy** (`shouldRetryQuery` in `api/client.ts`): a query does not retry a `4xx` error, except `408` and
`429`, so a page can react at once to an answer such as the `404` of an unknown project. Server and network
errors retry up to 3 times.

`applyUpdatedSurvey(queryClient, before, after)` runs when an update succeeds. It stores `after` as
`detail`. In every cached list it replaces the item in place when the list is the one `after` belongs to
(same scope and same `archived`), and removes it from every other list. It then marks the lists of the
scope before and the scope after stale (the visible list refetches, so it re-sorts: an update moves
`updatedAt`), and, when `archived` or the scope changed, the `has-archived` flags of both scopes.
`removeDeletedSurvey` drops the detail and the item from every cached list, and marks the scope's lists
and `has-archived` stale. `useCloneSurvey` reuses `addCreatedSurvey` for the copy.

The row actions (`surveyList/useSurveyActions.ts`) are the only caller of the three mutations. They use
`mutateAsync`, because a per-call callback of `mutate` runs only for the hook's latest call. Move and
Delete ask with `window.confirm` (the legacy texts, "organization" included); a successful Move opens the
target scope's Active list. A failed action sets one page-level message (`role="alert"`); the next action
clears it. A rename shows the new name at once and puts the old one back if the request fails.

**The menu markup.** `SurveyMenu.tsx` renders the copied surveyjs.io markup (D14; deviations are listed in
`web/src/shell/surveyjs-site/assets/README.md`). The popup is rendered only while open, and it gets the
`--left` class when it would pass the right edge of the page. The `role="button"`, `tabIndex` and `aria-*`
attributes sit on the dots container and on the flyout's text, not on the outer drop-down div, because that
div contains the menu links (a button must not contain links). A click on the outer div still toggles.

**Saving in the editor.** The savers in `editor/autosave.ts` are pure (no React, no Creator).
`createDocumentSaver` keeps one `PUT` in flight for its document; a newer request replaces the pending
content, and each `PUT` uses the `ETag` of the previous `204`. A `412` puts the saver into `conflict`,
where it drops pending work and ignores requests until `reset(etag)`. `editorStatus` combines the two
savers and the read-only flag into the bottom bar's status (read-only, then conflict, saving, error, saved).
`EditorPage` owns both savers and a `stopped` flag set by the first conflict, so a request the other
saver has queued also fails as a conflict and is never sent. "Reload latest" fetches both documents again
(`staleTime: 0`), loads them into the Creator and resets the savers. After each successful save,
`markSavedContentStale` marks the survey lists and the history query stale without refetching. Read-only is
fixed for the session: no savers, `creator.readOnly = true`.

**Code splitting.** No module that the list route or `edit.lazy.tsx` imports statically imports
`survey-creator-*`, `survey-react-ui` or `ace-builds`. The Creator is behind one dynamic `import()` of
`editor/SurveyEditor.tsx`, and `web/vite.config.ts` gives those modules a stable chunk name,
`survey-creator` (the Creator's CSS is imported only in `SurveyEditor.tsx`, and recursive dependencies are
not pulled into the group, or React and `survey-core` would load with the Creator). `survey-core` is its own
chunk, which the licence import loads without the Creator. An end-to-end test checks that the survey list
requests none of the Creator or Ace files.

The licence key travels: `SURVEYJS_LICENSE_KEY` (server) -> `GET /api/v1/config` ->
`applySurveyJSLicense` (browser). It is never in the code.

## Build and run

- `server` runs TypeScript directly with `tsx`; there is no server build.
- `web` is built by Vite (`pnpm build`). `survey-core` is one large lazy chunk, and the Survey Creator
  (with its CSS) another one, loaded only by the editor route. `chunkSizeWarningLimit` in `web/vite.config.ts` is
  raised only as far as that chunk needs.
- `pnpm demo` builds the API reference once, then runs the server with `node --watch --import tsx` and `vite` (web) together. (`tsx watch` hangs on Windows under `concurrently`, so it is not used.)

## What later steps add

- Done in Step 2: the store interfaces and domain types, the in-memory provider with an optional
  seed, the read-only `azure-legacy` provider, the golden fixtures, the shared provider suite, the
  Azurite and SQL Server replica, and the inspector CLI.
- Done in Step 3: sign-in with the dev provider and the surveyjs.io (OAuth 2.0 and UserInfo) provider,
  the mock OIDC server, sealed session and CSRF cookies, `/me` with account notices, the
  `surveyjs-site` shell, and end-to-end tests in memory and Azurite modes.
- Done in Step 4: the survey list and survey creation: `listSurveys`, `createSurvey`, `getSurvey`,
  `listProjects` and `getProject`, paging cursors, permissions, "New Survey N", the first legacy write
  (survey creation in `writes.ts`), the list page and the editor stub.
- Done in Step 5: the survey actions: `updateSurvey` (rename, publish, archive, move, settings),
  `deleteSurvey` and `cloneSurvey`, their legacy writes, the inline rename, the "…" menu with its
  confirmations and clipboard copies, and the placeholder pages for results, history and run.
- Done in Step 6: the survey editor (the Survey Creator with autosave, the conflict notice, read-only mode,
  Clear Survey, the obfuscated export, the Embed tabs and the name in the bottom bar), `getSurveyDefinition`,
  `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme` and `listSurveyHistory` with ETags and
  `If-Match`, the compare-and-set saves and the history users in both providers, the history page, and the
  per-route body limit for the two saves.
- Later: files joining the delete cascade and the editor's file uploads (Step 7), the run page and
  responses (Step 8), results, views and the other stores (Steps 9 and 10), project and member writes
  (Step 11), reading, comparing and restoring one history entry (P1), and Docker packaging. The contract
  already describes all of these.
