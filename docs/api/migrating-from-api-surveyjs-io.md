# Moving from api.surveyjs.io to Studio's API

For integrators who call the old service, `api.surveyjs.io`. After the cutover ([ADR 0035](../adr/0035-legacy-api-bridge.md))
the old URLs keep working: a separate service, the bridge, answers them through Studio's public API
([how exactly](legacy-compat.md)). So nothing breaks the day it happens. This page is for the day you want to call
Studio's API directly: it lists every old action, the public API operations that do the same, and where the new API
differs in shape. The decisions are in [ADR 0040](../adr/0040-bridge-access-key-actions.md).

The bridge exists to give you time. It answers the actions below, and passes the site's own paths (the demos and
scheduled jobs of surveyjs.io) to the old service unchanged, so those are not actions of this API and stay with the old
service: `getTempFile`, `tempFiles`, `uploadTempFiles`, `deleteTempFile`, `nps`, `getSurveyNPCResults`,
`getSurveyNPSResults` and `getSurveyPublicDemoResults`.

## A credential: API token or legacy key

The old API took the **access key** of a user in the query: `?accessKey=…`. Studio's API takes a credential in a header,
`Authorization: Bearer <value>`, and accepts two kinds ([API tokens](api-tokens.md), the people's page is
[API tokens in the user guide](../user-guide/api-tokens.md)):

- **An API token** (`sjs_` and 43 characters), made on the **API tokens** page. It has one scope: the owner's personal
  surveys, or one project. It can be revoked alone, and it is what you should use in new code.
- **The legacy access key** you already have, 32 hexadecimal digits. It works as a bearer value for the surveys its owner
  can reach. Through the bridge, `?accessKey=` is simply sent on as the bearer value. It stops working when you revoke it
  (where the instance allows that) or when its owner is blocked.

So the move is: make a token, replace `?accessKey=…` with the header, and replace the old URL with the operation below.
The examples set two variables (the address of your Studio's API, and a token; the value here is a sample, not a real
credential):

```sh
API=http://localhost:3000/api/v1
TOKEN=sjs_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEX
```

