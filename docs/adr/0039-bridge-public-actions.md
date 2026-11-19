# ADR 0039: The bridge's public actions and what Studio's public API adds for them

Status: Accepted (hosted Step 5, 2026-11-19). Builds on [ADR 0035](0035-legacy-api-bridge.md) (the bridge) and
[ADR 0038](0038-partial-responses.md) (partial responses). Settles how exact the bridge is, which operations Studio's
public API gains for the old API's public actions, and how legacy files are found.

## Context

Hosted Step 5 builds the bridge's first half: the old API's public actions under `public/Survey` and `public/v1/Survey`
(`getSurvey`, `getSurveyAndIsCompleted`, `post`, `upload`, `getResult`, `isCompleted`, `image`, `file`) and the
unauthenticated `private/Surveys/files?name=` and `getSurveyPublicResults/{id}`. Everything else on the host stays with
the old service (ADR 0035 point 5); the access-key actions and the results-layout reads are Step 6
([Legacy API usage](../architecture/legacy-api-usage.md)).

ADR 0035 asks for the old API "one to one". Its code (legacy documentation, private location) shows that one to one,
taken literally, would carry over:

- **data leaks:** `isCompleted` without a `clientId` answers some other respondent's state; `getSurveyPublicResults`
  returns respondents' IP addresses and client IDs when the survey has no saved column layout;
- **an HTML sanitizer** run over every posted answer set, so `&` and `<` are stored as entities;
- **byte-level artefacts** of its framework: per-request trace IDs in error bodies, the key order of its JSON
  serializer, whitespace, chunked streaming, platform headers, 512 zero bytes after recently uploaded files;
- **a start-page fallback:** unknown `GET` paths answer `200` with the API's start page, other unknown paths `405`.

