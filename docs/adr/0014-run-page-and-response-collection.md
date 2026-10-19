# 14. Run page and response collection

Date: 2026-10-17

## Status

Accepted. The product owner has not confirmed rulings S1, S11 and S13 yet (see "To confirm").

## Context

Step 8 lets people answer a survey. The contract already names the operations (`getPublishedSurvey`,
`submitResponse`, `uploadResponseFile`) and the plan names the page (`/s/{id}`, the old `/published?id=`
link). It does not say who may run a survey, how "Limit to one response" works on the server, what a retry
does, how big an answer may be, how the respondent's address is found, what is limited, or what the page
shows in each state. The current surveyjs.io code answers most of these in ways that do not fit: the post
endpoint checks nothing (not even that the survey is published), the one-response limit is a browser cookie,
the address was never stored by the current code, there is no size check on the server and no rate limit. Each
ruling below says what legacy does, what this application does, and why. The research behind the legacy
column is in the Step 8 notes; the stores are shared with the legacy site, which keeps running during the
transition ([ADR 0010](0010-writing-to-the-legacy-stores.md)).

Parity with the old site comes first (the project rule). Where a ruling departs from legacy, the "Legacy"
column says so and the reason is below the table.

## Decision

The rulings are numbered S1 to S25 and grouped by topic. "Keeps" means the legacy behaviour is reproduced;
"departs" means it is not.

### Availability (S1, S14)

| #   | Question               | Ruling                                                                                                                                                                                                                                                                                                         | Legacy                                                                                                                                                                                                                                                                                        |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Who can run a survey   | A survey is **available** when it exists **and** `published` is true. Archived does **not** block. Otherwise `404 survey-not-available`, title "This survey is not available", the same for an unknown and an unpublished survey. One rule for `getPublishedSurvey`, `submitResponse` and `uploadResponseFile` | Keeps: an archived published survey runs. Departs: the run page refused only `ispublished = 0`, so an empty (`NULL`) flag ran; an unknown id gave a blank page; the post and upload endpoints never looked at the published state. A blocked owner also made the page unavailable (not built) |
| S14 | `PublishedSurvey.name` | The name may be empty (a string of at most 200 characters, like `Survey.name`)                                                                                                                                                                                                                                 | The page showed no name and had an empty title                                                                                                                                                                                                                                                |

Why: one answer for "unknown" and "unpublished" tells a stranger nothing about surveys that exist. The
mapping of the provider already reads an empty flag as "not published" (layout, 9.1), so S1 follows it, and the
cost is that a survey that was never switched on the old site needs one **Publish**. Archived surveys keep
collecting until they are unpublished, as on the old site: archiving is a list view, not a switch off.

### One response per respondent (S2 to S4)

| #   | Question                           | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Legacy                                                                                                                                                                                                                                                               |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S2  | When "Limit to one response" is on | When `settings.useCookies` (the legacy flag, read only) is true **or** the stored definition has a non-empty string `cookieName` (what the Creator's "Limit to one response" property writes). `getPublishedSurvey` returns the definition with `cookieName` set to the survey id when `useCookies` is on and the definition has none (an empty string counts as none). So "on" means "the returned definition has a non-empty `cookieName`". No contract field | Keeps: the run page set the cookie name to the survey id when `usecookies` was on. Departs: the server also knows the setting, and the Creator's property counts                                                                                                     |
| S3  | Completion markers                 | Every stored response that carries a `clientId` writes (overwrites) that client's marker as complete: `SurveyCompletion{surveyId}`, `ispartialcompleted` false, `publishid` as legacy. `completed` (only when a `clientId` is given) is true when a marker exists and is not partial. It does not depend on S2                                                                                                                                                  | Keeps the marker rows and their format. Departs on one point: the old API told `no`, `partial` and `completed`; the contract has a boolean, so a partial marker (an API client's) reads `false`. The old run page never sent a client id and so never wrote a marker |
| S4  | The `409`                          | `submitResponse` answers `409 already-completed` only when the limit is on (S2), a `clientId` is sent and `completed` is true for it, checked **after** the replay check (S5), so a retry of the original still gets `201`. Two first submissions of one client sent at the same moment may both be stored                                                                                                                                                      | Departs: the old server never answered `409` and never checked completion; each post added a row. The limit lived only in the browser's cookie                                                                                                                       |

