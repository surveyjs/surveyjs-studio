# Public endpoints, rate limits and idempotency

Five operations serve respondents, embeds and readers of shared results: the three of Step 8,
`downloadFile` of Step 7 and `getPublicResults` of Step 10. They need **no session and no CSRF token**, so they are
rate limited. A sixth, `getResultStats`, needs a session and is listed because it is the way to count
responses without loading them. The reasons for each rule are in
[ADR 0014](../adr/0014-run-page-and-response-collection.md) (the run operations) and
[ADR 0016](../adr/0016-results-details-exports-and-public-results.md) (public results). The people-facing
descriptions are [Publishing and collecting responses](../user-guide/publishing-and-collecting-responses.md) and
[Downloading, sharing and deleting results](../user-guide/downloading-sharing-and-deleting-results.md).

| Operation            | Request                                                 | Who                     | Answer                                   |
| -------------------- | ------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `getPublishedSurvey` | `GET /public/surveys/{surveyId}`, optional `?clientId=` | Anyone                  | `200` the survey, its theme, `completed` |
| `submitResponse`     | `POST /public/surveys/{surveyId}/responses`, JSON       | Anyone                  | `201` `{ "id" }`                         |
| `uploadResponseFile` | `POST /public/surveys/{surveyId}/files`, multipart      | Anyone                  | `201`, `Location` and the stored file    |
| `downloadFile`       | `GET /public/files/{fileId}` ([Uploads](uploads.md))    | Anyone                  | `200` and the file                       |
| `getPublicResults`   | `GET /public/surveys/{surveyId}/results`                | Anyone, Grant Access on | `200` a page of results and the survey   |
| `getResultStats`     | `GET /surveys/{surveyId}/results/stats`                 | A user who can see      | `200` `{ count, firstSubmittedAt, ... }` |

The examples use this setup (the server of `pnpm demo` is on port 3000; the web app proxies `/api` on 5173):

```sh
API=http://localhost:3000/api/v1
ID=<the id of a published survey>
```

## Who can run a survey

A survey is **available** when it exists **and** is published. Archiving does not matter: an archived
survey that is still published runs and collects. For an unknown survey and for an unpublished one,
`getPublishedSurvey`, `submitResponse` and `uploadResponseFile` all answer the same `404`, so a caller
cannot tell them apart:

```text
HTTP/1.1 404 Not Found
{"type":"https://my-surveys.surveyjs.io/problems/survey-not-available","title":"This survey is not available","status":404,"code":"survey-not-available"}
```

Only a survey that was unpublished is not published. A survey whose published flag is empty in the old site's
table (it was never switched) is published, as the old run page treated it. A new or cloned survey also starts
published. See [ADR 0014](../adr/0014-run-page-and-response-collection.md) S1.

## Load a survey

```sh
curl -s "$API/public/surveys/$ID"
```

```json
{
  "id": "22222222-0000-4000-8000-a00000000001",
  "name": "Customer feedback",
  "definition": { "title": "Customer feedback", "elements": [] },
  "theme": { "themeName": "default" }
}
```

