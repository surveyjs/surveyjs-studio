# Testing

Tests check behaviour through a **seam**: HTTP, the browser, or the inputs and outputs of a pure
function. They do not call internals or read private state. Test output must be clean: no
warnings.

## The three seams

| Seam               | Question it answers                             | Where                         | Status         |
| ------------------ | ----------------------------------------------- | ----------------------------- | -------------- |
| HTTP conformance   | Does a server follow the contract?              | `conformance-tests/`          | Built (Step 1) |
| Browser end-to-end | Does the whole app work in a real browser?      | `e2e/`                        | Built (Step 3) |
| Provider suite     | Does a storage provider behave like the others? | `server/src/providers/suite/` | Built (Step 2) |

Unit tests sit next to the code (`*.test.ts`, `*.test.tsx`).

## Run everything

| Command                 | Runs                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`             | `pnpm test:unit`, then `pnpm test:conformance`                                                                                                   |
| `pnpm test:unit`        | Vitest projects: `scripts`, `contract`, `server`, `web`                                                                                          |
| `pnpm test:conformance` | The conformance suite against a server it starts itself                                                                                          |
| `pnpm e2e`              | Playwright on Chromium, Firefox and WebKit                                                                                                       |
| `pnpm e2e:azurite`      | Playwright sign-in, survey list, survey actions, editor, history, uploads, run, results and results-details specs in Azurite mode (needs Docker) |

These need the Docker replica (see [Development](development.md#azurite-mode)); they are not part of
`pnpm test`:

| Command                         | Runs                                                                                                                                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:providers:azurite`   | Four files against Azurite and SQL: the provider suite, the NULL-row tests, the survey, file and result write tests (create, update, clone, delete, definition and theme saves, files, response rows and completion markers) and the fixture loader tests |
| `pnpm test:conformance:azurite` | The conformance suite against a server on the `azure-legacy` provider                                                                                                                                                                                     |

