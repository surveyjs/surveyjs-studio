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

With `CONFORMANCE_BASE_URL` unset, the suite starts `pnpm --filter @my-surveys/server start`
on a free port (`NODE_ENV=test`, `STORAGE_PROVIDER=memory`, `IDENTITY_PROVIDER=dev`, `MEMORY_SEED=legacy-fixtures`), waits up to 30 s for
`/readyz`, and stops it (and its process tree) afterwards. `PUBLIC_BASE_URL` is the server's own
origin, and `SIGN_IN_RATE_LIMIT` is high enough that the suite never reaches it.

## Signing in

`src/sign-in.ts` signs in over HTTP only, like a browser: it calls `/auth/login`, follows the
redirect to the identity provider, and completes it. Today it completes the dev provider's
"Sign in as…" page (`/__dev/sign-in`) as a user of the legacy fixtures. When `/auth/login` redirects
anywhere else, the tests that need a signed-in user are **skipped**, and the skip note names the
redirect target. The tests that need no sign-in (`login`, the callback's `400`s, anonymous `401`s,
`passwordLogin`) run on every provider.

## Run against the Azure legacy provider

`CONFORMANCE_PROVIDER` picks the storage provider of the reference server:

| Value              | Reference server                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory` (default) | `STORAGE_PROVIDER=memory`; every app variable of the developer's shell is stripped.                                                                                                                           |
| `azure-legacy`     | `STORAGE_PROVIDER=azure-legacy`; the three `LEGACY_*` connection strings and the `OIDC_*` placeholders of `azure-legacy.env` are forwarded from the environment (every other app variable is still stripped). |

Against the local replica of the legacy stores (Azurite and SQL Server in Docker):

```sh
pnpm demo:azurite:up            # start the replica and load the golden fixtures
pnpm test:conformance:azurite   # reads docker/azurite.env and azure-legacy.env
pnpm demo:azurite:down          # stop and wipe the replica
```

A missing `LEGACY_*` variable stops the run with an error that names it.

## Run against another server

Start the server, then point the suite at its origin (without `/api/v1`, which the suite appends):

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell: `$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance`.

The server must be a fresh, in-memory/empty instance. No child process is started in this mode.
