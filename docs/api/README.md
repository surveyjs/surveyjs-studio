# API

The API is defined by one file: [`contract/openapi.yaml`](../../contract/openapi.yaml) (OpenAPI 3.1).
It is the source of truth for the server, the web client and the conformance suite. All paths are
relative to `/api/v1`.

This directory holds guides. The reference itself is generated from the contract and is not
committed.

- [Conventions](conventions.md): errors, paging, concurrency, CSRF, idempotency and more.
- [Paging](paging.md): `limit` and `cursor`, what a page can hold, and the reference cursor format for ports.
- [Concurrent editing with ETags](concurrency.md): `ETag`, `If-Match`, `412` and `428`, with a `curl` loop.
- [Authentication, sessions and CSRF](authentication.md): the sign-in flow, `returnTo`, the cookies,
  the CSRF header, sign-out and rate limiting.
- [Uploads and files](uploads.md): editor uploads, the allowed types, the quota, the download headers and
  file ids.
- [Public endpoints, rate limits and idempotency](public-endpoints.md): loading and answering a published
  survey, respondent files, `Idempotency-Key`, the one-response rule, `TRUST_PROXY`, payload limits, rate
  limits and the public results of a survey.
- [Managing users (instance admins)](admin-users.md): the `/admin/users` operations, set-password links,
  the last instance admin, and an instance admin's view of every project.
- [Exporting results](exporting-results.md): downloading every response as JSON or CSV (the format choice,
  the CSV rules, file names, streaming) and deleting all responses.

## View the API reference

The reference lists every operation with its parameters, bodies and responses.

**Served by the running server** (not available when `NODE_ENV=production`, unless
`API_DOCS=true`):

```sh
pnpm demo
```

Then open <http://localhost:3000/api/docs>. `pnpm demo` builds the reference first. If you start
the server another way and the page says `404` with "Run pnpm build:docs", build it:

```sh
pnpm --filter @surveyjs-studio/contract build:docs
```

(`pnpm build` does this too.) The output is one self-contained HTML file,
`contract/dist/reference.html`, with no external requests. It is git-ignored; you can open it
straight from disk or publish it as a static page.

The page is read from disk on every request, so after you rebuild it, a refresh shows the new version.

## Check and regenerate

Lint runs with Redocly telemetry off (`telemetry: off` in `contract/redocly.yaml`) and its update check
suppressed. The three operations that legitimately lack a 2xx or 4xx response (`GET /auth/login`,
`GET /auth/callback`, `GET /config`) are listed in `contract/.redocly.lint-ignore.yaml`.