CI runs all of them (see [Development](development.md#ci)).

## Unit tests

Run with Vitest from the root. Scope:

- `scripts/`: the `check:deps` rules.
- `contract/`: the package exports.
- `server/`: configuration (`loadConfig`), the error mapper, the contract loader, the app
  through Fastify's `inject` (HTTP in, HTTP out), the legacy mapping and fixture reading, the loader
  guards, the inspector CLI, and the provider suite on the in-memory provider. For sign-in:
  sealing and session expiry (with an injected clock), CSRF comparison, `returnTo` validation, the
  cookies, the sign-in flow and the authentication order through `inject` with the dev provider, the
  OIDC provider against an in-process fake identity server, the licence-expiry rule, and the refusal
  of the dev provider in production and hosted. For the survey list: "New Survey N" naming,
  permissions, cursor encoding and decoding, the surveys and projects handlers through `inject`, the
  mapping of projects, and the in-memory provider. For the survey actions: `cloneName`, the record
  changes of a patch (`patch.ts`) and `applySurveyChanges` as pure functions, the update, delete and
  clone handlers through `inject` (check order, `updatedAt`, `Location`), and the theme reading of the
  legacy mapping. For files: `detectFileType` (every type, near misses, a lying declared type, SVG
  prologs and the internal-subset refusal), `contentDisposition` and `fileNameOf`, `formatBytes`,
  `rewriteFileIds` and the file id helpers as pure functions; the upload and download handlers through
  `inject` (`files/handlers.test.ts`: the check order, the quota checks including an over-limit byte in a
  chunk of its own, the headers); the delete cascade and the clone copies in `surveys/handlers.test.ts`;
  and the blob metadata mapping. For responses: `responseIdFor` and `uuidV5` (known vectors, letter case, the
  namespace), `respondentIp` and `truncatedIp` (IPv4, IPv6, IPv4-mapped, zones, garbage), `publishedDefinition`
  and `limitCookieOf`, the memory `ResultStore`, `TRUST_PROXY` parsing in `loadConfig`, the log redaction and
  truncation, the public rate limits (`rate-limits.test.ts`: each operation, `downloadFile` on its own
  counter, `X-Forwarded-For` honoured only from a trusted peer), and the handlers through `inject`
  (see [Server tests of the public operations](#server-tests-of-the-public-operations)). For results and
  layouts (Step 9): the results cursor (the exact encoding of a known position, a round trip, and every
  malformed or foreign cursor as `400`), the generator of the large survey (`large-survey.test.ts`: the rule at
  chosen numbers, the exact distribution counts, determinism, the ties at the page borders), the fixture
  reader's treatment of the generated table, `listResults` through `inject` (`results/handlers.test.ts`: the
  default of 500, `limit` 1 and 1000, and `0`, `1001`, `1.5` and text as `400` at `/limit`, a foreign cursor),
  and the three view operations (`views/handlers.test.ts`: a `500` that logs no layout text, and the survey
  record unchanged by a save).
- `web/` (Step 9): `api/results.ts` (`loadAllResults` over several pages, a failing page, the same cursor
  twice) and `api/views.ts` (`404 view-not-found` as `null`, any other failure rejected, and `keepalive`
  counted in UTF-8 **bytes**: a body of 25,000 euro signs is under 60,000 characters but 75,000 bytes and is
  sent without it), the pure modules of `results/` (`search.ts`, `viewSaver.ts` with fake timers, `elementsState.ts`,
  `tableRows.ts`), and the page rendered through the router (`resultsRoutes.test.tsx`, `privateRoutes.test.tsx`:
  the tabs and links, results read from two pages, saving once with its body, the quiet message, retry after a failed
  read, both resets with their confirm texts). **`SummaryView.tsx` and `TableView.tsx` have no real unit
  test**, like `RunSurvey.tsx`: the page tests swap them for the stand-in `web/src/test/fakeResultsWidget.tsx`
  (loaded inside the `vi.mock` factories), because jsdom does not draw charts or a Tabulator table; the end-to-end
  spec covers them.
- `server/` (Step 10): the pure export modules (`results/csv.test.ts`: `csvField` for quoting, the formula guard
  (`=`, `+`, `-`, `@`, tab and CR; numbers untouched; a `-5` text gains the `'`), Unicode and null, the
  columns, the guarded header, `valueName`; `definition.test.ts`: `questionsOf` over pages, panels and a root
  without pages, the comment suffix, `privateKeysOf` and `withoutKeys`; `export-format.test.ts`: `format` over
  `Accept`, q-values, `*/*`, `text/*`, `406`, file names with Unicode, control characters and a blank name;
  `export.test.ts`: the paging of `storedResponses`, a failing first page, the JSON and CSV streams, the header
  alone for no responses), the handlers through `inject` (`results/handlers.test.ts`: the `no-store`, `nosniff`
  attachment headers, a `500` that logs no answer when the first page fails, a failed file delete that keeps
  the rows, public results without the private question, and a `500` without answers when the private list
  cannot be read; `surveys/handlers.test.ts`: `getSurvey` and `updateSurvey` without the list and one warning
  with the survey id when it cannot be read, and the old list kept when the survey update fails), the legacy mapping of the private-question blob
  (`mapping.test.ts`: the defaults for a missing `isPublic`, a BOM, a damaged blob, order and duplicates), the
  fixture seed's private list, and the public rate limit (`rate-limits.test.ts`: its own counter).
- `web/` (Step 10): `api/results.ts` (statistics under a key outside the results prefix, the delete with its
  CSRF token and its `403`, the cache after a deletion, and nothing changed when it fails), `api/public.ts`
  (every page joined, the survey of page 1, `survey-not-available`, a repeated cursor), the pure modules of
  `results/` (`details.ts`, `downloadUrl.ts`, `privacy.ts` with the "hidden but still private" rule and
  the change-based helpers, `publicDefinition.ts` with the legacy `questions` key, `publicResultsState.ts`), the Details tab through the router (`resultsRoutes.test.tsx`:
  totals, no dates for an empty survey, no toggle for a caller who cannot modify, one merge patch per toggle,
  the IP toggle that refetches nothing, the failures, the two delete steps; the private-question saves applied to
  a fresh read so another writer's names stay, no save when that read fails or has no list, and no toggle for a
  survey without the list) and the public page
  (`publicResultsRoutes.test.tsx`: Summary and Table without sign-in, the page name, **Try again**). The two
  widgets are still the stand-in `fakeResultsWidget.tsx`, so a real **Make private** is covered by the
  end-to-end spec.
- `web/`: the API client and config loader (with `msw` and `openapi-msw` mocks typed by the
  contract), the licence loader, the CSRF middleware, the route guard and sign-out, shell selection,
  the surveyjs.io shell (account menu, notice dialogs, cookie banner), and the app rendered with React
  Testing Library. For the survey list: the search parameter validation, the date format, the query
  modules, the cache rules (a created, updated and deleted survey in the cached lists), the three
  mutations, the retry policy, the menu items per view and permission (`menuItems.ts`, pure), and the
  whole app rendered at `/` for the row: the "…" menu (open, close, keyboard, every action with its
  confirmation, the copy items with a stubbed clipboard, the error message), the inline rename
  and the placeholder pages. For uploads: `api/files.ts` (the multipart request and its CSRF header),
  `editor/uploads.ts` (every message, the pre-check, the closed editor) and `editor/creatorAutosave.ts`
  (the closed session and the reload ordering) as modules with no Creator, and the editor page (the upload
  settings, and saving again only once the reloaded documents are in the editor). For the run page: the modules
  of `web/src/run/` that have no library in them (`search.ts`, `definition.ts` with `withServerFileStorage` over
  every kind of question and matrix column and `forRunPage` dropping the old service's properties, `cookie.ts`
  with `runCookieName` mapping names such as `msid_csrf=x; path=/; a` to a token, `clientId.ts` with a fake
  storage (the per-survey id: a known SHA-256, the same for one survey in any case, different across surveys,
  never the stored browser id, and a random id for the page load without `crypto.subtle`), `load.ts`, `runState.ts`, `submit.ts` (with the library's cookie kept or deleted) and
  `responseUploads.ts` with every message), `api/public.ts`, and the routes
  rendered through the router (`runRoutes.test.tsx`: the states, the `/published` redirect that keeps the
  other search members; `privateRoutes.test.tsx`: `/s/<id>` needs no session). **`RunSurvey.tsx` has no real
  unit test**: the tests swap it for a stand-in, because jsdom does not run the library here, and the e2e spec
  covers it. **`web`'s build runs `scripts/check-run-chunks.mjs`** after `vite build`; it fails the build when
  the run route can load Creator, Ace or Dashboard code, or no `survey-form` chunk, and (Step 9) when the
  results route's static imports hold Dashboard, `survey-analytics` or Tabulator code, when its full closure
  lacks one of the three `survey-dashboard*` chunks, or when the table chunk imports the export chunk
  statically, and (Step 10) when the public results route holds Dashboard code in its static closure or lacks the
  `survey-dashboard` or `survey-dashboard-table` chunk ([Architecture](architecture.md#web-modules-websrc)). **The unit-test setup encodes `FormData` itself**: under jsdom, `FormData` and `File` are
  not Node's, and Node's own conversion fails on them, so `web/src/test/setup.ts` turns a `FormData`
  request body into a `multipart/form-data` body (keeping the file names) before it reaches the mock
  server. `web/src/test/file-handlers.ts` holds the `msw` handler that reads such a body back.

`pnpm test:unit` leaves out the `providers-azurite` project, which needs Docker.

Run one project: `pnpm vitest run --project server`. Run one file: `pnpm vitest run server/src/config.test.ts`.

## HTTP conformance

The suite calls a server **only over HTTP** and validates each response against
`contract/openapi.yaml`: documented status, content type, required headers, body schema, and for
errors a `code` from the Problem enum with a `status` equal to the HTTP status. A `501` Problem is
accepted from any operation. Details: [`conformance-tests/README.md`](../conformance-tests/README.md).

Against the reference server (it starts the server on a free port with `NODE_ENV=test`, with every app
variable from your shell removed so only explicit values reach it, waits for
`/readyz`, and stops it afterwards):

```sh
pnpm test:conformance
```

Against another back end, start it first, then give the suite its origin without `/api/v1`.
The server must be a fresh, empty instance.

Git Bash:

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell:

```powershell
$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance
Remove-Item Env:CONFORMANCE_BASE_URL
```

A port is accepted when this suite passes against it.

### Files and the shared harness

| File                     | Checks                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.ts`             | The helpers all test files share: `call` (a request whose response must conform to the contract), `codeOf`, `signedIn` and `sessionHeaders` (cookies and CSRF header)                                                                                                                                                      |
| `conformance.test.ts`    | `getConfig`, errors, the sign-in flow (below), the session, and `501` for operations that are not built                                                                                                                                                                                                                    |
| `sign-in.test.ts`        | The cookie jar of the sign-in driver (a unit test of the suite itself)                                                                                                                                                                                                                                                     |
| `surveys.test.ts`        | `listSurveys` (filters, order, visibility, paging), `createSurvey` (defaults, naming, validation, scopes) and `getSurvey` (a stranger's survey is `404`)                                                                                                                                                                   |
| `projects.test.ts`       | `listProjects` and `getProject` (roles, order, paging, a non-member gets `404`)                                                                                                                                                                                                                                            |
| `files.test.ts`          | `uploadSurveyAsset` and `downloadFile` (below)                                                                                                                                                                                                                                                                             |
| `public.test.ts`         | `getPublishedSurvey`, `submitResponse` and `getResultStats` (below)                                                                                                                                                                                                                                                        |
| `public-files.test.ts`   | `uploadResponseFile` (below)                                                                                                                                                                                                                                                                                               |
| `survey-actions.test.ts` | `updateSurvey` (every field and the combinations, `projectId: null`, `updatedAt` on every patch, `422`, `403`, `404`, a move to a project the user is not in), `deleteSurvey` (`409`, then `204`, then `404`; the `403` and `404` refusals) and `cloneSurvey` (contents, name, target scope, creator, `404`, `403`, `422`) |

`fixtureUsers` in `sign-in.ts` holds the owner, the admin, the member, the outsider and the blocked
user: the same people as the [seed accounts](development.md#golden-fixtures).

**Tests must tolerate data from other tests and from earlier runs.** The Azurite replica keeps what
tests create. So tests never assume the exact size of a scope that tests write to: they check
membership, relative order and values computed from what they created, and walk every page. The
rule for test data is in [Test data](#test-data) below. `pnpm legacy:load` reloads the fixtures and
removes everything else, which resets a replica.

### Signing in from the conformance suite

Private operations need a session, so the suite signs in over HTTP only, the way a browser does
(`conformance-tests/src/sign-in.ts`). `signIn(baseUrl, userId, returnTo)` calls `/auth/login`, keeps
the cookies in a small cookie jar, follows the redirect to the identity provider, completes it, and
calls the callback. It knows two providers:

| `/auth/login` leads to                     | The driver                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `/__dev/sign-in` (the dev provider)        | Reads the page, finds the link of the user (its `code` is the user id) and opens it                                             |
| A form with a `username` field (mock OIDC) | Posts the user id as `username` to the form's action. The mock (`docker/mock-oidc.json`) signs in that user with email and name |

The user is one of the legacy fixtures (`fixtureUsers`: the owner, the project admin, the member,
the outsider and the blocked user). With any other login page the driver throws
`SignInUnsupportedError`, and the tests that need a session are **skipped**, with the redirect target
in the skip note. The tests that need none still run.

**To make another server pass the suite**, give it a sign-in that the driver can complete. The
simplest way is the mock OIDC server of Azurite mode (`pnpm demo:azurite:up` starts it):

- Configure the port as an OAuth 2.0 client of the issuer `http://127.0.0.1:18080/surveyjs`: any
  client id and secret (the mock accepts all), the redirect URI `<its origin>/api/v1/auth/callback`,
  the scopes `openid profile email`, the code flow with PKCE (S256) and `state`, and the identity
  from UserInfo (`sub`, `email`, `name`). The mock's metadata is at
  `/surveyjs/.well-known/oauth-authorization-server`.
- Its directory must hold the fixture users (the ids in `fixtureUsers` and
  `server/fixtures/legacy/sql/Users.json`), so that `sub` finds the user, and the blocked user gets `403`.
- Start the port and run the suite with `CONFORMANCE_BASE_URL` set. The driver completes the mock's
  login form on its own.

The port's session cookies may be sealed in its own way. Their names, attributes and the CSRF rule
must follow [the API guide](api/authentication.md).

What the suite checks about sign-in: `login` redirects with an `msid_auth_<state key>` cookie; a bad
`returnTo` is `400`; the callback sets `msid` and `msid_csrf` and redirects to `returnTo`; two sign-ins
started in one browser both finish; a wrong `state` or a missing transaction cookie is `400`; a blocked
user is `403` with no session; `passwordLogin` is `501`; `getCurrentUser` is `401` signed out and the
user signed in; `logout` clears the cookies and returns the end-session URL, also without a session,
and is `403` with a session but without the CSRF token; an anonymous call to a private operation
is `401` even when it is not built, and a change without the CSRF token is `403`. The suite also tests its own validator
against a small fixture contract (`conformance-tests/src/fixtures/things.yaml`), so a broken
validator cannot give false passes.

### Files and the quota on the conformance server

`files.test.ts` uploads through the harness's multipart call (`upload`), which the validator accepts for
`multipart/form-data` requests. It checks: a PNG is stored and served to anyone (the `201` answer,
`Location`, the download headers); a WebM is an attachment and an SVG inline; the type comes from the bytes
and not from the declared type or the name; the quota is kept (a file over the whole quota, a file that
exactly fills what is left and one byte more, a survey with nothing left); the refusals (`422` for a form
without a file part and for an empty file; `400` for a cut body; `415` for a JSON body); the callers who may not change the survey (`401`,
`403` without the CSRF token, `403` for Olivia on Engineering retro, `404` for Oscar and for an unknown
survey); `404` for unknown and malformed ids; deleting a survey deletes its files; and a clone has its own
files, with rewritten links, that stay when the source is deleted.

The suite starts the reference server with `LIMIT_MAX_ASSET_BYTES_PER_SURVEY=65536` (in
`conformance-tests/src/global-setup.ts`), so the quota tests do not send 50 MB. They read the quota from
`GET /config` (`limits.maxAssetBytesPerSurvey`), so they also work against a server with another limit. A
server under test only has to report a limit that it really enforces. All uploads go to surveys the tests
create in the admin's Personal scope; no fixture survey gets a file.

**The validator checks non-JSON bodies by media type only.** The body of a response is parsed and checked
against its schema only for `application/json` and `application/*+json`. For another documented media type
(the images and videos of `downloadFile`) the validator checks that the response has one of the documented
types, the required headers, and nothing else, so it never reads binary content as text.
(`validator.test.ts` covers this.)

### The public operations on the conformance server

`public.test.ts` and `public-files.test.ts` (Step 8) call the run page's operations with no session (and
`getResultStats` with one). **Every test that stores something creates its own survey** in the admin's Personal
scope, gives it a definition through `POST /surveys { definition }`, publishes it with `PATCH { published: true }`,
and archives and deletes it at its end. No fixture survey gets a response, a marker or a file: on fixtures the
tests only read (`01` published and not archived, `05` published and archived: both run; `02` and `06`
unpublished) and refuse (`404`, nothing stored). "Stored once" is read back with `getResultStats`.

| File                   | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.test.ts`       | `getPublishedSurvey`: a published survey with its theme and, with a `clientId`, `completed`; an archived published survey runs; an unpublished and an unknown survey give the same `404`; a `clientId` that is too long or holds a reserved character is `400`. `submitResponse`: one response for each `Idempotency-Key` (a replay answers `201` with the same `id`, its data is ignored and the count stays 1; a request without a key is a new response); the one-response limit (a `cookieName` in the definition: the second submit of a client is `409`, but a retry of the first still answers `201`; a survey without a cookie name accepts the client again); a partial response is stored as complete; what the server cannot store (`404`, `422`, `415`, `400`, a bad `Idempotency-Key`); and a body of `limits.maxResponseBytes + 1` bytes is `413`. The `429` test (below). `getResultStats`: the fixture survey's 5 responses for Olivia, `count` 0 and `null` times for a new survey, `404` for Oscar and for an unknown survey, `401` without a session |
| `public-files.test.ts` | `uploadResponseFile`: a PNG is stored and served inline to anyone; another type is stored as `application/octet-stream` and served as an attachment; a file of exactly `limits.maxFileBytes` is accepted and one byte more is `413`; `422` for a form without a file and for an empty file; `415` for a JSON body; `400` for a cut body; `404 survey-not-available` for an unpublished and an unknown survey; the file is gone with its survey                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

**Server values.** The suite starts the reference server (in `global-setup.ts`) with `TRUST_PROXY=127.0.0.1,::1`
(the test client connects from the loopback address, so the server believes its `X-Forwarded-For`),
`PUBLIC_RATE_LIMIT=300`, `PUBLIC_FILE_RATE_LIMIT=10000` and `LIMIT_MAX_FILE_BYTES=65536` (so the file tests do
not send 10 MB). The tests read `limits.maxFileBytes` and `limits.maxResponseBytes` from `GET /config`, so
they also work against a server with other limits.

**The `429` test** sends its requests with its own random `X-Forwarded-For` address, so no other test shares
its counter. It reaches the limit with cheap `400` answers (a path id of 65 characters) and checks `429`,
`Retry-After` and the `rate-limited` code. A server under test must report the limits it enforces and trust the
address header of the suite's client.

**The respondent's IP is not checked in conformance.** No operation reads a response until Step 9, so whether
the address is stored (on, off, or an IPv4-mapped address) is checked in the server tests and in the Azurite
writes test. Step 9 adds the conformance check.

### The body limit on the conformance server

The suite starts the reference server with `LIMIT_MAX_DOCUMENT_BYTES=262144` (set in
`conformance-tests/src/global-setup.ts`), so the `413` test for the definition and theme saves does not
have to send 30 MB. The test reads the limit from `GET /config` (`limits.maxDocumentBytes`) and sends a
body just over it, so it also works against a server with another limit. A server under test only has to
report a limit that it really enforces.

### Results and views on the conformance server

`conformance-tests/src/results.test.ts` and `views.test.ts` (Step 9) use the fixtures **read-only** and write
only to surveys they create:

| Data                                    | What the tests do                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "API created" `…a08` (Olivia)           | Reads: a walk of three pages of 500 over the 1,500 generated rows, the default of 500 and `limit=1000`. Never a response, never a view write                                                                                                                                                                                                     |
| "Customer feedback" `…a01`              | Reads: the five legacy rows one by one with `limit=1`; the old site's Summary and Table layouts served until the user saves or resets                                                                                                                                                                                                            |
| "Campaign survey" `…a04` (Mia)          | Reads as a project member                                                                                                                                                                                                                                                                                                                        |
| The admin's Personal scope, Engineering | Own surveys: submissions oldest first, a walk that stays whole when a response arrives, rows of one client not merged, `400` for a bad `limit` or cursor; save, read, reset, per-user layouts (Engineering, so Olivia can see it), a clone without layouts, `415`, `422`, `413`, `403` and `401`; each survey is archived and deleted at the end |
| Oscar Outsider                          | `404 not-found` on `listResults` and on the three view operations, on a colleague's survey and on `…a08`; he only reads and refuses, so nothing is written                                                                                                                                                                                       |

A layout is never saved on `…a01` or `…a08`: the test of the old site's layouts reads them only, and a test
that resets a layout does it on its own survey. The Azurite replica keeps data between runs, and
`pnpm legacy:load` clears the views container, so the fallback read of `…a01` always sees the fixtures'
own layouts.

### Details, exports and public results on the conformance server

`conformance-tests/src/results-details.test.ts` and `public-results.test.ts` (Step 10) follow the rule above:
the fixtures are read only and every write goes to a survey the test creates (and removes, archive first).

| Data                                    | What the tests do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Customer feedback" `…a01` (Olivia)     | Reads: its JSON export equals a `listResults` walk, its CSV starts with the byte order mark and has CRLF lines; `getPublicResults` returns it without the private question `receipt` (`privateQuestions: ["receipt"]`), with `no-store`, to a caller with no session                                                                                                                                                                                                                                                                                                             |
| "API created" `…a08` (Olivia)           | Reads: both exports stream all 1,500 responses (a JSON array of 1,500, a CSV of 1,501 records whose header is `Submitted,color,score,subscribe,channels,comment,ClientId`). Never a deletion                                                                                                                                                                                                                                                                                                                                                                                     |
| "Campaign survey" `…a04` (Mia)          | A project member downloads; the outsider gets `404`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The admin's Personal scope, Engineering | Own surveys: format negotiation (`format` over `Accept`, `406`, `400` for `xlsx`), an empty survey (`[]`, a header-only CSV), the file name with an ASCII fallback and the UTF-8 name, the respondent IP in the list and the JSON export and never in public results, **deleting results** (rows, markers and respondent files go; the survey, the editor's assets and the saved layouts stay; `401`, `403`, `404`), Grant Access without publishing, archived surveys, paging of public results, the strip of answers and comments of private questions, bad limits and cursors |

The public rate-limit test uses an `X-Forwarded-For` address of its own and an over-long id, so it
costs the shared counters nothing and writes nothing. A deletion test **never targets a fixture
survey**: a deleted `…a08` would break the end-to-end spec that counts its 1,500 responses on a replica that
keeps its data between runs.

### Test data

Tests that write (create, update, clone, move and delete surveys) do so in only a few scopes, and
only in surveys they created themselves. No test changes a fixture survey: the checks on fixtures
(for example "the owner cannot modify Engineering retro") are refusals, which write nothing.

| Suite               | Writable scopes                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conformance         | The outsider's Personal scope, **Engineering** and the **admin's Personal scope**                                                                                                                                                                    |
| Step 5 e2e spec     | The admin's Personal scope and **Engineering** only (`survey-actions.spec.ts`)                                                                                                                                                                       |
| Step 6 e2e specs    | The admin's Personal scope only (`editor.spec.ts`, `history.spec.ts`), each test with its own survey                                                                                                                                                 |
| Step 7 e2e spec     | The admin's Personal scope only (`uploads.spec.ts`), each test with its own survey, removed at its end                                                                                                                                               |
| Step 8 e2e spec     | The admin's Personal scope only (`run.spec.ts`): each test creates, publishes, answers and removes its own survey                                                                                                                                    |
| Step 9 e2e spec     | The admin's Personal scope only (`results.spec.ts`): the tests that save or reset a layout create, publish, answer and remove their own survey. The tests on `…a08` and `…a01` write nothing: their layout writes are answered in the browser        |
| Step 9 conformance  | The admin's Personal scope and Engineering (`results.test.ts`, `views.test.ts`), each test with its own survey                                                                                                                                       |
| Step 10 e2e spec    | The admin's Personal scope only (`results-details.spec.ts`): the tests that toggle, make private, submit or delete create, publish, answer and remove their own survey. The tests on `…a08` read the Details tab and the downloads and write nothing |
| Step 10 conformance | The admin's Personal scope and Engineering (`results-details.test.ts`, `public-results.test.ts`), each test with its own survey; no setting, private list, response or deletion on `…a01`, `…a04` or `…a08`                                          |
| Other e2e specs     | The Step 4 "Create a Survey" test still writes the outsider's Personal scope; the paging spec fills Engineering                                                                                                                                      |

The owner's Personal scope, the Marketing project and every fixture survey are **fixture-only** (the large survey
`…a08` included: it holds 1,500 results and no test changes it):
no test writes to them, because the end-to-end tests assert their exact first rows on Azurite, where
data stays between runs. A test that looks for one fixture row in a scope that others write to walks
every page and does not assume it is on the first. Later steps must follow the same rule, and must **not
archive the outsider's surveys**, not even for a moment: the outsider spec asserts that this user has no
Active/Archived switch, which is shown only when there is an archived survey. (That is why the Step 5
e2e spec archives and deletes in the admin's scope, and the outsider's scope is never archived.)
Tests that create surveys archive and delete them at the end where they can; moves go to Engineering
and back out. The suite assumes a replica loaded by `pnpm legacy:load` at most a few runs ago.

The content tests of Step 6 (`conformance-tests/src/content.test.ts`) work in the same scopes. They
create their own surveys, save definitions and themes (with a stale, a missing, a weak and a `*`
`If-Match`; the `400`, `403`, `404`, `413` and `422` answers), and check the history: one entry for each
definition save, none for a theme save, paging, an invalid cursor, and the two legacy entries of Customer
feedback (read, never written). Olivia's `PUT`s on Engineering retro are refusals (`403`) and write
nothing.

The file tests of Step 7 (`conformance-tests/src/files.test.ts`) work in the admin's Personal scope too.
Every test that uploads creates its own surveys and uploads only to those, and removes them at the end
(archive, then delete). The shared stores, including the new file container, are never emptied, so
assertions are about the files a test created, never "the container holds N blobs". Olivia's upload to
Engineering retro and Oscar's upload to Campaign survey are refusals (`403`, `404`) and store nothing.

The Step 8 tests (`public.test.ts`, `public-files.test.ts`) follow the same rule (see
[The public operations on the conformance server](#the-public-operations-on-the-conformance-server)). Result
tables, completion markers and respondent files of the surveys they create are never emptied by the replica
loader; only deleting their survey (the tests do) removes them.

Who can modify what on the fixtures (the read-only checks of Step 5 and Step 6 rely on it): Olivia cannot modify
"Engineering retro" (created by Adam, she is a plain member there), so her `PATCH` and `DELETE` are
`403`; Mia can modify "Campaign survey" (she created it) and not "Archived campaign" (created by Olivia);
Oscar cannot see anything that is not his (`404`). The table is in
[Development](development.md#golden-fixtures).

## Browser end-to-end

Install the browsers once (see [Development](development.md#setup)), then:

```sh
pnpm e2e
```

`pnpm e2e` builds the web app, then Playwright starts the servers itself and opens the app in three
browsers. The server runs with the dev identity provider and the legacy-fixtures seed, so specs sign
in through the "Sign in as…" page. Servers: 3000 and `vite preview` on 5173, plus a second pair
(3001 and 5174) whose server shows the expired-licence notice. Rules:

- The config strips the developer's app variables (`APP_*`, `PORT`, `VITE_*`, and the other
  server variables) from the environment before starting the servers and the previews. The list is
  in `e2e/app-variables.mjs`, shared by the config and the runner script. Results do not depend on
  what you have exported.
- Locally it reuses servers already running on 3000 and 5173 (for example `pnpm demo`). Those servers must use the default configuration, or the home page spec fails. With `CI` set it does not
  reuse them, and fails if the ports are busy.
- Specs import `test` from `e2e/tests/support/test.ts`. It fails a test on any console error or
  page error, except the console errors of an observed signed-out `/api/v1/me` 401, the favicon CSP
  message of Firefox, and the error responses a test allows (below).
- The servers run with `SIGN_IN_RATE_LIMIT`, `PUBLIC_RATE_LIMIT` and `PUBLIC_FILE_RATE_LIMIT` set to 100000,
  because all browsers and workers share one IP address; the limits themselves are covered by the server tests
  and the conformance `429` test.
- The browsers run with the locale `en-US` and the time zone `UTC` (set in `e2e/playwright.config.ts`), so the
  dates in the list read the same on every machine (`4/14/2026`).
- Traces are kept for failures; CI uploads `e2e/playwright-report/`.

Run one browser: `pnpm e2e --project=chromium`.

The specs (`e2e/tests/`):

| Spec                         | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Modes                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `home.spec.ts`               | After sign-in the home page shows the My Surveys heading and a survey row, with no console errors                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | memory                               |
| `sign-in.spec.ts`            | An anonymous visit goes to sign-in; signing in shows the user's name; a deep link survives sign-in; Sign Out ends the session                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | memory, Azurite                      |
| `shell.spec.ts`              | A keyboard user opens the Account menu and signs out; Escape closes a menu and keeps focus (not on WebKit)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | memory                               |
| `notices.spec.ts`            | With `ACCOUNT_NOTICES=license-expired` (the second server pair) the renewal dialog opens, and Later closes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | memory                               |
| `survey-list.spec.ts`        | The owner's list (rows, dates, newest first), the Active/Archived view and the URL (reload and Back), the project selector, a user with neither selector nor switch, an unknown project that falls back to Personal Surveys, an unknown survey id ("This survey is not available." and its back link), and Create a Survey (opens the editor, then heads the list)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | memory, Azurite                      |
| `survey-list-paging.spec.ts` | Fills Engineering through the API until it holds more than 50 surveys, then Load more adds rows until the button goes and no row repeats                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | memory only (it writes many surveys) |
| `editor.spec.ts`             | **One test after another** (the Creator is heavy). A row click opens the editor, and an added question is saved (the `PUT` answers `204`, the status says "All changes saved") and survives a reload; the Themes tab saves a theme; **two browser contexts** edit the same survey and the second one gets the conflict notice, then **Reload latest** brings the first one's changes and saving works again; Clear Survey asks, then saves the empty survey (still empty after a reload); the name in the bottom bar is renamed; the Embed Survey tab shows the service address only with "Load Survey JSON from service"; read-only (Olivia on Engineering retro: status "Read-only", nothing editable, no write request sent); and the **bundle split** (the survey list loads no `survey-creator`, `SurveyEditor`, worker or Ace file, and the editor does) | memory, Azurite                      |
| `history.spec.ts`            | The history page of a new survey (first "No edits yet.", then two saves give two rows, newest first, with the user and the time zone; Back returns to the list), and of Customer feedback (two legacy entries without a user)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | memory, Azurite                      |
| `survey-actions.spec.ts`     | One scenario per row action: rename (Esc, Enter, reload), publish, Run in a new tab (the real run page) and unpublish, clone, the three copy items against the API values, Edit, View Results and View History, Move (the confirmation, to Engineering and back to Personal), Archive, Restore and Delete; and the two "no modify rights" views (Olivia on Engineering retro, Mia on Archived campaign)                                                                                                                                                                                                                                                                                                                                                                                                                                                        | memory, Azurite                      |

`uploads.spec.ts` (Step 7) has two tests. The first chooses an image for an Image question through the
file chooser and checks the upload (`POST` answers `201`), the picture shown in the Creator, the saved
definition (it holds the file link, not a data URL), the download (`200`, the type and the bytes), and that the file answers `404`
after the survey is archived and deleted. The second, the quota test, shows the message for a file over the
whole quota (before any request) and for one that the server refuses (`413`), and that nothing is saved.
The e2e servers run with `LIMIT_MAX_ASSET_BYTES_PER_SURVEY=1048576` (1 MB, set in
`e2e/playwright.config.ts`), so the test needs only a file of a little over 1 MB. Helpers are in
`e2e/tests/support/uploads.ts` (`PNG_1X1`, `paddedPng`, `uploadViaApi`, `creatorNotification`). The spec
runs in three browsers in memory mode and on Chromium in Azurite mode.

`run.spec.ts` (Step 8) checks the run page. **One survey per test, in the admin's Personal scope, answered by
the admin and removed at the end.** (1) A survey published from the list and run through **Run** opens in a new
tab at `/s/<id>`: the themed button, the brand footer, one submit, the thank-you text, and `getResultStats`
says 1. (2) A double click on **Complete** sends one `POST`. (3) A File Upload question: the file goes
through the library's choose button and the browser's file chooser (survey-core 3.1.2 ignores a direct
change on its hidden input), the upload answers `201`, the submitted answer holds the file's URL, and the
file downloads with its bytes. (4) An unpublished survey shows "This survey is not currently available."
(with an allowance for the one `404` the page's read produces). (5) `/published?id=<id>&q1=Ann` ends at
`/s/<id>?q1=Ann` with the answer prefilled. (6) A signed-out respondent loads a `survey-form-*.js` chunk and no
Creator, Ace or Dashboard file. The brand footer's logo (`surveyjs.io`) is routed to a local response, so runs
stay offline and the console guard stays quiet. The spec runs in three browsers in memory mode and on Chromium in
Azurite mode (helpers: `e2e/tests/support/run.ts`).

`results.spec.ts` (Step 9) checks the results page in three browsers and, on Chromium, in Azurite mode. The
console guard stays on, and the whole spec allows the `404` of a view read (`VIEW_404`: a user who has no saved
layout). **`…a08` ("API created") and `…a01` ("Customer feedback") are read only**: every non-`GET` request to
`/views/` is answered with `204` in the browser (`keepViewWritesInBrowser`), so nothing reaches the server, and
nothing is submitted to them. The writing tests use the admin's own published survey with three answers.

| Test                            | Checks                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Summary counts every response   | Olivia opens `…a08`: the pages of `/results` add up to 1,500 items and the last has `nextCursor: null`; five charts; no "first 1,000" banner; switching the `color` chart to its table shows 500 for Red, Green and Blue (the one `PUT` this sends is answered in the browser and counted)                                             |
| Hide, move, reload, reset       | Hide `q2` (`PUT` `204`), drag `q3` onto `q1` with the mouse (`PUT` `204`); after a reload the order is `q3, q1`; Details, **Reset Summary State**: the confirm text, `DELETE` `204`, "The summary layout is reset."; the Summary shows `q1, q2, q3`, also after a reload                                                               |
| Table paging and CSV            | `…a08?tab=table`: the first row, **Next Page**, **Last Page** (page 300), then **Export As... > CSV**: `results.csv` has 1,501 non-empty lines, a header with `Submitted`, and the first and last response in order; no layout write                                                                                                   |
| Table column, reset, Excel, PDF | Hide a column (`PUT` `204`), reload, **Reset Table State** (`DELETE` `204`), the column is back; the Excel file (`results.xlsx`, starts with `PK`) and the PDF (`results.pdf`, starts with `%PDF-`) download. This one test is why three browsers run: the deferred download of the export libraries is the one browser-dependent risk |
| The old site's layouts          | `…a01`: the Summary shows `satisfaction` and `receipt`; the Table's last header is `IPAddress` with the value `203.0.113.7`; no layout write on either tab                                                                                                                                                                             |
| Lazy bundles                    | Hovering **View Results** loads the route's chunk and no Dashboard or results request; clicking loads `survey-dashboard-*` and no `survey-dashboard-table-*`; the Table tab loads the table chunk                                                                                                                                      |
| A stranger                      | Oscar at `/surveys/<…a08>/results` sees "This survey is not available."                                                                                                                                                                                                                                                                |

`survey-actions.spec.ts` changed too: its View Results step now reads two layouts and allows their `404`s. Helpers
are in `e2e/tests/support/results.ts` (`LARGE_SURVEY`, `FEEDBACK_SURVEY`, `VIEW_404`, `CHART_DEFINITION`,
`submitViaApi`, `summaryItems`, `summaryItemNames`, `recordViewWrites`, `keepViewWritesInBrowser`,
`isViewWrite`, `openResultsTab`, `tableHeaders`, `tableCells`). Rules learned: a two-entry
`expectedErrorResponses` must be written as `[[a, b], {}]`, because Playwright reads an array whose second
element is an object as a fixture tuple; and the spec relies on survey-analytics' DOM (`[data-question]`,
`.sa-question__header--draggable`, `.tabulator-page.active`, `.sa-tabulator-column-title-text`), so a library
upgrade can need new selectors.

`results-details.spec.ts` (Step 10) checks the Details tab and the public page in three browsers and, on Chromium,
in Azurite mode. The console guard stays on and the spec allows the `404` of a view read. **`…a08` is read
only**: no `PATCH`, submission, deletion or layout write goes to it. Every writing test uses the admin's own
published survey and removes it.

| Test                             | Checks                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Totals and dates                 | Olivia, `…a08`: "Total responses:" is `1500`, and the first and last dates equal the browser's own `toLocaleString()` of `2026-05-01T08:00:00.000Z` and `2026-05-01T20:30:00.000Z` (engines format times differently, so the expected text is made in the page)                                                                                                                                 |
| An empty survey                  | "Total responses:" is `0`, no dates, no **Delete Results**                                                                                                                                                                                                                                                                                                                                      |
| Downloads                        | **JSON** is `API created.json` with 1,500 items; **CSV** is `API created.csv` with the byte order mark, 1,501 records and the header `Submitted,color,score,subscribe,channels,comment,ClientId`; no layout write                                                                                                                                                                               |
| Grant Access and the public page | **Grant Access** (the `PATCH` answers `200`, the link `/results/<id>`), **Make private** on `q2` (exactly one `PATCH` with `{ settings: { privateResultQuestions: ["q2"] } }`); a signed-out context sees the heading, the charts `q1` and `q3`, a Table with three rows and no `q2` column and no **Export As...** menu; **Disable Access**, reload: "These survey results are not available." |
| Save Respondent IP               | The toggle's text changes; after a submission the Table has an **IPAddress** column with a value                                                                                                                                                                                                                                                                                                |
| Delete Results and file links    | An uploaded file's link in the Table answers `200`; **Delete Results** with the survey name and the confirm text; "All results are deleted.", the total is `0`, the Table is empty and the file's link answers `404`                                                                                                                                                                            |

Helpers are in `e2e/tests/support/results.ts` (`isSettingsPatch`, `isResultsDelete`, `PUBLIC_RESULTS_404`). The
Details tab of a caller who cannot modify the survey (no toggles, no delete) is covered by the route tests of
`web` only.

Helpers (`e2e/tests/support/`):

- `sign-in.ts`: `users` (owner, admin, member and outsider) and `signInAt(page, path, user)`, which signs in
  through the browser: on the dev page it clicks the user, on the mock OIDC form it types the user id.
- `survey-list.ts`: locators for the rows and names (`surveyRows`, `surveyNames`, `surveysNamed`,
  `loadMoreButton`), `expectSurveyRow` (name, created and updated dates) and `loadAllPages` (clicks Load
  more until the list ends). For the row actions: `surveyRow`, `menuTrigger`, `openRowMenu`,
  `menuEntries`, `openFlyout`, `pickMenuItem`, `answerNextConfirm`, `recordClipboard` and `copiedValues`,
  and API helpers that create, read, find and discard surveys (`createSurveyViaApi`, `getSurveyViaApi`,
  `findSurveysViaApi`, `discardSurveyViaApi`).
- `survey-actions.spec.ts` rules, learned the hard way:
  - Every spec that opens menus **answers the cookie banner first** (`isInformedAboutCookieAndPolicies`
    in local storage, as `notices.spec.ts` does). The fixed banner and the footer otherwise intercept
    the click on the last menu items on a short viewport, and the click is lost.
  - **Flyouts** (Survey IDs, Move to Project) are opened by **clicking the trigger** and waiting for
    `aria-expanded="true"` (`openFlyout`). A flyout that opens by hover only can close or flip sides while
    the pointer travels to it.
  - **The clipboard is stubbed** with an init script (`recordClipboard`, read back with `copiedValues`):
    the copy items call `navigator.clipboard.writeText`, which needs permissions that browsers do not
    all give. The test compares the copied values with the survey read through the API.
  - **Confirmations** are answered with `answerNextConfirm` (it handles the next `dialog` event and
    returns its message, which is compared with the legacy text in full).
  - **The pencil link has a zero-size box** (its only child is positioned absolutely, as on the site), so
    Playwright treats it as not visible. Click the icon inside it (`.v2-class---my-surveys-page__edit-icon`),
    or focus the link and press Enter.
  - Each test creates its own survey through the API with a unique name and removes it afterwards
    (`discardSurveyViaApi`: archive, then delete). Assertions are about one named row, never a count.
- `editor.ts` (Step 6): `uniqueSurveyName`, `withCleanup`, `openEditor` and `expectEditorReady`, `expectSaved`
  (waits for the `PUT` to answer `204`, then for "All changes saved"), `addQuestion`, `openTab` (through
  the tab bar's "More" menu when a tab is in the overflow), `getDocumentViaApi` (content and ETag),
  `putDefinitionViaApi` (set-up: read the ETag, then `PUT` with `If-Match` and the CSRF header).
  Rules learned: the editor spec runs its tests one after another, because several Creators starting
  together make Firefox slow to render; the first render of the Creator waits up to 30 s; a test that
  opens a **second browser context** watches that context's console with `watchConsole` too; and
  `expectedErrorResponses` accepts a `RegExp` path for an id known only at run time (the conflict test
  expects one `412`).
- `test.ts`: the shared `test` and its console guard. **`expectedErrorResponses`** is a fixture option, a
  list of `{ path, status }`: a per-test allowance for API answers that the test expects to be
  errors, which browsers log as console errors (for example a `404` for an unknown project). Set it
  with `test.use({ expectedErrorResponses: [{ path: "/api/v1/surveys", status: 404 }] })`. Every such
  console error must be matched by an observed response with that path and status, so an allowance
  cannot hide an error that never came from the listed response.

Azurite mode: after `pnpm demo:azurite:up`, `pnpm e2e:azurite` runs the sign-in, survey list, survey
actions, editor, history, uploads, run, results and results-details specs on Chromium against the azure-legacy server and the mock OIDC server (it uses ports 3000 and 5173, so stop the
memory-mode servers first). It sets `E2E_MODE=azurite` and uses `playwright.azurite.config.ts`.

## Provider suite

One shared suite, `describeProviderSuite(name, create)` in `server/src/providers/suite/provider-suite.ts`,
runs against every storage provider and checks that they behave the same. It uses only the
`ProviderSet` interface. It runs on the golden fixtures (see
[Development](development.md#golden-fixtures)), and compares with expected domain objects that are
**written by hand** in `suite/expected.ts`, not computed from the mapping.

It covers:

- `getSurvey`: every fixture survey, an unknown id, and ids in upper case;
- `listSurveys`: personal and project scopes, the order (`updatedAt` descending, then id), an owner
  with no surveys, no mixing of scopes, and case-insensitive ids;
- `getUser` and `findUserByEmail`: found, unknown, email in any case;
- `listSurveyPage`: pages of the active and the archived list, the position of the last item, a walk
  that stays whole while a newer survey is added, ordering by id at equal times;
- `createSurvey` and `getDefinition`: the legacy defaults and lower-case ids, the same record from
  every read, a duplicate id, a definition kept (and `{}` without one);
- `getTheme`: the fixture theme, `{}` for a survey without one, `null` for an unknown id;
- `updateSurvey`: each field alone and all together (a rename, publish, archive, a move to a project
  and back to a Personal scope with the creator set to the mover, both settings), `updatedAt` always set,
  the other fields untouched, ids in upper case, an unknown id;
- `cloneSurvey`: the copy has the definition and the theme of the source and the legacy defaults, a
  source without a definition gives a copy that reads `{}`, an unknown source, a duplicate copy id;
- `deleteSurvey`: the survey, its definition and its theme are gone, the other surveys are not touched,
  a second delete is `false`;
- `getDefinition` and `getTheme`: the version token (the same for the same text, changed by a write,
  a version also for a survey without content, `null` for an unknown id);
- `saveDefinition` and `saveTheme`: a save with the current version stores the content and returns the
  next version; a stale version is a `conflict` and writes nothing; an unknown survey is `not-found`;
  `updatedAt` moves; the definition and the theme are independent;
- `listHistory` and `getHistorySnapshot`: one entry for each definition save with the saving user and the
  snapshot, newest first, ties by id, cursor paging (a walk), ids in upper case, the entries that create
  and clone add, the two legacy entries of Customer feedback (no user), delete removes the history, and
  an unknown survey gives an empty page;
- `files` (the `FileStore`): a file is stored and read back with its record and bytes (ids in any letter
  case); an unknown or malformed id is `null`; a second put of the same id is rejected and keeps the first
  file; a name with non-ASCII characters, spaces and quotes survives; a 5 MiB file round-trips byte for
  byte; `usage` counts a survey's assets only; `deleteSurveyFiles` removes one survey's files and leaves
  another's; `copySurveyAssets` copies under new ids of the target survey with the same bytes, name and
  type, and `cloneSurvey` with `rewriteText` stores the rewritten definition and theme. The tests use
  fresh random survey ids (a file store does not need a survey) and delete what they stored;
- `results` (the `ResultStore`): the fixture responses of Customer feedback in order, with the statistics and
  the markers (the partial marker of `client-0001` reads `partial`); a response stored on a new survey (the id
  in lower case); a stored `clientId` and IP, and the marker `completed`; an id that comes again answers `exists`
  and keeps the first response; the same id again with a `clientId` writes the missing marker again (store level); listing by
  time and then id, and counts per survey; the answers returned unchanged; a non-GUID id rejected with nothing
  stored; and `deleteSurvey` empties it. The tests create their own surveys and read the fixtures only;
- `results paging` (`listResponsePage`): the large survey `…a08` in three pages of 500 and in pages of 1000
  and 500 (the page borders fall inside a tie of the same minute, so the id tie-break and the Azure filter
  are used), the statistics of the 1,500 rows, the five rows of Customer feedback in slices of 2, a fresh survey
  with ties and several `limit`s, `after` the last row (an empty page), a walk that stays whole when a later
  response arrives and does not see an earlier one, and items that are copies;
- `views` (the `ViewStore`): the legacy fallback of fixture `…a01` for both views and `null` elsewhere; save,
  read, replace, other user, other view and other survey, a state with non-ASCII text, ids in upper case, reset
  and a second reset, a save after a reset; **a reset hides the legacy layout** for that user and view only;
  `getSurvey` equal before and after a save or reset (no `updatedAt` change); a clone has no layouts; a
  deletion removes them for every user; a non-GUID id reads `null` and rejects a save. The reset test runs on
  fixture `…a01` under a **fresh random user id** that no real user has, because only `…a01` holds legacy
  layouts and the suite cannot write one through the interface. It is the only write to a fixture survey, and
  `pnpm legacy:load` clears the marker (the memory provider is rebuilt for each run);
- `listUserProjects` and `getUserProject`: roles, order (project name ignoring case, then id), the full
  project record, unknown user or project, a non-member;
- the lifecycle: `ready()` resolves `true`, `close()` resolves.

Where it runs:

| Test file                                | Provider                                         | Run with                      |
| ---------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `memory.provider.test.ts`                | `memory`, seeded with fixtures                   | `pnpm test:unit`              |
| `azure-legacy.provider.azurite.test.ts`  | `azure-legacy` on the replica                    | `pnpm test:providers:azurite` |
| `azure-legacy.null-rows.azurite.test.ts` | `azure-legacy`, rows with NULL columns           | `pnpm test:providers:azurite` |
| `azure-legacy.writes.azurite.test.ts`    | `azure-legacy`, the legacy format of every write | `pnpm test:providers:azurite` |

`pnpm test:providers:azurite` is the Vitest project `providers-azurite`. It reads
`docker/azurite.env`, loads the fixtures into the running replica first, and needs
`pnpm demo:azurite:up`. The NULL-row test adds rows with NULL columns and checks the defaults
and the skip warnings (ids only). The writes test reads the replica directly and checks what a
create leaves: exactly the legacy columns of the `Surveys` row, the blobs, the audit row, a project
survey, and a duplicate id (a `LegacyStoreError` with no connection-string text). For Step 5 it checks
the raw rows after an update (only the named columns and `timestamp` change, the audit rows come in
order with their Edm types, `{ settings: {} }` writes only `timestamp`), a clone (the theme text and the
definition bytes equal the source's, the history blob, `SURVEY_THEME_CHANGE`), a delete (the three
tables, the blobs, the history and the layout blobs are gone, one `SURVEY_DELETE` row, a second delete is
`false`), and that an unreachable audit table only logs warnings (survey id and event type only). For
Step 6 it checks the definition save (`surveyjson` and `surveytext` are append blobs with the same compact
text and no BOM, the new history point with the metadata `userid` and `savedat`, only `timestamp`
changed in the row, one `SURVEY_UPDATE` row, the returned version equals the blob's ETag), a **stale save
that writes nothing** (blobs, ETags, history names, row and audit rows unchanged), a first save of a
survey without a blob (`"none"`), the theme save (the text, `timestamp`, one `SURVEY_THEME_CHANGE`, no
history point; a 40,000-character theme saves and its audit row has no `theme`; a non-ASCII theme gets a
version that the next save accepts), the SQL compare-and-set alone (a different case or a trailing
space is a conflict), and the metadata on create and clone points. For Step 7 it checks a stored file
directly in the replica (a block blob `{surveyId}/{fileId}` in `my-surveys-files` with the type as its
content type, the metadata `kind`, `name` and `createdat`, the bytes, and no blob in the legacy containers),
that the container is created by the first upload (a test uses a container name of its own through the
`filesContainer` option), that a survey's files are deleted and no others, and that a clone with a rewrite
stores the rewritten text equally in `surveyjson`, `surveytext` and the history point. For Step 8 it checks
the result tables in the replica directly: `post{postId}` has exactly the legacy properties and Edm types
(no `clientid` or `ipaddress` when not given, never `ispartialcompleted`), the marker has a Boolean
`ispartialcompleted` false and gets `publishid` once the survey has one, a client id with a quote, an accent and
spaces round-trips, **a result text of exactly 32,768 characters is stored and 32,769 is refused with
`ResponseTooLargeError` and writes nothing**, the first row stays when an id comes again, no audit row is
added, both tables are dropped with the survey, and a respondent file is stored with the kind `response`. For
Step 9 it checks the views in the replica directly (`views`): a save is a block blob of JSON at
`{survey}/{user}/{view}` in `my-surveys-views`, all lower case; a reset leaves a zero-byte blob and a later save
replaces it; a stored blob that is not a JSON object reads `null` with a warning that carries ids only; deleting
a survey removes its layouts (and deleting one without any works); the legacy layout blobs of a fixture survey
are never changed; a save or reset writes no audit row and leaves `Surveys.timestamp` alone; and a broken row
is skipped while paging, never repeating a good one. For Step 10 it checks, through the interface on both providers, **delete all** (a survey's rows and markers go,
the other surveys' stay, the record, the saved views and the private list stay, it resolves for a survey
without responses and again, and a response appended right afterwards is stored), the **private-question list**
(the fixture list of Customer feedback, `[]` elsewhere, a save read back in order in any id case, a replace,
deletion with the survey, no copy on a clone, `[]` for a non-GUID id and a rejected save) and the
**kind-limited file delete** (only the `response` files go). In the replica it checks the rows directly:
`post{postId}` and `SurveyCompletion{surveyId}` are emptied in batches (150 rows take two transactions), both
tables and `postdelete{postId}` stay, one `SURVEY_DELETEALLRESULTS` audit row is written, a survey that never
had a results table is fine; the private list is an append blob with the old JSON (`[{ "name", "isPublic":
false }]`) and no SQL or audit change; the old defaults, and a rejected read (fail closed, no warning) for a zero-byte blob, text that is not
JSON, JSON that is not an array and an empty append blob; and the blob goes with the survey. The loader tests (`load-fixtures.azurite.test.ts`) check
that the 1,500 generated rows load and that loading again gives equal summaries, and that the views container is
cleared by a load. The **create tests
of the provider suite use a fresh, random scope each** (`freshScope()`), so they do not depend on
earlier runs and leave nothing that another test could see.

**To run the suite against a new provider**, add a test file next to the others in
`server/src/providers/` that calls `describeProviderSuite("<name>", () => <create a ProviderSet
that holds the golden fixtures>)`. If it needs a service, put it in its own Vitest project, as
`providers-azurite` does, so `pnpm test:unit` stays free of it.

### Server tests of the public operations

These run in `pnpm test:unit` on the memory provider with `app.inject`: `results/handlers.test.ts` (the
respondent address: stored with the clock's time when the survey keeps addresses, ignored `X-Forwarded-For`
unless the peer is trusted, an IPv4-mapped address stored as IPv4, nothing stored when the setting is off; a
partial response stored as complete; `413` when the store cannot hold the answers; `500` for another store
failure with neither answers nor client id in the log; a replay answers the first id and a new key is refused
once the client has completed), `rate-limits.test.ts` and `files/handlers.test.ts` (`uploadResponseFile`: the
check order, the per-file limit, any type, a file whose survey went away). **The IP checks live here**, where
they were written before `listResults` existed.

### Conformance on a provider

`CONFORMANCE_PROVIDER` selects the provider for the server that the conformance suite starts:
`memory` (default; every app variable is removed; the dev identity provider) or `azure-legacy` (the
three `LEGACY_*` variables and the `OIDC_*` settings of the mock OIDC server are passed through, and
the run fails if one is missing; sign-in goes through the mock). `pnpm test:conformance:azurite`
sets it from `conformance-tests/azure-legacy.env` after loading `docker/azurite.env`. The
survey and project tests run on the provider, so on Azurite they read the fixtures from the replica and
create surveys in it (only in the scopes named in [Test data](#test-data)).

The end-to-end tests run on the memory provider (`pnpm e2e`) and, for the sign-in, survey list, survey
actions, editor, history, uploads, run, results and results-details specs, on the `azure-legacy` provider with the mock OIDC server (`pnpm e2e:azurite`). The paging spec
runs in memory mode only.
