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

A port in another language (.NET, PHP, ...) is accepted when this suite passes against it.

## Run against the reference server

```sh
pnpm test:conformance
```

With `CONFORMANCE_BASE_URL` unset, the suite starts `pnpm --filter @surveyjs-studio/server start`
on a free port (`NODE_ENV=test`, `STORAGE_PROVIDER=memory`, `IDENTITY_PROVIDER=dev`, `MEMORY_SEED=legacy-fixtures`), waits up to 30 s for
`/readyz`, and stops it (and its process tree) afterwards. `PUBLIC_BASE_URL` is the server's own
origin, and `SIGN_IN_RATE_LIMIT` is high enough that the suite never reaches it.

With `CONFORMANCE_IMAGE=<tag>` (Linux only, used by CI) it runs that production image instead, with
`docker run --network host` and the same settings. See
[Testing](../docs/testing.md#the-conformance-suite-on-the-production-image).

## Signing in

`src/sign-in.ts` signs in over HTTP only, like a browser: it calls `/auth/login`, follows the
redirect to the identity provider, and completes it as a user of the legacy fixtures. It completes

- the dev provider's "Sign in as…" page (`/__dev/sign-in`, `IDENTITY_PROVIDER=dev`): it follows the
  link of the user;
- the login form of the mock OIDC server (Azurite mode): it posts the user id as `username`, and the
  mock (`docker/mock-oidc.json`) signs in that user with its email and name claims.

When `/auth/login` leads anywhere else, the tests that need a signed-in user are **skipped**, and the
skip note names the redirect target. The tests that need no sign-in (`login`, the callback's `400`s,
anonymous `401`s, `passwordLogin`) run on every provider. Both reference runs (`test:conformance` and
`test:conformance:azurite`) skip nothing.

## Run against the Azure legacy provider

`CONFORMANCE_PROVIDER` picks the storage provider of the reference server:

| Value              | Reference server                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` (default) | `STORAGE_PROVIDER=memory`; every app variable of the developer's shell is stripped.                                                                                                                                                     |
| `azure-legacy`     | `STORAGE_PROVIDER=azure-legacy`; the three `LEGACY_*` connection strings and the `OIDC_*` settings of the mock OIDC server (from `docker/azurite.env`) are forwarded from the environment (every other app variable is still stripped). |

Against the local replica of the legacy stores (Azurite and SQL Server in Docker) and the mock OIDC
server:

```sh
pnpm demo:azurite:up            # start the replica and load the golden fixtures
pnpm test:conformance:azurite   # reads docker/azurite.env and azure-legacy.env
pnpm demo:azurite:down          # stop and wipe the replica
```

A missing `LEGACY_*` or `OIDC_*` variable stops the run with an error that names it.

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

The mode cannot be combined with `CONFORMANCE_BASE_URL`. The stub and the reference server are stopped
afterwards.

## Run with password sign-in

`CONFORMANCE_AUTH=password` runs the reference server with the local user directory
(`USER_DIRECTORY=local`), `AUTH_METHODS=password` and a first admin from `ADMIN_EMAIL` and
`ADMIN_PASSWORD` (synthetic values in `src/global-setup.ts`). The fixture users become accounts without
a password and still sign in through the dev sign-in, so every file runs on local accounts.
`src/password.test.ts` runs only in this mode: the admin's sign-in and forced change, the same answer
for a wrong password and an unknown email, the back-off, and a password change ending the other
sessions. It needs `CONFORMANCE_PROVIDER=memory`, `sqlite` or `postgres` and the default user
directory, and cannot be combined with `CONFORMANCE_BASE_URL`.

```sh
pnpm test:conformance:password   # reads password.env (sqlite)
```

## Run read-only

`CONFORMANCE_READ_ONLY=true` runs the reference server with `READ_ONLY=true`. The script runs only
`src/read-only.test.ts`: every operation that documents the `503 ReadOnly` response must answer
`503 read-only`, and reads and sign-out must keep working. In the other runs the server reports
`readOnly: false` in `/config` and the file is skipped.

```sh
pnpm test:conformance:read-only   # reads read-only.env
```

## The account-deleted webhook

The reference server always runs with a fixed, synthetic `ACCOUNT_WEBHOOK_SECRET`, and
`src/account-deleted.test.ts` signs its calls with it. Against another server
(`CONFORMANCE_BASE_URL`) set `CONFORMANCE_WEBHOOK_SECRET` to the `whsec_` secret that server was started
with. Without it the webhook tests are skipped. All erasure cases sit in that one file, because
conformance files run in parallel and Erin Erasable is the only user the suite may erase.

## Run against another server

Start the server, then point the suite at its origin (without `/api/v1`, which the suite appends):

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell: `$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance`.

The server must be a fresh, in-memory/empty instance. No child process is started in this mode.

| Variable                     | Meaning                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `CONFORMANCE_BASE_URL`       | The origin of the server to test                                                      |
| `CONFORMANCE_WEBHOOK_SECRET` | Its `ACCOUNT_WEBHOOK_SECRET`; without it the webhook tests are skipped                |
| `CONFORMANCE_PROVIDER`       | `memory` (default), `azure-legacy`, `sqlite` or `postgres`; the reference server only |
| `CONFORMANCE_AUTH`           | `default` or `password`; the reference server only                                    |
| `CONFORMANCE_USER_DIRECTORY` | `default` or `surveyjs-api`; the reference server only                                |
| `CONFORMANCE_READ_ONLY`      | `true` or `false` (default); the reference server only                                |

Two more files check the server's edge. `src/security-headers.test.ts` expects the headers of
[ADR 0019](../docs/adr/0019-run-page-isolation-and-security-headers.md) on an API answer, a problem
answer and an unknown path (HSTS only when the server is reached over https). `src/legacy-urls.test.ts`
expects `404` with no `Location` for `/published?id=…` and `/Service/EditSurvey/{id}`: the server
redirects no old address.