The golden responses recorded on production (Step 5's input from the SurveyJS team) come later; until then the reference
is the old code. The SurveyJS team chose (2026-11-19) to build from the code now and to fix differences the
recordings show before the DNS switch (Step 7).

Studio's public API has today: `getPublishedSurvey` (published surveys only, no `ETag`), `submitResponse` and
`uploadResponseFile` by survey ID (published only), `downloadFile`, and `getPublicResults` (when public results are on).
Nothing addresses a survey by its legacy `postId` or `resultId`, the three-state completion is internal, no
per-question aggregate exists, and nothing resolves a legacy file name.

## Decision

### 1. Exact wherever a caller can depend on it

The bridge reproduces, for every action of this step: routes (both prefixes, any letter case, with or without a
trailing slash, `{id}` path forms where the old route has them), methods, status codes, content types with their
charset, the headers a caller reads (`Content-Type`, `Content-Disposition`, `Cache-Control` where set, CORS), JSON
shapes and property casing, error texts, and the formats of values callers parse (for example `getResult`'s keys
`"True"`/`"False"` and its times without `Z`). It does not reproduce incidental bytes: trace IDs, whitespace and key
order where JSON parsers ignore them, chunked transfer, platform headers, trailing padding of files.

**Three deliberate differences:**

| Old behaviour                                                                 | The bridge                                                                                | Why                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `isCompleted` without `clientId` answers the first stored respondent's state  | answers `"no"`                                                                            | a leak of another respondent's state                 |
| `getSurveyPublicResults` includes `ClientId` and `IPAddress` without a layout | never includes them                                                                       | a leak of respondents' data on a public endpoint     |
| `post` HTML-encodes the answers before storing them                           | stores the answers as sent; reads return what was stored (migrated answers keep entities) | Studio stores answers as data and escapes on display |

**Unknown paths are forwarded** to the old service with the site's paths (ADR 0035 point 5), so they answer exactly as
today (the start page, `405`) while the old service runs. `post/page-number` is one of them.

**`getSurveyAndIsCompleted` and `image`** work as their code intends (ADR 0035): the survey with its completion state,
and the image's bytes.

### 2. What Studio's public API adds

Clean operations, named for what they do; none is shaped like the old API. All are unauthenticated, rate limited as
public operations (`getLegacyFile` as `downloadFile`, `getQuestionSummary` with a lower limit of its own), and
implemented on the memory, SQL and Azure legacy providers. They exist in the hosted edition only (Consequences).

| Operation                      | Path                                                    | What it does                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPublicDefinition`          | `GET /public/surveys/{surveyId}/definition`             | The stored definition, **whatever the publish state** (documented as the read for surveys built for the old service). Strong `ETag`; `If-None-Match` → `304`; `Cache-Control: no-cache` |
| `getRespondentState`           | `GET /public/surveys/{surveyId}/respondents/{clientId}` | `{ state: "none" \| "partial" \| "completed" }`, from the completion marker                                                                                                             |
| `submitResponseByPostId`       | `POST /public/posts/{postId}/responses`                 | As `submitResponse`, addressed by the survey's post ID and **whatever the publish state**, as surveys built for the old service post                                                    |
| `uploadResponseFileByPostId`   | `POST /public/posts/{postId}/files`                     | As `uploadResponseFile`, addressed by the post ID, whatever the publish state                                                                                                           |
| `getRespondentStateByResultId` | `GET /public/results/{resultId}/respondents/{clientId}` | As `getRespondentState`, addressed by the survey's result ID                                                                                                                            |
| `getQuestionSummary`           | `GET /public/results/{resultId}/questions/{name}`       | One question's counts over the completed responses (ADR 0038): `{ answered, values: [{ value, count }], responseCount, firstSubmittedAt, lastSubmittedAt }`                             |
| `getLegacyFile`                | `GET /public/legacy-files/{kind}/{name}`                | A file by its legacy name; `kind` is `asset` (editor images) or `response` (respondent files). Bytes, with `downloadFile`'s headers; `404` when unknown                                 |
| `getPublicResults` (changed)   | adds `from` and `till`                                  | Bounds on `submittedAt` for the old `getSurveyPublicResults` filters                                                                                                                    |

The post and result IDs keep the old API's exposure: a survey's answers and aggregates are reachable only through its
result ID, and posting only through its post ID, as before. `getPublicDefinition` and `getRespondentState` are reachable
by survey ID, as the old `getSurvey` and `getSurveyAndIsCompleted` are.

### 3. Legacy files

- **New uploads** through `upload` are ordinary Studio files. The bridge answers `dxsimage:` or `dxsfile:` followed by the
  file ID and the original extension; `image` and `file` with such a name call `downloadFile`.
- **Existing legacy names** resolve through `getLegacyFile`: on the SQL providers through a `legacy_files` table (legacy
  name → file ID; migration `0008`, filled by the migration in Step 9); on the Azure legacy provider by reading the
  legacy `surveyfiles` (editor) and `files` (respondent) shares directly, read-only, before the cutover; on the memory
  provider from its seed. Tests stub the share reader, since Azurite has no file service.
- `files?name=` and `file` answer `application/octet-stream` (`file` as an attachment), as the old API does; `image`
  serves the image with its own content type (for a Studio upload, detected from the bytes).

### 4. The bridge

- A workspace package `bridge/` and an image target of its own, in TypeScript on Fastify (case-insensitive routes,
  trailing slashes ignored). No store, no store credentials. It calls Studio through `openapi-fetch` typed with the
  contract's generated `paths`, so a breaking contract change fails its type check.
- **Settings:** Studio's API base URL, the old service's base URL (for forwarding), the size of the `getSurvey` cache,
  and the largest `upload` body (Studio's default file limit and 1 MiB; at most 8 uploads are read at once, one more
  gets an empty `503`).
- **`getSurvey` cache:** answers kept per survey with Studio's `ETag`; every request revalidates with `If-None-Match`,
  so an edit shows at once and an unchanged survey costs Studio a `304`. A revalidation Studio refuses for rate reasons
  serves the cached copy, so a caller that reads one survey very often keeps getting it; without a copy the `429`
  stands.
- **Client address:** the bridge sends the caller's address in `X-Forwarded-For`. Studio trusts it only from the bridge
  (`TRUST_PROXY`), so IP capture and the per-IP rate limits work per respondent.
- **Answers to posts** carry no `Idempotency-Key`, so a repeated old post stores a second response, as today.
- **Forwarding:** the site's paths and unknown paths go to the old service with method, headers (but hop-by-hop ones)
  and body unchanged, and its answer comes back unchanged.

### 5. Rules for the builder

- **Posts by post ID follow the old API's checks, not Studio's run page.** `submitResponseByPostId` and
  `uploadResponseFileByPostId` ignore the publish state and "Limit to one response": the old API never refused a post
  (its one-response setting worked only in the browser). Size limits and rate limits apply as for `submitResponse`.
- **Markers** follow ADR 0038 on every path: each post with a client ID sets that client's state to what it posted, so
  a partial save after completing reads `partial` again, as in the old API. A stored marker without a partial flag reads
  `completed`. The bridge reads `isPartialCompleted` as the old API bound it (`true`, `"true"`, `1`).
- **`getQuestionSummary`** counts the answers under the question's name in the folded, completed responses only (never
  metadata such as times or IDs). An array answer counts each element; an object answer counts each property as a
  two-element array `[key, value]`; any other value counts as itself, keeping its JSON type, so `1` and `"1"` stay apart.
  `answered` counts responses that have the name, `null` included. The bridge turns these values into the old
  `QuestionResult` keys (`"True"`, `"[row1, col1]"`, .NET date and number forms).
- **`getPublicDefinition`** returns the working definition (what the editor last saved, which the old API served too),
  for archived surveys as well; an unknown or deleted survey is `404`. The definition is returned as JSON, not as the
  stored bytes: a stored text with a byte-order mark or non-strict JSON is a listed difference.
- **Client IDs** go into paths percent-encoded; the contract's `ClientId` rules hold. A missing or empty `clientId` never
  reaches Studio: the bridge answers as the old API (`getSurveyAndIsCompleted`: `400` with its text) or by point 1
  (`isCompleted`: `"no"`).
- **Legacy file names** are single path segments (letters, digits, `.`, `-`, `_`); anything else is `404` without a
  lookup. They match as stored (case included). `getLegacyFile` returns the stored bytes as stored (a legacy file keeps
  any padding it has, as the old API served it) with the content type from the name's extension, or
  `application/octet-stream` without one.
- **Studio's answers the old API never gave:** `429` (Studio's per-address limits) passes through as `429` with an
  empty body; a network failure or an unexpected Studio status answers an empty `500`, as the old API's unhandled
  errors do. Every other Studio status maps to the old answer for that case.

### 6. How the answers are checked

- A package `legacy-compat-tests`: HTTP only, given a base URL; golden files per action, each marked **derived** (from
  the old code, now) or **recorded** (from production, later), with volatile parts masked.
- A recording script for the SurveyJS team: it calls the real `api.surveyjs.io` for the test account's surveys and
  writes the answers to the private location for review (plan-hosted rule 6); reviewed recordings replace the derived
  golden files, and every difference is fixed or recorded here before Step 7.

### Why not the alternatives

| Option                                                   | Why not                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Byte-exact, quirks included                              | Copies two data leaks and a sanitizer, and every framework artefact; fragile and costly for bytes no parser reads                    |
| Shapes only                                              | Breaks parsers of `getResult`'s keys and times, and of error texts                                                                   |
| The bridge computes `getResult` by reading all responses | Needs an unauthenticated read of every response, wider than the old API's exposure                                                   |
| One lookup operation from post or result ID to survey ID | Turns a result ID into a survey ID, and posting by survey ID would widen who can post; addressing by the old keys keeps the exposure |
| Studio's `submitResponse` drops its publish check        | Studio's own run page relies on it                                                                                                   |

## Consequences

- **Studio's contract** gains seven public operations and two query parameters; each has conformance tests on every
  provider and a handler in the web sandbox.
- **Hosted edition only.** The seven operations read unpublished and archived definitions and post to unpublished
  surveys, which only surveys built for the old service need. They are routes only when `APP_EDITION=hosted`; any other
  server answers them `404`, as an unknown path, with no rate limit, and its publish rules are unchanged. `from` and
  `till` on `getPublicResults` work everywhere. The conformance runs check the hosted behaviour where the server is
  hosted (the Azure legacy run) and the `404` elsewhere, the web sandbox included; the provider and server tests cover
  the SQL and memory stores.
- **Migration `0008`** adds `legacy_files`; the Azure legacy provider gains a read-only file-share reader
  (`@azure/storage-file-share`).
- **Differences from the old API:** the three in point 1; `getResult` counting completed responses folded by ADR 0038
  (the old code counts every row merged by client); `getSurveyPublicResults` returning completed responses only (the old
  one also returned partial saves, and left out the answer columns its saved results layout hid, which the migration maps
  into `privateResultQuestions`); `getSurvey` returning JSON rather than the stored bytes, and answering `200 {}` for a
  survey whose definition was never saved (the old API answered `400`); uploads whose extension has characters outside
  `[A-Za-z0-9_-]` answered without an extension; uploads above the bridge's upload limit (11,534,336 bytes by default,
  where the old host took up to 30,000,000) answered with an empty `413`; Studio's rate limits (`429`, and slow
  streaming of very large public results); and incidental bytes. [`docs/api/legacy-compat.md`](../api/legacy-compat.md) holds the full list.
- **Step 6** adds the access-key actions and the results-layout reads (`getIsResultPublic`, `getResultPublicColumns`,
  `getPublicResultSummaryState`, `getPublicResultTableState`) on the same bridge.
- **The recordings** may bring a round of small fixes before Step 7.
