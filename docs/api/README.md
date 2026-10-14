# API

The API is defined by one file: [`contract/openapi.yaml`](../../contract/openapi.yaml) (OpenAPI 3.1).
It is the source of truth for the server, the web client and the conformance suite. All paths are
relative to `/api/v1`.

This directory holds guides. The reference itself is generated from the contract and is not
committed.

- [Conventions](conventions.md): errors, paging, concurrency, CSRF, idempotency and more.

## View the API reference

The reference lists every operation with its parameters, bodies and responses.

**Served by the running server** (not available when `NODE_ENV=production`, unless
`API_DOCS=true`):

```sh
pnpm demo
```

Then open <http://localhost:3000/api/docs>. `pnpm demo` builds the reference first. If you start
the server another way and the page says `404` with "Run pnpm build:docs", build it:

```sh
pnpm --filter @my-surveys/contract build:docs
```

(`pnpm build` does this too.) The output is one self-contained HTML file,
`contract/dist/reference.html`, with no external requests. It is git-ignored; you can open it
straight from disk or publish it as a static page.

The page is read from disk on every request, so after you rebuild it, a refresh shows the new version.

## Check and regenerate

| Command                                       | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint:contract`                          | Redocly lint, and fail if `generated/openapi.d.ts` is stale |
| `pnpm --filter @my-surveys/contract generate` | Regenerate the TypeScript types from the contract           |

## Outside `/api/v1`

| Path        | Purpose                                                                      |
| ----------- | ---------------------------------------------------------------------------- |
| `/healthz`  | Process is up: `200 {"status":"ok"}`                                         |
| `/readyz`   | Providers are ready: `200 {"status":"ok"}` or `503 {"status":"unavailable"}` |
| `/api/docs` | The API reference (not in production by default)                             |

## Implemented in Step 1

Only `GET /api/v1/config` is implemented. Every other operation answers `501` with a Problem
Details body (`code: not-implemented`).