Why: the cookie alone is the old behaviour and stays (the Form Library writes and reads it). The server check
adds what a cookie cannot: a respondent who clears cookies but keeps the browser's local storage is still
refused, and an embed that has no cookie can use the `clientId`. Neither stops a respondent who changes browser,
device or client id: it is a courtesy limit. The race is accepted because an atomic check needs a transaction
the old store cannot give; the cost is a rare duplicate.

### Idempotency (S5, S6)

| #   | Question    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                | Legacy                                                                                                                                                                 |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S5  | Idempotency | With an `Idempotency-Key` the response id is a UUID version 5 (RFC 9562, SHA-1) of `{survey id in lower case}:{key}` in the fixed namespace `0a6f1e2c-5b7d-4c3a-9e81-6d2f4b8c1a73`; without one it is random. The store inserts only if the id is absent, and a replay answers `201` with the same body and ignores its data. A key lives as long as its response: the contract says "at least 24 hours". The namespace never changes | Departs. Each legacy post got a new GUID and no key. The legacy table write was an upsert at the row key, so a derived id gives idempotent inserts with no extra store |
| S6  | `partial`   | `partial: true` and `lastPageIndex` are ignored: the response is stored as a normal complete response (P1)                                                                                                                                                                                                                                                                                                                            | Departs. Legacy wrote `ispartialcompleted` only for a post with a client id and the flag; without a client id it stored a normal row                                   |

Why a derived id: the response id must be a GUID (the old readers read the `id` column as `Edm.Guid`), so the
key cannot be stored as is, and a second table for keys would be one more thing to keep and delete. The cost
is that a key reused much later by a buggy client returns the old id.

### Size (S7)

| #   | Question           | Ruling                                                                                                                                                                                                                                                                                                                                                                                          | Legacy                                                                                                                                                               |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S7  | Size of a response | The global Fastify body limit (`LIMIT_MAX_RESPONSE_BYTES`, 1 MB) gives `413 payload-too-large`. The `azure-legacy` provider also refuses a `result` text of more than **32,768 UTF-16 code units** (one Azure Table string holds 64 KiB) with a typed error before anything is written, and the service answers `413`, detail "The answers are too large to store." `memory` has no extra limit | Departs. The page refused 65,536 characters on the client only; the server checked nothing, and a long result failed in the store with a `400` and the Azure message |

Why the second limit: the store cannot hold more, and the contract allows `413` below the body limit. Files
leave the response (S11), so the 32,768 characters hold the answers only. The cost is that memory and Azurite
differ between 32,768 characters and 1 MB; it is documented and tested in the Azurite writes test, not in
conformance.

### The address and the logs (S8, S9)

| #   | Question    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                          | Legacy                                                                                                                                        |
| --- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| S8  | The address | `TRUST_PROXY` (default empty: trust nobody) is a comma-separated list of IP addresses and CIDR ranges, given to Fastify's `trustProxy`. `request.ip` honours `X-Forwarded-For` only from a listed peer. The rate limiter also keys on `request.ip`. `respondentIp(ip)` turns `::ffff:1.2.3.4` into `1.2.3.4`. The address is stored only when the survey's `storeRespondentIp` setting is on at submission time | Departs. The only legacy rule was the socket peer, and the current code never stored an address. It only cleared one when the setting was off |
| S9  | The logs    | The `clientId` query value is redacted in request logs. The request log's `remoteAddress` is truncated (IPv4: the last number is 0; IPv6: the first three groups, then `::`). No answers, file names or client ids appear in any log                                                                                                                                                                            | New. None in legacy (idea section 8, data minimisation)                                                                                       |

Why: behind a reverse proxy every user would share one address, one rate-limit counter and one stored
address, so a proxy rule is needed. Trusting nobody is the safe default, because a caller can send any
`X-Forwarded-For`. The truncation keeps the logs useful for a block of addresses without naming a person.
This also settles the Step 3 limitation of the sign-in limit.

### Rate limits (S10)

| #   | Question    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                              | Legacy                                                             |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| S10 | Rate limits | Per client IP, per operation, in a fixed window of one minute (`@fastify/rate-limit`). `PUBLIC_RATE_LIMIT` (60) for `getPublishedSurvey`, `submitResponse` and `uploadResponseFile`; `PUBLIC_FILE_RATE_LIMIT` (600) for `downloadFile`. `429 rate-limited` with `Retry-After`, title "Too many requests", detail "Too many requests. Try again in {after}."; sign-in keeps its own text. The contract gains `429` on `downloadFile` | New. The legacy API has no limiter and no other anti-abuse measure |