| Command                                            | Purpose                                                     |
| -------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint:contract`                               | Redocly lint, and fail if `generated/openapi.d.ts` is stale |
| `pnpm --filter @surveyjs-studio/contract generate` | Regenerate the TypeScript types from the contract           |

## Outside `/api/v1`

| Path        | Purpose                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `/healthz`  | Process is up: `200 {"status":"ok"}`                                                           |
| `/readyz`   | Providers are ready: `200 {"status":"ok"}` or `503 {"status":"unavailable","failing":["sql"]}` |
| `/api/docs` | The API reference (not in production by default)                                               |

## What is implemented

| Since   | Operations                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------- |
| Step 1  | `getConfig`                                                                                                               |
| Step 3  | `login`, `loginCallback`, `logout`, `getCurrentUser` ([authentication](authentication.md))                                |
| Step 4  | `listSurveys`, `createSurvey`, `getSurvey`, `listProjects`, `getProject` (see below)                                      |
| Step 5  | `updateSurvey`, `deleteSurvey`, `cloneSurvey` (see below)                                                                 |
| Step 6  | `getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme`, `listSurveyHistory` (see below)       |
| Step 7  | `uploadSurveyAsset`, `downloadFile` (see below)                                                                           |
| Step 8  | `getPublishedSurvey`, `submitResponse`, `uploadResponseFile`, `getResultStats` (see below)                                |
| Step 9  | `listResults`, `getResultsView`, `saveResultsView`, `resetResultsView` (see below)                                        |
| Step 10 | `exportResults`, `deleteResults`, `getPublicResults` (see below)                                                          |
| Step 11 | `createProject`, `updateProject`, `deleteProject`, `listMembers`, `addMember`, `updateMember`, `removeMember` (see below) |
| Step 12 | `receiveAccountDeleted`, the webhook of surveyjs.io (see below)                                                           |

### Step 4: surveys and projects

All five need a session; `createSurvey` also needs the CSRF header. Paging:
[Paging](paging.md).

| Operation      | Behaviour                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listSurveys`  | Query `project` (`personal`, the default, or a project id), `archived` (default `false`), `limit`, `cursor`. Newest `updatedAt` first. A project the user does not belong to, an unknown one and text that is no id all answer `404 not-found`. A bad cursor, `limit` or `archived` is `400`                                  |
| `createSurvey` | Optional body `{ name, projectId, definition }`. No `projectId` (or `null`): the user's personal scope; a project the user is not a member of: `403 forbidden`. No `name`: "New Survey N" (see [Your surveys](../user-guide/your-surveys.md#create-a-survey)). Answers `201`, `Location: /api/v1/surveys/{id}` and the survey |
| `getSurvey`    | The survey when the user can see it; `404 not-found` for an unknown survey **and** for one the user cannot see                                                                                                                                                                                                                |
| `listProjects` | The projects the user belongs to, by name ignoring case, then id, with the user's `role`. Paged                                                                                                                                                                                                                               |
| `getProject`   | The project when the user is a member; `404 not-found` otherwise                                                                                                                                                                                                                                                              |

Rules for `createSurvey`:

- A given `name` is kept as sent. It must have 1 to 200 characters and not be blank after trimming.
  A blank name is `422 validation-failed` with a pointer `/name`. The contract's `maxLength: 200`
  counts characters (code points), but the legacy column holds 200 UTF-16 code units, so the server
  also answers `422` at `/name` for a name longer than 200 UTF-16 code units (a name with emoji can
  pass the schema and still fail here).
- `createdAt` and `updatedAt` are the server's clock; the ids of the survey, its `postId` and its
  `resultId` are new GUIDs. The survey starts published (its legacy flag stays empty, which means
  published since Step 14, ADR 0014 S1) and not archived, with every setting off.
