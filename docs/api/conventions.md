# API conventions

A summary of the conventions in the header of
[`contract/openapi.yaml`](../../contract/openapi.yaml). If this page and the contract disagree,
the contract wins.

## Basics

- **Base path** `/api/v1`. Versioning is in the path.
- **JSON** with camelCase property names. Timestamps are RFC 3339 in UTC. IDs are opaque strings;
  existing surveyjs.io GUIDs are kept.
- **Request ID.** Every response has an `x-request-id` header. Send your own to correlate logs.

## Errors

Every error is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details with the media
type `application/problem+json`:

```json
{
  "type": "https://my-surveys.surveyjs.io/problems/not-implemented",
  "title": "Not implemented",
  "status": 501,
  "code": "not-implemented",
  "detail": "Operation listSurveys is not implemented yet."
}
```

| Member   | Meaning                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`   | `https://my-surveys.surveyjs.io/problems/<code>`                                                                                                                                        |
| `title`  | Short, human-readable                                                                                                                                                                   |
| `status` | The HTTP status                                                                                                                                                                         |
| `code`   | Stable machine-readable identifier. Clients should switch on this                                                                                                                       |
| `detail` | Optional explanation                                                                                                                                                                    |
| `errors` | Optional, for validation failures: a list of `{ pointer, detail }`, where `pointer` is a JSON Pointer to the invalid field; at most 50 entries, and `detail` says when the list was cut |

Problem codes by status:

| Status | Codes                                                                      |
| ------ | -------------------------------------------------------------------------- |
| 400    | `bad-request` (malformed request, or invalid path, query or header)        |
| 401    | `unauthenticated`                                                          |
| 403    | `forbidden`, `csrf-token-invalid`                                          |
| 404    | `not-found`, `survey-not-available`, `user-not-found`, `view-not-found`    |
| 406    | `not-acceptable`                                                           |
| 409    | `survey-not-archived`, `already-member`, `last-admin`, `already-completed` |
| 412    | `edit-conflict`                                                            |
| 413    | `payload-too-large`, `quota-exceeded`                                      |
| 415    | `unsupported-media-type`                                                   |
| 422    | `validation-failed` (valid JSON, wrong content; see `errors`)              |
| 428    | `if-match-required`                                                        |
| 429    | `rate-limited` (with `Retry-After`)                                        |
| 500    | `internal-error` (no internal detail in the body)                          |
| 501    | `not-implemented`                                                          |

The `Problem` schema in the contract holds the full list of codes.

## Paging

List endpoints use opaque cursors: `?limit=&cursor=` (`limit` 1-200, default 50). The response is
`{ "items": [...], "nextCursor": "..." }`. `nextCursor` is `null` on the last page. Pass it back
as `cursor` to get the next page. Do not parse it. More in [Paging](paging.md).

## Partial updates (Merge Patch)

`PATCH` takes a JSON Merge Patch document ([RFC 7396](https://www.rfc-editor.org/rfc/rfc7396)).
Send `Content-Type: application/merge-patch+json` or `application/json`. Members you omit stay as
they are; `null` removes a member.

Two rules apply to `PATCH /surveys/{surveyId}`:

- `projectId: null` is a **value**, not a removal: it moves the survey to the caller's Personal
  surveys. (`projectId` has no "removed" state.)
- Every successful `PATCH` moves `updatedAt`, even when no value changes.

## Concurrent edits (ETag)

The survey definition and the theme return an `ETag`. A write must send it back in `If-Match`. A stale
value fails with `412 edit-conflict`, and a missing header with `428 if-match-required`. The rules, the
meaning of `*`, and a `curl` loop are in [Concurrent editing with ETags](concurrency.md).

## Creation

`201 Created` with a `Location` header and the created resource in the body.

## Uploads

Files are sent as `multipart/form-data`, with the part named `file`. See [Uploads and files](uploads.md).

## Downloads

The file format comes from the `Accept` header. A browser download link cannot set headers, so a
`format` query parameter is accepted as an alias and takes precedence. Responses carry
`Content-Disposition`. An unsupported format gives `406 not-acceptable`.

## Authentication, sessions and CSRF

Full description: [Authentication, sessions and CSRF](authentication.md).

- The web app uses the session cookie `msid` (HttpOnly, SameSite=Lax, and Secure on https), set on
  sign-in. It lasts 12 hours and does not renew.
- Requests that change data (`POST`, `PUT`, `PATCH`, `DELETE`) must also send `X-CSRF-Token`
  with the value of the readable `msid_csrf` cookie (double-submit). Otherwise: `403 csrf-token-invalid`.
- Order of checks: authentication (`401`), CSRF (`403`), request validation, then the handler.
- Bearer API tokens (`Authorization: Bearer <token>`) arrive in phase 2 (P1).
- `/public/*` operations need no authentication. They are rate limited per address
  ([Public endpoints](public-endpoints.md#rate-limits)).

## Idempotent submissions

A respondent submission may carry an `Idempotency-Key` header (1 to 128 characters; a UUID is
recommended). A repeated key for the same survey returns the original response's `id` (`201`) instead of
storing a second response. Keys are remembered for at least 24 hours. How the key becomes the response id,
and how it works with the one-response limit, is in
[Public endpoints](public-endpoints.md#idempotency).

## Phasing

Operations and properties marked `x-phase: P1` belong to phase 2 (API tokens, password login,
partial responses). They are part of the contract now. Until they are implemented, a server
answers those operations with `501 not-implemented` and ignores the marked properties.

Any operation that no handler exists for also answers `501`, after authentication. This is the case
for every operation that a step has not built yet, and the conformance suite accepts it.

## Limits

Configured on the server and returned by `GET /api/v1/config` as `limits`:
`maxAssetBytesPerSurvey` (50 MB), `maxFileBytes` (10 MB), `maxResponseBytes` (1 MB) and `maxDocumentBytes` (30 MB). The last one is the
body limit of the survey definition and theme saves; the others follow [ADR 0004](../adr/0004-body-limit.md).
`maxAssetBytesPerSurvey` is the total of editor uploads one survey may hold ([Uploads and files](uploads.md#the-quota)).
