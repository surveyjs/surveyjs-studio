# The old API's actions: the bridge

The bridge answers the actions of the old API (`api.surveyjs.io`) through Studio's public API, so pages and servers
built for the old service keep working: the public and unauthenticated actions ([Step 5 demo](../demo/hosted-05.md)) and
the actions that take an `accessKey` ([Step 6 demo](../demo/hosted-06.md)). Every other path goes to the old service
unchanged. The decisions are in [ADR 0035](../adr/0035-legacy-api-bridge.md) (the bridge),
[ADR 0039](../adr/0039-bridge-public-actions.md) (how exact it is, the public actions) and
[ADR 0040](../adr/0040-bridge-access-key-actions.md) (the access-key actions); the usage that sets the build order is in
[Legacy API usage](../architecture/legacy-api-usage.md). The checks are in
[Testing](../testing.md#the-compatibility-suite), how to run it in
[Operations](../operations.md#running-the-bridge). A caller who wants to move to Studio's own API reads the
[migration guide](migrating-from-api-surveyjs-io.md).

The rule is **exact wherever a caller can depend on it**: routes, methods, status codes, content types with their
charset, `Content-Disposition`, `Cache-Control` where the old API set it, CORS, JSON shapes and property casing, error
texts, and the formats of values callers parse. It does not reproduce incidental bytes: per-request trace IDs, the key
order and whitespace of JSON, chunked transfer, platform headers and the padding of stored files. The differences on
purpose and the ones that follow from Studio's rules are listed [below](#differences-from-the-old-api).

## What the bridge answers

Each action is served under both prefixes (`public/Survey` and `public/v1/Survey`, or `private/Surveys` and
`private/v1/Surveys`), in any letter case, with or without a trailing slash, and with the survey ID as a path segment
where the old route had one.

| Action                                        | Method | The bridge calls                                               | Answer                                                                       |
| --------------------------------------------- | ------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `public/Survey/getSurvey`                     | GET    | `getPublicDefinition` (cached, revalidated)                    | The survey JSON                                                              |
| `public/Survey/getSurveyAndIsCompleted`       | GET    | `getPublicDefinition`, `getRespondentState`                    | `{ survey, isCompleted }`                                                    |
| `public/Survey/post`                          | POST   | `submitResponseByPostId`                                       | Empty `200`                                                                  |
| `public/Survey/upload`                        | POST   | `uploadResponseFileByPostId`                                   | `dxsimage:{name}` or `dxsfile:{name}`                                        |
| `public/Survey/getResult`                     | GET    | `getQuestionSummary`                                           | `{ AnswersCount, QuestionResult, FirstResultAt, LastResultAt, ResultCount }` |
| `public/Survey/isCompleted`                   | GET    | `getRespondentStateByResultId`                                 | The string `no`, `partial` or `completed`                                    |
| `public/Survey/image`                         | GET    | `downloadFile` (Studio uploads), `getLegacyFile` (other names) | The image's bytes                                                            |
| `public/Survey/file`                          | GET    | As `image`                                                     | The file's bytes, `application/octet-stream`, as an attachment               |
| `private/Surveys/files?name=`                 | GET    | `getLegacyFile` (editor files)                                 | The file's bytes, `application/octet-stream`                                 |
| `private/Surveys/getSurveyPublicResults/{id}` | GET    | `getPublicResults` (every page, with `from` and `till`)        | `{ Data, ResultCount }`, streamed                                            |

The access-key actions of `private/Surveys` are in [their own section](#the-access-key-actions), and the migration
guide's [table](migrating-from-api-surveyjs-io.md#every-action-and-its-operations) lists every action with the
operations it calls.

The operations the bridge calls are in the [public endpoints guide](public-endpoints.md#operations-for-the-bridge). They
exist only in Studio's **hosted edition** (`APP_EDITION=hosted`): in front of any other Studio server, the actions above
answer as for an unknown survey or file. The bridge adds no store and no credentials: it holds only the `getSurvey`
cache.

**`getSurvey` cache.** The bridge keeps each survey's definition with Studio's `ETag` and sends every request to Studio
with `If-None-Match`. An edit in Studio shows on the next request, and a survey that did not change costs Studio a `304`.
A revalidation Studio refuses for rate reasons (`429`) serves the cached copy, as a `304` would, so a caller that reads
one survey very often (a scheduled job, a busy page behind one address) keeps getting it; without a cached copy the empty
`429` stands. The same holds for the definition `getSurveyAndIsCompleted` reads.

**Preflights.** An `OPTIONS` request with an `Origin` and an `Access-Control-Request-Method` header, to any path, is
answered by the bridge with `204` and the old policy (any origin, the requested method and headers). Every answer the
bridge makes itself carries `Access-Control-Allow-Origin: *` when the request had an `Origin`. Forwarded answers keep the
old service's own CORS headers.

**Errors.** Studio's `429` goes to the caller as `429` with an empty body (but see the cache above). A network failure,
a timeout, or a Studio status the action has no answer for becomes an empty `500`, as the old API's unhandled errors
were. Every other Studio
status maps to the old answer for that case (for example `400` with its text for an unknown result ID).

## The access-key actions

Every action of `private/Surveys` and `private/v1/Surveys` that takes the `accessKey` query parameter is answered by
the bridge, through Studio's public API with the caller's key. The routes follow the same rules as above: both
prefixes, any letter case, an optional trailing slash, and the survey ID as a path segment where the old route has one
(`id` from the form beats the route, which beats the query). The bare path `private/Surveys` (and `private/v1/Surveys`)
answers an empty `500` for every method, as the old service did, without asking Studio.

### The mapping table

One table in the bridge (`bridge/src/mapping.ts`) lists each action it answers: the action, its methods, its routes, how
it treats a bad key and the Studio operations it calls. The router is built from that table, so nothing is answered
that is not in it, and everything else is forwarded. The migration guide shows the same table, and a test
(`bridge/src/guide.test.ts`) fails when the guide and the table differ. The
[guide's table](migrating-from-api-surveyjs-io.md#every-action-and-its-operations) is therefore the list of what the
bridge answers.

### The key

- **Where it is read.** The query parameter `accessKey`, the name in any letter case, the first value. Four actions
  (`generateAccessKey`, `getSurveyDemoResults`, `uploadFiles` and `PUT clone`) also read it from a form field, as the old
  actions did, and `exportSurveyResults` reads it from the query only. A key in the body of a `GET` request
  is not read.
- **What happens to it.** The bridge sends the value to Studio as `Authorization: Bearer <value>` and nowhere else. It
  is never logged and never in an answer header. The value may be a legacy access key or an
  [API token](api-tokens.md). A token works within its scope: through the bridge a Personal token sees only the
  personal surveys, and an `ownerId` that names another project falls back to the personal surveys, as the old API
  falls back for someone who is not a member.
- **A missing or empty key** reaches no Studio call: the bridge answers the action's bad-key answer at once. So does a key
  with a trailing space or any character outside visible ASCII (the old service probably ignored trailing spaces).

### A bad key

Studio's `401` (an unknown, revoked or blocked owner's key) is answered like a missing key. There are two answers, as
in the old API:

| Actions                                                                                            | Answer for a missing, wrong, revoked or blocked key                      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `generateAccessKey`, `getSurveyDemoResults`, `exportSurveyResults`, `uploadFiles`, `clone` (`PUT`) | `200`, `text/html; charset=utf-8`, `The accessKey '<key>' is incorrect.` |
| `clone` (`POST`) and every other action                                                            | An empty `401`, no `Location`                                            |

The key in the text is HTML-encoded (see [below](#access-key-actions-on-purpose)). A survey the caller may not read or change (Studio's
`403` or `404`) is answered with the action's own "You are not authorized …" text with the survey's id, as the old API
answers an unknown and a forbidden survey alike. Studio's `429` goes to the caller as an empty `429`, and a network
failure or any status the action has no answer for is an empty `500` (see [Errors](#what-the-bridge-answers)). The old
API had no revoked keys: a key replaced by `generateAccessKey` was just unknown. Revoking a key on the API tokens page
([ADR 0037](../adr/0037-access-keys-and-api-tokens.md)) gives the same answer as a wrong key.

**The order of the checks differs for the actions that need sign-in** (every action answering the empty `401`). A missing
or empty key is answered before the body is read. A key that is present is checked by Studio only after the bridge has
read and validated the body, because only Studio knows whether a key is wrong or revoked, and an extra Studio call
for each request was judged not worth it. So a wrong or revoked key sent with an unreadable or invalid body (for
example `changeJson` with an `Id` that is no GUID, or a body that is not JSON) gets that body's empty `400`, where the
old API answered the `401`.

### How the actions work

- **Permissions are Studio's.** The owner, a project admin, or the survey's creator may change a survey (the
  [differences](#access-key-actions-on-purpose) say what the old API allowed). Reading needs only that the caller can see the survey.
- **`delete`** archives an active survey and then deletes it, because the old API deleted active surveys and its callers
  are servers. Studio's own pages and API keep their two steps. If the call fails between the two steps, the survey stays
  archived and a retry finishes the job.
- **`changeJson`** saves with no version check (`If-Match: *`, as the old API) and adds a history point, as the editor's
  saves do. Its `Text` field is ignored.
- **`create`** makes an empty survey. **`clone`** names the copy "Copy of …", places it with the source, and answers with an
  empty body, as the old one did.
- **`generateAccessKey`** with an API token replaces that token and answers the new value as a JSON string. With a legacy
  key, Studio cannot replace it yet (the keys move into Studio in Steps 8 and 9), so the bridge forwards the request to
  the old service, which owns the key.
- **`uploadFiles` with the documentation's placeholder key** stores nothing and maps each file to the zero GUID, as the
  old one did.
- **Continuation tokens** of `getSurveyResults` are the bridge's own, opaque, and wrap Studio's cursor. `ResultCount` is
  the number of rows in the page and `ContinuationToken` comes first in the answer, as before. A token that is a decimal
  number is read as an offset (the old paging by offset); any other token the bridge did not make starts again at the
  first page.
- **Whole-survey reads** (`getSurveyResults` without paging, `getSurveyDemoResults`, the export, the column reads) read
  Studio's pages one after another and wait out a `429` within the same answer, as
  [`getSurveyPublicResults`](#getsurveypublicresults) does.
- **Results layouts** are one copy per survey and kind, shared by everyone, as in the old API. In Studio they are the
  survey's shared layout, which a user with no layout of their own sees as the default
  ([viewing results](../user-guide/viewing-results.md#your-layout-is-saved)). Who may see what in public results is the
  survey's list of private questions: the permission actions read and write that list.

## What is forwarded

Every path the bridge has no route for (the table above and the [mapping table](#the-mapping-table)) goes to the old
service, whatever the method. That covers the site's own paths
([Forwarded to the old service](../architecture/legacy-api-usage.md#forwarded-to-the-old-service)) and unknown paths, so `post/page-number` and the old start page answer exactly as the old service does.

- **Sent on:** the method, the path and query as received (byte for byte), the body unchanged and streamed (never parsed
  or size limited by the bridge), and the headers in their order and letter case, except the hop-by-hop ones
  (`Connection` and the headers it names, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `Proxy-Connection`,
  `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`). `Host` becomes the old service's host, and `Expect` is dropped (the
  bridge already answered `100 Continue`).
- **`X-Forwarded-For`:** the incoming value, then the caller's connection address, as any proxy appends it.
- **Answered:** the status, headers (but the same hop-by-hop ones) and body as the old service sent them, streamed.
- **Refused:** a request with a transfer coding other than `chunked`, or with a malformed target (`*`, `http://`), gets
  an empty `400` and is not forwarded. If the old service cannot be reached, or sends nothing for two minutes, the
  caller gets an empty `500` (the old API never answered `502`).

## Settings

The bridge reads environment variables. A wrong value stops it at start with every problem listed. The
[image](../operations.md#running-the-bridge) sets `BRIDGE_HOST` and `BRIDGE_PORT`.

| Variable                   | Default     | Meaning                                                                                                                                                                                                                                           |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BRIDGE_STUDIO_URL`        | (required)  | Studio's API base URL, with `/api/v1` (for example `http://studio:3000/api/v1`). `http` or `https`; no query, fragment or credentials                                                                                                             |
| `BRIDGE_LEGACY_URL`        | (required)  | The old service's base URL, for the forwarded paths. Same rules. Use `https:`: the forwarded requests carry the callers' headers, and a plain `http:` hop shows them on the network                                                               |
| `BRIDGE_CACHE_ENTRIES`     | `10000`     | How many surveys the `getSurvey` cache keeps (0 to 10,000,000; 0 turns it off). The cache is bounded by the **number** of entries, not by their size                                                                                              |
| `BRIDGE_PORT`              | `3002`      | The port to listen on (1 to 65,535)                                                                                                                                                                                                               |
| `BRIDGE_HOST`              | `127.0.0.1` | The address to listen on. The image sets `0.0.0.0`                                                                                                                                                                                                |
| `BRIDGE_STUDIO_TIMEOUT_MS` | `10000`     | A call to Studio taking longer, its answer's body included, is answered with an empty `500` (1 to 600,000)                                                                                                                                        |
| `BRIDGE_MAX_UPLOAD_BYTES`  | `11534336`  | The largest `upload` body (1 to 30,000,000): Studio's default file limit of 10 MiB and 1 MiB for the form around it. A larger body is an empty `413`, unread. Raise it with Studio's `LIMIT_MAX_FILE_BYTES`                                       |
| `BRIDGE_FILE_TIMEOUT_MS`   | `120000`    | How long a file's bytes (`image`, `file`, `files?name=`) may take to stream through once Studio has answered (1 to 3,600,000). Studio's headers must still come within `BRIDGE_STUDIO_TIMEOUT_MS`; a file still streaming at the limit is cut off |
| `BRIDGE_TRUST_PROXY`       | none        | Comma-separated IP addresses or CIDR ranges of the reverse proxy in front of the bridge. Empty: the caller is the connection's peer. Set: the caller is the address that proxy's `X-Forwarded-For` names                                          |

There is no setting for the log level (it is `info`) and no health endpoint: an address the bridge answered itself would
differ from the old host, which answers every unknown `GET` with its start page. A probe can use a forwarded path.

## Operator notes

- **Studio's edition.** The bridge needs a Studio server with `APP_EDITION=hosted`: only that edition routes the
  operations it calls. Any other answers them `404`, so the actions answer as for unknown surveys and files.
- **The caller's address.** The bridge sends one address in `X-Forwarded-For` to Studio, the caller's, so Studio's IP
  capture and per-address rate limits work per respondent. Studio takes it only from a trusted peer: Studio's
  `TRUST_PROXY` must list the bridge. And the bridge must know the real caller: behind a reverse proxy, set
  `BRIDGE_TRUST_PROXY` to that proxy, or every respondent looks like the proxy. When the bridge cannot tell the address
  (the connection is already gone), it sends no `X-Forwarded-For`, and Studio counts the call against the bridge's own
  address.
- **`BRIDGE_TRUST_PROXY` is trusted as set.** The trusted proxy's `X-Forwarded-For` is passed on unvalidated, to Studio
  (the resolved address) and to the old service (the whole chain). List only proxies that overwrite or append the header.
- **Use `https:` for `BRIDGE_LEGACY_URL`** (see the table).
- **The cache is bounded by entries, not bytes.** A definition can be large, so size `BRIDGE_CACHE_ENTRIES` for the memory
  you have. It is per bridge instance; several instances each keep their own.
- **Half-closing clients get no answer.** A client that sends its request and then closes its sending side (a
  half-closed connection) is not answered; Node's server closes such a connection. Ordinary clients do not do this.
- **Slow connections.** The bridge cuts a request that has not finished after 5 minutes, so a hung connection can last
  that long.
- **Body limits.** The bridge accepts up to 30,000,000 bytes in an action's body (as the old host did; empty `413`
  above), 4 MiB for `post` and `BRIDGE_MAX_UPLOAD_BYTES` (11,534,336 by default) for `upload` (empty `413` above,
  before the body is read). Studio refuses answers over its own limit (`LIMIT_MAX_RESPONSE_BYTES`, 1 MiB by default) and
  files over `LIMIT_MAX_FILE_BYTES`, so a post between 1 and 4 MiB gets Studio's refusal mapped to the old text, not
  `413`. Keep `BRIDGE_MAX_UPLOAD_BYTES` about 1 MiB above `LIMIT_MAX_FILE_BYTES`.
- **Uploads at once.** The bridge reads at most 8 `upload` requests at a time, each held in memory up to
  `BRIDGE_MAX_UPLOAD_BYTES`; one more is answered with an empty `503` before its body is read, as the old host answered
  when overloaded. A client retries it as any `503`.
- **Slow public results and a proxy in front.** `getSurveyPublicResults` streams a large set slowly: on Studio's `429`
  for a later page the bridge waits up to 120 seconds before the next page, sending nothing meanwhile (see
  [below](#getsurveypublicresults)). A reverse proxy or CDN in front of the bridge needs a read-idle (response) timeout
  above 120 seconds, or it cuts such a stream.
- **File names.** A legacy file name is looked up only when it is one path segment of letters, digits, `.`, `-` and `_`
  (at most 100 characters); any other name is `404` without a lookup, and a segment of more than 1,024 characters is
  `404` as well.
- **Seeds without file storage.** A development or test server seeds the legacy files' bytes only when `FILES_PATH` or
  `FILE_STORE` is set. Without one, the seed has no legacy files and `image`, `file` and `files?name=` answer `404`.

## Differences from the old API

Three differences are on purpose ([ADR 0039](../adr/0039-bridge-public-actions.md), point 1); the others follow from
Studio's rules or from a value the old service's framework wrote that no caller can depend on. A reader of the golden
files finds a `difference` note on each case that records one ([Testing](../testing.md#the-compatibility-suite)).

### On purpose

| Old behaviour                                                                 | The bridge                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `isCompleted` without `clientId` answers the first stored respondent's state  | Answers `no`. A client ID of `.` or `..` also reads `no`                                                                       |
| `getSurveyPublicResults` includes `ClientId` and `IPAddress` without a layout | Never includes them. An answer that is itself named `ClientId` or `IPAddress` is returned as an answer and does not merge rows |
| `post` HTML-encodes the answers before storing them                           | Stores them as sent; reads return what was stored (migrated answers keep their entities)                                       |

### Which responses are counted

- **`getResult`** counts the completed responses, folded by [ADR 0038](../adr/0038-partial-responses.md). The old API
  counted every stored row, merged by client.
- **`getSurveyPublicResults`** returns completed responses only; the old API also returned partial saves.
  `HappendAt` and `InstanceId` are hidden only when the survey's `privateResultQuestions` names them (the old API also
  dropped them when a column layout existed and did not list them).
- **`getSurveyPublicResults` and a saved column layout.** The old API also left out the answers of columns its saved
  results layout marked non-public or hidden. Studio has no such layout: the bridge returns every answer except those of
  the survey's private questions (`privateResultQuestions`), so a column the old layout hid shows. The migration tool
  (hosted Step 9) maps those hidden columns into `privateResultQuestions`.
- **A respondent of a "Limit to one response" survey** who completed and posts again through `post` is stored, with no
  `409`, and the completion marker follows the post. Posts by post ID ignore the publish state and the one-response
  setting, as the old API never refused a post.

### `getSurvey` and `getSurveyAndIsCompleted`

- `getSurvey` answers the definition as JSON, not the stored bytes: no byte-order mark, compact, strict JSON.
- **A survey whose definition was never saved** answers `200 {}`; the old API answered `400` with `Check parameter values.`.
  Studio stores an empty definition for it and the bridge cannot tell it from a saved empty survey. A page that probes
  an unsaved survey gets `{}`.
- `getSurveyAndIsCompleted` embeds Studio's JSON as is. The old API re-serialised the survey: it rewrote date-like
  strings (`.000Z` to `Z`, offsets to the server's local time) and wrote floats as `1.0` or `1E+21`. A caller that
  compares dates in the survey as text sees the original form. A definition that is not a JSON object answers an empty
  `500`, as before (Studio stores objects only).
- Client IDs of 257 to 1,024 characters were accepted by the old storage; Studio refuses them (`no` for the state reads,
  the refusal text for `post`).

### `post`

- **`surveyResult` that is not a JSON object** (not JSON, an array, a number): the old API stored the row, which readers
  skipped, and set the client's marker. The bridge stores nothing, sets no marker and answers the same empty `200`, also
  for an unknown post ID (the old API answered `400` with `Check parameter values.`).
- **Values:** `NaN`, `Infinity`, `undefined` and elisions in the posted JSON are stored as `null`. Numbers with leading
  zeros or in hex form are read differently from the old reader. Strict JSON nested deeper than 64 levels is dropped.
- **Refusals.** The old `400` text was the storage's message, with a request ID and time, and never stable. The bridge
  answers `message` and `code: message` lines: the `PropertyValueTooLarge` text for Studio's `413`, the `InvalidInput`
  text for Studio's `400` and `422` (for example a client ID with `/`, `\`, `#` or `?`). The text names a 64 KB limit; the
  real limit is Studio's response size limit, which may differ. The old API had already stored the response when only
  its marker write failed; the bridge stores nothing.
- A body larger than 4 MiB is an empty `413` (above).
- **Studio in read-only mode** (`READ_ONLY=true`) refuses writes with `503`; the bridge answers `post` and `upload` with
  an empty `500` then, as an unexpected Studio status.
- **Validation texts.** The binder reproduces the old texts for the documented examples. Where the old text named the old
  API's own model type (a top-level array, string or number as the body) or was a long multi-line conversion text (an
  object or array given for `postId`), the bridge answers the framework's generic `The input was not valid.`. Not
  reproduced: `$`-metadata properties, hex or octal numbers, `new Date(…)` constructors, number formats in conversion
  texts beyond plain integers and floats, and charsets other than UTF-8 (the body is read as UTF-8; a byte-order mark is
  ignored). A body that breaks inside a value gives the error recovery the old reader had, emulated from its design.
- Trace IDs in error bodies are new for each answer.

### `upload`

- Studio refuses an empty file (`415`; the old API stored it) and a file over `LIMIT_MAX_FILE_BYTES` (empty `413`; the old
  API had only the host's 30,000,000-byte limit). The bridge's own limit, `BRIDGE_MAX_UPLOAD_BYTES`, refuses a larger
  body with an empty `413` before it is read: with the defaults, an upload of about 10 to 28.6 MB, which the old host
  took, now gets `413`.
- More than 8 uploads at once: the next one gets an empty `503` (see [Operator notes](#operator-notes)).
- **The extension** of the uploaded name is kept only when it has letters, digits, `_` and `-`; any other extension is
  answered without one.
- A malformed multipart body answers an empty `500`.
- The answer is `dxsimage:` or `dxsfile:` followed by the Studio file ID and the extension. The bridge also reads a
  Studio file name with or without the prefix (the old API failed with `500` on the prefix).

### `getResult`

- Question names are matched exactly; the old API also matched the lower-case name and the stored row's own properties,
  such as its type and its own submission time.
- A top-level integer and an array element of the same value are merged; the old API kept them apart as two integer types.
- An array element `["k","v"]` is read as a pair `[k, v]` (Studio cannot tell it from an object's property). The old API
  walked it as two values.
- **Order:** Studio's first-seen order; the old API put the newest row first.
- Dates nested inside a pair use the invariant date text, and date strings with an offset are written `+00:00`: the
  server's time zone is taken as UTC, and Microsoft-style `/Date(…)/` strings are not converted.
- A question name Studio cannot take (more than 256 characters, `.` or `..`) answers zero answers with the survey's
  totals, so a real question with such a name is reported without answers.
- A question value nested more than about 1,500 levels fails to parse and answers an empty `500`; the old reader stopped
  at 64.

### `getSurveyPublicResults`

- **`from` and `till`** accept `yyyy-M-d`, `yyyy/M/d` and `M/d/yyyy`, with an optional `H:mm[:ss[.f…]]` after `T` or
  spaces, and `Z` or `±HH[[:]mm]`. The other forms the old parser accepted (month names, two-digit years) count as
  malformed, and no bound is applied. A date without an offset is UTC. Studio's bound is the first save of a folded
  response.
- Values keep Studio's number text. Studio stores parsed JSON, so `1.0` normally reaches the bridge as `1`; the
  formatter keeps `1.0` whenever Studio sends it.
- **A Studio failure before the stream starts** answers an empty `500`; the old private actions answered an empty `400`.
- **Slow streaming of very large sets.** The bridge reads Studio's pages (1,000 responses) one request each, and
  Studio limits public operations per address (`PUBLIC_RATE_LIMIT`, 60 a minute by default). On a `429` for a later page
  the bridge waits for `Retry-After` (seconds or an HTTP date; 60 seconds when absent or neither, at least 1 and at most
  120 seconds a wait) and goes on while the caller
  is connected. A very large set therefore streams slowly: about 60,000 responses a minute per caller by default. A `429`
  on the first page is passed to the caller, as for every action.

### `image`, `file` and `files?name=`

- **`file`** answers `application/octet-stream` as an attachment, as the old API did. [ADR 0039](../adr/0039-bridge-public-actions.md)
  first said it would answer the stored type; the exactness rule won. **`image`** serves the image with Studio's content
  type (for a Studio upload, detected from the bytes) and passes on `X-Content-Type-Options`, `Content-Security-Policy`
  and `Cross-Origin-Resource-Policy`, which matters for SVG on the API host; the old API sent none of these.
- Only names that match the legacy file-name rule are looked up. Other invalid names (a backslash, a space, more than 100
  characters) answer `404` without a lookup, where the old API might have answered `500`. For `files?name=`, a name with
  a colon is an empty `400`, as an old storage error was.
- **Trailing padding.** Files stored by the old service keep any padding they have; new uploads have none.

### Studio's rules

- **Rate limits.** Studio limits public operations per address, and a `429` from Studio goes to the caller with an empty
  body; the old API never answered `429`. The bridge sends the caller's address (above), so the limits apply per
  respondent. Studio's limits and the settings that change them are in the
  [public endpoints guide](public-endpoints.md#rate-limits).
- **Limits** (`LIMIT_MAX_RESPONSE_BYTES`, `LIMIT_MAX_FILE_BYTES`) apply as for Studio's own run page.
- **No idempotency key.** A repeated `post` stores a second response, as the old API did.

## Differences in the access-key actions

The same rule as above: exact wherever a caller can depend on it, and every difference listed here
([ADR 0040](../adr/0040-bridge-access-key-actions.md), point 1 and its consequences). The golden files of these actions
carry a `difference` note on each case that records one. Answers also differ in trace IDs, whitespace and the other
incidental bytes listed at the top, and not otherwise.

### Access-key actions: on purpose

| Old behaviour                                                                                      | The bridge                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The bad-key text repeats the key unencoded as `text/html`                                          | The same text with the key HTML-encoded (the old answer let a crafted key inject markup into the page)                                |
| The empty `401` carries a `Location` to the site's sign-in page, with the key in it                | An empty `401` without `Location` (the key leaked into redirects and logs; the sign-in page goes at the cutover)                      |
| Any member of a project may change its surveys; the site's administrators may change any survey    | Studio's permissions: the owner, a project admin, or the survey's creator. `archive`, `restore` and `delete` need the same            |
| `changeOrganization` moves a survey to any ID                                                      | To the caller's personal space (their own ID) or to a project the caller may move it to; any other ID gets the "Access denied" answer |
| The CSV export never quotes a cell, so a comma in an answer splits it                              | Quotes a cell that holds a comma, a quote or a line break; every other cell is as the old export wrote it                             |
| `setGenerationJSONType` stores a setting                                                           | Checks the key and stores nothing (nothing in the API reads it back)                                                                  |
| `changeJson` and `changeTheme` drop the survey's card image; `uploadFiles` keeps a card image name | No card images; every upload gets a new name (Studio has no card images, and any key could overwrite another survey's card)           |

### Access-key actions: smaller differences

**Keys**

- A key with a trailing space or any character outside visible ASCII gets the bad-key answer.
- For the actions that answer an empty `401`, a wrong or revoked key sent with an unreadable or invalid body answers that
  body's empty `400`, not the `401`: Studio checks a present key after the bridge has validated the body
  ([A bad key](#a-bad-key)). A missing key still answers `401` first.
- `generateAccessKey`, `getSurveyDemoResults`, `uploadFiles` and `PUT clone` take the key from a form field or the query,
  as before. A key in the body of a `GET` request is not read. `exportSurveyResults` takes it from the query
  only, as before.
- `generateAccessKey`'s answer with a new API token carries `Cache-Control: no-store`, so no cache keeps the token. The
  old answer had no such header.

**Survey records**

- A survey record's `IsPublished` is never `null` (the old one was `null` until the survey was published or unpublished
  once), and `CreatorId` is the real creator (the old one was all zeros after `create`).
- `create` without a name gets Studio's name, "New Survey N" (the old one stored no name, so `Name` was `null`).
  `CreatedAt` is UTC (the old one used the server's local time).
- `getSurveyInfo`: `Json` is `"{}"` for a survey made by `create` (the old one answered `null`); a survey the caller may
  not read answers an empty `400` (the old one, an empty `500`), because Studio does not tell it from an unknown one.
  `Json` is Studio's stored definition as compact, strict JSON, not the stored text byte for byte.
- `publishVersion` and `changeVersionTitle` need the right to change the survey. A version of another user's survey
  answers an empty `400` (the old one: the "publish the survey version" text), because Studio does not reveal another
  user's survey. `publishVersion` stores nothing new and `changeVersionTitle` records an audit entry, as in the old API.
- `Theme` is Studio's stored theme written again (whitespace and the order of keys inside the string may differ); an empty
  theme `{}` reads `null`.
- An unreadable form body binds its fields as missing (the old one probably answered an empty `400`).
- A `changeJson` whose `Json` is not a JSON object answers an empty `400` (the old one stored any text). A theme that is not
  a JSON object answers an empty `400` as well.
- The bare `private/Surveys` path answers an empty `500` from the bridge itself, as the old service did.

**Content**

- Studio's size limit on a definition, a theme or an upload answers an empty `400`. A layout or theme of any size is
  saved (the old one failed above about 32,000 characters and saved nothing).
- Definitions are stored as JSON, so `1.0` comes back as `1`, and comments and unquoted keys are dropped, as for
  `getSurvey` in the public actions.
- Upload parts without a file name are skipped. A multi-file upload that fails part-way has stored the earlier files, as
  the old one did. A stored file's name is a new GUID, as before.

**Responses and the export**

- **One kind of continuation token.** A decimal token from the old paging by offset is read as an offset; the old
  storage's own tokens start again at the first page.
- **Order.** Rows come oldest first (Studio's order). The old order was the storage's own, random by row key.
  `getSurveyDemoResults` returns the oldest 1,000 (the old one, the first 1,000 in storage order).
- **Runs.** Responses are folded into runs ([ADR 0038](../adr/0038-partial-responses.md)): the saves of one client until
  it completes are one response, and `InstanceId` is the run's id. The old API merged every row of a client, the last
  one winning. Deleting by the id of any save in a run deletes the whole run.
- **Completion state.** Deleting a response clears the respondent's completion state only when it was their latest run
  (the old one cleared it whatever the order). `deleteAllResults` also deletes the respondents' uploaded files.
- **Results with a broken layout.** `getSurveyResults` and `getSurveyDemoResults` do not fail on a saved column layout
  that cannot be read (the old ones answered an empty `400`); the CSV export does, with an empty `400`.
- **The CSV.** Lines end with CRLF; the order of columns that share a place is stable (the old sort was not); columns and
  titles come from the survey's current definition, not a published snapshot; a cell that starts with `=`, `+`, `-` or
  `@` is written as it is, as the old export did, so open the file as data and not as a formula sheet.
- **The JSON export** hides the private questions (with their comment keys) and keeps `ClientId` and `IPAddress`. The old
  one filtered columns only when a saved column layout existed.

**Results layouts**

- **Permissions are the survey's private questions.** With private questions, every other element reads
  `isPublic: true`; `isPublic` counts only when it is exactly `false`. `setResultPermissions` with a value that is not a
  list answers an empty `400` (the old one stored it, which broke later reads). An empty value changes nothing, as before.
- **With no private question,** the stored layout text comes back as it was saved and the public reads filter by its own
  `isPublic` (an element without one: empty `400`), as before.
- Combined reads leave dates as stored (the old one rewrote them in its server's time zone).
- `getResultPublicColumns` never has `ClientId`, `IPAddress` or a private question's columns.
- The language of the column titles is read from the first `Accept-Language` entry by pattern, not from the old
  culture list.
- A form-or-JSON body with trailing content, or a field repeated in another letter case, answers an empty `400`.
- Saving a layout does not move the survey up `getActive` (the old one did).
