# ADR 0040: The bridge's access-key actions and what Studio's public API adds for them

Status: Accepted (hosted Step 6, 2026-11-20). Builds on [ADR 0035](0035-legacy-api-bridge.md) (the bridge),
[ADR 0037](0037-access-keys-and-api-tokens.md) (access keys and API tokens) and
[ADR 0039](0039-bridge-public-actions.md) (the public actions). Settles how the bridge answers the old API's
`accessKey` actions, which operations Studio's public API gains for them, and where a survey's shared results layout
lives.

## Context

Hosted Step 6 builds the bridge's second half: the actions under `private/Surveys` and `private/v1/Surveys` that take
the `accessKey` query parameter (about 40, listed in [Legacy API usage](../architecture/legacy-api-usage.md)), and the
four results-layout reads Step 5 left forwarded (`getIsResultPublic`, `getResultPublicColumns`,
`getPublicResultTableState`, `getPublicResultSummaryState`).

The old code (legacy documentation, private location, plan-hosted rule 6) shows:

- **Two answers for a bad key.** Most actions answer a missing, wrong or blocked user's key with an empty `401` whose
  `Location` points to the site's sign-in page and carries the key. Five (`generateAccessKey`, `getSurveyDemoResults`,
  `exportSurveyResults`, `uploadFiles`, `PUT clone`) answer `200 text/html` "The accessKey '…' is incorrect.", with the
  key echoed unencoded.
- **Permissions:** the owner, any member of the owning organization (only `archive`, `restore` and `delete` need the
  `admin` role), and a hard-coded list of site administrators. `changeOrganization` moves a survey to any id given,
  checked against nothing.
- **Results layouts are one copy per survey,** shared by everyone: the Table state, the Summary state, an older column
  layout, and a permissions list (which questions public results hide). The reads return the stored text as a JSON
  string inside JSON, combined with the permissions.
- **Some actions change nothing that this API reads back:** `setGenerationJSONType` sets a user setting only the site's
  old editor reads; `publishVersion` sets the survey's publish id to the value it already has; `changeVersionTitle`
  writes an audit record and nothing else. ADR 0035 point 4 expected the first two to need storage in Studio; they do
  not, except that the publish id must be readable (`getIsPublished`, `publishVersion` and `changeVersionTitle` look a
  survey up by it).
- **Paging** in `getSurveyResults` hands out two kinds of continuation token, a decimal offset or the storage's own
  opaque token, depending on whether the survey has any response with a client id.
- **Failures nobody can depend on:** layouts and themes over about 32,000 characters fail and are not saved; the bare
  `private/Surveys` path answers `500`; the CSV export doubles quotes but never quotes a cell, so a comma in an answer
  splits it.

Studio's public API already offers most of what the actions need to bearer callers: listing (by project, archived),
create, clone, rename, archive, publish, move, delete, the definition (with history), the theme, assets, the history,
listing, exporting and deleting all responses, and per-user results views. It lacks: the "Limit to one response"
setting, a survey's creator, a lookup by post ID or publish ID, deleting one response, date bounds on authenticated
result reads, a shared layout, and uploads that belong to no survey.

## Decision

### 1. Exact wherever a caller can depend on it, as in ADR 0039

ADR 0039 point 1 applies to every action of this step: routes (both prefixes, any letter case, an optional trailing
slash, the `{id}` forms where the old route has them; `id` from the form beats the route, which beats the query),
methods, status codes, content types, the headers a caller reads, JSON shapes, property names, casing and order, value
formats (dates with and without `Z` as each action has them), the HTML-encoded `Json` of `getSurveyInfo`, the JSON
string holding JSON of the layout reads, and error texts. Incidental bytes are not reproduced.

**Deliberate differences:**

