# Conformance tests

A Vitest suite that talks to a My Surveys server **only over HTTP** and checks every
response against the OpenAPI 3.1 contract (`contract/openapi.yaml`). For the operation
called, it checks that:

- the status is documented (or covered by `default`);
- the `Content-Type` is one of the documented media types;
- every header declared `required: true` on that response is present, and every declared
  header that is present matches its schema (header values are strings; numbers and
  booleans are read from them before validation);
- the body validates against the documented schema (Ajv, JSON Schema 2020-12), and a
  response documented without content has an empty body;
- an `application/problem+json` body also has a `code` from the Problem enum and a
  `status` equal to the HTTP status.

A `501` is accepted from any operation as a Problem, because every operation may be
unimplemented in Phase 1. Request headers, cookies and response headers the contract does not
declare are not checked.

A port in another language (.NET, PHP, ...) is accepted when this suite passes against it. Run it with
`pnpm test:conformance --base <url>`; see [Porting the back end](../docs/customizing/porting.md).

Each mode below other than the default has a root script (`pnpm test:conformance:<mode>`) that runs the
package script of the same name with the mode's `.env` files. CI runs every mode except the user-API one.

## Run against the reference server

```sh
pnpm test:conformance
```

With `CONFORMANCE_BASE_URL` unset, the suite starts `pnpm --filter @surveyjs-studio/server start`
on a free port (`NODE_ENV=test` and the settings of `src/reference-settings.ts`: `STORAGE_PROVIDER=memory`, `IDENTITY_PROVIDER=dev`, `MEMORY_SEED=legacy-fixtures`, ...), waits up to 30 s for
`/readyz`, and stops it (and its process tree) afterwards. Every app variable of the developer's shell is
removed first, so only these values reach the server. `PUBLIC_BASE_URL` is the server's own
origin, and `SIGN_IN_RATE_LIMIT` is high enough that the suite never reaches it.

### On the production image

With `CONFORMANCE_IMAGE=<tag>` (Linux only, used by CI) the suite runs that image instead of tsx, with
the same settings: the container `surveyjs-studio-conformance`, started with `docker run --network host` and
the values passed by name (`-e NAME`). It waits up to 60 s for `/readyz`.

- `NODE_ENV` is `development` on `memory`, `sqlite` and `postgres` (the dev sign-in the suite uses is refused in
  production) and `production` on `azure-legacy`, with a local-only `SESSION_SECRET`.
- When the suite ends, it saves the container's log to `docker-logs/surveyjs-studio-conformance.log` and removes
  the container.
