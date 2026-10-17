# Uploads and files

Two operations store and serve the files of a survey (images and videos placed in it from Survey
Creator):

| Operation           | Request                                      | Answer                                |
| ------------------- | -------------------------------------------- | ------------------------------------- |
| `uploadSurveyAsset` | `POST /surveys/{surveyId}/assets`, multipart | `201`, `Location` and the stored file |
| `downloadFile`      | `GET /public/files/{fileId}`, no session     | `200` and the file                    |

`uploadResponseFile` (respondent files) is not built yet and still answers `501` (Step 8). The reasons for
each rule are in [ADR 0013](../adr/0013-editor-uploads-and-files.md).

The examples use a cookie jar `cookies.txt` of a signed-in session, as in
[Step 5](README.md#step-5-survey-actions):

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
API=http://localhost:3000/api/v1
ID=<a survey id you may modify>
```

## Upload a file

Send one file as the multipart part named `file`. The session cookie and the CSRF header are needed, as
for every request that changes data ([Authentication](authentication.md#csrf-the-double-submit-rule)).
Do not set `Content-Type` yourself: `curl` adds the multipart boundary.

```sh
curl -i -b cookies.txt -H "X-CSRF-Token: $CSRF" -F "file=@logo.png" "$API/surveys/$ID/assets"
```

```text
HTTP/1.1 201 Created
location: /api/v1/public/files/22222222000040008000a000000000013f9a1c0d5e7b4a6c8d2e1f0a9b8c7d6e
content-type: application/json; charset=utf-8

{"id":"22222222000040008000a000000000013f9a1c0d5e7b4a6c8d2e1f0a9b8c7d6e","url":"http://localhost:3000/api/v1/public/files/22222222000040008000a000000000013f9a1c0d5e7b4a6c8d2e1f0a9b8c7d6e","name":"logo.png","contentType":"image/png","size":2048}
```

| Field         | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `id`          | The file id (see [Ids](#ids))                                                                        |
| `url`         | The absolute address, `PUBLIC_BASE_URL` plus `/api/v1/public/files/{id}`. **Use this in the survey** |
| `name`        | The uploaded file name without any folder part, at most 255 characters                               |
| `contentType` | The type found in the bytes, not the one the client declared                                         |
| `size`        | Bytes                                                                                                |

`Location` is the same address as a path. To use the file, put `url` where the survey wants a link, for
example the `imageLink` of an `image` question or the `logo` of the survey, and save the definition
([Concurrent editing](concurrency.md)):

```json
{
  "elements": [
    {
      "type": "image",
      "name": "logo",
      "imageLink": "http://localhost:3000/api/v1/public/files/22222222000040008000a000000000013f9a1c0d5e7b4a6c8d2e1f0a9b8c7d6e"
    }
  ]
}
```

Only the first file part is read. The body may have at most 20 parts, and at most 10 text fields of
1,024 bytes each.

### Allowed types

The type is decided from the **content** of the file. The part's `Content-Type` and the file name are
ignored, so a PNG that is called `a.pdf` is stored as a PNG.

| Type       | `contentType`   | Served as    |
| ---------- | --------------- | ------------ |
| PNG (APNG) | `image/png`     | `inline`     |
| JPEG       | `image/jpeg`    | `inline`     |
| GIF        | `image/gif`     | `inline`     |
| WebP       | `image/webp`    | `inline`     |
| AVIF       | `image/avif`    | `inline`     |
| BMP        | `image/bmp`     | `inline`     |
| SVG        | `image/svg+xml` | `inline`     |
| MP4        | `video/mp4`     | `attachment` |
| WebM       | `video/webm`    | `attachment` |
| Ogg        | `video/ogg`     | `attachment` |

Anything else is `415`. An SVG must start with `<svg` (after an optional byte order mark, whitespace, an
XML declaration, comments and a doctype). A doctype with an internal subset (`[ ... ]`) is refused.

### The quota

A survey may hold at most `limits.maxAssetBytesPerSurvey` bytes of files (default 50 MB,
`LIMIT_MAX_ASSET_BYTES_PER_SURVEY`). Read it from `GET /config`:

```sh
curl -s "$API/config" | grep -o '"maxAssetBytesPerSurvey":[0-9]*'
```

```text
"maxAssetBytesPerSurvey":52428800
```

Rules:

- The files count until the **survey is deleted**. There is no way to delete one file, so replacing an
  image in a survey does not free its space.
- A copy of a survey ([`cloneSurvey`](README.md#step-5-survey-actions)) gets copies of the files and starts
  with the same usage.
- There is no limit for one file besides what is left of the quota.
- No operation reports the usage. A client that wants to warn early compares the size of the file with
  `maxAssetBytesPerSurvey`, as the editor does.
- Old links to `api.surveyjs.io` in a survey are not files of this store and are not counted.

### Errors

The checks run in this order: authentication and CSRF, the media type of the request, the path id, the
survey (`404`, then `403`), the quota that is left, then the file. Nothing is stored for any error.

| Status | `code`                   | When                                                                                                                                                                                 |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | `bad-request`            | The survey id is not a GUID, or the multipart body is malformed or cut short ("The multipart body could not be read.")                                                               |
| `401`  | `unauthenticated`        | No session                                                                                                                                                                           |
| `403`  | `csrf-token-invalid`     | The CSRF header is missing or wrong                                                                                                                                                  |
| `403`  | `forbidden`              | You can see the survey but not modify it                                                                                                                                             |
| `404`  | `not-found`              | Unknown survey, or one you cannot see                                                                                                                                                |
| `413`  | `quota-exceeded`         | The survey has no space left, **or** this file does not fit in what is left. The detail reads "This survey can store up to 50 MB of files."                                          |
| `415`  | `unsupported-media-type` | **The request** is not `multipart/form-data` ("Send the body as multipart/form-data."), **or the file** is not an allowed type ("Unsupported file type"; the detail lists the types) |
| `422`  | `validation-failed`      | No part named `file`, or the first file is in another part, or the file is empty. The pointer is `/file`                                                                             |

On this route `413` always has the code `quota-exceeded`: the global body limit does not apply to
multipart bodies.

## Download a file

`GET /public/files/{fileId}` needs **no session and no CSRF token**: the unguessable address is the
permission. Anyone with the link can read the file.

```sh
curl -I "$API/public/files/22222222000040008000a000000000013f9a1c0d5e7b4a6c8d2e1f0a9b8c7d6e"
```

```text
HTTP/1.1 200 OK
content-type: image/png
content-length: 2048
content-disposition: inline; filename="logo.png"; filename*=UTF-8''logo.png
cache-control: public, max-age=3600
x-content-type-options: nosniff
content-security-policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox
cross-origin-resource-policy: cross-origin
```

The headers are the same for every caller:

| Header                         | Value and reason                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Type`                 | The stored type (found in the bytes at upload)                                                                                                                                  |
| `Content-Disposition`          | `inline` for images, `attachment` for videos. Has `filename` (ASCII only, other characters become `_`) and `filename*` (UTF-8, RFC 5987). A `<video>` still plays an attachment |
| `Cache-Control`                | `public, max-age=3600`. A deleted file may stay in a browser or proxy cache for up to an hour                                                                                   |
| `X-Content-Type-Options`       | `nosniff`: the browser must use the stored type                                                                                                                                 |
| `Content-Security-Policy`      | `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`. An SVG opened directly in a tab runs no script and loads nothing                                       |
| `Cross-Origin-Resource-Policy` | `cross-origin`: a survey embedded on another site may show the image                                                                                                            |

An `<img>` that shows an SVG draws it as usual: browsers never run script inside an image.

There is no `ETag`, `Last-Modified`, `304`, `Range` or `206` yet. A client that asks for a range gets
the whole file. An unknown id, a malformed id, and a file of a deleted survey are all `404 not-found`.

## Ids

A file id is **64 lower-case hexadecimal digits**: the id of the survey without dashes (32 digits), then
128 random bits (32 digits). Treat it as opaque. A lookup accepts upper-case digits too. Anything else is
a `404`. The id is the same in the `Location`, the `url`, the `id` field and the survey JSON.

When a survey is cloned, each file gets a new id (with the copy's id in front), and the links in the
copy's definition and theme are rewritten.

## Deleting

There is no operation to delete one file. Deleting a survey ([`deleteSurvey`](README.md#step-5-survey-actions))
deletes all its files first. After that, a `GET` on one of them answers `404`.