A bearer request needs no CSRF token. Studio's other rules apply: its [permissions](../adr/0009-survey-permissions-follow-legacy.md)
(the owner, a project admin, or the survey's creator may change a survey), [paging](paging.md) with a cursor, an `ETag`
on definitions ([concurrency](concurrency.md)), and a `429` with `Retry-After` when you ask too often. Errors come as
[problem documents](conventions.md) with a `code`, not as the old API's bare texts.

## Every action and its operations

One row for each action the bridge answers, in the order of the bridge's mapping table (`bridge/src/mapping.ts`). A test
(`bridge/src/guide.test.ts`) checks that this table and the mapping table list the same actions, methods and
operations, so this list is the list of what the bridge answers. The **Action** column holds the path without the
`v1` prefix; each also answers under `public/v1/Survey` and `private/v1/Surveys`. The third column is what the bridge
calls to give the old answer (some of those calls only build the old record's shape); the last is what you call when you
move.

The operations are in the [API reference](README.md#view-the-api-reference). Seven public operations (the ones
[for the bridge](public-endpoints.md#operations-for-the-bridge), such as `getPublicDefinition` and
`submitResponseByPostId`), `getPublicLayout` and `uploadLegacyFile` exist in Studio's **hosted edition** only.

| Action                                        | Methods | Operations the bridge calls                                            | What to call instead                                                                   |
| --------------------------------------------- | ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `public/Survey/getSurvey`                     | GET     | `getPublicDefinition`                                                  | `GET /public/surveys/{surveyId}/definition`                                            |
| `public/Survey/getSurveyAndIsCompleted`       | GET     | `getRespondentState`, `getPublicDefinition`                            | Both calls: the definition and the respondent's state                                  |
| `public/Survey/isCompleted`                   | GET     | `getRespondentStateByResultId`                                         | `getRespondentStateByResultId`; the answer is `{ state }`, not a bare string           |
| `public/Survey/post`                          | POST    | `submitResponseByPostId`                                               | `submitResponseByPostId`: `POST /public/posts/{postId}/responses`, `data` as an object |
| `public/Survey/upload`                        | POST    | `uploadResponseFileByPostId`                                           | `uploadResponseFileByPostId`: `POST /public/posts/{postId}/files`                      |
| `public/Survey/getResult`                     | GET     | `getQuestionSummary`                                                   | `getQuestionSummary`: `GET /public/results/{resultId}/questions/{name}`                |
| `private/Surveys/getSurveyPublicResults`      | GET     | `getPublicResults`                                                     | `getPublicResults`: `GET /public/surveys/{surveyId}/results`                           |
| `public/Survey/image`                         | GET     | `downloadFile`, `getLegacyFile`                                        | `downloadFile` for Studio's own files, `getLegacyFile` for old names                   |
| `public/Survey/file`                          | GET     | `downloadFile`, `getLegacyFile`                                        | As `image`                                                                             |
| `private/Surveys/files`                       | GET     | `getLegacyFile`                                                        | `getLegacyFile`: `GET /public/legacy-files/asset/{name}`                               |
| `private/Surveys/generateAccessKey`           | GET     | `replaceCurrentCredential`                                             | `replaceCurrentCredential`: `POST /me/credential`, with an API token                   |
| `private/Surveys/setGenerationJSONType`       | PUT     | `getCurrentUser`                                                       | Nothing: the setting is not read anywhere. Stop calling it                             |
| `private/Surveys/getSurveyInfo`               | GET     | `getSurvey`, `getSurveyTheme`, `getSurveyDefinition`, `getCurrentUser` | `getSurvey` for the record, `getSurveyDefinition` and `getSurveyTheme` for the JSON    |
| `private/Surveys/getActive`                   | GET     | `listSurveys`, `getCurrentUser`                                        | `listSurveys` (`archived=false`, `project`)                                            |
| `private/Surveys/getArchive`                  | GET     | `listSurveys`, `getCurrentUser`                                        | `listSurveys` with `archived=true`                                                     |
| `private/Surveys/create`                      | POST    | `createSurvey`, `getCurrentUser`                                       | `createSurvey`: `POST /surveys`                                                        |
| `private/Surveys/archive`                     | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "archived": true }`                                             |
| `private/Surveys/restore`                     | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "archived": false }`                                            |
| `private/Surveys/delete`                      | DELETE  | `deleteSurvey`, `updateSurvey`                                         | `deleteSurvey`: `DELETE /surveys/{surveyId}`; archive an active survey first           |
| `private/Surveys/changeName`                  | PUT     | `updateSurvey`, `getSurvey`                                            | `updateSurvey` with `{ "name": … }`                                                    |
| `private/Surveys/getIsPublished`              | GET     | `getSurvey`                                                            | `getSurvey`: `published`, and `legacyPublishId` for the old publish id                 |
| `private/Surveys/publishVersion`              | PUT     | `listSurveys`, `updateSurvey`                                          | Nothing: it changed nothing a caller can read. Use `publish`                           |
| `private/Surveys/publish`                     | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "published": true }`                                            |
| `private/Surveys/unPublish`                   | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "published": false }`                                           |
| `private/Surveys/setUseCookies`               | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "settings": { "useCookies": … } }`                              |
| `private/Surveys/changeVersionTitle`          | PUT     | `listSurveys`                                                          | Nothing: it changed nothing a caller can read                                          |
| `private/Surveys/getIsResultPublic`           | GET     | `getSurvey`                                                            | `getSurvey`: `settings.publicResults`                                                  |
| `private/Surveys/makeResultPublic`            | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "settings": { "publicResults": … } }`                           |
| `private/Surveys/storeIPAddressInResult`      | PUT     | `updateSurvey`                                                         | `updateSurvey` with `{ "settings": { "storeRespondentIp": … } }`                       |
| `private/Surveys/clone`                       | POST    | `cloneSurvey`                                                          | `cloneSurvey`: `POST /surveys/{surveyId}/clones`                                       |
| `private/Surveys/clone`                       | PUT     | `cloneSurvey`                                                          | `cloneSurvey`: `POST /surveys/{surveyId}/clones`                                       |
| `private/Surveys/changeOrganization`          | PUT     | `getCurrentUser`, `updateSurvey`                                       | `updateSurvey` with `{ "projectId": … }`                                               |
| `private/Surveys/changeJson`                  | PUT     | `saveSurveyDefinition`, `getSurvey`, `updateSurvey`                    | `saveSurveyDefinition`: `PUT /surveys/{surveyId}/definition`                           |
| `private/Surveys/changeTheme`                 | PUT     | `saveSurveyTheme`, `getSurvey`, `updateSurvey`                         | `saveSurveyTheme`: `PUT /surveys/{surveyId}/theme`                                     |
| `private/Surveys/getHistoryPoint`             | GET     | `getSurveyHistoryEntry`, `getSurvey`                                   | `getSurveyHistoryEntry`: `GET /surveys/{surveyId}/history/{entryId}`                   |
| `private/Surveys/uploadFiles`                 | POST    | `getCurrentUser`, `uploadLegacyFile`                                   | `uploadLegacyFile` (hosted), or `uploadSurveyAsset` for one survey                     |
| `private/Surveys/deleteResult`                | DELETE  | `listSurveys`, `deleteResponse`                                        | `deleteResponse`: `DELETE /surveys/{surveyId}/results/{responseId}`                    |
| `private/Surveys/deleteAllResults`            | DELETE  | `deleteResults`                                                        | `deleteResults`: `DELETE /surveys/{surveyId}/results`                                  |
| `private/Surveys/getSurveyResults`            | GET     | `listResults`                                                          | `listResults` (`limit`, `cursor`, `from`, `till`)                                      |
| `private/Surveys/getSurveyDemoResults`        | GET     | `listResults`                                                          | `listResults` with `limit=1000`                                                        |
| `private/Surveys/exportSurveyResults`         | GET     | `getSurvey`, `getSurveyDefinition`, `getSurveyLayout`, `listResults`   | `exportResults`: `GET /surveys/{surveyId}/results/export`                              |
| `private/Surveys/getResultColumns`            | GET     | `getSurvey`, `getSurveyDefinition`, `getSurveyLayout`, `listResults`   | No operation: worked out from the definition and the responses                         |
| `private/Surveys/setResultColumns`            | PUT     | `saveSurveyLayout`, `getSurvey`                                        | `saveSurveyLayout` with kind `columns`                                                 |
| `private/Surveys/getResultTableState`         | GET     | `getSurvey`, `getSurveyLayout`                                         | `getSurveyLayout` with kind `table`                                                    |
| `private/Surveys/setResultTableState`         | PUT     | `saveSurveyLayout`, `deleteSurveyLayout`                               | `saveSurveyLayout` or `deleteSurveyLayout`, kind `table`                               |
| `private/Surveys/getResultSummaryState`       | GET     | `getSurvey`, `getSurveyLayout`                                         | `getSurveyLayout` with kind `summary`                                                  |
| `private/Surveys/setResultSummaryState`       | PUT     | `saveSurveyLayout`, `deleteSurveyLayout`                               | `saveSurveyLayout` or `deleteSurveyLayout`, kind `summary`                             |
| `private/Surveys/setResultPermissions`        | PUT     | `updateSurvey`, `getSurvey`                                            | `updateSurvey` with `settings.privateResultQuestions`                                  |
| `private/Surveys/getResultPublicColumns`      | GET     | `getPublicLayout`, `getPublicResults`                                  | No operation: as `getResultColumns`, for the public results                            |
| `private/Surveys/getPublicResultTableState`   | GET     | `getPublicLayout`                                                      | `getPublicLayout` with kind `table`                                                    |
| `private/Surveys/getPublicResultSummaryState` | GET     | `getPublicLayout`                                                      | `getPublicLayout` with kind `summary`                                                  |
| `private/Surveys`                             | any     | none                                                                   | Nothing: the bare path answers an empty `500`                                          |

