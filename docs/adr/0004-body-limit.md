# 4. Request body limit equals the response size limit

Date: 2026-10-14

## Status

Accepted

## Context

The spec proposes a limit of 1 MB for a response body without files (`maxResponseBytes`),
10 MB for one respondent file, and 50 MB of editor assets per survey. Fastify has one global
`bodyLimit`. Almost all JSON bodies in the API (survey metadata, definitions, responses) are
small, and an unbounded body is a denial-of-service risk.

## Decision

Set the global Fastify `bodyLimit` to `LIMIT_MAX_RESPONSE_BYTES` (default 1 MB). A body over the
limit is rejected with `413 payload-too-large`. File upload routes (editor assets and respondent
files) will raise the limit **per route**, to `LIMIT_MAX_FILE_BYTES`, when they are built. Routes
that do not upload files never accept more than the global limit.

## Consequences

- The safe default applies to every route, including ones added later.
- Whoever adds an upload route must set the per-route limit, or uploads fail with `413`.
- Changing `LIMIT_MAX_RESPONSE_BYTES` also changes the largest accepted JSON body. The limit is
  reported to clients in `GET /api/v1/config`.
