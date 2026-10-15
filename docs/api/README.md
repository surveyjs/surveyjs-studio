# API

The API is defined by one file: [`contract/openapi.yaml`](../../contract/openapi.yaml) (OpenAPI 3.1).
It is the source of truth for the server, the web client and the conformance suite. All paths are
relative to `/api/v1`.

This directory holds guides. The reference itself is generated from the contract and is not
committed.

- [Conventions](conventions.md): errors, paging, concurrency, CSRF, idempotency and more.
- [Paging](paging.md): `limit` and `cursor`, what a page can hold, and the reference cursor format for ports.
- [Authentication, sessions and CSRF](authentication.md): the sign-in flow, `returnTo`, the cookies,
  the CSRF header, sign-out and rate limiting.

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

Lint runs with Redocly telemetry off (`telemetry: off` in `contract/redocly.yaml`) and its update check
suppressed. The three operations that legitimately lack a 2xx or 4xx response (`GET /auth/login`,
`GET /auth/callback`, `GET /config`) are listed in `contract/.redocly.lint-ignore.yaml`.

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

## What is implemented

| Since  | Operations                                                                                 |
| ------ | ------------------------------------------------------------------------------------------ |
| Step 1 | `getConfig`                                                                                |
| Step 3 | `login`, `loginCallback`, `logout`, `getCurrentUser` ([authentication](authentication.md)) |
| Step 4 | `listSurveys`, `createSurvey`, `getSurvey`, `listProjects`, `getProject` (see below)       |

### Step 4: surveys and projects

All five need a session; `createSurvey` also needs the CSRF header. Paging:
[Paging](paging.md).

| Operation      | Behaviour                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listSurveys`  | Query `project` (`personal`, the default, or a project id), `archived` (default `false`), `limit`, `cursor`. Newest `updatedAt` first. A project the user does not belong to, an unknown one and text that is no id all answer `404 not-found`. A bad cursor, `limit` or `archived` is `400`                                  |
| `createSurvey` | Optional body `{ name, projectId, definition }`. No `projectId` (or `null`): the user's personal scope; a project the user is not a member of: `403 forbidden`. No `name`: "New Survey N" (see [Your surveys](../user-guide/your-surveys.md#create-a-survey)). Answers `201`, `Location: /api/v1/surveys/{id}` and the survey |
| `getSurvey`    | The survey when the user can see it; `404 not-found` for an unknown survey **and** for one the user cannot see                                                                                                                                                                                                                |
| `listProjects` | The projects the user belongs to, by name ignoring case, then id, with the user's `role`. Paged                                                                                                                                                                                                                               |
| `getProject`   | The project when the user is a member; `404 not-found` otherwise                                                                                                                                                                                                                                                              |

Rules for `createSurvey`:

- A given `name` is kept as sent. It must have 1 to 200 characters and not be blank after trimming.
  A blank name is `422 validation-failed` with a pointer `/name`. The contract's `maxLength: 200`
  counts characters (code points), but the legacy column holds 200 UTF-16 code units, so the server
  also answers `422` at `/name` for a name longer than 200 UTF-16 code units (a name with emoji can
  pass the schema and still fail here).
- `createdAt` and `updatedAt` are the server's clock; the ids of the survey, its `postId` and its
  `resultId` are new GUIDs. The survey starts unpublished and not archived, with every setting off.
- A given `definition` is stored. Nothing is stored without one, and the definition then reads as
  `{}`. It is read back over HTTP in a later step (`getSurveyDefinition` is still `501`).
- `permissions.canModify` follows [ADR 0009](../adr/0009-survey-permissions-follow-legacy.md).

Every other operation answers `501` with a Problem Details body (`code: not-implemented`), after
authentication: a private operation called without a session answers `401`. `passwordLogin` stays
`501` until P1.
