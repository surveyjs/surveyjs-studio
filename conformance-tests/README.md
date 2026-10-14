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
on a free port (`NODE_ENV=test`, `STORAGE_PROVIDER=memory`), waits up to 30 s for
`/readyz`, and stops it (and its process tree) afterwards.

## Run against another server

Start the server, then point the suite at its origin (without `/api/v1`, which the suite appends):

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell: `$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance`.

The server must be a fresh, in-memory/empty instance. No child process is started in this mode.