`(root)` is the bare `private/Surveys` path: it answers an empty `500` for every method and calls nothing.

## Examples

### Surveys: list, read, create, change

```sh
# getActive / getArchive: the personal surveys; add &project=<id> for a project's
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys?archived=false&limit=50"
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys?archived=true"

# getSurveyInfo: the record, then the definition
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID"
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/definition"

# create (a name and a definition are optional)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"My survey","definition":{"elements":[{"type":"text","name":"q1"}]}}' "$API/surveys"

# changeName, archive, restore, publish, unPublish, changeOrganization, setUseCookies,
# makeResultPublic, storeIPAddressInResult, setResultPermissions: one PATCH each
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"New name","archived":false,"published":true}' "$API/surveys/$ID"
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"settings":{"publicResults":true,"useCookies":true,"privateResultQuestions":["email"]}}' "$API/surveys/$ID"

# clone, delete (archive first when the survey is active)
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/clones"
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID"
```

Where the new API differs:

- **Records.** A survey is `{ id, name, projectId, published, archived, createdAt, updatedAt, postId, resultId, … }` in
  camel case, with dates as `Z` timestamps and `settings` for Grant Access, "Save Respondent IP", "Limit to one response"
  and the private questions. The old `PostId`, `ResultId`, `UserId`, `AllowAccessResult`, `StoreIPAddress` and `IsArchived`
  are `postId`, `resultId`, `creatorId`, `settings.publicResults`, `settings.storeRespondentIp` and `archived`.
  `published` is `true` unless the survey was unpublished; the old `IsPublished` could be `null`.
