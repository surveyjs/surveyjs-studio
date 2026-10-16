# Development

## Setup

1. **Node.js 24.** `.nvmrc` holds `24.21.0` and `engines.node` is `>=24.21.0 <25`. With nvm:
   `nvm use` (nvm-windows: `nvm use 24.21.0`). `.npmrc` sets `engine-strict=true`, so install
   fails on another major.
2. **pnpm 12.11.2.** Pinned in `packageManager`. Pick one:
   - `corepack enable`, then use `pnpm`. On Windows this may need an administrator shell;
   - leave corepack off and put `corepack pnpm` in front of every command, for example
     `corepack pnpm install`;
   - `npm install -g pnpm@12.11.2`.
3. `pnpm install`. For the e2e suite, install the browsers once:
   `pnpm --filter @my-surveys/e2e exec playwright install chromium firefox webkit`
   (on Linux add `--with-deps`, as CI does).

## Demo modes

| Mode    | Command                                                                       | Storage                                                                                               |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| memory  | `pnpm demo`                                                                   | In memory; data is lost on restart                                                                    |
| Azurite | `pnpm demo:azurite:up`, then `pnpm demo:azurite` (see [below](#azurite-mode)) | Local replica of the legacy stores, read through `azure-legacy`; sign-in through the mock OIDC server |

`pnpm demo` builds the API reference (`contract/dist/reference.html`), then starts two processes:
the server on <http://127.0.0.1:3000> (`node --watch --import tsx`, restarts on change; `tsx watch` hangs on Windows under `concurrently`) and the web app on
<http://localhost:5173> (Vite dev server, proxies `/api`, `/__dev`, `/healthz` and `/readyz` to port 3000).
Stop both with Ctrl+C. Ports are fixed; if 5173 is taken, Vite stops instead of choosing another.

### Signing in

Every page except the sign-in itself needs a session, so the first thing you see is a sign-in page.

| Mode    | Where `/api/v1/auth/login` leads                                                                                                     | Identity provider                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| memory  | `/__dev/sign-in`, a server page with the seed users, no password ([ADR 0007](adr/0007-dev-identity-provider.md))                     | `dev` (set in `server/demo.env`) |
| Azurite | The mock OIDC server's login form at `http://127.0.0.1:18080/surveyjs/authorize` ([below](#signing-in-through-the-mock-oidc-server)) | `surveyjs-oidc`                  |

`pnpm demo` seeds the memory store with `MEMORY_SEED=legacy-fixtures`, so the page lists the five
[seed accounts](#golden-fixtures): Olivia Owner, Adam Admin, Mia Member, Oscar Outsider, and the blocked user
(shown by email, marked "blocked"; choosing it gives `403 forbidden`). The session lasts 12 hours and does
not renew; Sign Out in the account menu ends it. Restarting the server does not end it: the cookie is
sealed with `SESSION_SECRET`, or the fixed development constant when it is unset (the server logs a warning
at start-up). Walkthrough: [Step 3 demo](demo/step-03.md). How sign-in works:
[Authentication](api/authentication.md).

To run one part alone: `pnpm --filter @my-surveys/server dev:demo` (watch mode, reads `server/demo.env`),
`IDENTITY_PROVIDER=dev pnpm --filter @my-surveys/server start` (no watching; the server needs an
identity provider, and `dev` signs in as a user of the memory seed), `pnpm --filter @my-surveys/web dev`, or
`pnpm --filter @my-surveys/web preview` (serves the production build; run
`pnpm --filter @my-surveys/web build` first).

## Environment variables (server)

Read at start-up. Every problem is reported at once and the process exits with code 1.

| Variable                                   | Values                                                                            | Default                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `development`, `test`, `production`                                               | `development`                                                                                                                                                              |
| `HOST`                                     | host name or address                                                              | `127.0.0.1`                                                                                                                                                                |
| `PORT`                                     | integer 0-65535 (0 = any free port)                                               | `3000`                                                                                                                                                                     |
| `LOG_LEVEL`                                | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                      | `info`                                                                                                                                                                     |
| `APP_EDITION`                              | `hosted`, `self-hosted`                                                           | `self-hosted`                                                                                                                                                              |
| `APP_SHELL`                                | non-empty string                                                                  | `surveyjs-site`                                                                                                                                                            |
| `AUTH_METHODS`                             | comma list of `surveyjs`, `password`, `oidc` (at least one)                       | `surveyjs`                                                                                                                                                                 |
| `SURVEYJS_LICENSE_KEY`                     | string                                                                            | unset (`null` in `/config`)                                                                                                                                                |
| `STORAGE_PROVIDER`                         | `memory`, `azure-legacy`                                                          | `memory`                                                                                                                                                                   |
| `MEMORY_SEED`                              | `empty`, `legacy-fixtures` (used by `memory`)                                     | `empty`                                                                                                                                                                    |
| `LEGACY_SQL_CONNECTION_STRING`             | SQL Server connection string; **secret**                                          | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | Azure Storage connection string (surveys account); **secret**                     | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | Azure Storage connection string (results account); **secret**                     | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `PUBLIC_BASE_URL`                          | absolute http(s) origin, no path (a base path is not supported)                   | `http://localhost:3000`; **required in production**                                                                                                                        |
| `LIMIT_MAX_ASSET_BYTES_PER_SURVEY`         | positive integer                                                                  | `52428800` (50 MB)                                                                                                                                                         |
| `LIMIT_MAX_FILE_BYTES`                     | positive integer                                                                  | `10485760` (10 MB)                                                                                                                                                         |
| `LIMIT_MAX_RESPONSE_BYTES`                 | positive integer                                                                  | `1048576` (1 MB); also the request body limit                                                                                                                              |
| `LIMIT_MAX_DOCUMENT_BYTES`                 | positive integer                                                                  | `30000000`; request body limit of the survey definition and theme saves                                                                                                    |
| `API_DOCS`                                 | `true`, `false`                                                                   | `true`, but `false` when `NODE_ENV=production`                                                                                                                             |
| `IDENTITY_PROVIDER`                        | `surveyjs-oidc`, `dev`                                                            | `surveyjs-oidc`; `dev` needs `STORAGE_PROVIDER=memory` and is refused in production and hosted                                                                             |
| `SESSION_SECRET`                           | string, at least 32 characters; **secret**                                        | unset; required in production, and when `PUBLIC_BASE_URL` is https or not on `localhost`, `127.0.0.1` or `[::1]` (a fixed dev constant is used, with a warning, elsewhere) |
| `SESSION_MAX_AGE_SECONDS`                  | positive integer                                                                  | `43200` (12 h); absolute expiry                                                                                                                                            |
| `OIDC_ISSUER_URL`                          | absolute http(s) URL; plain http only on `localhost`, `127.0.0.1` or `[::1]`      | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_CLIENT_ID`                           | string                                                                            | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_CLIENT_SECRET`                       | string; **secret**                                                                | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_DISCOVERY`                           | `oauth-authorization-server` (RFC 8414; auth.surveyjs.io), `openid-configuration` | `oauth-authorization-server`; `openid-configuration` with the `openid` scope also sends a nonce and requires an ID token                                                   |
| `OIDC_SCOPES`                              | space-separated scopes                                                            | `profile email`; `openid profile email` with `openid-configuration`                                                                                                        |
| `SIGN_IN_RATE_LIMIT`                       | positive integer (requests per minute per IP)                                     | `30`                                                                                                                                                                       |
| `ACCOUNT_NOTICES`                          | `none`, `license-expired`, `license-expires-soon`, `surveyjs-licenses`            | `none`; `surveyjs-licenses` needs `azure-legacy`                                                                                                                           |
| `SHELL_LINKS`                              | JSON object of name to absolute http(s) URL                                       | unset; merged over the built-in account links (below)                                                                                                                      |

"Required in production" means `NODE_ENV=production`. `SESSION_SECRET` is also required whenever the
public origin is not a loopback http origin, so a deployment that forgets `NODE_ENV` cannot run with
the public development constant. An empty or whitespace-only value counts as unset
(the default applies). Integer variables accept decimal digits only (`1e3`, `0x10`, `-1` and `1.5` are rejected). The values for edition, shell, auth
methods, licence key and limits are returned by `GET /api/v1/config`.

`GET /api/v1/config` also returns `links`, the account links of the shell. The built-in ones are the
surveyjs.io Account menu's links; `SHELL_LINKS` replaces them by name or adds more:

| Name       | Built-in URL                                                  | Used for                                                     |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| `settings` | `https://surveyjs.io/manage`                                  | Account menu "Settings", and the licence notices' "Renew"    |
| `helpDesk` | `https://surveyjs.answerdesk.io/ticket/list?preset=mytickets` | Account menu "Help Desk", and the licence dialogs' Help Desk |
| `billing`  | `https://surveyjs.io/manage#billing`                          | Account menu "Billing"                                       |

For example, `SHELL_LINKS={"settings":"https://account.example.com/"}` moves both the Settings item
and the Renew button.

`SIGN_IN_RATE_LIMIT` counts per operation and per socket IP address. The server does not read
`X-Forwarded-For` yet, so behind a reverse proxy all users share one counter: raise the limit until
trusted-proxy support arrives (Step 14).

`pnpm demo` reads `server/demo.env` (dev sign-in, the legacy fixture users, `PUBLIC_BASE_URL=http://localhost:5173`).
Variables set in the shell win over that file. To see a licence dialog of the surveyjs.io shell, run
`ACCOUNT_NOTICES=license-expired pnpm demo` (Git Bash; PowerShell: `$env:ACCOUNT_NOTICES = "license-expired"; pnpm demo`). After "Later" or "Renew" the dialog stays
hidden in that browser, as on surveyjs.io; remove the `expiredNotificationDateTime` (or
`expiresSoonNotificationDateTime`) key from the site's local storage to see it again.
The three `LEGACY_*` values, `SESSION_SECRET` and `OIDC_CLIENT_SECRET` are secrets. Never commit one, and never put a real one in a file in
this repository; the errors and logs of the server do not print them.

Set them in the shell that starts the server.

Git Bash:

```sh
IDENTITY_PROVIDER=dev APP_SHELL=demo pnpm --filter @my-surveys/server start
```

PowerShell (the variables stay set for the whole session; remove one with `Remove-Item Env:APP_SHELL`):

```powershell
$env:IDENTITY_PROVIDER = "dev"; $env:APP_SHELL = "demo"; pnpm --filter @my-surveys/server start
```

The web app has one optional build-time variable: `VITE_API_BASE_URL` (default `/api/v1`).

## Azurite mode

Azurite mode runs the server and the tools against a local replica of the legacy stores, and signs
in through a local mock OIDC server instead of `auth.surveyjs.io`. Nothing real is touched. It needs
**Docker** (with Compose) and free ports 10000 and 10002 (Azurite Blob and Table), 14333 (SQL Server)
and 18080 (mock OIDC server), all on 127.0.0.1.

| Command                  | Does                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo:azurite:up`   | Starts Azurite, SQL Server and the mock OIDC server, waits until all are healthy, then loads the golden fixtures (`pnpm legacy:load`). Safe to run again |
| `pnpm demo:azurite`      | Like `pnpm demo`, but the server uses the `azure-legacy` provider on the replica and signs in through the mock OIDC server. Needs `demo:azurite:up`      |
| `pnpm demo:azurite:down` | Stops the containers and **deletes their volumes**. The next `up` starts empty                                                                           |
| `pnpm legacy:load`       | Loads the fixtures into a running replica                                                                                                                |

[`docker/azurite.env`](../docker/azurite.env) holds the local-only values: `STORAGE_PROVIDER=azure-legacy`,
the three `LEGACY_*` connection strings, the SQL Server password, and the `OIDC_*` settings of the
mock OIDC server. The storage key in it is Microsoft's public Azurite development key, not a secret;
the mock accepts any client id and secret. Explicit environment variables win over the file.

`pnpm demo:azurite` reads it, then `server/demo-azurite.env` (`PUBLIC_BASE_URL=http://localhost:5173`,
the Vite origin). To start the server alone on the replica (it then redirects to its own origin,
port 3000):

```sh
node --env-file=docker/azurite.env --import tsx server/src/main.ts
```

(`pnpm --filter @my-surveys/server start` does not read the file; export the variables or use
the command above.) The hosted edition runs too: `APP_EDITION=hosted pnpm demo:azurite` (Git Bash).
`ACCOUNT_NOTICES=surveyjs-licenses pnpm demo:azurite` reads the licence notices from the replica's
licence tables ([layout, 3.15](architecture/legacy-data-layout.md#315-licences-and-the-licence-expiry-dialogs)).
The fixtures have fixed expiry dates, so what each user sees depends on today's date.

The loader refuses to write to an endpoint that is not local: it checks the
connection strings, then the URL of every storage client the SDK builds, before any call. Azure Files is
not emulated: the legacy file fixtures are not loaded. Why SQL Server: [ADR 0006](adr/0006-legacy-replica.md).

The provider suite and the Azure legacy conformance run use the replica too; see
[testing](testing.md#provider-suite).

### Signing in through the mock OIDC server

The mock is [mock-oauth2-server](https://github.com/navikt/mock-oauth2-server) (MIT), configured by
[`docker/mock-oidc.json`](../docker/mock-oidc.json). Its issuer is `http://127.0.0.1:18080/surveyjs`.
The server uses the same `surveyjs-oidc` code and mode as for `auth.surveyjs.io`
([what it serves](architecture/legacy-data-layout.md#61-sign-in-server-authsurveyjsio)):
`OIDC_DISCOVERY=oauth-authorization-server`, code flow with PKCE and `state`, the identity from
UserInfo, and the mock's `end_session_endpoint` on sign-out. Two differences from the real server:

- the mock serves its RFC 8414 metadata under the issuer path
  (`/surveyjs/.well-known/oauth-authorization-server`), not at
  `/.well-known/oauth-authorization-server/surveyjs`; the server tries that location second;
- the mock refuses an authorization request without the `openid` scope, so `docker/azurite.env` sets
  `OIDC_SCOPES="openid profile email"`. The mock then also returns an ID token, which the server
  checks (signature, issuer, audience, expiry) and whose `sub` must match UserInfo.

`/auth/login` opens the mock's sign-in page. Type a fixture user in the first field, leave the
claims box empty, and press **Sign-in**:

| Type       | Signs in as                            |
| ---------- | -------------------------------------- |
| `owner`    | Olivia Owner, `owner@example.com`      |
| `admin`    | Adam Admin, `admin@example.com`        |
| `member`   | Mia Member, `member@example.com`       |
| `outsider` | Oscar Outsider, `outsider@example.com` |
| `blocked`  | the blocked user: `403 forbidden`      |

The user's id (`11111111-0000-4000-8000-a00000000001` for the owner) works too. The mock gives
these names their legacy `Users.id` as the subject, with their email and name claims. Any other
text signs in a user the directory does not know, with that text as the subject.

## Golden fixtures

`server/fixtures/legacy/` holds synthetic data in the **legacy storage formats**: SQL rows as JSON
(`sql/`), Azure Table entities in Table REST JSON (`tables/`), blob content (`blobs/`) and
file content (`files/`). Its [README](../server/fixtures/legacy/README.md) lists the layout and what
each fixture covers. Three things read them: `MEMORY_SEED=legacy-fixtures`, the provider suite,
and `pnpm legacy:load`.

Seed accounts (all synthetic, in `sql/Users.json`). Use them with the inspector, and to sign in to
a demo ([Signing in](#signing-in) above):

| Email                  | Name           | Roles                                            | Covers                                                 |
| ---------------------- | -------------- | ------------------------------------------------ | ------------------------------------------------------ |
| `owner@example.com`    | Olivia Owner   | Admin of Marketing, user of Engineering          | Personal surveys (published, draft, archived)          |
| `admin@example.com`    | Adam Admin     | Admin of Engineering (its creator) and Marketing | A project creator; a role stored as `Admin`            |
| `member@example.com`   | Mia Member     | User of Marketing                                | A plain member                                         |
| `outsider@example.com` | Oscar Outsider | None                                             | One personal survey, in no project                     |
| `blocked@example.com`  | (none)         | None                                             | Blocked user; the display name falls back to the email |

What each user sees in the survey list (Step 4; "newest first" is by updated date):

| User           | Personal, active (newest first)            | Personal, archived | Projects (role)                        |
| -------------- | ------------------------------------------ | ------------------ | -------------------------------------- |
| Olivia Owner   | API created, Customer feedback, Draft idea | Old poll           | Engineering (user), Marketing (admin)  |
| Adam Admin     | none                                       | none               | Engineering (admin), Marketing (admin) |
| Mia Member     | none                                       | none               | Marketing (user)                       |
| Oscar Outsider | Outsider quiz                              | none               | none                                   |

Project surveys: Marketing has "Campaign survey" (active) and "Archived campaign" (archived);
Engineering has "Engineering retro" (active). Mia can modify "Campaign survey" (she created it) and
not "Archived campaign"; Olivia cannot modify "Engineering retro"
([ADR 0009](adr/0009-survey-permissions-follow-legacy.md)).

What each user can and cannot modify (Step 5: without modify rights the row menu hides the modifying
items, and `PATCH` and `DELETE` answer `403`):

| User           | Can modify                                                   | Cannot modify (sees, can clone)                                           |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Olivia Owner   | Her Personal surveys; Marketing's surveys (she is its admin) | Engineering retro (Adam created it; she is a plain member of Engineering) |
| Adam Admin     | Every survey of Engineering and Marketing (admin of both)    | Nothing he can see                                                        |
| Mia Member     | Campaign survey (she created it)                             | Archived campaign (Olivia created it)                                     |
| Oscar Outsider | His own Personal survey (Outsider quiz)                      | Nothing he can see; surveys of others are invisible to him (`404`)        |

Moving a survey makes the mover its creator, so a move changes who can modify it afterwards.

**Writing demos change the data.** In memory mode a restart resets it. On the Azurite replica
the changes stay until `pnpm legacy:load`. Do your trying on surveys you create yourself (Create a
Survey), and keep the fixture surveys unchanged: the test suites read them.

To change them:

1. Edit the files and keep them valid legacy data; check the
   [layout document](architecture/legacy-data-layout.md) first.
2. Run `pnpm prettier --write server/fixtures`.
3. Update `server/src/providers/suite/expected.ts` **by hand**. The expected domain objects are
   written independently of the mapping on purpose, so a mapping bug cannot hide itself.
4. Run `pnpm test:unit`, and `pnpm test:providers:azurite` with the replica up.

## Inspector

A read-only command that prints one user's surveys from whichever store is configured:

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

| Flag                   | Meaning                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| `--user <id or email>` | Required. A user GUID, or an email address                                        |
| `--env-file <path>`    | Load variables from this file first. Variables already set in the environment win |
| `--help`               | Print the usage and exit                                                          |

Output: a user line, the personal surveys, then one table per project the user belongs to, with
id, name, published, archived, created and updated. Warnings about skipped legacy rows go to
standard error (ids only). Exit codes: `0` success, `1` user not found or a store or configuration
error, `2` usage error, an unreadable env file, or no store to inspect.

It refuses (exit `2`) rather than read an empty store: `STORAGE_PROVIDER` must be set after the env
file is loaded, and the memory provider needs `MEMORY_SEED=legacy-fixtures`. The message says to
pass `--env-file docker/azurite.env` or set the variables. "User not found" names the provider
(`User not found in the azure-legacy store: …`). An unexpected error prints only its name and a
plain code, such as `Error: unexpected failure (ConnectionError, code ESOCKET)`.

Safety: it calls only read methods, and its errors never print connection strings. Put the flag
after the script name as shown; the script ends with `--` because Node 24 itself would otherwise
take a `--env-file` placed after the script path. For the memory provider on the fixtures:
`STORAGE_PROVIDER=memory MEMORY_SEED=legacy-fixtures pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com`
(the explicit variables win over the file).

Against a real store (a read-only copy, or production for a support question), give the inspector
the least privilege it needs, since it only reads:

- SQL: a login with only `db_datareader` on the database, and `ApplicationIntent=readonly` in the
  connection string, in lower case: `mssql` 12.7 ignores `ReadOnly`. It routes to a readable
  secondary where there is one;
- storage: SAS connection strings with read and list permissions only (`sp=rl`), for the Blob and
  Table services, with a short expiry;
- keep the env file **outside the repository**, or name it `.env.<something>`: only `.env` and
  `.env.*` are git-ignored (except `.env.example`). Never commit it, and delete it when you are
  done.

## Scripts

Root scripts are listed in the [README](../README.md#scripts). Package scripts:

| Package             | Script                                         | Purpose                                                                                                                                                 |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`            | `dev`, `start`, `typecheck`                    | Watch mode, plain start, type check                                                                                                                     |
| `web`               | `dev`, `build`, `preview`, `test`, `typecheck` | Vite dev server, build (type check first), preview, unit tests                                                                                          |
| `contract`          | `generate`                                     | Regenerate `generated/openapi.d.ts` after editing `openapi.yaml`                                                                                        |
| `contract`          | `lint`, `check:generated`                      | Redocly lint (telemetry off, update notice suppressed; known exceptions in `contract/.redocly.lint-ignore.yaml`); fail if the committed types are stale |
| `contract`          | `build:docs`                                   | Write the self-contained `contract/dist/reference.html`                                                                                                 |
| `conformance-tests` | `test`                                         | See [testing](testing.md)                                                                                                                               |
| `e2e`               | `test`                                         | Playwright                                                                                                                                              |

Run a package script with `pnpm --filter <package name> <script>`, for example
`pnpm --filter @my-surveys/contract generate`.

## Changing the contract

1. Edit `contract/openapi.yaml` (hand-formatted; Prettier ignores it).
2. `pnpm --filter @my-surveys/contract generate`, and commit the changed `generated/openapi.d.ts`.
3. `pnpm lint:contract`.
4. Implement the change and add conformance tests **in the same pull request**.

An operation without a handler answers `501` by itself, so adding an operation to the contract
needs no server change until you implement it.

## Dependencies and upgrades

- **Exact versions.** Every dependency in every `package.json` is an exact version, with no `^`
  or `~` (`save-exact=true` in `.npmrc`). The only exception is `workspace:*` for packages in this
  repository. `pnpm-lock.yaml` is committed, and CI installs with `--frozen-lockfile`.
- **`pnpm check:deps`** fails when:
  - a core dependency is not an exact version. Core means `typescript`, `react`, `react-dom`,
    `vite`, `fastify`, `openapi-typescript`, `openapi-fetch`, `openapi-react-query`, `openapi-msw`,
    and every package whose name starts with `@vitejs/`, `@tanstack/`, `@fastify/`, `@redocly/`
    or `survey-`;
  - `survey-*` packages are used with different versions (they must move together).
- **Renovate** (`renovate.json`) pins versions, waits 14 days after a release, and refreshes the
  lockfile on Mondays before 5:00. Its pull requests:
  - one group for all minor and patch updates except SurveyJS: merge when CI is green;
  - one group "SurveyJS" for every `survey-*` package, majors included: review it as a whole
    (Creator, Form Library and Dashboard must still work together);
  - Node.js updates stay below version 25.
- **Major upgrades** (a core dependency, Node.js, pnpm) get their own pull request, never mixed
  with feature work. The pull request adds an ADR in `docs/adr/` that records what changed and how
  it was verified (for the shape, see [ADR 0002](adr/0002-node-24-lts.md)).
- **Node.js** is pinned in `.nvmrc` and `engines.node`. Keep both, and the Docker base image once
  it exists, on the same major.

To see the rule fail and recover, follow [the Step 1 demo](demo/step-01.md#6-dependency-rules).

## CI

`.github/workflows/ci.yml` runs on pushes to `master` and `step/**` and on pull requests, on
`ubuntu-latest` (Docker is available there), with a timeout of 40 minutes. It runs, in this order:

1. `pnpm install --frozen-lockfile`, `check:deps`, `lint:contract`, `typecheck`, `lint`,
   `format:check`;
2. `test:unit` and `test:conformance` (in-memory);
3. `pnpm demo:azurite:up`, which starts the legacy replica and the mock OIDC server and loads the
   fixtures;
4. `test:providers:azurite` and `test:conformance:azurite`;
5. the browser install, `e2e` (memory provider, dev sign-in, three browsers) and `e2e:azurite` (the
   `azure-legacy` server and the mock OIDC server, Chromium);
6. on failure, it uploads the Playwright report;
7. `pnpm demo:azurite:down`, which always runs (`if: always()`).

Run the same commands locally before you push. Steps 3, 4 and 7 need Docker.

## Conventions

- TypeScript is strict and ESM. Server, contract and conformance tests use `NodeNext`; web uses `Bundler`.
- ESLint (flat config) and Prettier. `pnpm format` fixes formatting.
- Commit messages are conventional: `feat(server): ...`, `fix(web): ...`, `docs: ...`, `chore: ...`.