- It cannot be combined with `CONFORMANCE_BASE_URL`, `CONFORMANCE_PROVIDER=sqlite` (the container cannot see the
  run's database file) or `CONFORMANCE_AUTH=oauth` (that run starts two servers).

CI builds `surveyjs-studio-hosted:ci` and runs `test:conformance:azurite` and `test:conformance:postgres` on it. See
[Testing](../docs/testing.md#the-conformance-suite-on-the-production-image).

## Run against another server

Start the server, then give the suite its origin without `/api/v1` (the suite appends it):

```sh
pnpm test:conformance --base http://127.0.0.1:3000
```

`--base` (`scripts/conformance/cli.ts`) sets `CONFORMANCE_BASE_URL` for the run, so
`CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance` works too (PowerShell:
`$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance`). Other arguments go to Vitest.
No child process is started in this mode.

The server must be a fresh instance started with the reference settings (`src/reference-settings.ts`, listed
in the porting guide) and the legacy fixtures. `node --import tsx scripts/conformance/cli.ts reference-env
--port 3000 --out ref.env` writes those settings as `NAME=value` lines for `docker run --env-file`. Set
`CONFORMANCE_WEBHOOK_SECRET` to the server's webhook secret. CI runs this against the production image (the
`conformance-base` job).

| Variable                     | Meaning                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `CONFORMANCE_BASE_URL`       | The origin of the server to test                                                                 |
| `CONFORMANCE_WEBHOOK_SECRET` | Its `ACCOUNT_WEBHOOK_SECRET`; without it the webhook tests are skipped                           |
| `CONFORMANCE_PROVIDER`       | `memory` (default), `azure-legacy`, `sqlite`, `postgres` or `sandbox`; the reference server only |
| `CONFORMANCE_FILE_STORE`     | `local` (default) or `s3`; the `sqlite` and `postgres` reference servers only                    |
| `CONFORMANCE_AUTH`           | `default`, `password` or `oauth`; the reference server only                                      |
| `CONFORMANCE_USER_DIRECTORY` | `default` or `surveyjs-api`; the reference server only                                           |
| `CONFORMANCE_READ_ONLY`      | `true` or `false` (default); the reference server only                                           |
| `CONFORMANCE_IMAGE`          | An image tag to run as the reference server (Linux only)                                         |

## Signing in

`src/sign-in.ts` signs in over HTTP only, like a browser: it calls `/auth/login`, follows the
redirect to the identity provider, and completes it as a user of the legacy fixtures. It completes

- the dev provider's "Sign in as…" page (`/__dev/sign-in`, `IDENTITY_PROVIDER=dev`): it follows the
  link of the user;
- the login form of the mock OIDC server (Azurite mode): it posts the user id as `username`, and the
  mock (`docker/mock-oidc.json`) signs in that user with its email and name claims.

When `/auth/login` leads anywhere else, the tests that need a signed-in user are **skipped**, and the
skip note names the redirect target. The tests that need no sign-in (`login`, the callback's `400`s,
anonymous `401`s, `passwordLogin`) run on every provider. The reference runs skip none of them.

## Run on another storage provider

`CONFORMANCE_PROVIDER` picks the storage provider of the reference server:

| Value              | Reference server                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` (default) | `STORAGE_PROVIDER=memory`, seeded with the legacy fixtures.                                                                                                                                                                             |
| `sqlite`           | `STORAGE_PROVIDER=sqlite` on a new database file in a temporary folder.                                                                                                                                                                 |
| `postgres`         | `STORAGE_PROVIDER=postgres` on a new database of the PostgreSQL server of `DATABASE_URL` (from `docker/postgres.env`).                                                                                                                  |
| `azure-legacy`     | `STORAGE_PROVIDER=azure-legacy`; the three `LEGACY_*` connection strings and the `OIDC_*` settings of the mock OIDC server (from `docker/azurite.env`) are forwarded from the environment (every other app variable is still stripped). |
| `sandbox`          | No server: see [Run against the sandbox mock](#run-against-the-sandbox-mock).                                                                                                                                                           |

### SQLite, PostgreSQL and S3

The setup makes a new database for the run, loads the golden fixtures into it with the server's `pnpm seed`,
and starts the server with the dev sign-in. The teardown deletes the database and the run's files.

```sh
pnpm test:conformance:sqlite     # reads sqlite.env
pnpm postgres:up                 # start the local PostgreSQL
pnpm test:conformance:postgres   # reads docker/postgres.env and postgres.env
pnpm s3:up                       # start the local S3 server
pnpm test:conformance:s3         # SQLite, files in S3: reads docker/s3.env, sqlite.env and s3.env
```

With `CONFORMANCE_FILE_STORE=s3` the files go to a new bucket on the local S3 server, made and removed by the
server's `s3:bucket` command; the `S3_*` settings come from `docker/s3.env`. A missing `DATABASE_URL` or `S3_*`
variable stops the run with an error that names it.

### The Azure legacy provider

Against the local replica of the legacy stores (Azurite and SQL Server in Docker) and the mock OIDC
server:

```sh
pnpm demo:azurite:up            # start the replica and load the golden fixtures
pnpm test:conformance:azurite   # reads docker/azurite.env and azure-legacy.env
pnpm demo:azurite:down          # stop and wipe the replica
```

A missing `LEGACY_*` or `OIDC_*` variable stops the run with an error that names it. The replica keeps what
the tests create, so the tests never assume the exact size of a scope they write to; `pnpm legacy:load`
resets it.

## Run against the user-API stub

`CONFORMANCE_USER_DIRECTORY` picks the user directory of the reference server. `default` (unset) is the
storage provider's own. `surveyjs-api` starts the stand-in for the surveyjs.io user API first
(`server/src/users/surveyjs-api/stub-cli.ts`, on a free port, with a synthetic token) and runs the
server with `USER_DIRECTORY=surveyjs-api`, `USER_API_URL` and `USER_API_TOKEN` pointing at it and
`ACCOUNT_NOTICES=surveyjs-licenses`. Sign-in, members by email and the licence notices then go through
the API. One extra file, `src/user-directory.test.ts`, runs only in this mode.

```sh
pnpm test:conformance:user-api   # reads user-api.env
```

The mode cannot be combined with `CONFORMANCE_BASE_URL` or `CONFORMANCE_AUTH`. The stub and the reference
server are stopped afterwards.

## Run with password sign-in

`CONFORMANCE_AUTH=password` runs the reference server with the local user directory
(`USER_DIRECTORY=local`), `AUTH_METHODS=password` and a first admin from `ADMIN_EMAIL` and
`ADMIN_PASSWORD` (synthetic values in `src/global-setup.ts`). The fixture users become accounts without
a password and still sign in through the dev sign-in, so every file runs on local accounts.
The server runs the `self-hosted` shell with a brand name, so `src/features.test.ts` checks `/config` and
`/api/docs` there (the other runs check the `surveyjs-site` shell). Two files run only in this mode:

- `src/password.test.ts`: the admin's sign-in and forced change, the same answer for a wrong password and an
  unknown email, the back-off, and a password change ending the other sessions;
- `src/admin.test.ts`: the instance admin's `/admin/users` operations and project oversight, signed in as the
  seed's instance admin, Ivy Instance.

It needs `CONFORMANCE_PROVIDER=memory`, `sqlite` or `postgres` and the default user directory, and cannot be
combined with `CONFORMANCE_BASE_URL`.

```sh
pnpm test:conformance:password   # reads password.env (sqlite)
```

## Run with OAuth2 sign-in

`CONFORMANCE_AUTH=oauth` is the password mode with `AUTH_METHODS=password,surveyjs,google,github,facebook`
and `SIGN_UP_DOMAINS=allowed.example`. The setup starts the OAuth stub (`server/src/testing/oauth-stub.ts`)
and points all four methods at it, so no real provider is contacted. It also starts a second server, on a
database of its own, with `OPEN_SIGN_UP=on`. Only `src/oauth.test.ts` runs: each provider's full flow, the
join policy, linking by verified email, invitations claimed at sign-in, and the refusals.

```sh
pnpm test:conformance:oauth      # reads oauth.env (sqlite)
```

## Run read-only

`CONFORMANCE_READ_ONLY=true` runs the reference server with `READ_ONLY=true`. The script runs only
`src/read-only.test.ts`: every operation that documents the `503 ReadOnly` response must answer
`503 read-only`, and reads and sign-out must keep working. In the other runs the server reports
`readOnly: false` in `/config` and the file is skipped.

```sh
pnpm test:conformance:read-only   # reads read-only.env
```

## Run against the sandbox mock

`CONFORMANCE_PROVIDER=sandbox` starts no server. Each test file registers the sandbox's mock handlers
(`web/src/sandbox/handlers`, the demo's in-browser back-end) with `msw/node`
(`src/sandbox-setup.ts`), over its own in-memory store of the sandbox seed, and the requests go to
`http://sandbox.test`. A session is the `msid` cookie naming a seed user, set without HTTP; tests
for users the seed leaves out are skipped. The script runs a subset of 13 files. The sandbox has no
CSRF token, so the CSRF assertions run only when `sandbox` is false. Tests that check only CSRF,
need a fixture the seed leaves out, or need server-only behaviour (rate limits, IP addresses, export
formats, file types read from the bytes) skip themselves there with `ctx.skip`. Every variable that
configures a server (`CONFORMANCE_BASE_URL`, `_IMAGE`, `_USER_DIRECTORY`, `_AUTH`, `_READ_ONLY`, `_FILE_STORE`)
is refused.

```sh
pnpm test:conformance:sandbox   # reads sandbox.env
```

## The account-deleted webhook

The reference server always runs with a fixed, synthetic `ACCOUNT_WEBHOOK_SECRET`, and
`src/account-deleted.test.ts` signs its calls with it. Against another server
(`CONFORMANCE_BASE_URL`) set `CONFORMANCE_WEBHOOK_SECRET` to the `whsec_` secret that server was started
with. Without it the webhook tests are skipped. All erasure cases sit in that one file, because
conformance files run in parallel and Erin Erasable is the only user the suite may erase.

## The server's edge

Two more files check the server's edge. `src/security-headers.test.ts` expects the headers of
[ADR 0019](../docs/adr/0019-run-page-isolation-and-security-headers.md) on an API answer, a problem
answer and an unknown path (HSTS only when the server is reached over https). `src/legacy-urls.test.ts`
expects `404` with no `Location` for `/published?id=…` and `/Service/EditSurvey/{id}`: the server
redirects no old address.