- **`ownerId`** (a project's id in `getActive`) is `project`; without it you get the token's own space, as with the old
  personal list. A project token sees only its project. Add `include=theme` to get each survey's theme in the list.
- **Lists** are pages: follow `nextCursor` ([paging](paging.md)); the order is newest first, as before.
- **`delete`** needs an archived survey. The bridge archives first because the old API deleted active surveys.
- **A `PATCH`** changes only the fields you send, and `settings` takes the whole `privateResultQuestions` list. Moving a
  survey (`projectId`) is allowed to a project you can move it to, or `null` for Personal.
- **`getIsPublished`'s `publishid`** is `legacyPublishId` on the survey record (hosted edition; `null` for surveys made
  in Studio).

### Content: the definition, the theme, history and files

```sh
# changeJson: the whole definition, with If-Match (the ETag of your last read, or * for no check)
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "If-Match: *" \
  -d '{"title":"Changed","elements":[{"type":"text","name":"q1"}]}' "$API/surveys/$ID/definition"

# changeTheme
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "If-Match: *" \
  -d '{"themeName":"default"}' "$API/surveys/$ID/theme"

# getHistoryPoint: list the entries, then read one
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/history"
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/history/$ENTRY"

# uploadFiles: an editor file that belongs to no survey (hosted), or one of a survey
curl -s -X POST -H "Authorization: Bearer $TOKEN" -F "file=@image.png" "$API/legacy-files"
```

- **`changeJson`'s body** is the survey JSON itself, not `{ Id, Json }` with the JSON as a string, and the survey is in
  the path. Use the `ETag` of the last read in `If-Match` for a conflict check ([concurrency](concurrency.md)); a save is
  a history point.
- **`uploadFiles`** answers `{ legacyName }`, a new GUID that `getLegacyFile` serves. Use `uploadSurveyAsset` (`POST
/surveys/{surveyId}/assets`) for a file that belongs to one survey: it counts against that survey's quota and is
  deleted with it.

### Results

```sh
# getSurveyResults: a page of responses, oldest first; from and till bound the first-save time
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/results?limit=500&from=2026-01-01T00:00:00Z"
# the next page: the cursor of the last one
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/results?limit=500&cursor=$CURSOR"

# exportSurveyResults: every response as a file
curl -s -H "Authorization: Bearer $TOKEN" -o results.csv "$API/surveys/$ID/results/export?format=csv"

# deleteResult, deleteAllResults
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/results/$RESPONSE"
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/results"
```

