# Concurrent editing with ETags

Two people (or two windows) can edit the same survey. A save must not silently replace a change that
the writer has not seen. The survey definition and the theme therefore use **ETags** and
`If-Match`, as in [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#name-if-match).

This applies to four operations:

| Operation              | Request                                               | Answer                               |
| ---------------------- | ----------------------------------------------------- | ------------------------------------ |
| `getSurveyDefinition`  | `GET /surveys/{surveyId}/definition`                  | `200`, the definition and its `ETag` |
| `saveSurveyDefinition` | `PUT /surveys/{surveyId}/definition`, with `If-Match` | `204` and the new `ETag`             |
| `getSurveyTheme`       | `GET /surveys/{surveyId}/theme`                       | `200`, the theme and its `ETag`      |
| `saveSurveyTheme`      | `PUT /surveys/{surveyId}/theme`, with `If-Match`      | `204` and the new `ETag`             |

## The loop

1. **Read.** `GET` the document. Keep the `ETag` response header (it includes the quotes).
2. **Edit** the document in your own copy.
3. **Write.** `PUT` the whole document with `If-Match: <the ETag you kept>`.
4. **On `204`**, the response has the **new** `ETag`. Keep it for your next write. You do not need to
   read again.
5. **On `412`**, someone else saved first. Read again, merge or redo your change, and write with the
   new `ETag`.

The `PUT` replaces the whole document. There is no partial update.

## The rules

| Case                                               | Answer                                            |
| -------------------------------------------------- | ------------------------------------------------- |
| `If-Match` is missing or blank                     | `428 if-match-required`                           |
| `If-Match` is one tag that equals the current ETag | The save goes ahead: `204`                        |
| `If-Match` is a list, and one tag equals it        | The save goes ahead (the list is comma-separated) |
| `If-Match: *`                                      | Matches any current version: the save goes ahead  |
| `If-Match` names an older version                  | `412 edit-conflict`; nothing is written           |
| A weak tag (`W/"..."`)                             | Never matches: `412`                              |
| A value that is not a list of entity tags          | Matches nothing: `412`                            |

`*` skips the protection against lost updates. Use it only when you want to overwrite whatever is
there, for example when you restore a survey from a backup.

The checks run in this order: authentication (`401`), CSRF (`403`), the body size (`413`), the media
type (`415`), the body schema (`422`), then the survey: unknown or invisible (`404`), no modify rights
(`403`), the `If-Match` header (`428`), and the version (`412`). So a user who cannot see the survey
never learns anything from the ETag.

The `412` body is:

```json
{
  "type": "https://my-surveys.surveyjs.io/problems/edit-conflict",
  "title": "The survey was changed by someone else",
  "status": 412,
  "code": "edit-conflict",
  "detail": "Reload the survey to see the latest version."
}
```

The `428` body has `"code": "if-match-required"`, the title "If-Match required" and the detail "Send the
ETag from your last read in If-Match."

## What an ETag is

- **Strong and opaque.** It looks like `"3f9c..."`. Do not parse it, compare it with anything except
  itself, or build one. Send back exactly what you were given.
- **Per document.** The definition and the theme have separate ETags. The ETag of one is no good for
  the other.
- **Provider specific.** What it is made of differs between storage providers (a content hash, or the
  storage service's own version of the blob). Two servers give different ETags for the same document.
- **Changes with the content.** It changes whenever the stored text changes, also when a legacy
  editor, which sends no ETag, writes the survey. The legacy writer is therefore not protected, but
  every new writer is, against it and against each other.
- **For a survey without a definition** (`{}`), the `GET` still returns an `ETag`, and a first `PUT`
  with it works.
- A `404` has no `ETag`.

## Body size

The two `PUT` operations accept bodies up to `limits.maxDocumentBytes` (`GET /config`; the server
setting `LIMIT_MAX_DOCUMENT_BYTES`, default 30,000,000 bytes, as the legacy site accepts about 28.6
MiB). A larger body is `413 payload-too-large`. Every other route keeps the much smaller
`limits.maxResponseBytes` ([ADR 0004](../adr/0004-body-limit.md)).

## Example: a save loop with `curl`

The example uses a cookie jar `cookies.txt` of a signed-in session
([Authentication](authentication.md#csrf-the-double-submit-rule)) and `jq`.

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
API=http://localhost:3000/api/v1
ID=<a survey id you can modify>

# 1. Read. -D - prints the headers, which hold the ETag.
ETAG=$(curl -s -D - -o definition.json -b cookies.txt "$API/surveys/$ID/definition" \
  | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
echo "$ETAG"

# 2. Edit definition.json (here: set a title), then 3. write with If-Match.
jq '.title = "Customer feedback"' definition.json > edited.json
curl -i -b cookies.txt -X PUT "$API/surveys/$ID/definition" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" --data-binary @edited.json
```

Expected: `HTTP/1.1 204 No Content` and a new `ETag` header. Run the last command again with the **old**
`$ETAG`: it answers `412 Precondition Failed` with `"code":"edit-conflict"`. Without the `If-Match`
header it answers `428 Precondition Required`.

To chain writes, take the `ETag` of each `204` for the next one:

```sh
ETAG=$(curl -s -D - -o /dev/null -b cookies.txt -X PUT "$API/surveys/$ID/definition" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" --data-binary @edited.json | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
```

The theme works the same, with `/theme` in place of `/definition`.

## Side effects of a successful save

| Save       | Also                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| Definition | The survey's `updatedAt` moves to the save time, and one entry is added to the history |
| Theme      | `updatedAt` moves; no history entry                                                    |

The history is read with `listSurveyHistory` (`GET /surveys/{surveyId}/history`, newest first, paged;
[Paging](paging.md)). See [API: Step 6](README.md#step-6-definition-theme-and-history).
