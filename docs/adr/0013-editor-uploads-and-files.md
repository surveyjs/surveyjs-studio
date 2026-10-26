# 13. Editor uploads and file serving

Date: 2026-10-17

## Status

Accepted. The product owner has not confirmed rulings R1, R4, R5, R6, R11 and the limits of R8 yet (see
"For the product owner to confirm").

## Context

Step 7 lets the Survey Creator upload images and videos to the server (`uploadSurveyAsset`,
`POST /surveys/{surveyId}/assets`) and serves them to anyone who has the link (`downloadFile`,
`GET /public/files/{fileId}`). The contract names the two operations, the `StoredFile` answer and the
limit `maxAssetBytesPerSurvey`, and `spec.md` asks for a per-survey quota and quota errors shown as
notifications. It does not say how files are stored, named or typed, what a download carries, what
happens to files when a survey is deleted or cloned, or what the Creator does on an error. The current
surveyjs.io code answers some of these in ways that do not fit (any type, no link to a survey, never
deleted). Each ruling below says what legacy does, what this application does, and why. The research
behind the legacy column is in the Step 7 notes; the stores are shared with the legacy site, which keeps
running during the transition ([ADR 0010](0010-writing-to-the-legacy-stores.md)).

Respondent files (`uploadResponseFile`) are Step 8. They will use the same store and the same download
route ([ADR 0005](0005-respondent-files-as-urls.md)), with a new file kind.

## Decision

The rulings are numbered R1 to R18 and grouped by topic.

### Storage and ids (R1 to R4)

| #   | Question                  | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                             | Legacy                                                                                                                                                                                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | File id                   | 64 lower-case hex digits: the owning survey's GUID without dashes (32), then 128 random bits (32, `crypto.randomBytes(16)`). A lookup accepts any letter case. Anything that is not 64 hex digits is "no such file" (`404`). The helpers are in `server/src/domain/file-id.ts`                                                                                                                                                     | Departs. A new GUID without any link to a survey                                                                                                                                                                                     |
| R2  | Where files live          | `memory`: in the provider's memory, lost on restart. `azure-legacy`: block blobs in a **new container `my-surveys-files`** of the surveys storage account, named `{surveyId}/{fileId}`. The blob's content type is the detected type; its metadata is `kind` (`asset`), `name` (URI-encoded, as metadata is ASCII only) and `createdat`. The container is created, private, by the first write that finds it missing, then retried | Departs. File share `surveyfiles`, root directory, a GUID as the name, no extension, no type, no name, no size. Azurite cannot emulate Azure Files, and legacy code reads containers by fixed names, so a new one is invisible to it |
| R3  | Kinds                     | `FileKind` is `"asset"` only. Usage, the quota and copies count assets. Deleting a survey's files deletes every kind. Step 8 adds `"response"`                                                                                                                                                                                                                                                                                     | New                                                                                                                                                                                                                                  |
| R4  | Legacy assets and preview | Existing `https://api.surveyjs.io/private/Surveys/files?name=...` links in survey JSON stay as they are: served by the legacy API, not counted, not deleted, not copied. The legacy **preview image** (`my-surveys-survey-preview-image-{id}` in the share) is **not built**                                                                                                                                                       | Keeps the old links working. No code in the legacy repository uploads a preview image, the share cannot be emulated, and reading it needs a new SDK                                                                                  |

Why the id carries the survey: each provider finds a file's survey from its id, so no index is needed for
downloads, usage or deletes, and a survey's files share the prefix `{surveyId}/`. The random half alone
gives 128 bits. The cost is that the survey id shows in file links. Survey ids are already public (run
links, embed code) and grant nothing. Changing the format later needs a lookup for old ids.

Why a new container: the editor's links use `api.surveyjs.io` until that site is retired. Those links
break then, so a migration belongs to the hosted-migration track, before the old API retires (mode 1.3). A stale preview image, if any exists in
production, stays.

The writes (`uploadData`, `createIfNotExists`, blob delete) are in
`server/src/providers/azure-legacy/writes.ts` like every legacy write; the reads are in
`providers/azure-legacy/files.ts` (`createAzureFileStore(blobs, { container })`). **Production
credentials need the right to create a container**, or an operator creates `my-surveys-files` first.
There are no audit rows for files (the legacy log has no such event types).

### Types and serving (R6 to R8)