- A given `definition` is stored. Nothing is stored without one, and the definition then reads as
  `{}`. It is read back with `getSurveyDefinition` ([Step 6](#step-6-definition-theme-and-history)) and
  gets one history entry.
- `permissions.canModify` follows [ADR 0009](../adr/0009-survey-permissions-follow-legacy.md).

### Step 5: survey actions

All three need a session and the CSRF header (see
[Authentication](authentication.md#csrf-the-double-submit-rule)). The examples use a cookie jar
`cookies.txt` of a signed-in session and this setup:

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
API=http://localhost:3000/api/v1
ID=<a survey id>
```

| Operation      | Behaviour                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updateSurvey` | `PATCH /surveys/{surveyId}`, a merge patch with at least one of `name`, `projectId`, `archived`, `published`, `settings`. Answers `200` and the survey as stored |
| `deleteSurvey` | `DELETE /surveys/{surveyId}`. Only an archived survey. Answers `204` with no body                                                                                |
| `cloneSurvey`  | `POST /surveys/{surveyId}/clones`, an optional body `{ name, projectId }`. Answers `201`, `Location: /api/v1/surveys/{id}` and the copy                          |

Rules for `updateSurvey` and `deleteSurvey`:

- **Who.** The user must be allowed to modify the survey
  ([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)): the owner for a personal survey, an
  `admin` or the creator for a project survey. A survey the user can see but not modify is
  `403 forbidden` ("You cannot modify this survey."). A survey the user cannot see, or that does not
  exist, is `404 not-found`.
- **Order of checks** for `updateSurvey`: body schema (`422`), then a given `name` (`422`), then
  `404`, then `403`, then the target project of `projectId` (`403`).
- **`name`** is kept as sent, and follows the rule of `createSurvey`: 1 to 200 UTF-16 code units, not
  blank after trimming. Otherwise `422 validation-failed` with the pointer `/name`.
- **`projectId`** moves the survey. A project id moves it to that project, and the user must be a
  member of it (any role), else `403 forbidden` ("You are not a member of this project."). `null`
  moves it to the **caller's** Personal surveys. A project id equal to the current one moves nothing.
  After a real move the **caller is the survey's creator**, and `permissions.canModify` in the answer
  is worked out for the new place.
- **`archived`** and **`published`** are independent. Archiving does not unpublish.
- **`settings`** takes `publicResults`, `storeRespondentIp` and (Step 10) `privateResultQuestions`; a key you
  leave out stays as it is.
  (`useCookies` is not part of the patch and is never changed.)
- **`updatedAt`** moves on every successful `PATCH`, also when no value changes (for example
  `{"settings":{}}`), as the legacy site does.
- All fields of one request are applied together in one store call.
- **`deleteSurvey`** checks `404`, then `403`, then `409 survey-not-archived` ("Archive the survey
  before deleting it"). It deletes the survey and everything stored for it: the definition, the theme,
  the history, the results and the completion markers, the deleted-result audit and the saved results
  layouts. It is safe to call again after a failure while the survey is still listed. Files join this
  list since Step 7 (see [Uploads and files](uploads.md#deleting)).

Rules for `cloneSurvey`:

- Anyone who can see the source may clone it, also an archived one. Unknown or invisible: `404`.
- The copy goes to the source's scope. `projectId: null` puts it in the caller's Personal surveys; a
  project id puts it in that project, and the caller must be a member (`403` otherwise).
- The **caller** is the copy's creator.
- The name is the given `name` (same rule as above, `422`), or `Copy of {name}` cut to 200 UTF-16
  code units without splitting a character.
- The copy has the definition and the theme of the source. It is published (like a new survey,
  since Step 14) and active, every setting is off, and it has new `id`, `postId` and `resultId`. `createdAt` and `updatedAt` are now.
  Results and history are not copied.

Examples. Rename:

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"name":"Customer feedback 2026"}'
```

Publish and archive in one request (one request can carry several fields):

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"published":true,"archived":true}'
```

Each field also works alone, for example `{"archived":true}`.

Move to a project, and back to the caller's Personal surveys (`null` is a value here, not a removal):

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"projectId":"55555555-0000-4000-8000-a00000000002"}'
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"projectId":null}'
```

Settings:

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"settings":{"publicResults":true,"storeRespondentIp":false}}'
```

Each of these answers `200` with the survey, for example:

```json
{
  "id": "22222222-0000-4000-8000-a00000000001",
  "name": "Customer feedback 2026",
  "projectId": null,
  "published": true,
  "archived": false,
  "createdAt": "2026-03-13T10:00:00.000Z",
  "updatedAt": "2026-10-15T09:30:00.000Z",
  "postId": "33333333-0000-4000-8000-a00000000001",
  "resultId": "44444444-0000-4000-8000-a00000000001",
  "settings": { "publicResults": true, "storeRespondentIp": false },
  "permissions": { "canModify": true }
}
```

Clone, with the default name and with a name and a target:

```sh
curl -i -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" "$API/surveys/$ID/clones"
curl -i -b cookies.txt -X POST "$API/surveys/$ID/clones" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -d '{"name":"Pilot","projectId":null}'
```

Delete. A survey that is not archived is refused; archive it first:

```sh
curl -i -b cookies.txt -X DELETE -H "X-CSRF-Token: $CSRF" "$API/surveys/$ID"
```

```text
HTTP/1.1 409 Conflict
{"type":"https://studio.surveyjs.io/problems/survey-not-archived","title":"Archive the survey before deleting it","status":409,"code":"survey-not-archived"}
```

After `{"archived":true}` the same request answers `204 No Content`, and a third one `404`.

### Step 6: definition, theme and history

All five need a session. The two `PUT`s also need the CSRF header and `If-Match` (see
[Concurrent editing with ETags](concurrency.md)). The examples use the setup of the Step 5 section.

| Operation               | Behaviour                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSurveyDefinition`   | `GET /surveys/{surveyId}/definition`. `200`, the definition (`{}` when the survey has none) and an `ETag`. `404` for an unknown survey and for one the user cannot see             |
| `saveSurveyDefinition`  | `PUT /surveys/{surveyId}/definition`, a JSON object, with `If-Match`. `204` with the new `ETag`                                                                                    |
| `getSurveyTheme`        | `GET /surveys/{surveyId}/theme`. As the definition (`{}` when none)                                                                                                                |
| `saveSurveyTheme`       | `PUT /surveys/{surveyId}/theme`, a JSON object, with `If-Match`. `204` with the new `ETag`                                                                                         |
| `listSurveyHistory`     | `GET /surveys/{surveyId}/history`, query `limit` (1 to 200, default 50) and `cursor`. `200` `{ items: [{ id, at, user }], nextCursor }`, newest first. `404` as for the definition |
| `getSurveyHistoryEntry` | `GET /surveys/{surveyId}/history/{entryId}`. `200`, the definition saved in that entry. `404` as for the definition, and for an unknown entry                                      |

Rules for the two `PUT`s:

- **Who.** The user must be allowed to modify the survey (same rule and same answers as Step 5: `403`
  when the user can see the survey but not modify it, `404` when it is invisible).
- **Order of checks.** Authentication, CSRF, the body size (`413`), the media type (`415`), the body
  schema (`422`, the body must be a JSON object), then `404`, `403`, `428` (no `If-Match`) and `412`
  (the version is not the current one). Nothing is written before every check passes.
- **The body limit** is `limits.maxDocumentBytes` (`GET /config`, default 30,000,000 bytes), not the
  1 MB of the other routes.
- **Stored as** the compact JSON text of the body (`JSON.stringify`), so a read returns the same
  content, not the same bytes.
- **`updatedAt`** is set to the save time by both saves.
- **History.** Only the definition save adds an entry (with the saving user and a full snapshot of the
  definition). Creating a survey with a definition, and cloning a survey that has one, also add an
  entry. The theme save adds none.
- **The conflict test is atomic.** On the `azure-legacy` provider the definition is replaced only if
  the blob still has the ETag you sent, and the theme only if the stored text is still the one the
  ETag was made from, so two writers cannot both succeed.

Rules for `listSurveyHistory`:

- Entries are ordered by `at` (newest first), then by entry id (descending). Paging works as in
  [Paging](paging.md); the cursor is opaque, and a bad cursor or `limit` is `400`.
- `user` is `{ id, displayName }`, or `null` for entries recorded without a user (the legacy editor
  wrote none) and for users that no longer exist.
- `id` reads the definition saved in the entry with `getSurveyHistoryEntry` ([ADR 0032](../adr/0032-history-json-view.md)).
  An entry never changes. A legacy entry whose text cannot be read as a definition gives `{}`. Comparing and restoring
  entries are not built yet (P1).

Read, edit and save the definition (the full loop with explanations is in
[Concurrent editing with ETags](concurrency.md#example-a-save-loop-with-curl)):

```sh
curl -i -b cookies.txt "$API/surveys/$ID/definition"
curl -i -b cookies.txt -X PUT "$API/surveys/$ID/definition"   -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json"   -H "If-Match: $ETAG" -d '{"title":"Customer feedback","pages":[]}'
```

The second one answers `204 No Content` and an `ETag`. With a stale `If-Match` it answers
`412 Precondition Failed`:

```text
HTTP/1.1 412 Precondition Failed
{"type":"https://studio.surveyjs.io/problems/edit-conflict","title":"The survey was changed by someone else","status":412,"code":"edit-conflict","detail":"Reload the survey to see the latest version."}
```

The history, with the entries of the survey just saved:

```sh
curl -b cookies.txt "$API/surveys/$ID/history?limit=2"
```

```json
{
  "items": [
    {
      "at": "2026-10-16T08:15:02.411Z",
      "user": { "id": "11111111-0000-4000-8000-a00000000001", "displayName": "Olivia Owner" }
    },
    { "at": "2026-03-13T10:00:00.000Z", "user": null }
  ],
  "nextCursor": null
}
```

### Step 7: uploads and files

| Operation           | Behaviour                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadSurveyAsset` | `POST /surveys/{surveyId}/assets`, multipart with one part `file`. Needs a session, the CSRF header and the right to modify the survey. `201`, `Location` and the stored file |
| `downloadFile`      | `GET /public/files/{fileId}`. No session. `200` and the file, `inline` for images, with the security headers; `404` for an unknown id                                         |

The type is found from the content, a survey's files are limited by `limits.maxAssetBytesPerSurvey`, and
deleting a survey deletes its files. A clone copies them. Everything is in
[Uploads and files](uploads.md).

### Step 8: the run page's operations

| Operation            | Behaviour                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPublishedSurvey` | `GET /public/surveys/{surveyId}`, optional `clientId`. No session. `200` with the definition, the theme and, with a `clientId`, `completed`. `404 survey-not-available` when unknown or unpublished |
| `submitResponse`     | `POST /public/surveys/{surveyId}/responses`, `{ data, clientId? }`, optional `Idempotency-Key`. No session. `201 { id }`; `409` when the one-response limit is on and the client has completed      |
| `uploadResponseFile` | `POST /public/surveys/{surveyId}/files`, multipart part `file`. No session. `201`, `Location` and the stored file; any type, up to `limits.maxFileBytes`                                            |
| `getResultStats`     | `GET /surveys/{surveyId}/results/stats`. Needs a session. `200 { count, firstSubmittedAt, lastSubmittedAt }`; `404` for an unknown survey or one the user cannot see                                |

A survey runs while it is published, archived or not. The three public operations are rate limited per
address. The rules, `curl` examples, the idempotency scheme, the `cookieName` convention, `TRUST_PROXY` and
the error table are in [Public endpoints, rate limits and idempotency](public-endpoints.md).
`getResultStats` was built early, because it was the only way to see that a response was stored; the
other results operations came with Step 9.

### Step 9: results and views

All four need a session. `saveResultsView` and `resetResultsView` also need the CSRF header. `{view}` is
`summary` (the Dashboard) or `table`.

| Operation          | Behaviour                                                                                                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listResults`      | `GET /surveys/{surveyId}/results`, query `limit` (1 to 1000, default 500) and `cursor`. `200 { items, nextCursor }`, oldest first. `404 not-found` for an unknown survey or one the user cannot see |
| `getResultsView`   | `GET /surveys/{surveyId}/views/{view}`. `200` the caller's saved layout, any JSON object. `404 view-not-found` (title "View not found") when there is none                                          |
| `saveResultsView`  | `PUT /surveys/{surveyId}/views/{view}`, a JSON object. `204`. Replaces an earlier layout or a reset                                                                                                 |
| `resetResultsView` | `DELETE /surveys/{surveyId}/views/{view}`. `204`, also when nothing was saved                                                                                                                       |

Rules for `listResults`:

- Every stored response is one item `{ id, submittedAt, data, clientId?, respondentIp? }`, **oldest first**
  (`submittedAt`, then `id`). Rows of one client are **not merged**, and `partial` is not returned. There
  is no cap on the total; the dashboard walks every page. Paging and the cursor are in
  [Paging](paging.md#results-oldest-first-one-survey); the `curl` walk there uses a survey with 1,500
  responses.
- `clientId` is returned as stored. A survey of the old site may hold any string there.
- The answers are the respondents' data: they are never written to a log.
- The user needs to see the survey (the same rule as `getSurvey`). A member of the survey's project reads
  its results. Other users get `404`.
- `limit` outside 1 to 1000, a bad cursor, or a cursor of another survey: `400 bad-request`.

Rules for the views:

- **Per user.** A layout belongs to the caller and the survey. Saving or resetting one changes nothing for
  anyone else. Anyone who can see the survey (not only users who may modify it) reads, saves and resets
  their own layout. A survey that is unknown or not visible answers `404 not-found`; a visible survey
  with no layout answers `404 view-not-found` on `GET`.
- **Legacy fallback.** On the `azure-legacy` provider (and the memory provider with the fixtures), a user
  with no layout of their own and no reset gets the survey's old per-survey layout, as stored. After
  `resetResultsView`, `getResultsView` answers `404 view-not-found` **even when an old layout exists**,
  until the next save. The old layouts are never written or deleted by these operations
  ([legacy data layout](../architecture/legacy-data-layout.md#310-results-layouts-the-only-saved-ui-state)).
- **Body.** `saveResultsView` accepts any JSON object and stores it as sent. An array, a string or
  `null` is `422 validation-failed`; another media type is `415`; a body over `limits.maxResponseBytes`
  is `413 payload-too-large`. There is no limit of its own and no new variable.
- **No side effects.** A save or reset does not change the survey: `updatedAt` stays, and there is no
  history entry. A survey deletion deletes every user's layouts; a clone does not copy them.
- A missing or wrong CSRF token on the two writes is `403 csrf-token-invalid`.

Read and save a layout with `curl` (the cookie jar and `$CSRF` as in the Step 5 section):

```sh
curl -s -b cookies.txt "$API/surveys/$ID/views/summary"
# {"type":"…/problems/view-not-found","title":"View not found","status":404,"code":"view-not-found"}
curl -i -b cookies.txt -X PUT "$API/surveys/$ID/views/summary" -H "X-CSRF-Token: $CSRF"   -H "Content-Type: application/json" -d '{"elements":[{"name":"q1","isVisible":false}]}'
# HTTP/1.1 204 No Content
curl -s -b cookies.txt "$API/surveys/$ID/views/summary"
# {"elements":[{"name":"q1","isVisible":false}]}
```

### Step 10: exports, deleting and public results

| Operation          | Behaviour                                                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exportResults`    | `GET /surveys/{surveyId}/results/export`, `format` `json` or `csv`, or `Accept`. Needs a session. `200` streams every response as an attachment; `400` for another `format`; `406` when `Accept` names neither |
| `deleteResults`    | `DELETE /surveys/{surveyId}/results`. Needs a session, CSRF and the right to modify. `204`: deletes the responses, the completion markers and the respondent files                                             |
| `getPublicResults` | `GET /public/surveys/{surveyId}/results`, `limit` and `cursor`. No session. `200 { survey, items, nextCursor }` while Grant Access is on, else `404 survey-not-available`                                      |

`updateSurvey` also takes a new setting, `settings.privateResultQuestions`: the names of the questions hidden
from public results (an array of strings, `[]` for none). A patch **replaces** the whole list. It is returned by
`getSurvey`, `updateSurvey`, `createSurvey` and `cloneSurvey`, and **left out of `listSurveys` items** (reading
it from a list would mean one blob read for each survey on the old stores; call `getSurvey`). A clone starts
with `[]`. `getSurvey` and `updateSurvey` leave it out when the server cannot read the list right now: do not
offer to change it then, and read it again before you patch, so that you change only the names you mean to.
`updateSurvey` saves the list after the rest of the patch; a failed update leaves the old list.

```sh
# $API, $ID and $CSRF as in Step 5
curl -s -X PATCH -b cookies.txt -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"settings":{"privateResultQuestions":["receipt"]}}' "$API/surveys/$ID"
```

The export, the CSV rules, the file names, a failure part way and the delete are in
[Exporting results](exporting-results.md). The public results page of a survey is in
[Public endpoints](public-endpoints.md#public-results). The reasons are in
[ADR 0016](../adr/0016-results-details-exports-and-public-results.md).

### Step 11: projects and members

All seven need a session. The six that change data also need the CSRF header. Paging of `listMembers`:
[Paging](paging.md).

| Operation       | Behaviour                                                                                                                                           |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createProject` | `POST /projects`, `{ name }`. Any signed-in user. `201`, `Location` and the project: `role` `admin`, `memberCount` 1, `ownerId` the caller          |
| `updateProject` | `PATCH /projects/{projectId}`, `{ name }` as a merge patch. Admins only. `200` and the project. A patch without `name` changes nothing              |
| `deleteProject` | `DELETE /projects/{projectId}`. Admins only. `204`. The surveys move to the owner's personal scope, or to the admin who deletes                     |
| `listMembers`   | `GET /projects/{projectId}/members`, `limit` and `cursor`. Any member. `200 { items, nextCursor }` with `{ userId, displayName, email, role }`      |
| `addMember`     | `POST /projects/{projectId}/members`, `{ email, role? }`. Admins only. `201`, `Location` and the member. `404 user-not-found`, `409 already-member` |
| `updateMember`  | `PATCH /projects/{projectId}/members/{userId}`, `{ role }` (`admin` or `user`). Admins only. `200` and the member. `409 last-admin`                 |
| `removeMember`  | `DELETE /projects/{projectId}/members/{userId}`. An admin removes anyone; any member removes themselves (leaves). `204`. `409 last-admin`           |

Rules:

- **Who may do what.** An unknown project and a project the caller does not belong to both answer
  `404 not-found`, for every operation (the same as `getProject`). A member who is not an admin gets
  `403 forbidden` for rename, delete, add, change role and removing someone else. Any member may list the members
  and remove themselves. A target that is not a member of the project (or whose account no longer exists)
  is `404 not-found`.
- **Names.** A project name has 1 to 128 characters (the contract). A blank name is `422 validation-failed`
  with the pointer `/name`, checked before access, so it is the answer for a non-member too. Two projects may
  have the same name.
- **Add a member.** The `email` is found without regard to case. The `role` is `user` when left out. The admin
  check comes **before** the address lookup, so only admins can learn whether an address is registered. A user
  who is blocked can be added.
- **The last admin.** Demoting the only admin, removing them, or their leaving is `409 last-admin`. The only
  member of a project cannot leave, whatever their role: they delete the project. Setting the role a member
  already has is a `200` and writes nothing. The check and the write are one step, so two admins who demote
  each other at the same moment cannot leave the project without an admin.
- **The owner.** `Project.ownerId` is the creator of the project while the creator is still a member, else `null`.
  A role change of the creator made in another application can replace their row and make it `null`.
- **Deleting a project.** The surveys, archived ones too, with their results, files and history, are not
  deleted. They move to the owner's personal scope; when `ownerId` is `null`, to the admin who deletes the
  project. Their ids, published state and settings stay, and so does each survey's creator.
- **Members.** `listMembers` orders by display name ignoring case, then user id. A member whose account no
  longer exists is left out. A cursor of another project is `400 bad-request`.

The answers to `createProject` and `addMember` are the `Project` and the `Member` objects. Examples (the cookies `msid` and
`msid_csrf` come from the browser's developer tools, and the CSRF header carries the value of `msid_csrf`; the
demo uses the same calls, see [the Step 11 demo](../demo/step-11.md#7-the-api-view)):

```sh
API=http://localhost:5173/api/v1
AUTH=(-b "msid=<cookie>; msid_csrf=<csrf>" -H "X-CSRF-Token: <csrf>")
MIA_AUTH=(-b "msid=<Mia cookie>; msid_csrf=<Mia csrf>" -H "X-CSRF-Token: <Mia csrf>")

# Create a project
curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{"name":"Research"}' "$API/projects"
# {"id":"…","name":"Research","ownerId":"11111111-0000-4000-8000-a00000000002","role":"admin","memberCount":1,"createdAt":"…"}
P=<the id>

# Rename it with a merge patch
curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/merge-patch+json" -d '{"name":"Research team"}' "$API/projects/$P"

# Add a member, then make them an admin
curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{"email":"member@example.com"}' "$API/projects/$P/members"
# {"userId":"11111111-0000-4000-8000-a00000000003","displayName":"Mia Member","email":"member@example.com","role":"user"}
curl -s -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" -d '{"role":"admin"}' "$API/projects/$P/members/<user id>"

# Leave: a member removes their own user id (here Mia, with her own cookie; a plain member can do this)
curl -i -X DELETE "${MIA_AUTH[@]}" "$API/projects/$P/members/<Mia's user id>"
# HTTP/1.1 204 No Content

# Delete the project (admins only; the caller is still a member, so this is not a 404)
curl -i -X DELETE "${AUTH[@]}" "$API/projects/$P"
# HTTP/1.1 204 No Content
```

An address nobody registered answers `404` with `"code":"user-not-found"`; adding a member twice answers `409`
with `"code":"already-member"`; the last admin leaving answers `409` with `"code":"last-admin"`. The reasons are
in [ADR 0017](../adr/0017-projects-and-members.md); for users the page is
[Projects and team members](../user-guide/projects-and-team-members.md).

Since Step 11 only `passwordLogin` answers `501` with a Problem Details body (`code: not-implemented`). It stays
`501` until P1. A private operation called without a session answers `401`. The conformance suite has one `501`
test (`passwordLogin`, which is public); the server tests build the routes with no handler at all to check the
`501` of an operation without one.

### Step 12: the account-deleted webhook

`receiveAccountDeleted` is `POST /api/v1/webhooks/account-deleted`, in the contract's `Integrations` tag. It is not
for browsers or scripts of users. **surveyjs.io calls it** when someone deletes their surveyjs.io account, and the
server then erases that user's data: personal surveys with their results and files, the user's place in every
project (a project that would lose its last admin passes to its next member, and a project with no other member is
deleted with its surveys). The same erasure runs from `pnpm account:erase` and `pnpm account:reconcile`
([Operations](../operations.md)). The contract is the reference; the surveyjs.io side is written up in
[the user API and webhook document](../integrations/surveyjs-user-api.md#the-account-deleted-webhook).

- **No session and no CSRF header.** The call is signed, as [Standard Webhooks](https://www.standardwebhooks.com/)
  describes, with the secret the server has in `ACCOUNT_WEBHOOK_SECRET` (`whsec_` and base64). The headers are
  `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (`v1,` and the base64 HMAC-SHA256 of
  `{id}.{timestamp}.{body}`).
- **The body** is `{ "type": "account.deleted", "data": { "userId": "<user id>" } }`. Another `type` answers `204`
  and does nothing.
- **Answers.** `204`: the erasure is finished (repeat it and nothing more happens). `401 invalid-signature`: the
  signature is missing, wrong, or its timestamp is more than five minutes from the server's clock; this is checked
  before the body is read. `400`: the signature is valid but the body is not an account event, or `data.userId` is
  not an id. `404`: the server has no webhook secret. `413`: the body is over 64 KiB.
- **The server trusts the signed message.** It does not ask the user directory whether the account is gone.
- **`curl` is not practical**, because the signature needs the body and a clock. To try it on a local server use
  `pnpm webhook:account-deleted --user <id> --env-file server/demo.env`, which signs with the local demo secret
  and prints `HTTP 204` (or the refusal; `--bad-signature` shows `HTTP 401` and `invalid-signature`). See
  [the Step 12 demo](../demo/step-12.md).

`GET /config` lists `authMethods`; its values are `surveyjs`, `password`, `google`, `github` and `facebook`
(`oidc` is gone). Only `surveyjs` works ([ADR 0018](../adr/0018-accounts-by-deployment-mode.md)).

Every server answer, success or problem, carries `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin` and a `Content-Security-Policy` that forbids framing (and, except for
`/api/docs`, everything else); over https also `Strict-Transport-Security`
([ADR 0019](../adr/0019-run-page-isolation-and-security-headers.md)). The server answers no old surveyjs.io
address: `/published?id=…`, `/Service/*` and `/Results/*` are ordinary unknown paths (`404 not-found`, no
`Location`).