| Old behaviour                                                                                                              | The bridge                                                                                                                       | Why                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| The bad-key text echoes the key unencoded as `text/html`                                                                   | the same text, the key HTML-encoded                                                                                              | a reflected-HTML hole on `api.surveyjs.io`                                  |
| The empty `401` carries a `Location` to the site's sign-in, with the key in it                                             | an empty `401` without `Location`                                                                                                | the key leaks into redirects and logs; the sign-in page goes at the cutover |
| Any member of a project may change its surveys; site administrators may change any survey                                  | Studio's permissions ([ADR 0009](0009-survey-permissions-follow-legacy.md)): the owner, a project admin, or the survey's creator | one permission model; Studio has no site-administrator role                 |
| `changeOrganization` moves a survey to any id                                                                              | to Personal (the caller's own id) or to a project the caller may move it to; any other id gets the old "Access denied" answer    | an unchecked move makes surveys vanish                                      |
| The CSV export never quotes a cell                                                                                         | quotes a cell that holds `,`, `"` or a line break; everything else as the old export                                             | the old output is unreadable for exactly those cells                        |
| `setGenerationJSONType` stores a user setting                                                                              | checks the key and stores nothing                                                                                                | nothing in the API reads it; the editor that did goes at the cutover        |
| `changeJson` and `changeTheme` drop the survey's My Surveys card image; `uploadFiles` keeps a client-given card image name | no card images; every upload gets a new name                                                                                     | Studio has no card images (ADR 0012); any key could overwrite any card      |

The remaining differences are smaller and listed in [`docs/api/legacy-compat.md`](../api/legacy-compat.md): responses
folded into runs as ADR 0038 has them (the old code merges every row of a client, last wins); `IsPublished` never
`null` and `CreatorId` the real creator; a layout save that does not move the survey up `getActive`; layouts and themes
of any size saved; a `changeJson` whose `Json` is not a JSON object refused; and the bare `private/Surveys` path
answered with an empty `500` by the bridge itself.

### 2. The key

- The bridge sends the `accessKey` value (any letter case of the name) as `Authorization: Bearer` and never reads or
  keeps it otherwise. It reads the key where the old action did: most actions from the query; four of the five
  text-answer actions (`generateAccessKey`, `getSurveyDemoResults`, `uploadFiles`, `PUT clone`) from a form field first,
  then the query, as the old API bound any simple parameter; `exportSurveyResults` from the query only. A missing or
  empty key reaches no Studio call: the bridge answers the action's bad-key answer at once. A present key is checked by
  Studio, after the bridge has read the body: for the actions answering the empty `401`, a wrong key sent with an
  unreadable or invalid body gets that body's empty `400`.
- **Bad-key answers by action,** as the old API: the empty `401` for the actions that require sign-in; `200` with the
  text for the five above; `POST clone` an empty `401`. A Studio `401` (unknown, revoked, blocked owner) maps the same
  way. A Studio `404` or `403` for the survey maps to the action's own "You are not authorized …" answer with the id,
  as the old API answers unknown and forbidden surveys alike.
- **API tokens work too,** within their scope (ADR 0037 point 3): through the bridge a Personal token sees only the
  personal surveys, and `ownerId` naming another project falls back to Personal, as the old API falls back for a
  non-member.
- **Fail closed.** Step 3 left a request's credential scope defaulting to "everything" when absent (its ruling R3).
  Before the bridge builds on it, the scope becomes required: a request without one is refused.
- **`generateAccessKey`** follows ADR 0037 point 5: with an API token, `replaceCurrentCredential` rotates it and the
  bridge answers the new value as a JSON string; with a legacy key, Studio answers `409 legacy-key-replace-unavailable`
  until the keys move into Studio (Steps 8–9), and the bridge then forwards the request to the old service, which owns
  the key.

### 3. What Studio's public API adds

Ordinary operations and fields, available to bearer callers and implemented on the memory, SQL and Azure legacy
providers, with conformance tests and web sandbox handlers. "Hosted" marks the ones that exist only when
`APP_EDITION=hosted` (`404` elsewhere, as in ADR 0039).

| Change                                                                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Survey.useCookies`; `updateSurvey` `settings.useCookies`                  | "Limit to one response", readable and settable                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Survey.creatorId`                                                         | Who created the survey (moving a survey makes the mover its creator, as both Studio and the old API do)                                                                                                                                                                                                                                                                                                                                                     |
| `Survey.legacyPublishId` (hosted)                                          | The publish id the old service gave a survey, read-only; `null` for surveys made in Studio                                                                                                                                                                                                                                                                                                                                                                  |
| `listSurveys` `include=theme`                                              | Each item carries its theme, so a list costs one call                                                                                                                                                                                                                                                                                                                                                                                                       |
| `listSurveys` `postId`, `legacyPublishId` (the latter hosted)              | Finds the survey with that id among every survey the caller can see, Personal and projects alike                                                                                                                                                                                                                                                                                                                                                            |
| `deleteResponse` `DELETE /surveys/{surveyId}/results/{responseId}`         | Deletes one response (the whole run, ADR 0038), keeps an audit copy as `deleteResults` does, and clears that respondent's completion state when it was their latest run. `responseId` may be the id of any stored save in the run: callers hold the ids the old API showed, which for a run of saves was the last one's                                                                                                                                     |
| `listResults` `from`, `till`                                               | Bounds on the first-save time, as on `getPublicResults`                                                                                                                                                                                                                                                                                                                                                                                                     |
| Shared layouts `GET`/`PUT`/`DELETE /surveys/{surveyId}/layouts/{kind}`     | `kind` is `table`, `summary` or `columns`. The text as given, stored and returned verbatim. Read: anyone who can see the survey; write and delete: anyone who can change it                                                                                                                                                                                                                                                                                 |
| `getPublicLayout` `GET /public/surveys/{surveyId}/layouts/{kind}` (hosted) | When public results are on: the layout text and the private question names, for the bridge's public layout reads. Rate limited as a public read                                                                                                                                                                                                                                                                                                             |
| `uploadLegacyFile` `POST /legacy-files` (hosted)                           | An editor file that belongs to no survey, stored under a new legacy name, a random lower-case GUID distinct from the file's id (the form the old API gave its uploads), and served by `getLegacyFile` (`asset`). It is the uploader's, deleted with their account. It goes to Studio's own file store on every provider, never to the old share ([ADR 0013](0013-editor-uploads-and-files.md) R2); `getLegacyFile` looks there first, then in the old share |

### 4. The shared results layout

- **One layout per survey and kind,** beside Studio's per-user views. A user with no view of their own and no reset sees
  the shared layout as the default; that replaces today's read of the old per-survey layout, which on the Azure legacy
  provider is the same data.
- **Storage:** on the Azure legacy provider, the old per-survey layout itself, read and written in place, so the old
  site and the bridge see one copy until the cutover; on the SQL providers a `survey_layouts` table (next migration);
  in memory, a map. Deleted with the survey, not copied by a clone, no history and no audit (Studio's views rule R7).
- **Permissions are `privateResultQuestions`.** `setResultPermissions` sets the private questions to the names it marks
  not public (an empty value changes nothing, as the old API); the layout reads combine them as the old code combines its
  permissions list: an element whose name is private reads `isPublic: false`, any other `true`. So the questions public
  results hide are decided in one place for Studio and the bridge.
- **`getResultColumns` and `getResultPublicColumns`** are computed by the bridge as the old code computes them, from the
  definition, every response and the `columns` layout, with the column titles in the language of the first
  `Accept-Language` entry.

### 5. Rules for the builder

- **One mapping table** in the bridge lists each old action, its methods and the Studio operations it calls. The router
  is built from it, and a test checks that the migration guide's table has exactly its rows, so the guide and the code
  say the same.
- **Continuation tokens are the bridge's own,** opaque, wrapping Studio's cursor. A decimal token from the old offset
  engine is honoured as an offset; any other token the bridge did not make starts again at the first page, as the old
  offset engine does. `ResultCount` is the rows in the page, and `ContinuationToken` comes first, as the old answer has
  it.
- **Whole-survey reads** (`getSurveyResults` without paging, `getSurveyDemoResults`, the export, the column reads) walk
  Studio's pages as Step 5's public results do, waiting out a `429` within the same answer.
- **`InstanceId`** in result answers is the response's id as Studio returns it: the run's id, as in Step 5.
- **Writes through Studio's checks:** `changeJson` saves with `If-Match: *` (no version check, as the old API) and is a
  history point, as the editor's saves are; the `Text` field is ignored. `delete` archives an active survey and then
  deletes it, because the old API deletes active surveys and its callers are server integrations; Studio's two-step
  rule ([ADR 0011](0011-survey-actions.md) R8) stays for its own pages and for direct callers of its API. A failure
  between the two calls leaves the survey archived, and a retry finishes. `create` makes an empty survey. `clone` is
  named "Copy of …" and placed with the source, and its answer is empty, as the old API's.
- **The anonymous and placeholder keys** answer as the old code: `uploadFiles` with the documentation's placeholder key
  stores nothing and maps each file to the zero GUID.
- Studio statuses the old API never gave: ADR 0039 point 5 (`429` passes through empty; anything unexpected is an empty
  `500`).

### 6. How the answers are checked

As ADR 0039 point 6: golden files derived from the old code now, each marked derived; the SurveyJS team's recording
script gains the access-key actions, run with the test account's key against surveys it creates and deletes itself,
and the reviewed recordings replace the derived files before Step 7. Each action is checked with a valid, a wrong and
a revoked key.

### Why not the alternatives

| Option                                                          | Why not                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Layouts as the caller's own per-user view                       | The old shared answer is not reproduced, and the public layout reads still need a shared copy                |
| Layouts in an opaque store only the bridge reads                | Studio would never show what an integrator saved                                                             |
| A "legacy settings" bag on surveys and users (ADR 0035 point 4) | Nothing reads the settings back; only the publish id is read, and it is a plain read-only field              |
| The old permissions list stored beside `privateResultQuestions` | Two answers to "which questions are private", which drift as soon as either side changes                     |
| The old permission model for bridge callers                     | A key would change surveys Studio's own pages refuse to change; site administrators are not a role in Studio |
| The bridge lists every survey to find one by post or publish id | One call per survey the caller can see, for every `deleteResult`                                             |

## Consequences

- **Studio's contract** gains the fields, filters and operations in point 3; the hosted-only ones follow ADR 0039's
  edition rule. A migration adds `survey_layouts`; uploads that belong to no survey need a file row without a survey
  (the plan settles the column).
- **ADR 0035 point 4** is narrowed: no setting is stored "as given"; `legacyPublishId` is the only legacy value Studio
  keeps for the old API's answers.
- **Step 3's ruling R3** is reversed: the request scope is required.
- **Differences from the old API:** point 1, and the full list in [`docs/api/legacy-compat.md`](../api/legacy-compat.md).
- **The migration guide** `docs/api/migrating-from-api-surveyjs-io.md` lists every old action with its public API
  operations and examples, checked against the bridge's mapping table.
- **Step 9** copies the old per-survey layouts into `survey_layouts` and the old permissions into the private questions,
  and keeps each survey's publish id.
- **[Legacy API usage](../architecture/legacy-api-usage.md)** is corrected: `publishVersion` writes no snapshot, and
  `changeVersionTitle` records an audit entry.
- **The recordings** may bring a round of small fixes before Step 7.