| #   | Question         | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Legacy                                               |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| R6  | Allowed types    | Decided from the **bytes** only; the declared part type and the file name are ignored. Images: PNG (also APNG), JPEG, GIF, WebP, AVIF, BMP, SVG. Videos: MP4, WebM, Ogg. Anything else is `415`; an empty file is `422` first. SVG is accepted when the text, after a BOM, whitespace, an XML declaration, comments and a doctype without an internal subset, starts with `<svg`. The rules are in `server/src/files/file-type.ts`                                                                                                                     | Departs. Any file type is accepted                   |
| R7  | Download headers | `200` with `Content-Type` (the stored type), `Content-Length`, `Content-Disposition` (`inline` for `image/*`, else `attachment`, with `filename` and `filename*`), `Cache-Control: public, max-age=3600`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox` and `Cross-Origin-Resource-Policy: cross-origin`. The same for every caller; no cookie is needed                                                                                                         | Departs. `application/octet-stream` as an attachment |
| R8  | Caching, ranges  | `max-age=3600`; no `ETag`, `Last-Modified`, `304`, `Range` or `206`. Ids are never reused and content never changes, but a delete must take effect, so a deleted file may stay in a browser or proxy cache for up to an hour. Without `Range`, Safari may refuse to play uploaded videos, and seeking is limited. Left open (see [architecture](../architecture.md#open-for-later-steps)). The `Cross-Origin-Resource-Policy` value `cross-origin` lets surveys embedded on other sites show the images. `attachment` still lets `<video>` play a file | Departs. The legacy action sets no cache headers     |

Why the sandboxing policy: an SVG opened directly in a tab would otherwise run its scripts on our origin,
next to the session. The `sandbox` directive gives it an opaque origin and `default-src 'none'` loads
nothing. `nosniff` is safe because the served type matches the bytes. A separate origin for user files is
the stronger fix and is left for later (it needs a second host name).

### Quota (R5, R12 to R14)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Legacy                                                                                        |
| --- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R5  | The quota       | The sum of a survey's asset sizes stays at or under `limits.maxAssetBytesPerSurvey` (`LIMIT_MAX_ASSET_BYTES_PER_SURVEY`, default 50 MB). Checked **three times**: before the body is read (`remaining = quota - usage`; nothing left is `413`), while it is read (the busboy `fileSize` limit is `remaining`; over is `413`) and after it is stored (usage again; over: delete the new file, `413`). The step after the store also checks that the survey still exists (deleted meanwhile: delete the new file, `404`), and when the store fails during that step it deletes the new file (best effort) before the `500`. A file counts until its survey is deleted. There is no per-file limit besides the quota: `LIMIT_MAX_FILE_BYTES` is for respondent files (see [ADR 0004](0004-body-limit.md#addendum-step-7)) | Departs. Only a client-side check of 4,000 KB for one batch; files are not linked to a survey |
| R12 | Upload request  | `multipart/form-data` with one file part named `file`; only the first file part is read. Busboy limits: `files: 1`, `fields: 10`, `fieldSize: 1024`, `parts: 20`, `headerPairs: 100`, `fileSize: remaining`. The name is the part's file name without any folder part (`/`, `\`) and control characters, trimmed, at most 255 UTF-16 code units, `file` when empty                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Keeps "only the first file is used". The posted survey id was ignored                         |
| R13 | Order of checks | The framework first, in Fastify's hook order (authentication `401`, CSRF `403`, then `415` for a body that is not multipart, then `400` for a bad path id). Then `404` (unknown or not visible), `403` (cannot modify), usage, `413` when nothing is left, then the part: no `file` part `422`; a malformed or cut body `400`; over `remaining` `413`; empty `422`; type `415`; store; the survey again (gone: delete, `404`) and usage again (over: delete, `413`); a store failure here: delete, `500`; `201`                                                                                                                                                                                                                                                                                                        | Departs. Legacy checked a key in the query string                                             |
| R14 | Problems        | `413 quota-exceeded` "File quota exceeded" with the detail "This survey can store up to {size} of files."; `415 unsupported-media-type` "Unsupported file type" (the detail lists the allowed types); `422 validation-failed` with the pointer `/file`; `400 bad-request` "The multipart body could not be read."; a download `404 not-found`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Departs. The raw response text                                                                |

Why three checks: the one after the store keeps the total under the quota even when uploads run at the
same time (both may be refused, never both kept). The same step checks the survey again, so an upload
that passed the access check just before the survey was deleted does not leave a public file that no
longer counts towards anything (it narrows that window; it does not close it). A store failure after the
file was stored deletes the file too, so a `500` never leaves a file that counts. The first two checks
keep memory bounded: one upload holds at most `remaining` bytes. The cost of R5: replacing or clearing an image frees nothing, so a user can fill
50 MB by replacing images again and again. Freeing space needs a way to delete one file, which the
contract does not have (R9).

Notes on the code as built. `@fastify/multipart` 10.1.2 is the one new dependency. `server/src/api.ts`
registers it before the media-type loop, so `multipart/form-data` has a parser (the body is read by the
handler, `request.file()`; Fastify's `bodyLimit` does not apply, the busboy limits do). The old
pass-through body parser is gone, and a contract request media type with no parser now stops start-up. The
upload handler also checks `truncated` after `toBuffer()`: in 10.1.2 `toBuffer()` can miss the size limit
when the over-limit bytes arrive in their own chunk, and returns the first `remaining` bytes.

### Delete and clone (R9 to R11)

| #   | Question      | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                           | Legacy                                                             |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R9  | Clearing      | The Creator's `onClearFile` is not handled; nothing is deleted on the server                                                                                                                                                                                                                                                                                                                                                     | Same: legacy never deletes a file                                  |
| R10 | Survey delete | After the `409` check, `deleteSurveyFiles(id)` runs, then `deleteSurvey(id)` (children first, as in [ADR 0010](0010-writing-to-the-legacy-stores.md)). A file-store failure fails the request with `500` and the survey stays; a retry finishes. Cost: if the survey delete fails after the files went, the survey stays without its files                                                                                       | Departs. Deleting a survey deletes no file                         |
| R11 | Clone         | `SurveysService.clone` makes the copy's id, calls `copySurveyAssets(source, copy, createdAt)` (old file id to new id), then `cloneSurvey(source, copy, { rewriteText })`. `rewriteText` replaces every old file id by its new id in the definition and theme text (only when files were copied). If the files cannot be copied, or the clone answers `null` or throws, the copies are deleted (best effort) and the error stands | Departs. A copy shared the source's links, and nothing was deleted |

Why copy: without copies, deleting the source would break the copy's images. Ids are 64 hex digits, so a
plain text replace cannot hit anything else, and it keeps whatever origin the links carry. The cost is
that a clone copies up to the quota in bytes, so the copy's usage starts at the source's. Legacy-style
links (R4) are not copied.

Deleting the survey is also what ADR 0005 asks for: a deleted survey must not leave public files behind.

### The Creator (R15 to R17)

| #   | Question           | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                         | Legacy                                                                  |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| R15 | The `201` answer   | `Location: /api/v1/public/files/{id}` (relative, like the other creates) and the body `StoredFile { id, url, name, contentType, size }`; `url` is `{PUBLIC_BASE_URL}/api/v1/public/files/{id}` and goes into the survey JSON                                                                                                                                                                                                   | Departs. Legacy returned a link with a query string and an access key   |
| R16 | The upload adapter | Only the first chosen file is uploaded. A file over the whole quota is refused in the browser. Success calls back with `url`; a failure shows our own message in a Creator notification (one for the quota, one for the type, one each for `403`, `404` and `401`, one for anything else). A read-only editor has no handler, and a result that arrives after the editor closed is ignored. Texts: `web/src/editor/uploads.ts` | Keeps "only the first file". Legacy notified with the raw response text |
| R17 | Sizes in messages  | `formatBytes` is the same on server and web: `52428800` is `50 MB`, `1572864` is `1.5 MB`, `65536` is `64 KB`, `500` is `500 bytes`                                                                                                                                                                                                                                                                                            | New                                                                     |

### The Step 6 fixes (R18)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Legacy        |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| R18 | Two parked gaps | (a) Both Creator save functions return at once when the session is closed, so a late auto-save timer after the editor closed sends nothing. (b) Loading documents into an open Creator first cancels both scheduled auto-saves and clears the pending flags, and "Reload latest" resets the savers only after the Creator holds the new documents (`SurveyEditor` reports `onDocumentsLoaded`). The wiring moved to `web/src/editor/creatorAutosave.ts` (no Creator imports), so both are unit-tested | Not in legacy |

Without (b), an edit made before the reload could be saved over the reloaded content.

## Consequences

- A survey's files are public to anyone with the link, and are never listed, signed or expiring. The id
  is unguessable (128 random bits). Whoever has a link can pass it on.
- Space is never freed while the survey exists. Deleting the survey is the only way to free it, and
  a clone does not help, because it copies the files. A way to delete one file is a later contract change.
- A deleted survey's images can stay in a browser cache for up to an hour, and the legacy links of R4 keep
  working until `api.surveyjs.io` is retired.
- Cloning copies up to the quota, so a clone of a survey full of files takes longer.
- The new container needs the right to create it (or an operator creates it first).
- Uploads that run at the same time each hold up to the remaining quota in memory, so N parallel uploads
  to an empty survey can hold about N × 50 MB. Options for later: a per-user cap on concurrent uploads
  (with the rate limits of Step 8), or streaming the file to the store instead of buffering it.
- Open for later steps: a separate origin for user files, `Range` and conditional downloads, freeing space
  when a file is no longer used, and migrating legacy asset links before `api.surveyjs.io` is retired
  (see [architecture](../architecture.md#open-for-later-steps)).
- Files of a clone are copied before the copy exists. A crash between the two leaves files that belong to
  a survey id that never existed. They take space in the container and are never part of a survey. This
  is the same kind of leftover as the orphan blobs of ADR 0010.

## For the product owner to confirm

These rulings are decisions of the team, not of the product owner. Until the owner confirms them, they
stand as written.

- **R1:** the file id contains the survey id. Another format needs a lookup for old ids.
- **R4:** legacy editor links are left untouched and the preview image is not built. The links break when
  `api.surveyjs.io` is retired; moving them is a rollout task.
- **R5:** replacing an image does not free space.
- **R6:** only the listed image and video types may be uploaded. Legacy accepted anything, so a PDF, a MOV
  or a HEIC image is now refused.
- **R8 (limits):** no `Range` or conditional requests, and a one-hour cache; Safari may not play uploaded
  videos, and a deleted file can stay in a cache for an hour.
- **R11:** a clone copies the files, up to the quota in bytes.
