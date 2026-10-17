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

## Addendum (Step 6)

The first per-route override is not for files. The survey definition and theme saves
(`saveSurveyDefinition`, `saveSurveyTheme`) use their own limit, `LIMIT_MAX_DOCUMENT_BYTES` (default
30,000,000 bytes, reported as `limits.maxDocumentBytes`), because existing surveys with inline images are
far larger than 1 MB. Every other route keeps the global limit. See
[ADR 0012](0012-editor-content-and-history.md#the-body-limit-r12).

## Addendum (Step 7)

The upload route is not raised to `LIMIT_MAX_FILE_BYTES` either. A `multipart/form-data` body is read by
the handler, so Fastify's `bodyLimit` does not apply to it. The editor upload (`uploadSurveyAsset`) is
bounded by the **remaining quota** of the survey (`LIMIT_MAX_ASSET_BYTES_PER_SURVEY` minus what its files
already use), through the busboy `fileSize` limit, and by fixed limits on the number and size of the other
parts. `LIMIT_MAX_FILE_BYTES` stays for respondent files (Step 8). See
[ADR 0013](0013-editor-uploads-and-files.md).
