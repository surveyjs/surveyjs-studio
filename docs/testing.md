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

| Command                 | Runs                                                                    |
| ----------------------- | ----------------------------------------------------------------------- |
| `pnpm test`             | `pnpm test:unit`, then `pnpm test:conformance`                          |
| `pnpm test:unit`        | Vitest projects: `scripts`, `contract`, `server`, `web`                 |
| `pnpm test:conformance` | The conformance suite against a server it starts itself                 |
| `pnpm e2e`              | Playwright on Chromium, Firefox and WebKit                              |
| `pnpm e2e:azurite`      | Playwright sign-in and survey list specs in Azurite mode (needs Docker) |

These need the Docker replica (see [Development](development.md#azurite-mode)); they are not part of
`pnpm test`:

| Command                         | Runs                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:providers:azurite`   | Four files against Azurite and SQL: the provider suite, the NULL-row tests, the survey-creation write tests and the fixture loader tests |
| `pnpm test:conformance:azurite` | The conformance suite against a server on the `azure-legacy` provider                                                                    |

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
  mapping of projects, and the in-memory provider.
- `web/`: the API client and config loader (with `msw` and `openapi-msw` mocks typed by the
  contract), the licence loader, the CSRF middleware, the route guard and sign-out, shell selection,
  the surveyjs.io shell (account menu, notice dialogs, cookie banner), and the app rendered with React
  Testing Library. For the survey list: the search parameter validation, the date format, the query
  modules, the cache rule that adds a created survey to the list, and the retry policy.

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

| File                  | Checks                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness.ts`          | The helpers all test files share: `call` (a request whose response must conform to the contract), `codeOf`, `signedIn` and `sessionHeaders` (cookies and CSRF header) |
| `conformance.test.ts` | `getConfig`, errors, the sign-in flow (below), the session, and `501` for operations that are not built                                                               |
| `sign-in.test.ts`     | The cookie jar of the sign-in driver (a unit test of the suite itself)                                                                                                |
| `surveys.test.ts`     | `listSurveys` (filters, order, visibility, paging), `createSurvey` (defaults, naming, validation, scopes) and `getSurvey` (a stranger's survey is `404`)              |
| `projects.test.ts`    | `listProjects` and `getProject` (roles, order, paging, a non-member gets `404`)                                                                                       |

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

### Test data

Tests that write (create surveys) do so in only two scopes: **the outsider's personal scope** and
**the Engineering project**. The owner's personal scope and the Marketing project are
**fixture-only**: no test writes to them, because the end-to-end tests assert their exact first rows
on Azurite, where data stays between runs. A test that looks for one fixture row in a scope that
others write to walks every page and does not assume it is on the first. Later steps must follow the
same rule, and must **not archive the outsider's surveys**: the outsider spec asserts that this user
has no Active/Archived switch, which is shown only when there is an archived survey. The suite
assumes a replica loaded by `pnpm legacy:load` at most a few runs ago.

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
- The browsers run with the locale `en-US` and the time zone `UTC` (set in `e2e/playwright.config.ts`), so the
  dates in the list read the same on every machine (`4/14/2026`).
- Traces are kept for failures; CI uploads `e2e/playwright-report/`.

Run one browser: `pnpm e2e --project=chromium`.

The specs (`e2e/tests/`):

| Spec                         | Checks                                                                                                                                                                                                                                                                                                                                                                         | Modes                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `home.spec.ts`               | After sign-in the home page shows the My Surveys heading and a survey row, with no console errors                                                                                                                                                                                                                                                                              | memory                               |
| `sign-in.spec.ts`            | An anonymous visit goes to sign-in; signing in shows the user's name; a deep link survives sign-in; Sign Out ends the session                                                                                                                                                                                                                                                  | memory, Azurite                      |
| `shell.spec.ts`              | A keyboard user opens the Account menu and signs out; Escape closes a menu and keeps focus (not on WebKit)                                                                                                                                                                                                                                                                     | memory                               |
| `notices.spec.ts`            | With `ACCOUNT_NOTICES=license-expired` (the second server pair) the renewal dialog opens, and Later closes it                                                                                                                                                                                                                                                                  | memory                               |
| `survey-list.spec.ts`        | The owner's list (rows, dates, newest first), the Active/Archived view and the URL (reload and Back), the project selector, a user with neither selector nor switch, an unknown project that falls back to Personal Surveys, an unknown survey id ("This survey is not available." and its back link), and Create a Survey (opens the editor placeholder, then heads the list) | memory, Azurite                      |
| `survey-list-paging.spec.ts` | Fills Engineering through the API until it holds more than 50 surveys, then Load more adds rows until the button goes and no row repeats                                                                                                                                                                                                                                       | memory only (it writes many surveys) |

Helpers (`e2e/tests/support/`):

- `sign-in.ts`: `users` (owner, admin, member and outsider) and `signInAt(page, path, user)`, which signs in
  through the browser: on the dev page it clicks the user, on the mock OIDC form it types the user id.
- `survey-list.ts`: locators for the rows and names (`surveyRows`, `surveyNames`, `surveysNamed`,
  `loadMoreButton`), `expectSurveyRow` (name, created and updated dates) and `loadAllPages` (clicks Load
  more until the list ends).
- `test.ts`: the shared `test` and its console guard. **`expectedErrorResponses`** is a fixture option, a
  list of `{ path, status }`: a per-test allowance for API answers that the test expects to be
  errors, which browsers log as console errors (for example a `404` for an unknown project). Set it
  with `test.use({ expectedErrorResponses: [{ path: "/api/v1/surveys", status: 404 }] })`. Every such
  console error must be matched by an observed response with that path and status, so an allowance
  cannot hide an error that never came from the listed response.

Azurite mode: after `pnpm demo:azurite:up`, `pnpm e2e:azurite` runs the sign-in and survey list specs on
Chromium against the azure-legacy server and the mock OIDC server (it uses ports 3000 and 5173, so stop the
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
- `listUserProjects` and `getUserProject`: roles, order (project name ignoring case, then id), the full
  project record, unknown user or project, a non-member;
- the lifecycle: `ready()` resolves `true`, `close()` resolves.

Where it runs:

| Test file                                | Provider                                              | Run with                      |
| ---------------------------------------- | ----------------------------------------------------- | ----------------------------- |
| `memory.provider.test.ts`                | `memory`, seeded with fixtures                        | `pnpm test:unit`              |
| `azure-legacy.provider.azurite.test.ts`  | `azure-legacy` on the replica                         | `pnpm test:providers:azurite` |
| `azure-legacy.null-rows.azurite.test.ts` | `azure-legacy`, rows with NULL columns                | `pnpm test:providers:azurite` |
| `azure-legacy.writes.azurite.test.ts`    | `azure-legacy`, the legacy format of a created survey | `pnpm test:providers:azurite` |

`pnpm test:providers:azurite` is the Vitest project `providers-azurite`. It reads
`docker/azurite.env`, loads the fixtures into the running replica first, and needs
`pnpm demo:azurite:up`. The NULL-row test adds rows with NULL columns and checks the defaults
and the skip warnings (ids only). The writes test reads the replica directly and checks what a
create leaves: exactly the legacy columns of the `Surveys` row, the blobs, the audit row, a project
survey, and a duplicate id (a `LegacyStoreError` with no connection-string text). The **create tests
of the provider suite use a fresh, random scope each** (`freshScope()`), so they do not depend on
earlier runs and leave nothing that another test could see.

**To run the suite against a new provider**, add a test file next to the others in
`server/src/providers/` that calls `describeProviderSuite("<name>", () => <create a ProviderSet
that holds the golden fixtures>)`. If it needs a service, put it in its own Vitest project, as
`providers-azurite` does, so `pnpm test:unit` stays free of it.

### Conformance on a provider

`CONFORMANCE_PROVIDER` selects the provider for the server that the conformance suite starts:
`memory` (default; every app variable is removed; the dev identity provider) or `azure-legacy` (the
three `LEGACY_*` variables and the `OIDC_*` settings of the mock OIDC server are passed through, and
the run fails if one is missing; sign-in goes through the mock). `pnpm test:conformance:azurite`
sets it from `conformance-tests/azure-legacy.env` after loading `docker/azurite.env`. The
survey and project tests run on the provider, so on Azurite they read the fixtures from the replica and
create surveys in it (only in the scopes named in [Test data](#test-data)).

The end-to-end tests run on the memory provider (`pnpm e2e`) and, for the sign-in and survey list
specs, on the `azure-legacy` provider with the mock OIDC server (`pnpm e2e:azurite`). The paging spec
runs in memory mode only.
