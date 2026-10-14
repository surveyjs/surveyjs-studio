# Conformance tests

A Vitest suite that talks to a My Surveys server **only over HTTP** and checks every
response against the OpenAPI 3.1 contract (`contract/openapi.yaml`): the status is
documented, the `Content-Type` matches, and the body validates against the schema
(Ajv, JSON Schema 2020-12). `application/problem+json` bodies must also carry a `code`
from the Problem enum and a `status` equal to the HTTP status. A `501` is accepted from
any operation as a Problem, because every operation may be unimplemented in Phase 1.

A port in another language (.NET, PHP, ...) is accepted when this suite passes against it.

## Run against the reference server

```sh
pnpm test:conformance
```

With `CONFORMANCE_BASE_URL` unset, the suite starts `pnpm --filter @my-surveys/server start`
on a free port (`NODE_ENV=test`, `STORAGE_PROVIDER=memory`), waits up to 30 s for
`/readyz`, and stops it (and its process tree) afterwards.

## Run against another server

Start the server, then point the suite at its origin (without `/api/v1`, which the suite appends):

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell: `$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance`.

The server must be a fresh, in-memory/empty instance. No child process is started in this mode.