`name` may be empty. `theme` is `{}` when the survey has none. With `?clientId=<id>` the answer also has
`completed`, true when that client has already completed the survey (see
[One response per respondent](#one-response-per-respondent)). Without `clientId` there is no `completed`
member.

`clientId` is 1 to 256 characters and must not contain `/`, `\`, `#`, `?` or control characters (the old
site's table keys refuse them). Another value is `400 bad-request`.

## Submit a response

```sh
curl -i -X POST "$API/public/surveys/$ID/responses" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 5b1f0c1e-7d3a-4b8e-9d52-0c9a3f8e6a11" \
  -d '{"data":{"satisfaction":4,"comment":"Fine"}}'
```

```text
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"b0f1c3a8-52de-5a41-8c97-3e6d9f2b7a10"}
```

The body is `{ "data": { ... }, "clientId": "...", "partial": false, "lastPageIndex": 0 }`. Only `data` is
required. The server stores the response and answers its `id`. The id is a GUID, as the old site's
readers need.

- `partial` and `lastPageIndex` are **ignored** until phase 2: the response is stored as a normal, complete
  response.
- The server's clock sets the time (`submittedAt`). The server does not check `data` against the survey.
- The respondent's address is stored only when the survey's `storeRespondentIp` setting is on
  ([below](#the-respondents-ip-address)).

### Idempotency

A client that is not sure a request arrived sends it again with the same `Idempotency-Key` header (1 to
128 characters; a UUID is recommended). The retry stores nothing new.

- The response id is derived from the survey and the key: a version 5 UUID (RFC 9562, SHA-1) of the text
  `{survey id in lower case}:{key}` in the fixed namespace `0a6f1e2c-5b7d-4c3a-9e81-6d2f4b8c1a73`. Without
  a key the id is random. So **a key is per survey**: the same key for two surveys is two responses.
- A request whose key already stored a response answers `201` with the **same body** (`id`) and ignores
  its data. A port that shares the store must derive the same ids, or its retries would not find the
  response.
- Keys are remembered for as long as the response exists, which is **at least 24 hours** (the contract
  promises no more).
- The replay check runs **before** the one-response check, so a retry of a response that completed the
  client still answers `201`, not `409`.
- Two different requests with the same key stored as one: the second one's data is dropped. A client
  that wants a new response sends a new key.

## One response per respondent

"Limit to one response" is on for a survey when the definition that `getPublishedSurvey` returns has a
non-empty string `cookieName`. The Creator's **Limit to one response** property writes it. For a survey
that has the old site's flag (`usecookies`, read only here) and no `cookieName` of its own, the server adds
`cookieName` with the survey id to the returned definition. An empty `cookieName` counts as none.

The convention for an embed that uses the Form Library: take `cookieName` from the returned definition and
pass the definition to `new Model(...)`; the library writes and reads that cookie itself. The library writes
the name into `document.cookie` as it is, so an embed that runs surveys it does not trust should replace a
`cookieName` that is not an RFC 6265 token (the run page percent-encodes it). For the server side, send the
same `clientId` on load and on submit. The run page sends a different id for each survey: the lower-case hex
SHA-256 of `{browser id}:{survey id in lower case}`, where the browser id is a random UUID it keeps in local
storage and never sends. The authors of two surveys can read the client ids of their responses
(`listResults`), and this keeps them from matching one browser across their surveys. An embed should do the
same:

```sh
CLIENT=$(uuidgen)
curl -s "$API/public/surveys/$ID?clientId=$CLIENT" | grep -o '"completed":[a-z]*'
```

```text
"completed":false
```

After a response with that `clientId` is stored, the server keeps a **completion marker** for the client
(in the old site's `SurveyCompletion` table). Then:

```text
curl -s "$API/public/surveys/$ID?clientId=$CLIENT"      ->  "completed":true
```

and a second submit of that client, with the limit on, is refused:

```text
HTTP/1.1 409 Conflict
{"type":"https://my-surveys.surveyjs.io/problems/already-completed","title":"Already completed","status":409,"code":"already-completed","detail":"This survey accepts one response per respondent, and this one has already completed it."}
```

Rules:

- Every stored response that has a `clientId` writes the marker, with the limit on or off. `completed`
  reads it: true when a marker exists and is not a partial one (a marker written by an old API client
  with a partial response is `false`). Client ids match exactly, including case.
- The `409` needs all three: the limit is on, a `clientId` is sent and it has completed. With the limit
  off a client may submit again.
- **A race can store two responses.** Two first submissions of one client sent at the same moment may
  both pass the check. The check and the write are not one atomic step.
- It cannot stop a respondent who changes the client id, which anyone calling the API can.

## The respondent's IP address

The address of a response is `request.ip`, which is the connection's address unless the server was told to
believe a proxy. `TRUST_PROXY` (default empty) is a comma-separated list of IP addresses and CIDR ranges of
the reverse proxies in front of the server. When the connection comes from a listed proxy, the server takes
the address from `X-Forwarded-For` (the last address in the header that is not a listed proxy, as
Fastify's `trustProxy` does); from any other peer, the header is ignored. Without it, a server behind a
proxy sees only the proxy's address for everyone.

- **Use it, and only it, behind your own proxy.** A value that includes untrusted peers lets a caller choose
  its own address, and with it the rate-limit counter.
- An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is stored as `203.0.113.7`.
- The address is stored **only when the survey's `storeRespondentIp` setting is on** at the time of the
  submission. A response sent while it was off never gets one, even if the setting is turned on later.
- Request logs show the address **truncated**: IPv4 with the last number set to 0, IPv6 cut after the first
  three groups (`2001:db8:1::`). They never show answers, file names or client ids, and the `clientId` query
  value is written as `[redacted]`.

## Size limits

| Limit                          | Value                                                                             | Where it ends                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The request body of a response | `limits.maxResponseBytes`, 1 MB by default (`LIMIT_MAX_RESPONSE_BYTES`)           | `413 payload-too-large`, title "Payload too large"                                   |
| The answers, in the old tables | 32,768 UTF-16 characters of `data` as compact JSON (`azure-legacy` provider only) | `413 payload-too-large`, detail "The answers are too large to store."                |
| One respondent file            | `limits.maxFileBytes`, 10 MB by default (`LIMIT_MAX_FILE_BYTES`)                  | `413 payload-too-large`, title "File too large", detail "A file can be up to 10 MB." |

The 32,768 limit comes from the old site's results table (one Azure Table string holds 64 KiB). It lies
below the 1 MB body limit on purpose: files go to the file store, and the response keeps only their links.
The `memory` provider has no limit besides the body. Both limits are read from `GET /config`
(`limits.maxResponseBytes`, `limits.maxFileBytes`); a server reports only limits it enforces.

## Rate limits

The public operations are limited **per client IP address, per operation, per minute** (a fixed window of 60
seconds). Each operation has its own counter.

| Operations                                                                       | Setting                  | Default per minute |
| -------------------------------------------------------------------------------- | ------------------------ | ------------------ |
| `getPublishedSurvey`, `submitResponse`, `uploadResponseFile`, `getPublicResults` | `PUBLIC_RATE_LIMIT`      | 60                 |
| `downloadFile`                                                                   | `PUBLIC_FILE_RATE_LIMIT` | 600                |
| `login`, `loginCallback`, `passwordLogin`                                        | `SIGN_IN_RATE_LIMIT`     | 30                 |

The check runs first, before the body is read, so a refused request costs the server little. A request over
the limit answers `429` with `Retry-After` in seconds:

```text
HTTP/1.1 429 Too Many Requests
retry-after: 41
{"type":"https://my-surveys.surveyjs.io/problems/rate-limited","title":"Too many requests","status":429,"code":"rate-limited","detail":"Too many requests. Try again in 41 seconds."}
```

Every answer of a limited operation also carries the limit headers of `@fastify/rate-limit`:
`x-ratelimit-limit` (the maximum), `x-ratelimit-remaining` and `x-ratelimit-reset` (seconds until the window
ends). The sign-in operations keep their own detail text, "Too many sign-in attempts. Try again in ...".

Several respondents behind one address (a school, an office) share a counter. The run page of a survey with
"Limit to one response" reads `getPublishedSurvey` twice for a browser that has a client id (once to learn
whether the limit is on, once with the id), so such page loads use the budget twice as fast. Raise
`PUBLIC_RATE_LIMIT` for such a deployment. The counters live in the process: with several server instances each one counts on its
own (a shared store is open for Step 14).

## Respondent files

`uploadResponseFile` stores the files of File Upload and Signature Pad questions. The Form Library calls it
once for each file; the run page does this for you ([the page](../user-guide/publishing-and-collecting-responses.md#file-questions)).

```sh
curl -i -X POST "$API/public/surveys/$ID/files" -F "file=@contract.pdf"
```

```text
HTTP/1.1 201 Created
location: /api/v1/public/files/22222222000040008000a00000000001a5c3e17b09d24f6e8a1b3c5d7e9f0a2b
content-type: application/json; charset=utf-8

{"id":"22222222000040008000a00000000001a5c3e17b09d24f6e8a1b3c5d7e9f0a2b","url":"http://localhost:3000/api/v1/public/files/22222222000040008000a00000000001a5c3e17b09d24f6e8a1b3c5d7e9f0a2b","name":"contract.pdf","contentType":"application/octet-stream","size":48211}
```

The part is named `file`; only the first file is read. Put the `url` in the answer, in the shape the
library uses: `[{ "name": "contract.pdf", "type": "application/pdf", "content": "<url>" }]`.

- **Any type is accepted.** The stored type comes from the bytes, as in [Uploads](uploads.md#allowed-types).
  An image or video of an allowed type keeps its type. **Anything else is stored and served as
  `application/octet-stream`**, always as an `attachment`, with the security headers of every download.
- The size is bounded **per file** by `limits.maxFileBytes`. There is no quota on the total: only the
  rate limit slows an abuser. Files whose response was never submitted stay.
- The survey must be available, as for `submitResponse`; it is checked again after the file is stored, and
  a file of a survey that was unpublished or deleted meanwhile is removed.
- A file link is **public**: `GET /public/files/{id}` needs no session. Files are deleted with their
  survey and not copied by a clone.

## Count the responses

`getResultStats` needs a session (no CSRF token: it reads). It answers `404` for an unknown survey and for
one the user cannot see ([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)), as for every survey
read.

```sh
curl -s -b cookies.txt "$API/surveys/$ID/results/stats"
```

```json
{
  "count": 2,
  "firstSubmittedAt": "2026-10-17T09:12:41.208Z",
  "lastSubmittedAt": "2026-10-17T09:15:02.774Z"
}
```

`count` is the number of stored rows. Rows of one client are **not** merged: Step 9 decides the reading
rules. A survey with no responses has `count` 0 and `null` times.

## Public results

`getPublicResults` serves the results of a survey whose **Grant Access** setting (`settings.publicResults`)
is on. It needs no session. The people-facing description is
[Grant Access and the public link](../user-guide/downloading-sharing-and-deleting-results.md#grant-access-and-the-public-link).

```sh
curl -s "$API/public/surveys/$ID/results?limit=2"
```

```json
{
  "survey": {
    "id": "22222222-0000-4000-8000-a00000000001",
    "name": "Customer feedback",
    "definition": { "title": "Customer feedback", "pages": [] },
    "privateQuestions": ["receipt"]
  },
  "items": [
    { "submittedAt": "2026-04-02T09:30:00.000Z", "data": { "satisfaction": 5 } },
    { "submittedAt": "2026-04-03T11:00:00.000Z", "data": { "satisfaction": 3 } }
  ],
  "nextCursor": "eyJ2IjoxLCJrIjoicmVzdWx0cyIs…"
}
```

- **The rule.** The survey exists **and** `publicResults` is on. Nothing else: `published` and `archived` are
  **not** looked at, because Grant Access is the owner's own choice. For an unknown survey and for one with
  Grant Access off the answer is the same `404 survey-not-available` (the Problem shown
  [above](#who-can-run-a-survey)), so a caller cannot tell them apart. Turning Grant Access off closes the
  endpoint at once, because every call checks the setting.
- **The page.** Every stored response, oldest first, paged as `listResults`: `limit` 1 to 1000 (default 500)
  and `cursor`, with the cursor of [`listResults`](paging.md#results-oldest-first-one-survey). A cursor
  belongs to its survey. Rows are not merged. Each page repeats the `survey` member, so a client can read it
  from the first page.
- **`survey`.** `id`, `name` (may be empty), the stored `definition` (so a Dashboard can draw the charts) and
  `privateQuestions`, the names of the questions left out (below). It has no theme and no permissions.
- **What an item holds.** `submittedAt` and `data` only. **No response id, no client id and no IP address**,
  whatever the survey's settings are. (The `nextCursor` of a page does carry the submission time and the
  response id of the page's last item, inside its encoding. Treat it as opaque: response ids are random, and
  no public operation takes one.)
- **Private questions are stripped on the server.** The survey's list `settings.privateResultQuestions`
  names questions; the server removes their answers from every item's `data` **before** it answers. It also
  removes their comments (the key plus the comment suffix of the definition) and, when the question has a
  `valueName`, the answer stored under it. A private question is thus not in the answer at all, and
  `privateQuestions` names it so that a client does not draw an empty chart. The default list is empty:
  every question is public. Authors change it with `updateSurvey`
  ([Step 10](README.md#step-10-exports-deleting-and-public-results)).
- **No cache.** `Cache-Control: no-store`, so a browser or a proxy does not keep results after Grant Access
  is turned off.
- **Rate limit.** The operation is limited by `PUBLIC_RATE_LIMIT` (60 a minute per address, with a counter of
  its own, see [Rate limits](#rate-limits)). The web page reads the results in pages of
  1,000, so it uses one request for each 1,000 responses; a survey of more than 60,000 responses cannot be
  read at once from one address and the page shows "Try again".
- **Large surveys on the old site's stores** cost what `listResults` costs
  ([Paging](paging.md#results-oldest-first-one-survey)).
- **Compared with the old site.** The old public data call returned the first 1,000 rows in storage order and
  filtered the columns only when an old column list existed, so the IP address and client id could leak. This
  endpoint always leaves them out and pages all rows. The old links (`/Results/Survey/<result id>`) are Step 12.

## Errors

| Operation            | Status | `code`                   | When                                                                                                      |
| -------------------- | ------ | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `getPublishedSurvey` | `400`  | `bad-request`            | The id is over 64 characters, or `clientId` is not valid                                                  |
|                      | `404`  | `survey-not-available`   | Unknown or unpublished survey                                                                             |
|                      | `429`  | `rate-limited`           | Over `PUBLIC_RATE_LIMIT`                                                                                  |
| `submitResponse`     | `400`  | `bad-request`            | Malformed JSON, a bad survey id, or an `Idempotency-Key` that is empty or over 128 characters             |
|                      | `404`  | `survey-not-available`   | Unknown or unpublished survey                                                                             |
|                      | `409`  | `already-completed`      | The limit is on and this `clientId` has completed the survey                                              |
|                      | `413`  | `payload-too-large`      | The body is over `limits.maxResponseBytes`, or the store cannot hold the answers                          |
|                      | `415`  | `unsupported-media-type` | The body is not JSON                                                                                      |
|                      | `422`  | `validation-failed`      | No body, or a body that is not `{ "data": { ... } }` (see `errors`)                                       |
|                      | `429`  | `rate-limited`           | Over `PUBLIC_RATE_LIMIT`                                                                                  |
| `uploadResponseFile` | `400`  | `bad-request`            | A bad survey id, or the multipart body is malformed or cut short                                          |
|                      | `404`  | `survey-not-available`   | Unknown or unpublished survey                                                                             |
|                      | `413`  | `payload-too-large`      | The file is over `limits.maxFileBytes`                                                                    |
|                      | `415`  | `unsupported-media-type` | The request is not `multipart/form-data`                                                                  |
|                      | `422`  | `validation-failed`      | No part named `file`, or the file is empty (pointer `/file`)                                              |
|                      | `429`  | `rate-limited`           | Over `PUBLIC_RATE_LIMIT`                                                                                  |
| `downloadFile`       | `404`  | `not-found`              | See [Uploads](uploads.md#download-a-file)                                                                 |
|                      | `429`  | `rate-limited`           | Over `PUBLIC_FILE_RATE_LIMIT`                                                                             |
| `getPublicResults`   | `400`  | `bad-request`            | The id is over 64 characters, `limit` is outside 1 to 1000, or the cursor is damaged or of another survey |
|                      | `404`  | `survey-not-available`   | Unknown survey, or Grant Access is off                                                                    |
|                      | `429`  | `rate-limited`           | Over `PUBLIC_RATE_LIMIT`                                                                                  |
| `getResultStats`     | `401`  | `unauthenticated`        | No session                                                                                                |
|                      | `404`  | `not-found`              | Unknown survey, or one the user cannot see                                                                |

A failure of the store is `500 internal-error` with no detail. The logs of such a failure carry the survey
id and the operation, never the answers.