Why: the three public operations accept anything from anyone, and the only legacy defence is an unguessable id.
The numbers are defaults to tune in production. The counters live in the process; a shared store for several
instances is open for Step 14.

### Respondent files (S11)

| #   | Question         | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Legacy                                                                                                                                                                                                                    |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S11 | Respondent files | `FileKind` gains `"response"`. The survey must be available (S1). One part named `file`, at most `LIMIT_MAX_FILE_BYTES` (10 MB by default) per file through the busboy `fileSize` limit: over is `413 payload-too-large`, title "File too large", detail "A file can be up to {size}."; empty or missing is `422`; malformed is `400`. **Any type is accepted**: the stored type is the detected one when it is on the allow-list of [ADR 0013](0013-editor-uploads-and-files.md) (R6), else `application/octet-stream`, served as an attachment. No quota. Not copied by a clone, deleted with the survey. `201` with `Location` and a `StoredFile` | Departs. The old endpoint did not check the published state, a size or a type, kept the extension, and answered a plain `dxsimage:` or `dxsfile:` reference. The old run page did not use it: files were inline data URLs |

Why: a File Upload question accepts any file, so refusing types would break surveys that work today. Sending
`octet-stream` as an attachment keeps an uploaded HTML or SVG file from running on our origin (the download
headers of ADR 0013 R7 apply). Respondent files are the means of keeping a response under the 32,768
characters of S7 and of
[ADR 0005](0005-respondent-files-as-urls.md) (files are URLs). The costs: total respondent storage is
bounded only by the rate limits, and a file uploaded by a respondent who never completes the survey stays until
the survey is deleted.

### Statistics (S12, S15)

| #   | Question         | Ruling                                                                                                                                                                                                                                                                                                                                     | Legacy                                                                                                                                                                    |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S12 | `getResultStats` | Built now, because it is the only way to check "stored once" and to show the count in the demo. It needs a session and answers `404` for an unknown survey and for one the user cannot see (ADR 0009). `count` is the number of stored rows with **no merging by client**; the first and last `submittedAt` are `null` when there are none | Departs in one point. The old statistics scan the table and merge rows with the same client id before counting. Step 9 decides the reading rules and may redefine `count` |
| S15 | Seeded results   | `MemorySeed` gains the fixture `post...` rows and completion markers, so both providers agree on the fixture counts                                                                                                                                                                                                                        | Not in legacy (a test and demo matter)                                                                                                                                    |

### The run page (S13, S16 to S22)

