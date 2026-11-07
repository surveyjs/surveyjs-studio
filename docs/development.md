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
   `pnpm --filter @surveyjs-studio/e2e exec playwright install chromium firefox webkit`
   (on Linux add `--with-deps`, as CI does).

## Demo modes

| Mode       | Command                                                                                         | Storage                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| memory     | `pnpm demo`                                                                                     | In memory; data is lost on restart                                                                     |
| Azurite    | `pnpm demo:azurite:up`, then `pnpm demo:azurite` (see [below](#azurite-mode))                   | Local replica of the legacy stores, read through `azure-legacy`; sign-in through the mock OIDC server  |
| SQLite     | `pnpm seed:sqlite` once, then `pnpm dev:sqlite` (see [below](#sqlite-and-postgresql-modes))     | Everything in `server/.data/`; users in memory, or in the database with [passwords](#password-sign-in) |
| PostgreSQL | `pnpm seed:postgres` once, then `pnpm dev:postgres` (see [below](#sqlite-and-postgresql-modes)) | Everything but users in PostgreSQL in Docker, files in `server/.data/files`                            |
| S3         | `pnpm seed:sqlite` once, then `pnpm dev:s3` (see [below](#files-in-s3))                         | Like SQLite, with the files in RustFS, an S3-compatible server in Docker                               |

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

`pnpm demo` seeds the memory store with `MEMORY_SEED=legacy-fixtures`, so the page lists the six
[seed accounts](#golden-fixtures): Olivia Owner, Adam Admin, Mia Member, Oscar Outsider, Erin Erasable
(for erasure demos and tests only), and the blocked user
(shown by email, marked "blocked"; choosing it gives `403 forbidden`). The session lasts 12 hours and does
not renew; Sign Out in the account menu ends it. Restarting the server does not end it: the cookie is
sealed with `SESSION_SECRET`, or the fixed development constant when it is unset (the server logs a warning
at start-up). Walkthrough: [Step 3 demo](demo/step-03.md). How sign-in works:
[Authentication](api/authentication.md).

To run one part alone: `pnpm --filter @surveyjs-studio/server dev:demo` (watch mode, reads `server/demo.env`),
`IDENTITY_PROVIDER=dev pnpm --filter @surveyjs-studio/server start` (no watching; the server needs an
identity provider, and `dev` signs in as a user of the memory seed), `pnpm --filter @surveyjs-studio/web dev`, or
`pnpm --filter @surveyjs-studio/web preview` (serves the production build; run
`pnpm --filter @surveyjs-studio/web build` first).

## Environment variables (server)

Read at start-up. Every problem is reported at once and the process exits with code 1. Which of them each deployment
mode needs, and their values in production: [Operations › Configuration by deployment mode](operations.md#configuration-by-deployment-mode).

| Variable                                   | Values                                                                                                                                                                                                                                                      | Default                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                 | `development`, `test`, `production`                                                                                                                                                                                                                         | `development`                                                                                                                                                              |
| `HOST`                                     | host name or address                                                                                                                                                                                                                                        | `127.0.0.1`                                                                                                                                                                |
| `PORT`                                     | integer 0-65535 (0 = any free port)                                                                                                                                                                                                                         | `3000`                                                                                                                                                                     |
| `LOG_LEVEL`                                | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                                                                                                                                                                | `info`                                                                                                                                                                     |
| `APP_EDITION`                              | `hosted`, `self-hosted`                                                                                                                                                                                                                                     | `self-hosted`                                                                                                                                                              |
| `APP_SHELL`                                | `surveyjs-site` (the surveyjs.io look), `self-hosted` (the self-hosted look with the instance's branding), `plain`, or a custom shell's name                                                                                                                | `surveyjs-site`                                                                                                                                                            |
| `AUTH_METHODS`                             | comma list of `surveyjs`, `password`, `google`, `github`, `facebook` (at least one); `password` needs `USER_DIRECTORY=local`; `google`, `github` and `facebook` are refused until self-hosted Step 8. The `OIDC_*` settings are needed only with `surveyjs` | `surveyjs`                                                                                                                                                                 |
| `SURVEYJS_LICENSE_KEY`                     | string                                                                                                                                                                                                                                                      | unset (`null` in `/config`)                                                                                                                                                |
| `BRAND_NAME`                               | the instance's name, at most 80 characters (the self-hosted shell)                                                                                                                                                                                          | `My Surveys`                                                                                                                                                               |
| `BRAND_LOGO_URL`                           | an https URL or a path on this site (`/...`, served by your reverse proxy: the app does not serve it)                                                                                                                                                       | unset: the name alone                                                                                                                                                      |
| `BRAND_ACCENT_COLOR`                       | `#rgb` or `#rrggbb`                                                                                                                                                                                                                                         | `#19b394`                                                                                                                                                                  |
| `TERMS_URL`, `PRIVACY_URL`                 | http(s) URLs, linked in the self-hosted footer                                                                                                                                                                                                              | unset: no link                                                                                                                                                             |
| `BRANDING`                                 | `on`, `off`: `off` hides "Powered by SurveyJS" and needs `SURVEYJS_LICENSE_KEY`                                                                                                                                                                             | `on`                                                                                                                                                                       |
| `STORAGE_PROVIDER`                         | `memory`, `azure-legacy`, `sqlite`, `postgres` (with `NODE_ENV=production`, `sqlite` and `postgres` need `USER_DIRECTORY=local`)                                                                                                                            | `memory`                                                                                                                                                                   |
| `MEMORY_SEED`                              | `empty`, `legacy-fixtures` (used by `memory`, and by the memory stores of `sqlite` and `postgres`)                                                                                                                                                          | `empty`                                                                                                                                                                    |
| `SQLITE_PATH`                              | path of the SQLite file (used by `sqlite`); a relative path is resolved against the working directory, and the folder is created                                                                                                                            | `/data/surveyjs-studio.db`                                                                                                                                                 |
| `DATABASE_URL`                             | `postgres://` or `postgresql://` URL (used by `postgres`); **secret**                                                                                                                                                                                       | unset; required when `STORAGE_PROVIDER=postgres`                                                                                                                           |
| `FILE_STORE`                               | `local`, `s3`; only with `sqlite` and `postgres` ([ADR 0025](adr/0025-file-storage-for-the-sql-providers.md))                                                                                                                                               | `local`                                                                                                                                                                    |
| `FILES_PATH`                               | folder of the uploaded files with `FILE_STORE=local`; a relative path is resolved against the working directory                                                                                                                                             | `/data/files`                                                                                                                                                              |
| `S3_BUCKET`                                | bucket of the files with `FILE_STORE=s3`; the app never creates it                                                                                                                                                                                          | unset; required when `FILE_STORE=s3`                                                                                                                                       |
| `S3_REGION`                                | AWS region (any value for most S3-compatible services)                                                                                                                                                                                                      | `us-east-1`                                                                                                                                                                |
| `S3_ENDPOINT`                              | URL of an S3-compatible service; https unless on `localhost`, `127.0.0.1` or `[::1]`                                                                                                                                                                        | unset: AWS S3                                                                                                                                                              |
| `S3_FORCE_PATH_STYLE`                      | `true`, `false`; `true` for services without virtual-host buckets (RustFS, MinIO)                                                                                                                                                                           | `false`                                                                                                                                                                    |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | the S3 keys, both or neither; the secret is **secret**                                                                                                                                                                                                      | unset: the AWS SDK's default credentials                                                                                                                                   |
| `LEGACY_SQL_CONNECTION_STRING`             | SQL Server connection string; **secret**                                                                                                                                                                                                                    | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | Azure Storage connection string (surveys account); **secret**                                                                                                                                                                                               | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | Azure Storage connection string (results account); **secret**                                                                                                                                                                                               | unset; required when `STORAGE_PROVIDER=azure-legacy`                                                                                                                       |
| `PUBLIC_BASE_URL`                          | absolute http(s) origin, no path (a base path is not supported)                                                                                                                                                                                             | `http://localhost:3000`; **required in production**                                                                                                                        |
| `LIMIT_MAX_ASSET_BYTES_PER_SURVEY`         | positive integer                                                                                                                                                                                                                                            | `52428800` (50 MB)                                                                                                                                                         |
| `LIMIT_MAX_FILE_BYTES`                     | positive integer                                                                                                                                                                                                                                            | `10485760` (10 MB); the largest respondent file                                                                                                                            |
| `LIMIT_MAX_RESPONSE_BYTES`                 | positive integer                                                                                                                                                                                                                                            | `1048576` (1 MB); also the request body limit                                                                                                                              |
| `LIMIT_MAX_DOCUMENT_BYTES`                 | positive integer                                                                                                                                                                                                                                            | `30000000`; request body limit of the survey definition and theme saves                                                                                                    |
| `API_DOCS`                                 | `true`, `false`; `true` only with `APP_SHELL=surveyjs-site` (the docs are shown only there)                                                                                                                                                                 | `true` in the surveyjs-site shell, but `false` when `NODE_ENV=production`; `false` in every other shell                                                                    |
| `IDENTITY_PROVIDER`                        | `surveyjs-oidc`, `dev`                                                                                                                                                                                                                                      | `surveyjs-oidc`; `dev` needs `STORAGE_PROVIDER=memory`, `sqlite` or `postgres` and is refused in production and hosted                                                     |
| `SESSION_SECRET`                           | string, at least 32 characters; **secret**                                                                                                                                                                                                                  | unset; required in production, and when `PUBLIC_BASE_URL` is https or not on `localhost`, `127.0.0.1` or `[::1]` (a fixed dev constant is used, with a warning, elsewhere) |
| `SESSION_MAX_AGE_SECONDS`                  | positive integer                                                                                                                                                                                                                                            | `43200` (12 h); absolute expiry                                                                                                                                            |
| `OIDC_ISSUER_URL`                          | absolute http(s) URL; plain http only on `localhost`, `127.0.0.1` or `[::1]`                                                                                                                                                                                | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_CLIENT_ID`                           | string                                                                                                                                                                                                                                                      | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_CLIENT_SECRET`                       | string; **secret**                                                                                                                                                                                                                                          | unset; required for `surveyjs-oidc`                                                                                                                                        |
| `OIDC_DISCOVERY`                           | `oauth-authorization-server` (RFC 8414; auth.surveyjs.io), `openid-configuration`                                                                                                                                                                           | `oauth-authorization-server`; `openid-configuration` with the `openid` scope also sends a nonce and requires an ID token                                                   |
| `OIDC_SCOPES`                              | space-separated scopes                                                                                                                                                                                                                                      | `profile email`; `openid profile email` with `openid-configuration`                                                                                                        |
| `SIGN_IN_RATE_LIMIT`                       | positive integer (requests per minute per IP)                                                                                                                                                                                                               | `30`                                                                                                                                                                       |
| `TRUST_PROXY`                              | comma-separated IP addresses or CIDR ranges (for example `127.0.0.1,10.0.0.0/8`)                                                                                                                                                                            | empty: no proxy is trusted. A bad entry stops start-up                                                                                                                     |
| `PUBLIC_RATE_LIMIT`                        | positive integer (requests per minute per IP, for each of `getPublishedSurvey`, `submitResponse`, `uploadResponseFile` and `getPublicResults`)                                                                                                              | `60`                                                                                                                                                                       |
| `PUBLIC_FILE_RATE_LIMIT`                   | positive integer (requests per minute per IP for `downloadFile`)                                                                                                                                                                                            | `600`                                                                                                                                                                      |
| `ACCOUNT_NOTICES`                          | `none`, `license-expired`, `license-expires-soon`, `surveyjs-licenses`                                                                                                                                                                                      | `none`; `surveyjs-licenses` needs `USER_DIRECTORY=surveyjs-sql` or `surveyjs-api`                                                                                          |
| `USER_DIRECTORY`                           | `memory`, `surveyjs-sql`, `surveyjs-api`, `local` (`local` needs `STORAGE_PROVIDER=memory`, `sqlite` or `postgres`)                                                                                                                                         | `memory` with `STORAGE_PROVIDER=memory`, `sqlite` or `postgres`, else `surveyjs-sql`                                                                                       |
| `ADMIN_EMAIL`                              | an email address; with `ADMIN_PASSWORD`, `USER_DIRECTORY=local` only                                                                                                                                                                                        | unset. At start-up with no active admin: creates this admin, who must change the password at the first sign-in; unset, a one-time setup link is logged instead             |
| `ADMIN_PASSWORD`                           | string, **secret**: at least 12 characters, not a common password; with `ADMIN_EMAIL`                                                                                                                                                                       | unset                                                                                                                                                                      |
| `USER_API_URL`                             | absolute http(s) URL; plain http only on `localhost`, `127.0.0.1` or `[::1]`; a trailing slash is dropped                                                                                                                                                   | unset; required for `USER_DIRECTORY=surveyjs-api`                                                                                                                          |
| `USER_API_TOKEN`                           | string; **secret**                                                                                                                                                                                                                                          | unset; required for `USER_DIRECTORY=surveyjs-api`                                                                                                                          |
| `ACCOUNT_WEBHOOK_SECRET`                   | `whsec_` and the base64 of at least 24 bytes; **secret**                                                                                                                                                                                                    | unset: the account-deleted webhook answers `404` (`503 read-only` while `READ_ONLY=true`)                                                                                  |
| `SHELL_LINKS`                              | JSON object of name to absolute http(s) URL                                                                                                                                                                                                                 | unset; merged over the built-in account links (below)                                                                                                                      |
| `WEB_ROOT`                                 | absolute path of a built `web/dist`; it must hold `index.html`                                                                                                                                                                                              | unset: the server serves the API only. Set: also the web app, with its own headers (ADR 0021)                                                                              |
| `READ_ONLY`                                | `true`, `false`                                                                                                                                                                                                                                             | `false`. `true`: every write answers `503 read-only`; reads, sign-in and sign-out work                                                                                     |
| `REQUEST_TIMEOUT_SECONDS`                  | positive integer of seconds                                                                                                                                                                                                                                 | `300`. The whole request, headers and body, must arrive within it, or the server answers `408`                                                                             |

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

The rate limits count per operation and per client IP address (`SIGN_IN_RATE_LIMIT` for the sign-in
operations, `PUBLIC_RATE_LIMIT` and `PUBLIC_FILE_RATE_LIMIT` for the public ones: [Public
endpoints](api/public-endpoints.md#rate-limits)). The client is the address of the connection, so **behind a
reverse proxy set `TRUST_PROXY` to the proxy's address (or range)**: the server then takes the client from
`X-Forwarded-For` for requests that come from that proxy. Without it every user shares the proxy's counter,
and a stored respondent address is the proxy's. List only proxies you run: a header from any other peer is
ignored, but a listed range that is too wide lets a caller choose its address. The counters live in the
process, so several instances each count alone ([Operations › One instance](operations.md#running-the-image)).

`pnpm demo` reads `server/demo.env` (dev sign-in, the legacy fixture users, `PUBLIC_BASE_URL=http://localhost:5173`).
Variables set in the shell win over that file. To see a licence dialog of the surveyjs.io shell, run
`ACCOUNT_NOTICES=license-expired pnpm demo` (Git Bash; PowerShell: `$env:ACCOUNT_NOTICES = "license-expired"; pnpm demo`). After "Later" or "Renew" the dialog stays
hidden in that browser, as on surveyjs.io; remove the `expiredNotificationDateTime` (or
`expiresSoonNotificationDateTime`) key from the site's local storage to see it again.
The three `LEGACY_*` values, `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `USER_API_TOKEN` and `ACCOUNT_WEBHOOK_SECRET` are secrets. Never commit one, and never put a real one in a file in
this repository; the errors and logs of the server do not print them.

Set them in the shell that starts the server.

Git Bash:

```sh
IDENTITY_PROVIDER=dev APP_SHELL=demo pnpm --filter @surveyjs-studio/server start
```

PowerShell (the variables stay set for the whole session; remove one with `Remove-Item Env:APP_SHELL`):

```powershell
$env:IDENTITY_PROVIDER = "dev"; $env:APP_SHELL = "demo"; pnpm --filter @surveyjs-studio/server start
```

The web app has one optional build-time variable: `VITE_API_BASE_URL` (default `/api/v1`).

### The editor in both modes

A row click (or **Edit**) opens the survey editor, in both demo modes. The Survey Creator is loaded from a
separate chunk, so the first open takes a moment; the survey list never loads it. Saves go through
`PUT /surveys/{id}/definition` and `/theme` with `If-Match` ([API](api/concurrency.md)).

| Mode    | What the editor does                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory  | Saves in memory. History entries have the saving user. A restart loses them; the fixture surveys have the two legacy entries of Customer feedback |
| Azurite | Saves into the replica in the legacy format ([ADR 0010](adr/0010-writing-to-the-legacy-stores.md)); the changes stay until `pnpm legacy:load`     |

**The licence banner.** The Creator is a commercial SurveyJS product. Without `SURVEYJS_LICENSE_KEY` it
shows its banner about a missing licence and stays usable. That is expected in both demo modes, and no
console error comes with it. To see the editor without the banner, set the key in your own shell
(`SURVEYJS_LICENSE_KEY=<your key> pnpm demo`; PowerShell: `$env:SURVEYJS_LICENSE_KEY = "<your key>"; pnpm demo`).
Never put a key in a file of this repository.

**Body limit.** The definition and theme saves accept up to `LIMIT_MAX_DOCUMENT_BYTES` (default
30,000,000 bytes); other routes keep `LIMIT_MAX_RESPONSE_BYTES`. The conformance suite lowers it to 262144.

**Uploads.** Choosing a picture or a video in the editor (an Image question, an image choice, the logo, a
theme background) uploads it through `POST /surveys/{id}/assets` and puts the returned link into the
survey ([Uploads and files](api/uploads.md), [for users](user-guide/images-and-files.md)). Where the
files go:

| Mode    | Where uploaded files are stored                                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory  | In the server's memory. A restart loses them, and the links then answer `404` (like all memory data)                                                                               |
| Azurite | In the blob container `my-surveys-files` of the replica (created on the first upload), as `{surveyId}/{fileId}`. They stay until the survey is deleted or `pnpm demo:azurite:down` |

The legacy file share `surveyfiles` is not used in either mode.

**Try the quota message.** A survey may hold `LIMIT_MAX_ASSET_BYTES_PER_SURVEY` bytes of files (default
50 MB). To see the message without a 50 MB file, start the demo with a small limit (Git Bash):

```sh
LIMIT_MAX_ASSET_BYTES_PER_SURVEY=1048576 pnpm demo
```

PowerShell: `$env:LIMIT_MAX_ASSET_BYTES_PER_SURVEY = "1048576"; pnpm demo`. Then choose an image of more than
1 MB: the editor shows "A survey can store up to 1 MB of files in total. This file was not uploaded." The
Step 7 demo script has the full walk-through ([demo](demo/step-07.md)).

### The run page in both modes

**Run** in the survey list opens the run page, `/s/<survey id>`, in both demo modes. It needs no sign-in, so
you can open the link in a private window. The Form Library loads in its own chunk (`survey-form`), never the
editor. Where the responses and files go:

| Mode    | Where responses and respondent files are stored                                                                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory  | In the server's memory. A restart loses them. The fixture surveys start with their legacy responses (Customer feedback has 5), so the count of a fixture survey is not 0                                                                                                                                            |
| Azurite | Result rows in the table `post{postId}` and completion markers in `SurveyCompletion{surveyId}` of the replica, in the legacy format ([ADR 0010](adr/0010-writing-to-the-legacy-stores.md)); respondent files in the container `my-surveys-files`. They stay until the survey is deleted or `pnpm demo:azurite:down` |

Only a **published** survey runs. Publish it in the list first. See the responses on the results page
(**View Results**, [below](#the-results-page-in-both-modes)), or count them through the API:
`GET /api/v1/surveys/<id>/results/stats` in the signed-in browser or with the cookie `msid`
([Public endpoints](api/public-endpoints.md#count-the-responses)).

- **The brand footer** loads its logo from `https://surveyjs.io`, so it is a missing image when you are offline.
  It is not an error of the page.
- **Rate limits** are on at their defaults (60 requests a minute for the run page's calls). To see a `429`
  quickly, start the demo with a low limit: `PUBLIC_RATE_LIMIT=5 pnpm demo` (PowerShell: `$env:PUBLIC_RATE_LIMIT =
"5"; pnpm demo`).
- **Respondent files** may be up to `LIMIT_MAX_FILE_BYTES` (10 MB). To see the refusal without a large file,
  start with `LIMIT_MAX_FILE_BYTES=1048576`.
- **The respondent's address.** Both modes run the web app and the API on two ports, and the web app's dev
  server connects from the loopback address. A response stored with "Save Respondent IP" on therefore holds
  `127.0.0.1` (or `::1`). `TRUST_PROXY` matters only behind a real reverse proxy.
- **The Step 8 demo script** walks through all of it ([demo](demo/step-08.md)).

### The results page in both modes

**View Results** in the survey list opens `/surveys/<survey id>/results`, in both demo modes. Sign in as
Olivia Owner (Olivia Owner on the memory sign-in page, or `owner` in the mock OIDC form), open the "…" menu of
**API created** (the first row of her list) and click **View Results**: the Summary shows five charts over
1,500 responses. [The user's view](user-guide/viewing-results.md) lists what the page does. Where the layouts
go:

| Mode    | Where the saved layouts of the Summary and the Table go                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| memory  | In the server's memory, for each user and survey. A restart loses them. Customer feedback starts with the old site's layouts of the fixtures (read-only, until you change or reset one)                                                                                   |
| Azurite | In the blob container `my-surveys-views` of the replica (created on the first save), as `{surveyId}/{userId}/{view}`, in the format described in [ADR 0010](adr/0010-writing-to-the-legacy-stores.md#step-9-results-layouts). `pnpm legacy:load` **clears** the container |

- **Layouts are per user.** Sign in as another user (for example Adam Admin on a survey of Engineering) to see
  that your layout is not theirs. Try layouts on surveys you create yourself, and add answers
  through the run page. A layout saved on a fixture survey is dropped by a restart (memory mode) or by the next
  `pnpm legacy:load` (Azurite mode), so the test suites never see it.
- **The licence banner.** The Summary and the Table are SurveyJS Dashboard components. Without
  `SURVEYJS_LICENSE_KEY` they show the library's banner about a missing licence and stay usable, with no
  console error. Set the key in your own shell as for the editor, never in a file of this repository.
- **No new variable.** A layout is limited by the body limit `LIMIT_MAX_RESPONSE_BYTES` only (default 1 MB). A
  larger layout is refused with `413`, and the page shows its quiet save-failure line.
- **Exports** (CSV, Excel, PDF) are made in the browser: the server is not involved, and the Excel and PDF
  code loads on the first such export.
- **The Step 9 demo script** walks through it ([demo](demo/step-09.md)).

### Details, downloads and public results in both modes (Step 10)

The **Details** tab (`/surveys/<survey id>/results?tab=details`) works in both demo modes. The user's view is
[Downloading, sharing and deleting results](user-guide/downloading-sharing-and-deleting-results.md). What
differs by mode, and where to try each part:

| Part                | Memory mode (`pnpm demo`)                                                                                  | Azurite mode (`pnpm demo:azurite`)                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statistics, exports | Read from memory                                                                                           | Read from the replica's `post{postId}` table, page by page (each page scans the rows from its cursor's time on, [Paging](api/paging.md#results-oldest-first-one-survey))          |
| Private questions   | Held in the server's memory, seeded from the fixture blob (`receipt` of Customer feedback)                 | The blob `surveyresultpermissions/{surveyId}` of the replica, in the old format. `pnpm legacy:load` restores the fixture's list                                                   |
| Delete Results      | Forgets the rows, markers and respondent files of the survey                                               | Deletes the rows of `post{postId}` and `SurveyCompletion{surveyId}` in batches of 100 (the tables stay), the respondent blobs, and writes one `SURVEY_DELETEALLRESULTS` audit row |
| Save Respondent IP  | The response holds the loopback address (`127.0.0.1` or `::1`): the browser and the server share a machine | The same                                                                                                                                                                          |

- **Customer feedback** (`22222222-0000-4000-8000-a00000000001`, Olivia Owner's) has Grant Access **on**, and the
  question `receipt` is private. Its public page is **`/results/22222222-0000-4000-8000-a00000000001`**
  (<http://localhost:5173/results/22222222-0000-4000-8000-a00000000001>): it shows `satisfaction` and not
  `receipt`, to anyone, without signing in.
- **API created** (`…a08`, Olivia Owner's, 1,500 responses) is for reading: its Details tab shows 1500 and the
  dates `2026-05-01T08:00:00.000Z` and `2026-05-01T20:30:00.000Z` in your browser's format, and its two
  downloads hold 1,500 responses. **Do not delete its results or change its settings**: the test suites read it.
- **Try writing parts on a survey you create** (Adam Admin has none of his own): turn on Grant Access, switch Save
  Respondent IP, make a question private, submit through the run page and delete the results. A restart
  forgets the changes in memory mode, and `pnpm legacy:load` restores the replica.
- **A downloaded file** is named after the survey. A browser saves it as an attachment; to read one in a
  terminal use `curl` with the `msid` cookie ([Exporting results](api/exporting-results.md)).
- **No new variable.** The public results use the existing `PUBLIC_RATE_LIMIT`.
- **The Step 10 demo script** walks through it ([demo](demo/step-10.md)).

### Projects and members in both modes (Step 11)

The **Projects** page (`/projects`) works in both demo modes. Open it from the account menu (**Projects**) or from
the project drop-down of the survey list (**Manage Projects**). The user's view is
[Projects and team members](user-guide/projects-and-team-members.md). What differs by mode:

| Part                 | Memory mode (`pnpm demo`)                                       | Azurite mode (`pnpm demo:azurite`)                                                                                                                               |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects and members | Held in the server's memory. A restart forgets what you created | Rows of `Organizations` and `OrganizationUsers` in the replica's SQL Server, written in transactions. `pnpm legacy:load` restores the fixtures                   |
| Deleting a project   | Moves the surveys in one step                                   | Moves the surveys (`Surveys.userid`), deletes the member rows and the project row in one transaction, then appends a `SURVEY_TRANSFER` row for each moved survey |

- **Do not change Marketing or Engineering.** The test suites read them and their memberships. Create a project
  of your own as Adam Admin, add Mia Member (`member@example.com`) and delete the project at the end. Do not add
  Oscar Outsider or Olivia Owner to a project you leave behind.
- **Only registered users can be added.** `member@example.com` works; any other address that is not a seed user
  gives "… is not a registered surveyjs.io user …". On the replica the seed users are the registered ones.
- **See the rows change** on the replica with the inspector (read only), once for each user, between the steps:
  `pnpm inspect:legacy --user admin@example.com --env-file docker/azurite.env` and the same with
  `member@example.com`. The line `Project <name> (<id>, role admin|user)` appears when a user joins, changes role
  when you use **Make Admin** or **Remove Admin Rights** (the same row, changed in place), and disappears when the
  user is removed or the project is deleted. After a delete the project's surveys are listed under `Personal`.
- **No new variable.** Step 11 adds no environment variable.
- **The Step 11 demo script** walks through it ([demo](demo/step-11.md)).

### Accounts and security in both modes (Step 12)

Step 12 adds four server variables (`USER_DIRECTORY`, `USER_API_URL`, `USER_API_TOKEN`, `ACCOUNT_WEBHOOK_SECRET`; see the
table above and [Operations](operations.md#configuring-accounts)) and these commands. All are run from the repository root:

| Script                           | What it does                                                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo:preview`              | Builds the app and serves it with `vite preview`, which sends the security headers and the content-security policy. **`pnpm demo` sends none**: Vite's dev server injects inline scripts. Use `demo:preview` to see the policy work |
| `pnpm user-api:stub`             | A local stand-in for the surveyjs.io user API with the seed users (port 4010, token `local-stub-token`). `--port`, `--host`, `--token`, `--fixtures`                                                                                |
| `pnpm test:conformance:user-api` | The conformance suite with the server on `USER_DIRECTORY=surveyjs-api`, against the stub it starts                                                                                                                                  |
| `pnpm account:erase`             | Erases one account's data (a dry run without `--yes`; needs a persistent store such as `--env-file docker/azurite.env`)                                                                                                             |
| `pnpm account:reconcile`         | Lists the owners the user directory does not know and, with `--apply`, erases them (at most `--max`, default 10)                                                                                                                    |
| `pnpm webhook:account-deleted`   | Sends a signed account-deleted webhook to a running server (`--user`, `--url`, `--bad-signature`, `--env-file server/demo.env`)                                                                                                     |

- **The demo webhook secret.** `server/demo.env` and `server/demo-azurite.env` hold `ACCOUNT_WEBHOOK_SECRET`, a local test
  value for `pnpm webhook:account-deleted`. Never use it anywhere else.
- **Erin Erasable** is the user for erasure demos and tests: she has no data in the fixtures and is the only user a test may
  erase. Every erasure test creates her data first.
- **The XSS survey.** `XSS in question name <img src=x onerror=alert(1)>` (`22222222-0000-4000-8000-a00000000009`, Mia's)
  checks that markup in names, titles, HTML and the completed page renders as text. Open it with `pnpm demo:preview`.
- **Old addresses.** `/published`, `/Service/*` and `/Results/*` are unknown addresses: the server answers `404` and the
  web app shows "Page not found". The surveyjs.io site redirects them ([the map](operations/surveyjs-redirects.md)).
- **The Step 12 demo script** walks through it ([demo](demo/step-12.md)).

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
| `pnpm legacy:load`       | Loads the fixtures into a running replica, and clears the saved results layouts (the container `my-surveys-views`)                                       |

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

(`pnpm --filter @surveyjs-studio/server start` does not read the file; export the variables or use
the command above.) The hosted edition runs too: `APP_EDITION=hosted pnpm demo:azurite` (Git Bash).
`ACCOUNT_NOTICES=surveyjs-licenses pnpm demo:azurite` reads the licence notices from the replica's
licence tables ([layout, 3.15](architecture/legacy-data-layout.md#315-licences-and-the-licence-expiry-dialogs)).
The fixtures have fixed expiry dates, so what each user sees depends on today's date.

The loader writes the result rows in **batches**: it deletes the existing rows of a table and creates the
fixture rows with table transactions of at most 100 actions (Azure Tables allow 100 actions on one partition,
and a transaction takes one action for each row, so the deletes and the creates go in separate transactions). The
1,500 generated rows of "API created" made this necessary: loading takes about 3 s instead of about 6 s on a
warm stack. After the blobs, it deletes every blob of the container `my-surveys-views` (the log line `Views:
cleared <n> saved layouts`), so a layout saved by hand in a demo does not stay in the fixtures: the
conformance suite and the end-to-end tests expect the fixtures' own layouts. Running it twice gives the same
state.

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
| `erasable` | Erin Erasable, `erasable@example.com`  |
| `blocked`  | the blocked user: `403 forbidden`      |

The user's id (`11111111-0000-4000-8000-a00000000001` for the owner) works too. The mock gives
these names their legacy `Users.id` as the subject, with their email and name claims. Any other
text signs in a user the directory does not know, with that text as the subject.

## SQLite and PostgreSQL modes

The SQL providers of the self-hosted track ([data model](architecture/data-model.md),
[ADR 0023](adr/0023-sqlite-driver-node-sqlite.md), [ADR 0024](adr/0024-kysely-and-plain-sql-migrations.md)). Surveys,
history, responses, results layouts, private questions, projects, members and the files' metadata are in the database;
the files' bytes are in `server/.data/files` (`FILES_PATH`), or in S3 with [`pnpm dev:s3`](#files-in-s3). By default
the **users** are the memory provider's, seeded by `MEMORY_SEED`, and lost on restart (`USER_DIRECTORY=memory`).
The server logs a warning saying so, and refuses that with `NODE_ENV=production`. Sign-in is the dev sign-in of
[`pnpm demo`](#signing-in), with the same seed users. With `USER_DIRECTORY=local` the users are in the database
([Password sign-in](#password-sign-in)).

| Mode       | First                                    | Then                | Database                                                                         |
| ---------- | ---------------------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| SQLite     | `pnpm seed:sqlite`                       | `pnpm dev:sqlite`   | `server/.data/surveyjs-studio.db` (git-ignored; delete the folder to start over) |
| PostgreSQL | `pnpm seed:postgres` (starts PostgreSQL) | `pnpm dev:postgres` | PostgreSQL 18 in Docker on 127.0.0.1:15432 (`docker/compose.postgres.yaml`)      |

`dev:sqlite` and `dev:postgres` run like `pnpm demo` (server on 3000, web app on 5173), with `server/demo.env` plus
`server/demo-sqlite.env` or [`docker/postgres.env`](../docker/postgres.env) (local-only values). `dev:postgres` starts
the container first (`pnpm postgres:up`, waits until it is healthy); `pnpm postgres:down` stops it and **deletes its
volume**.

The server **migrates the database at start-up**. Three commands work on it outside the server; each reads the
environment, or a file given with `--env-file` (variables already set win):

| Command           | What it does                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:status`  | Lists the applied migrations (with their time), the pending ones, and any a newer version applied. Writes nothing.  |
| `pnpm db:migrate` | Applies the pending migrations, in one transaction. Refused with `READ_ONLY=true`.                                  |
| `pnpm seed`       | Migrates, then loads the shared seed (the golden fixtures): each seed survey is replaced, every other survey stays. |

`pnpm seed:sqlite` and `pnpm seed:postgres` run `seed` with the mode's settings. For PostgreSQL, for example:
`pnpm db:status --env-file docker/postgres.env`. (For SQLite run the commands from `server/`, since
`demo-sqlite.env` names a relative path: `pnpm --filter @surveyjs-studio/server exec node --env-file=demo-sqlite.env --import tsx src/cli/db.ts status`.)

A database that a newer version migrated stops the server at start-up with "The database has migration NNNN-…, which
this version of SurveyJS Studio does not know: a newer version migrated it. Run that version or a newer one." With
`READ_ONLY=true` the server never migrates, and a pending migration stops it with a message naming `pnpm db:migrate`.

Migrations live in `server/sql/sqlite/` and `server/sql/postgres/`: plain SQL, `NNNN-name.sql`, the same numbers and
names in both, each statement ending with a `;` at the end of a line ([ADR 0024](adr/0024-kysely-and-plain-sql-migrations.md)).
A schema change adds one file to each folder and updates `server/src/sql/schema.ts`; an applied migration is never
edited.

### Password sign-in

Self-hosted Step 4: the users in the database's `users` table, signing in with a password on the app's own page
([ADR 0026](adr/0026-revoking-stateless-sessions-with-an-epoch.md)). Set the variables in the shell; they win over the
env files:

```sh
USER_DIRECTORY=local AUTH_METHODS=password   ADMIN_EMAIL=first-admin@example.test ADMIN_PASSWORD='a long local password'   pnpm dev:sqlite
```

Open <http://localhost:5173>: the **Sign in** page opens. Sign in as the first admin, and change the password. Without
`ADMIN_EMAIL` and `ADMIN_PASSWORD` the server logs a one-time link instead ("This instance has no admin yet…").

- Use an email the seed does not have: an `ADMIN_EMAIL` of an existing account creates nothing (a warning says so).
- The seed's users are accounts without a password; the dev sign-in still signs them in
  (`/__dev/sign-in`), as `IDENTITY_PROVIDER=dev` stays set.
- A database seeded before Step 4 has no seed users in `users`: delete `server/.data/` and run
  `pnpm seed:sqlite` again.
- The seed has an instance admin of its own, Ivy Instance (`instance-admin@example.com`), on the dev sign-in page
  (`/__dev/sign-in`) of a local directory. She and the first admin open **Users** in the account menu
  ([Managing users](user-guide/managing-users.md)).
- The same works with `dev:postgres` and `dev:s3`, and with `pnpm demo` (memory: the accounts are lost on restart).

### Files in S3

`FILE_STORE=s3` keeps the files in an S3-compatible bucket ([ADR 0025](adr/0025-file-storage-for-the-sql-providers.md)).
Locally that is RustFS (`docker/compose.s3.yaml`, settings in [`docker/s3.env`](../docker/s3.env); MinIO's images are
no longer published):

| Command                | What it does                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm s3:up`           | Starts RustFS on 127.0.0.1:19000 (console on 19001, keys in `docker/s3.env`) and creates the bucket `surveyjs-studio-files` |
| `pnpm dev:s3`          | `pnpm s3:up`, then the SQLite mode with its files in that bucket                                                            |
| `pnpm s3:bucket create | remove <name>`                                                                                                              | Creates a bucket (fine when it exists), or removes one with its objects |
| `pnpm s3:down`         | Stops RustFS and **deletes its data**                                                                                       |

The app never creates or removes a bucket: readiness (`/readyz`, check `files`) reports one it cannot reach.

## Production data mode

`pnpm dev:prod-data` runs the app on the **real** surveyjs.io stores (the mode 1.1 data) with sign-in
through a the site's sign-in service instance running on this machine. It reads and writes production data:
everything you do there is real.

1. **Register the client** in the site's sign-in service: client id `my-surveys` with the redirect URI
   `http://localhost:5173/api/v1/auth/callback` (and `http://localhost:5173/` after sign-out, if
   the server checks it). The browser uses the Vite origin, which proxies `/api` to the server.
2. **Fill in `server/.env`**: copy `server/.env.example` and set the three `LEGACY_*` connection
   strings, `OIDC_CLIENT_SECRET` and `SESSION_SECRET`. The file is gitignored; never commit it or
   put a real value in the template.
3. **Start the site's sign-in service**, then run `pnpm dev:prod-data` and open <http://localhost:5173>.

The launcher refuses to start while a required value is empty, prints the SQL server, database and
storage accounts it is about to use (never a key or password), then starts the server (`--env-file=.env`)
and Vite as `pnpm demo` does. Stop both with Ctrl+C.

- **The issuer is `https://localhost:7100`**: its metadata names that address, and
  `http://localhost:5100` only redirects there. the site's sign-in service publishes RFC 8414 metadata with the
  scopes `profile` and `email` and no ID token, so `OIDC_DISCOVERY` and `OIDC_SCOPES` keep their
  defaults ([ADR 0008](adr/0008-surveyjs-auth-oauth2-userinfo.md)).
- **Its certificate is the self-signed ASP.NET development certificate**, which Node rejects. For an
  https issuer on localhost the launcher reads the certificate from the running server, saves it to
  `server/.local/issuer-ca.pem` (gitignored) and starts the server with `NODE_EXTRA_CA_CERTS`
  pointing at it; Node reads that variable only at start-up, so `server/.env` cannot set it. A
  `NODE_EXTRA_CA_CERTS` already set in the shell is kept. The launcher stops if the issuer is not
  reachable.
- **The server watches `server/src` only** (`--watch-path=src`): with plain `--watch`, Node restarts
  whenever a library loads a file lazily on first use (the SQL driver does), dropping the requests in flight.
- **The first request takes several seconds** while the SQL and storage connections open.
- Tests and the e2e suites never read `server/.env`; they use their own env files.

## Prod-like mode

Prod-like mode runs the **production image** (`surveyjs-studio:local`, see [Operations](operations.md#deployment)) in the
mode 1 configuration on the offline replica, signing in through the mock OIDC server. Nothing real is touched. It
uses the same host ports as [Azurite mode](#azurite-mode) (10000, 10002, 14333, 18080) plus **8080**, so stop one
before starting the other.

| Command               | Does                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm prod-like:up`   | Builds the image, starts it with the replica and the mock, waits until all are healthy, loads the fixtures |
| `pnpm prod-like:down` | Stops the containers and **deletes their volumes**                                                         |

Open <http://localhost:8080> and sign in as `owner` on the mock's page
([users](#signing-in-through-the-mock-oidc-server)). The files:

- [`docker/compose.prod-like.yaml`](../docker/compose.prod-like.yaml) extends the services of
  `docker/compose.azurite.yaml` (which stays as it is for Azurite mode) and adds `app`, the image;
- [`docker/prod-like.env`](../docker/prod-like.env) is the app's settings: `APP_EDITION=hosted`,
  `STORAGE_PROVIDER=azure-legacy`, `ACCOUNT_NOTICES=surveyjs-licenses`, `IDENTITY_PROVIDER=surveyjs-oidc` with the
  mock, `PUBLIC_BASE_URL=http://localhost:8080` and a local `SESSION_SECRET`. All values are local placeholders.

**Why the app shares the mock's network.** openid-client checks that the issuer's metadata names the configured
issuer, so the browser and the app must reach the mock at the same address, and the server allows an http issuer
only on localhost. The app, the mock and Azurite share one network namespace (the mock's), and the mock listens on
18080 there: inside and on the host it is `http://127.0.0.1:18080/surveyjs`. Azurite is `127.0.0.1:10000` and
`:10002` inside too, because the server allows plain http to storage only on loopback. SQL Server is reached by its
service name, `legacy-sql,1433`. The app's port 3000 is published as 8080.

To see the logs: `docker compose --env-file docker/azurite.env -f docker/compose.prod-like.yaml logs app`.

## The image on production data

`pnpm image:prod-data` runs the **production image** on the stores and the sign-in in `server/.env`, like
[production data mode](#production-data-mode) but without Vite: the app is at <http://localhost:3000>. It reads and
writes production data.

1. **Register the redirect URI** `http://localhost:3000/api/v1/auth/callback` in the the site's sign-in service client (and
   `http://localhost:3000/` after sign-out, if the server checks it).
2. **Start the site's sign-in service** on this machine, then run `pnpm image:prod-data`. Stop it with Ctrl+C.

The launcher:

- refuses to start while `server/.env` is not ready: the checks of `pnpm dev:prod-data`, plus a `SESSION_SECRET` of
  at least 32 characters (the image runs with `NODE_ENV=production`), `IDENTITY_PROVIDER=surveyjs-oidc`, and an
  issuer on localhost. It names the variable, never the value;
- refuses a value with `$` that is not in single quotes: docker compose expands `$NAME` in an env file, Node does not;
- for an https issuer, reads its certificate into `server/.local/issuer-ca.pem`, mounts it read-only at
  `/certs/issuer-ca.pem` and sets `NODE_EXTRA_CA_CERTS` to it;
- prints the "REAL DATA" banner (servers and accounts, never a key or password), then runs
  `docker compose -f docker/image-prod-data.yaml up --build` and removes the containers when it stops.

Only `server/.env` reaches the container: variables set in the shell do not override it here. The compose file sets
`NODE_ENV`, `HOST`, `PORT`, `WEB_ROOT` and `PUBLIC_BASE_URL=http://localhost:3000` over the file.

**The issuer stays `https://localhost:7100`.** The issuer runs on the host, but `localhost` in a container is the
container. The service `issuer-forward` (`alpine/socat`) owns the app's network namespace and forwards the issuer's
port of its localhost to the same port on the host (`host.docker.internal`), so the metadata's issuer matches and
the certificate's `localhost` name fits. It forwards every other endpoint of the file on this machine the same way.
It also publishes the app's port 3000. On Docker Desktop this reaches a service the host runs on 127.0.0.1 (the site's sign-in service
on `localhost` listens there and on ::1); on Linux, `host.docker.internal` is the bridge address, so the issuer must
listen there too.

`--env-file <path>` reads another file instead of `server/.env`. It is for testing the launcher on the replica and
the mock (with `pnpm demo:azurite:up` running), not for real use.

## Golden fixtures

`server/fixtures/legacy/` holds synthetic data in the **legacy storage formats**: SQL rows as JSON
(`sql/`), Azure Table entities in Table REST JSON (`tables/`), blob content (`blobs/`) and
file content (`files/`). Its [README](../server/fixtures/legacy/README.md) lists the layout and what
each fixture covers. Three things read them: `MEMORY_SEED=legacy-fixtures`, the provider suite,
and `pnpm legacy:load`.

**The large survey (Step 9).** "API created" (`22222222-0000-4000-8000-a00000000008`, Olivia Owner's Personal
survey: active, its published flag never set, so it reads as published) holds **1,500 generated responses** and
a definition with five questions (`color`, `score`, `subscribe`, `channels`, `comment`). It is for the results page: its Summary counts every
response, the Table pages through them (300 pages of 5), and `listResults` takes two pages of 1,000 to read
them. The rows are not a JSON file: `server/src/providers/azure-legacy/large-survey.ts` makes them from a fixed
rule, so the memory seed and the Azurite loader hold the same rows. Colour is Red, Green or Blue 500 times each;
`score` 1 to 5, 300 times each; `subscribe` true 375 times; the first response is at
`2026-05-01T08:00:00.000Z` and the last at `2026-05-01T20:30:00.000Z`, two responses to each minute. The
definition is the two blobs `server/fixtures/legacy/blobs/surveys/surveyjson/` and `surveytext/` of the survey.
**Tests only read it:** no response, view or setting is written to it (the end-to-end tests keep their layout
writes in the browser). The expectations are hand-written in `suite/expected.ts` and not derived from the
generator.

Seed accounts (all synthetic, in `sql/Users.json`). Use them with the inspector, and to sign in to
a demo ([Signing in](#signing-in) above):

| Email                  | Name           | Roles                                            | Covers                                                             |
| ---------------------- | -------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `owner@example.com`    | Olivia Owner   | Admin of Marketing, user of Engineering          | Personal surveys (published, draft, archived)                      |
| `admin@example.com`    | Adam Admin     | Admin of Engineering (its creator) and Marketing | A project creator; a role stored as `Admin`                        |
| `member@example.com`   | Mia Member     | User of Marketing                                | A plain member                                                     |
| `outsider@example.com` | Oscar Outsider | None                                             | One personal survey, in no project                                 |
| `erasable@example.com` | Erin Erasable  | None                                             | No data. Erasure demos and tests only: the one user they may erase |
| `blocked@example.com`  | (none)         | None                                             | Blocked user; the display name falls back to the email             |

What each user sees in the survey list (Step 4; "newest first" is by updated date):

| User           | Personal, active (newest first)            | Personal, archived | Projects (role)                        |
| -------------- | ------------------------------------------ | ------------------ | -------------------------------------- |
| Olivia Owner   | API created, Customer feedback, Draft idea | Old poll           | Engineering (user), Marketing (admin)  |
| Adam Admin     | none                                       | none               | Engineering (admin), Marketing (admin) |
| Mia Member     | XSS in question name (Step 12)             | none               | Marketing (user)                       |
| Oscar Outsider | Outsider quiz                              | none               | none                                   |

**The XSS survey (Step 12).** `XSS in question name <img src=x onerror=alert(1)>`
(`22222222-0000-4000-8000-a00000000009`) is a published Personal survey of Mia Member. Its name, a question
name, a question title, an HTML question and the completed page all hold script that would run if it were
rendered as HTML. It is for the security checks: it shows as text in the list, and the content-security
policy stops the rest. Open it with **`pnpm demo:preview`**, not `pnpm demo`: Vite's dev server sends no
content-security policy, so the inline handlers would run there ([ADR 0019](adr/0019-run-page-isolation-and-security-headers.md)).
**Tests only read it**; the end-to-end test answers its submission itself, so nothing is stored.
No test asserts Mia's own list, which is why she owns it; the list below shows it for completeness.

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

It does not print definitions, themes or history. To see what the editor saved on the replica, use the
history page, `GET /api/v1/surveys/{id}/history`, or Azure Storage Explorer (see
[the Step 6 demo](demo/step-06.md#how-to-see-the-history-blobs-and-their-metadata)).

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

### Schema check

`pnpm inspect:legacy-schema [--env-file <path>]` prints what the app depends on in the `Surveys` table:

```text
Surveys.theme: varchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS
Surveys triggers: none
Surveys.ispublished: tinyint, nullable yes, default none
Surveys with an empty ispublished: 17 of 24
```

It reads `LEGACY_SQL_CONNECTION_STRING` only, runs `SELECT` on the `sys.*` views and one `COUNT`, and writes
nothing, so `READ_ONLY` does not matter. Exit codes: `0` success, `1` connection or query error (the message has
no connection string, host or password), `2` usage error, an unreadable env file, or no connection string. Use
the same least-privilege login as the inspector above. The output above is the local replica.

## Scripts

Root scripts are listed in the [README](../README.md#scripts). Package scripts:

| Package             | Script                                                                                               | Purpose                                                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`            | `dev`, `start`, `typecheck`                                                                          | Watch mode, plain start, type check                                                                                                                                   |
| `server`            | `dev:demo`, `dev:demo:azurite`, `dev:demo:sqlite`, `dev:demo:postgres`                               | The server half of the root `pnpm demo`, `pnpm demo:azurite`, `pnpm dev:sqlite` and `pnpm dev:postgres`; run those instead                                            |
| `server`            | `seed:sqlite`, `seed:postgres`                                                                       | The root `pnpm seed:sqlite` and `pnpm seed:postgres` ([SQLite and PostgreSQL modes](#sqlite-and-postgresql-modes)); `dev:demo:s3` is the server half of `pnpm dev:s3` |
| `server`            | `dev:prod-data`                                                                                      | The server with `server/.env`; run it through the root `pnpm dev:prod-data` ([production data mode](#production-data-mode))                                           |
| `web`               | `dev`, `build`, `preview`, `test`, `typecheck`                                                       | Vite dev server, build (type check first), preview, unit tests                                                                                                        |
| `contract`          | `generate`                                                                                           | Regenerate `generated/openapi.d.ts` after editing `openapi.yaml`                                                                                                      |
| `contract`          | `lint`, `check:generated`                                                                            | Redocly lint (telemetry off, update notice suppressed; known exceptions in `contract/.redocly.lint-ignore.yaml`); fail if the committed types are stale               |
| `contract`          | `build:docs`                                                                                         | Write the self-contained `contract/dist/reference.html`                                                                                                               |
| `conformance-tests` | `test`, `test:azurite`, `test:sqlite`, `test:postgres`, `test:s3`, `test:user-api`, `test:read-only` | See [testing](testing.md)                                                                                                                                             |
| `e2e`               | `test`, `test:azurite`, `test:sqlite`                                                                | Playwright                                                                                                                                                            |
| `e2e`               | `test:visual`, `capture`                                                                             | The visual parity run and the baseline capture (Step 13); see [Testing](testing.md#visual-parity)                                                                     |

The visual parity scripts are run from the root: `pnpm e2e:visual` (compare the app with the baselines; `--self` checks
the harness), `pnpm e2e:visual:report` (open the report) and `pnpm visual:capture` (a person captures the baselines from
surveyjs.io). The visual run uses its own ports, **3002** (server) and **5175** (web), so it can run beside the
functional e2e suite (3000/5173 and 3001/5174); both runners stop with a message naming the process when one of
their ports is taken. See [Testing › Visual parity](testing.md#visual-parity).

Run a package script with `pnpm --filter <package name> <script>`, for example
`pnpm --filter @surveyjs-studio/contract generate`.

## Changing the contract

1. Edit `contract/openapi.yaml` (hand-formatted; Prettier ignores it).
2. `pnpm --filter @surveyjs-studio/contract generate`, and commit the changed `generated/openapi.d.ts`.
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
- **Node.js** is pinned in `.nvmrc` and `engines.node`. Keep both on the same major, and the Docker
  base image (`FROM node:<version>` in `Dockerfile`) on the exact `.nvmrc` version: `pnpm check:deps`
  fails otherwise.

To see the rule fail and recover, follow [the Step 1 demo](demo/step-01.md#6-dependency-rules).

## CI

`.github/workflows/ci.yml` runs on pushes to `master`, `step/**`, `self-hosted/**` and `hosted/**` and on pull requests, on
`ubuntu-latest` (Docker is available there), with a timeout of 40 minutes. It runs, in this order:

1. `pnpm install --frozen-lockfile`, `check:deps`, `lint:contract`, `typecheck`, `lint`,
   `format:check`;
2. `test:unit`, `test:conformance` (in-memory), `test:conformance:read-only` (in-memory, `READ_ONLY=true`) and
   `test:conformance:sqlite` (a new SQLite file) and `test:conformance:password` (SQLite, local accounts and password
   sign-in);
3. `docker build -t surveyjs-studio:ci .`, the production image (labelled with the commit as
   `org.opencontainers.image.revision`);
4. `pnpm demo:azurite:up`, which starts the legacy replica and the mock OIDC server and loads the
   fixtures;
5. `test:providers:azurite`, and `test:conformance:azurite` on the image (`CONFORMANCE_IMAGE`); then `pnpm postgres:up`,
   `test:providers:postgres`, `pnpm s3:up`, `test:providers:s3`, `test:conformance:s3`, and `test:conformance:postgres`
   on the image;
6. the browser install, `e2e` (memory provider, dev sign-in, three browsers) and `e2e:azurite` (the
   `azure-legacy` server and the mock OIDC server, Chromium), both on the image (`E2E_TARGET=image`), and `e2e:sqlite`
   (the tsx server, whose SQLite file is on the host; files on local disk; Chromium) and `e2e:postgres` (Chromium,
   every functional spec but the licence notices; files in S3) and `e2e:password` (SQLite, password sign-in on the
   app's page; Chromium) and `e2e:self-hosted` (SQLite, the self-hosted shell with a brand; Chromium);
7. on a push to `master`, it saves the image as an artifact for the `publish` job (kept one day);
8. on failure, it uploads the Playwright report and the app containers' logs (`docker-logs/`);
9. `pnpm demo:azurite:down`, `pnpm postgres:down` and `pnpm s3:down`, which always run (`if: always()`).

The **`publish` job** runs after it, only on a push to `master` and only when every step above passed. It loads that
same image, checks that no `*.env*` file is in it, and pushes it as `ghcr.io/surveyjs/surveyjs-studio:<commit sha>`. It is
the only job with `packages: write`, and it runs no installed packages, only `docker`. The image's
`org.opencontainers.image.source` label (in the `Dockerfile`) links the package to this repository, so it takes the
repository's access rules.

The visual parity tests do not run in CI: the baselines are Windows renders of surveyjs.io, captured by a person (see
[Testing › Visual parity](testing.md#visual-parity)). CI typechecks, lints and unit-tests their helpers. Run
`pnpm e2e:visual` locally before you merge a change to the look of a page.

Run the same commands locally before you push. Steps 3, 4, 5 and 9 need Docker. The image targets of steps 5
and 6 need Linux (`docker run --network host`); on Windows and macOS run those suites without them.

## Conventions

- TypeScript is strict and ESM. Server, contract and conformance tests use `NodeNext`; web uses `Bundler`.
- ESLint (flat config) and Prettier. `pnpm format` fixes formatting.
- Commit messages are conventional: `feat(server): ...`, `fix(web): ...`, `docs: ...`, `chore: ...`.
- Prettier pads Markdown tables, so one wider cell rewrites every row and two branches that touch a table conflict
  on all of it. Run `node scripts/git-merge/markdown-tables.mjs --install` once per clone: `.gitattributes` then
  merges `*.md` without the padding and re-formats the result, and tables conflict only where both sides changed a
  row. Rows both sides only added at the same place (two new ADRs at the end of the index) are both kept, ours
  first. A conflict that remains is left unpadded; resolve it, then run `pnpm format`.
