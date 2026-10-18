# Exporting results

Two operations take all the results of a survey out of the application, or remove them:

| Operation       | Request                                  | Who                   | Answer                       |
| --------------- | ---------------------------------------- | --------------------- | ---------------------------- |
| `exportResults` | `GET /surveys/{surveyId}/results/export` | A user who can see    | `200` and a JSON or CSV file |
| `deleteResults` | `DELETE /surveys/{surveyId}/results`     | A user who can modify | `204` with no body           |

`getPublicResults` (the page a survey with Grant Access shows to anyone) is in
[Public endpoints](public-endpoints.md#public-results). The people-facing description of all three is
[Downloading, sharing and deleting results](../user-guide/downloading-sharing-and-deleting-results.md), and
the reasons for each rule are in [ADR 0016](../adr/0016-results-details-exports-and-public-results.md).

The examples use the session cookie, `msid`, of a signed-in user (copy its value from the browser's developer
tools, or from a cookie jar as in [Authentication](authentication.md)), and this setup:

```sh
API=http://localhost:3000/api/v1
ID=22222222-0000-4000-8000-a00000000008   # "API created": Olivia Owner's, 1,500 responses
```

## Download all responses

```sh
curl -s -b "msid=<cookie value>" "$API/surveys/$ID/results/export?format=json" -o results.json
curl -s -b "msid=<cookie value>" -H "Accept: text/csv" "$API/surveys/$ID/results/export" -o results.csv
```

The file holds **every stored response, oldest first** (by `submittedAt`, then `id`, the order of
`listResults`). There is no cap: the old page stopped at 1,000. Rows of one client are not merged. Reading
needs no CSRF header.

### Choosing the format

| Request                                                               | Format               |
| --------------------------------------------------------------------- | -------------------- |
| `?format=json`                                                        | JSON                 |
| `?format=csv`                                                         | CSV                  |
| `?format=` anything else (for example `xlsx`)                         | `400 bad-request`    |
| No `format`, no `Accept`, or an empty `Accept`                        | JSON                 |
| `Accept: application/json`                                            | JSON                 |
| `Accept: application/*` or `*/*`                                      | JSON                 |
| `Accept: text/csv`                                                    | CSV                  |
| `Accept: text/*`                                                      | CSV                  |
| `Accept` that names none of the above (for example `application/xml`) | `406 not-acceptable` |

- **`format` wins over `Accept`.** A browser link cannot set headers, so the web app uses
  `?format=json` and `?format=csv`. A client may send both: `format` is used and `Accept` is ignored.
- **`Accept` is read with q-values.** The ranges are tried from the highest `q` to the lowest, and equal
  values keep the order of the header. The first range this operation serves decides: `text/csv, */*;q=0.1`
  is CSV, `*/*;q=0.1, text/csv` is CSV too (higher `q`), and `application/xml, text/csv` is CSV. A range
  with `q=0`, or a `q` that is not a number, is skipped. There is **no specificity ranking**: with
  `text/csv;q=0.5, */*` the wildcard has the higher `q`, so the answer is JSON.
- **The check comes before the survey is looked up.** An unsupported `Accept` is `406` without reading the
  store, also for an id that does not exist. A bad `format` is `400` from the request validation.
- The `406` body is a Problem Details answer with `code: not-acceptable` and the detail "Ask for
  application/json or text/csv, or use format=json or format=csv.".

```sh
curl -i -b "msid=<cookie value>" -H "Accept: application/xml" "$API/surveys/$ID/results/export"
```

```text
HTTP/1.1 406 Not Acceptable
content-type: application/problem+json; charset=utf-8

{"type":"https://my-surveys.surveyjs.io/problems/not-acceptable","title":"Not acceptable","status":406,"code":"not-acceptable","detail":"Ask for application/json or text/csv, or use format=json or format=csv."}
```

### The answer

```text
HTTP/1.1 200 OK
content-type: text/csv; charset=utf-8
content-disposition: attachment; filename="API created.csv"; filename*=UTF-8''API%20created.csv
cache-control: no-store
x-content-type-options: nosniff
```

| Header                   | Value                                                                      |
| ------------------------ | -------------------------------------------------------------------------- |
| `Content-Type`           | `application/json; charset=utf-8` or `text/csv; charset=utf-8`             |
| `Content-Disposition`    | `attachment`, with the survey name and `.json` or `.csv`; see "File names" |
| `Cache-Control`          | `no-store`: the answers are not cached                                     |
| `X-Content-Type-Options` | `nosniff`                                                                  |

The answer has no `Content-Length`: the file is streamed.

### File names

The file is named after the survey, with the extension of the format: `Customer feedback.json`,
`Customer feedback.csv`. A survey with a blank name gives `results.json` or `results.csv`. Control
characters are removed from the name and a lone surrogate becomes U+FFFD. `Content-Disposition` carries two
names (RFC 6266):

- `filename="..."` is the ASCII fallback: every character outside printable ASCII, and `"`, `\` and `%`,
  become `_`;
- `filename*=UTF-8''...` is the real name, percent-encoded (RFC 5987). Clients that know it use it.

The header is always `attachment`, so a browser saves the file and never shows it as a page.

### JSON

A JSON array of the same items `listResults` returns, written as the rows are read. With no responses it is
`[]`.

```json
[
  {
    "id": "b0f1c3a8-52de-5a41-8c97-3e6d9f2b7a10",
    "submittedAt": "2026-05-01T08:00:00.000Z",
    "data": { "color": "Red", "score": 4, "channels": ["Search", "Ad"] },
    "clientId": "5c1f…",
    "respondentIp": "203.0.113.7"
  }
]
```

- `clientId` and `respondentIp` are there when the row has them, whatever the survey's setting is **now**
  (an address that was stored stays in the JSON file). `partial` is not returned.
- The owner's file has everything the owner can read. It is **not** the old site's
  `{ "ResultCount": …, "Data": […] }`.
- Count them with `jq length`:

```sh
curl -s -b "msid=<cookie value>" "$API/surveys/$ID/results/export?format=json" | jq length
```

```text
1500
```

### CSV rules

| Item                         | Rule                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoding                     | UTF-8, starting with a byte order mark (U+FEFF). Fields are separated by commas. **Every** record, the header and the last row included, ends with CRLF                                                       |
| Quoting                      | RFC 4180: a field that contains a comma, a double quote, CR or LF is wrapped in `"` and its quotes are doubled                                                                                                |
| Formula guard                | A **text** value that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front of it (before quoting). Header names too. Numbers and booleans are not touched                           |
| Columns                      | `Submitted`; `IPAddress` **only while the survey's `storeRespondentIp` setting is on**; one column per question, in the order of the definition; `ClientId`, last, always                                     |
| Question columns             | Pages in order, panels flattened in place. A dynamic panel, a matrix and a multiple text are **one** column each. Elements of the types `html` and `image` have no column. A name that repeats has one column |
| Comment columns              | A question with `showCommentArea`, `hasComment`, `showOtherItem` or `hasOther` set to true gets a second column right after it                                                                                |
| Headers                      | The question's **`name`**, not its title. The comment column is the name plus the suffix: the definition's `commentSuffix`, else `commentPrefix`, else `-Comment`                                             |
| Which answer                 | The answer is read under the question's `valueName` when it has a non-empty one, else under its `name`. The comment is read under that key plus the suffix                                                    |
| Values                       | A string as it is; a number or boolean as text (`4`, `true`); an array or object as compact JSON text; `null` and a missing answer as an empty field                                                          |
| Left out                     | Answers whose key is not a question of the definition. They stay in the JSON file                                                                                                                             |
| `Submitted`                  | `submittedAt` as stored, ISO 8601 UTC (`2026-05-01T08:00:00.000Z`)                                                                                                                                            |
| No responses                 | The byte order mark and the header record only                                                                                                                                                                |
| A definition without `pages` | Read as one page. A legacy `questions` list is read like `elements`                                                                                                                                           |

For "API created" the first record of the file is:

```text
Submitted,color,score,subscribe,channels,comment,ClientId
```

A few cases to know:

- **A text answer such as `-5` or `+1 555 0100` is changed** by the guard: the CSV has `'-5` and
  `'+1 555 0100`. The guard looks at the characters, not at the meaning. A **number** question stores a
  JSON number, which is not guarded. The JSON export never has the `'`.
- **A question that is called `Submitted`, `IPAddress` or `ClientId`** keeps its own column, so the header
  names that column twice. Read such a file by position.
- **Headers are names.** To show titles, read the definition (`getSurveyDefinition`) and map names to titles.
- **While Save Respondent IP is off**, the `IPAddress` column is not in the file, also when some responses
  stored an address. Those addresses are in the JSON file.
- `ClientId` is always the last column, also when no row has one, because the file is written while it is
  read and cannot look ahead.
- The comment of a question is the text of its comment or "other" area. It is a separate column only for the
  questions the list above names.

### Streaming and a failure part way

The server reads the responses one page of 1,000 at a time and writes each page before it reads the next.
It never holds the whole file.

- **Order of checks:** `401` (no session), `400` (bad id or `format`), `406` (`Accept`), `404` (an unknown
  survey, or one the user cannot see; for CSV also a survey with no definition), then the first page is
  read. A store failure on that first page is still a clean `500 internal-error` Problem Details answer.
- **A failure after the first page cannot change the status**, because `200` and the headers are already
  sent. The server **aborts the transfer** and logs the error (the log has no answers). The body ends
  without its last chunk, so most clients (browsers, `curl`, HTTP libraries) report an incomplete or failed
  download. A client that keeps what it received anyway has a JSON file that is not complete, or a CSV file
  with fewer rows than the survey has. Check the end of a JSON file (it must close with `]`) and compare the
  number of rows with `getResultStats` (`count`) when the file must be complete.
- Nothing is cached (`no-store`), and a second download reads the store again.

### Cost on the old site's stores

The export reads the survey the way `listResults` pages do, so the cost of paging on the `azure-legacy`
provider applies ([Paging](paging.md#results-oldest-first-one-survey)): each page lists the rows from the
cursor's time on, sorts them in memory and keeps 1,000. The first page reads all the rows and the last one
reads the few that are left, so a walk over N rows reads about N²/2,000 rows in total. 1,500 rows are
quick. A survey with 100,000 responses reads on the order of five million rows for one download, and
the server holds the remaining rows of each page in memory until it has sent it. Step 14 measures this. The
memory provider has no such cost.

### Errors

| Status | `code`            | When                                                                                                        |
| ------ | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `400`  | `bad-request`     | The survey id is not valid, or `format` is not `json` or `csv`                                              |
| `401`  | `unauthenticated` | No session                                                                                                  |
| `404`  | `not-found`       | An unknown survey, or one the user cannot see ([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)) |
| `406`  | `not-acceptable`  | `Accept` names neither JSON nor CSV and there is no `format`                                                |
| `500`  | `internal-error`  | The store failed before the first byte                                                                      |

## Delete all responses

```sh
CSRF=<the value of the msid_csrf cookie>
curl -i -X DELETE -b "msid=<cookie value>; msid_csrf=$CSRF" -H "X-CSRF-Token: $CSRF" "$API/surveys/$ID/results"
```

```text
HTTP/1.1 204 No Content
```

`deleteResults` needs a session and the CSRF header ([Authentication](authentication.md#csrf-the-double-submit-rule)),
and the user must be allowed to **modify** the survey, as for `updateSurvey`
([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)). Use a survey you created for trying it out:
**it cannot be undone**.

**What is deleted:**

- every response row (the rows that came from the old site too);
- every completion marker, so `getPublishedSurvey?clientId=` answers `completed: false` again and a client
  can submit again under "Limit to one response";
- the respondent files of the survey (the files of `uploadResponseFile`), so their links answer
  `404 not-found`. They are deleted **first**, then the rows and markers, so a failure part-way is repeated
  safely.

**What stays:** the survey record (its `updatedAt` does not change), the definition, the theme, the history,
the editor's assets (`uploadSurveyAsset` files), the users' saved layouts and the list of private
questions. The respondent's own browser may still hold the Form Library's completion cookie.

Rules:

- **`204`, also with nothing to delete.** A survey with no responses is not an error.
- **A response sent right after is stored normally.** On the `azure-legacy` provider the tables are
  **not** dropped (a response sent while Azure still removes a dropped table fails with
  `TableBeingDeleted`). The rows are deleted in transactions of at most 100 rows. A very large survey
  takes a while, and a failure part-way leaves the rest of the rows, so the call can be repeated.
- The old table `postdelete{postId}` (copies of results deleted one by one) is not touched.
- On the `azure-legacy` provider the delete also adds one `SURVEY_DELETEALLRESULTS` row to the survey's
  event log (best effort: a failure of that row is logged, with ids only, and the delete stays done).
  The row holds no answers. The response of the call is the same.
- The call writes no log line of its own about the content, and a failure never logs answers, file names,
  client ids or addresses.

| Status | `code`               | When                                                                             |
| ------ | -------------------- | -------------------------------------------------------------------------------- |
| `400`  | `bad-request`        | The survey id is not valid                                                       |
| `401`  | `unauthenticated`    | No session                                                                       |
| `403`  | `forbidden`          | The user can see the survey but not modify it ("You cannot modify this survey.") |
| `403`  | `csrf-token-invalid` | The CSRF header and cookie are missing or differ                                 |
| `404`  | `not-found`          | An unknown survey, or one the user cannot see                                    |
| `500`  | `internal-error`     | The store failed. Some rows or files may be gone; repeat the call                |