| #   | Question                           | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Legacy                                                                                                                                                                                                                                                                          |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S13 | The disclaimer                     | The orange "Disclaimer of liability" banner for owners without a licence is **not built** in Step 8. It is an open point for Step 13 (visual parity)                                                                                                                                                                                                                                                                                                                                                                                               | Keeps nothing yet: the page showed it at the top for an owner with no licence, and the plan and spec do not mention it                                                                                                                                                          |
| S16 | The page                           | A lazy route `/s/$surveyId`, without the site shell. `survey-react-ui` and `survey-core.css` are in their own chunk group `survey-form`; the translations (`survey-core/i18n`) in `survey-i18n`, loaded by a dynamic import only for a language other than English. `applyTheme(theme)`, `showBrandInfo = true`, `focusFirstQuestionAutomatic = false`; query parameters prefill answers, and `?locale=` sets the language. The build checks that the run route loads no Creator, Ace or Dashboard code                                            | Keeps: the options, the footer (the library's own brand block), the prefill and the locale. Departs: the address, and the page is a React route with the library in a chunk, not a server-rendered view with a CDN script                                                       |
| S17 | The states                         | Loading; not available (any `404` or `400`, or no id): its own small component, the legacy sentence "This survey is not currently available." in the legacy centred red style (copied on purpose, D14, and recorded in the assets README); completed before (S18); running; load failure: our own message and a **Try again** button                                                                                                                                                                                                               | Keeps the sentence and its style. Departs: an unknown id gave a blank page, and a missing id gave the library's empty-survey text                                                                                                                                               |
| S18 | `clientId` and the completed state | When the limit is on, the page keeps one random UUID for the browser in local storage (an id for one page load when storage is unavailable), and sends it on load and on submit. When the server says `completed`, the page writes the cookie `{cookieName}=true` **before** it builds the model, so the library shows its completed-before content. **The cookie has `path=/s`** (see "Decisions that changed during the step")                                                                                                                   | Keeps the cookie and the library's completed-before content. Departs: the old page sent no client id                                                                                                                                                                            |
| S19 | Submit                             | `onComplete` with `showSaveInProgress()`. One `Idempotency-Key` for each completion attempt, **reused** when the library's "Try again" fires again. Success: `showSaveSuccess()`; `409`: "You have already completed this survey."; `413`: "Your answers are too large to send."; `429`: "Too many attempts. Wait a minute, then try again."; anything else: "Your answers were not sent. Check your connection and try again." The texts are ours                                                                                                 | Departs. The old page checked 65,536 characters on the client and used a library text (`savingExceedSize`) that the library version in use no longer has                                                                                                                        |
| S20 | File questions                     | `storeDataAsText` is forced to `false` on every File Upload and Signature Pad question, also inside panels, dynamic panels and matrix columns (a column that takes the matrix's `cellType` too). `onUploadFiles` sends each file to `uploadResponseFile` and answers the stored `url`. Failures show: "This file is too large. A file can be up to {size}." (`413`), "Too many uploads. Wait a minute, then try again." (`429`), "The file was not uploaded. Please try again.". A file over `limits.maxFileBytes` is refused in the browser first | Departs. The old page had no upload handler, so answers carried the files inline (the library default `storeDataAsText: true`), and the Creator hides that property, so existing surveys have the default. Without the override the library would never call the upload handler |
| S21 | `/published`                       | The route `/published` with the search `id` replaces itself by `/s/{id}` and keeps every other search member (`locale`, prefilled answers). A missing or empty `id` shows the not-available page                                                                                                                                                                                                                                                                                                                                                   | Keeps the old address working. `/s/{id}` is new (the old site had no such route)                                                                                                                                                                                                |
| S22 | Placeholders                       | `web/src/privateRoutes.test.tsx` and `e2e/tests/survey-actions.spec.ts` assert the real page instead of the Step 5 placeholder                                                                                                                                                                                                                                                                                                                                                                                                                     | Not in legacy                                                                                                                                                                                                                                                                   |

Why a client id and a cookie: the library enforces the limit only through the cookie, and S4 enforces it on the
server through the id, so the page needs both. Writing the cookie before the model exists is what makes the
library show its own text (it reads the cookie while it loads the definition). The prefill keeps working links
of the old site that put answers in the query string, which the old page did without documenting it.

### Tests and process (S23 to S25)

| #   | Question                | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                     | Legacy        |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| S23 | Conformance strategy    | Tests write only to surveys they create in the admin's Personal scope: a definition through `POST /surveys { definition }`, publish through `PATCH`, archive and delete at the end. Fixtures are read only (`01` published, `02` and `06` unpublished, `05` published and archived, so available). "Stored once" is read with `getResultStats`. The IP is checked in server tests and the Azurite writes test until Step 9 | Not in legacy |
| S24 | End-to-end minimisation | Only the e2e task runs Playwright, and only the new spec (once on Chromium while iterating, once on all three browsers, once in Azurite mode), the changed `survey-actions.spec.ts` once, and `editor.spec.ts` once on Chromium. Never the full suite. The e2e servers run with `PUBLIC_RATE_LIMIT` and `PUBLIC_FILE_RATE_LIMIT` at 100000                                                                                 | Not in legacy |
| S25 | Records                 | This ADR (S1 to S23); a "Step 8" section in [ADR 0010](0010-writing-to-the-legacy-stores.md#step-8-result-rows-and-completion-markers); an addendum to [ADR 0004](0004-body-limit.md#addendum-step-8); a note on [ADR 0005](0005-respondent-files-as-urls.md#note-step-8)                                                                                                                                                  | Not in legacy |

### Decisions that changed during the step

Four decisions came after the first design and replace its text:

- **The limit cookie gets a token name and the run pages' scope (S18).** The cookie name comes from the
  survey's author, and two code paths write it: the page (the completed-before cookie) and the Form Library itself,
  which writes `{cookieName}=true` on every completion with no attributes of its own. A name such as
  `msid_csrf=x; path=/; a` would make the library's write overwrite the application's `msid_csrf` cookie for the
  whole site, and a `domain=` part could reach sibling hosts. So the page never hands the author's name to the
  library: `runCookieName` keeps a name that is an RFC 6265 token and percent-encodes any other one into a token
  (the survey id when it cannot be encoded), and the model's copy of the definition carries that name. The page
  writes the completed-before cookie under the same name with `path=/s`. The library's write has no `path`, so
  the browser gives it the default path of `/s/{id}`, which is `/s`: both writes are the same cookie, sent only
  to run pages. What remains: a token name that equals one of the app's names (`msid_csrf`) gives a second
  cookie of that name under `/s`, which shadows the app's one in `document.cookie` only while a page under `/s`
  is open; requests to `/api` do not carry it. The server's `409` reads the stored definition, not this name.
  The cost is that only the pages under `/s` see the cookie.
- **`ClientId` has a pattern in the contract (S3).** Azure Table row keys refuse `/`, `\`, `#`, `?` and control
  characters (layout, 3.7), so a marker could not be written for such an id and the providers would differ.
  The contract's `ClientId` now has the pattern `^[^/\\#?\u0000-\u001F\u007F-\u009F]+$`. The server answers `400`
  for another id, and the run page checks a stored id against the same pattern. Ids made by the run page are
  UUIDs. The cost is a `400` for an odd id of an embedder.
- **Conformance tests give their own surveys a definition through `POST /surveys { definition }`**, then
  `PATCH { published: true }` (S23), not through `PUT` with `If-Match`. It is one request fewer for each test and
  needs no ETag.
- **The one Chromium e2e run includes `editor.spec.ts` (S24).** The new chunk groups moved `survey-react-ui` and
  `survey-core.css` out of the Creator chunk, which changes how the editor loads its CSS.

The build facts behind S16: the Form Library's code and its CSS (about 525 kB of CSS) are in the chunk group
`survey-form`, the `survey-creator` CSS is now about 272 kB, and the locales are in `survey-i18n`, loaded through
`web/src/run/surveyLocales.ts` only for a non-English `?locale=`. A failed locale load logs a warning and the
survey runs in English. `web/scripts/check-run-chunks.mjs` runs in `web`'s build and fails it when the run route
can load Creator, Ace or Dashboard code.

## Consequences

- A survey runs while it is published, archived or not, and a survey that was never switched on the old site
  needs one Publish.
- "Limit to one response" is a courtesy limit. It stops the ordinary repeat visit from the same browser. It does
  not stop a respondent who clears the data, changes browser or device, or calls the API. Two simultaneous first
  submissions of one client may both be stored.
- A retry of a response that was stored answers `201` with the same id, even after the client has completed.
  Idempotency keys live as long as the responses, at least 24 hours.
- A response above 32,768 characters of answers is refused on the legacy stores and accepted up to 1 MB in memory.
- Without `TRUST_PROXY`, a server behind a reverse proxy sees one address for everyone: one rate-limit counter
  for all, and a stored address that is the proxy's. A `TRUST_PROXY` that is too wide lets callers pick their
  address.
- The public rate limits are per process. Several instances count on their own until a shared store exists
  (Step 14).
- Respondent files have no quota and no expiry. Total storage is bounded only by the rate limits, a file link is
  public, and a file that was never submitted stays until the survey is deleted.
- Rows are written directly, without the legacy HTML cleaner, so new rows hold the text as typed while old rows
  may hold entities. Readers treat both as text.
- `getResultStats` counts rows. Step 9 may redefine `count` when it adds the merging of rows of one client.
- The brand footer loads its logo from `surveyjs.io`; offline it is a missing image.
- The run page does not show the old "Disclaimer of liability" banner until Step 13.

**Step 9 change (S18).** Step 9 made `listResults` return each response's `clientId`, so a browser-wide id would
let the authors of different surveys match one respondent across their surveys. The run page now keeps the
browser id in local storage as before (same key) but never sends it. It sends a per-survey id: the lower-case
hex SHA-256 of `{browser id}:{survey id in lower case}` (Web Crypto). The same browser and survey give the same
id on every visit, so the limit works as before; different surveys get unrelated ids. Without `crypto.subtle`
(a page outside a secure context) the page sends a random id for this page load, and the stored browser id is
left alone. Markers written before the change are keyed by the browser id, so the server does not count a browser's
earlier response to a limited survey; the library's cookie still does. See [ADR 0015](0015-results-summary-table-and-views.md#to-confirm).

## For the product owner to confirm

These rulings are decisions of the team, not of the product owner. Until the owner confirms them, they stand as
written.

- **S1:** an archived survey that is still published keeps collecting responses (as on the old site), and a
  survey whose published flag is empty on the old site counts as not published (the old page ran it).
- **S11:** any file type is accepted, there is no quota for respondent files, and files uploaded but never
  submitted stay until the survey is deleted. Total respondent storage is bounded only by the rate limits.
- **S13:** the "Disclaimer of liability" banner for owners without a licence is not built. It needs a decision in
  Step 13: whether it belongs to "today's footer", and what licence data it reads.