- **Shape.** A response is `{ id, submittedAt, data, … }` with `data` an object; the old `Data` rows were flat objects
  with `HappendAt` and `InstanceId` beside the answers. A page is `{ items, nextCursor }`, where the old answer was
  `{ Data, ResultCount, ContinuationToken }`.
- **Runs.** The partial saves of a client are one response ([partial saves](public-endpoints.md#partial-saves)), and
  `deleteResponse` deletes the whole run, with the id of any save in it.
- **The CSV** quotes a cell that holds a comma, a quote or a line break, ends lines with CRLF and starts with a byte order
  mark ([exporting results](exporting-results.md)).
- **`getSurveyDemoResults`** is `listResults` with `limit=1000`.

### Layouts and permissions

A survey has one shared layout of each kind, `table`, `summary` and `columns`, kept as the text you send. They are
the default layout of every user who has not saved their own ([viewing results](../user-guide/viewing-results.md#your-layout-is-saved)).

```sh
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/layouts/table"
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"{\"visibleColumns\":[\"q1\"]}"}' "$API/surveys/$ID/layouts/table"
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" "$API/surveys/$ID/layouts/table"

# the public read, for a survey with Grant Access on (hosted edition; no credential)
curl -s "$API/public/surveys/$ID/layouts/table"
```

- **Permissions** are the survey's `settings.privateResultQuestions`: the questions public results hide. The old
  per-element `isPublic` flags become that list, and `getPublicLayout` returns it with the layout text.
- **`getResultColumns`** and **`getResultPublicColumns`** have no operation: they were worked out from the definition and
  the responses, and a client can do the same from `getSurveyDefinition` and `listResults`.

### Public actions

```sh
# getSurvey: the working definition, whatever the publish state (hosted edition)
curl -s "$API/public/surveys/$ID/definition"

# post: the response is an object, not a JSON string; clientId and partial are optional
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"data":{"q1":"Ada"},"clientId":"visitor-1"}' "$API/public/posts/$POST/responses"

# isCompleted, getResult
curl -s "$API/public/results/$RESULT/respondents/visitor-1"
curl -s "$API/public/results/$RESULT/questions/q1"

# getSurveyPublicResults
curl -s "$API/public/surveys/$ID/results?limit=100"
```

The public operations need no credential and are limited per address ([rate limits](public-endpoints.md#rate-limits)).
`getSurveyPublicResults` is `getPublicResults`, which also leaves out the private questions and the respondent's client
id and address.

### Replacing the key

`generateAccessKey` made a new legacy key and stopped the old one. With a token, call `replaceCurrentCredential`; the
answer is the new value ([API tokens](api-tokens.md#replacing-the-credential-of-a-request)):

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/me/credential"
```

A legacy key cannot be replaced this way yet: make an API token instead, and revoke the key on the API tokens page.

## What has no equivalent

- **`setGenerationJSONType`**: a setting only the old editor read. Studio reads it nowhere; the bridge checks the key and
  stores nothing.
- **`publishVersion`** and **`changeVersionTitle`**: hidden actions that changed nothing a caller can read back
  (`changeVersionTitle` leaves an audit entry). Publish with `updateSurvey`.
- **Card images**: Studio has none. `changeJson`, `changeTheme` and `uploadFiles` ignore them.
- **The cookie sign-in** of the old site: not accepted. An empty `401` has no `Location`.

## Bad keys

With a bad key the bridge answers as the old API did, and Studio answers `401` with a problem document. Through the bridge
that is an empty `401` for most actions and `200` with a `text/html` line for five of them (`generateAccessKey`,
`getSurveyDemoResults`, `exportSurveyResults`, `uploadFiles`, `PUT clone`); [the bridge's guide](legacy-compat.md#a-bad-key)
has the table. Calling Studio directly, check the status code, not the body.

## What stays the same, and what does not

The bridge keeps the old answers except where a caller cannot depend on them, and the exceptions are listed in
[the bridge's guide](legacy-compat.md#differences-in-the-access-key-actions). A direct call has Studio's answers: the
differences above are the ones to expect when you move.
