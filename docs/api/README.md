# API

The API is defined by one file: [`contract/openapi.yaml`](../../contract/openapi.yaml) (OpenAPI 3.1).
It is the source of truth for the server, the web client and the conformance suite. All paths are
relative to `/api/v1`.

This directory holds guides. The reference itself is generated from the contract and is not
committed.

- [Conventions](conventions.md): errors, paging, concurrency, CSRF, idempotency and more.
- [Paging](paging.md): `limit` and `cursor`, what a page can hold, and the reference cursor format for ports.
- [Authentication, sessions and CSRF](authentication.md): the sign-in flow, `returnTo`, the cookies,
  the CSRF header, sign-out and rate limiting.

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
pnpm --filter @my-surveys/contract build:docs
```

(`pnpm build` does this too.) The output is one self-contained HTML file,
`contract/dist/reference.html`, with no external requests. It is git-ignored; you can open it
straight from disk or publish it as a static page.

The page is read from disk on every request, so after you rebuild it, a refresh shows the new version.

## Check and regenerate

Lint runs with Redocly telemetry off (`telemetry: off` in `contract/redocly.yaml`) and its update check
suppressed. The three operations that legitimately lack a 2xx or 4xx response (`GET /auth/login`,
`GET /auth/callback`, `GET /config`) are listed in `contract/.redocly.lint-ignore.yaml`.

| Command                                       | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint:contract`                          | Redocly lint, and fail if `generated/openapi.d.ts` is stale |
| `pnpm --filter @my-surveys/contract generate` | Regenerate the TypeScript types from the contract           |

## Outside `/api/v1`

| Path        | Purpose                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `/healthz`  | Process is up: `200 {"status":"ok"}`                                         |
| `/readyz`   | Providers are ready: `200 {"status":"ok"}` or `503 {"status":"unavailable"}` |
| `/api/docs` | The API reference (not in production by default)                             |

## What is implemented

| Since  | Operations                                                                                 |
| ------ | ------------------------------------------------------------------------------------------ |
| Step 1 | `getConfig`                                                                                |
| Step 3 | `login`, `loginCallback`, `logout`, `getCurrentUser` ([authentication](authentication.md)) |
| Step 4 | `listSurveys`, `createSurvey`, `getSurvey`, `listProjects`, `getProject` (see below)       |
| Step 5 | `updateSurvey`, `deleteSurvey`, `cloneSurvey` (see below)                                  |

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
  `resultId` are new GUIDs. The survey starts unpublished and not archived, with every setting off.
- A given `definition` is stored. Nothing is stored without one, and the definition then reads as
  `{}`. It is read back over HTTP in a later step (`getSurveyDefinition` is still `501`).
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
- **`settings`** takes `publicResults` and `storeRespondentIp`; a key you leave out stays as it is.
  (`useCookies` is not part of the patch and is never changed.)
- **`updatedAt`** moves on every successful `PATCH`, also when no value changes (for example
  `{"settings":{}}`), as the legacy site does.
- All fields of one request are applied together in one store call.
- **`deleteSurvey`** checks `404`, then `403`, then `409 survey-not-archived` ("Archive the survey
  before deleting it"). It deletes the survey and everything stored for it: the definition, the theme,
  the history, the results and the completion markers, the deleted-result audit and the saved results
  layouts. It is safe to call again after a failure while the survey is still listed. Files join this
  list when uploads exist (Step 7).

Rules for `cloneSurvey`:

- Anyone who can see the source may clone it, also an archived one. Unknown or invisible: `404`.
- The copy goes to the source's scope. `projectId: null` puts it in the caller's Personal surveys; a
  project id puts it in that project, and the caller must be a member (`403` otherwise).
- The **caller** is the copy's creator.
- The name is the given `name` (same rule as above, `422`), or `Copy of {name}` cut to 200 UTF-16
  code units without splitting a character.
- The copy has the definition and the theme of the source. It is unpublished and active, every
  setting is off, and it has new `id`, `postId` and `resultId`. `createdAt` and `updatedAt` are now.
  Results and history are not copied.

Examples. Rename:

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"name":"Customer feedback 2026"}'
```

Publish and archive (one request can carry several fields):

```sh
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"published":true}'
curl -b cookies.txt -X PATCH "$API/surveys/$ID" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" \
  -d '{"archived":true}'
```

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
{"type":"https://my-surveys.surveyjs.io/problems/survey-not-archived","title":"Archive the survey before deleting it","status":409,"code":"survey-not-archived"}
```

After `{"archived":true}` the same request answers `204 No Content`, and a third one `404`.

Every other operation answers `501` with a Problem Details body (`code: not-implemented`), after
authentication: a private operation called without a session answers `401`. `passwordLogin` stays
`501` until P1.
