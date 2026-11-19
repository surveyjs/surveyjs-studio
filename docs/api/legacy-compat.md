# The old API's public actions: the bridge

The bridge answers the public and unauthenticated actions of the old API (`api.surveyjs.io`) through Studio's public
API, so pages and servers built for the old service keep working. Every other path goes to the old service unchanged.
The decisions are in [ADR 0035](../adr/0035-legacy-api-bridge.md) (the bridge) and
[ADR 0039](../adr/0039-bridge-public-actions.md) (how exact it is); the usage that sets the build order is in
[Legacy API usage](../architecture/legacy-api-usage.md). The checks are in
[Testing](../testing.md#the-compatibility-suite), how to run it in
[Operations](../operations.md#running-the-bridge), and a walk-through in [the Step 5 demo](../demo/hosted-05.md).

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

The operations the bridge calls are in the [public endpoints guide](public-endpoints.md#operations-for-the-bridge). The
bridge adds no store and no credentials: it holds only the `getSurvey` cache.

**`getSurvey` cache.** The bridge keeps each survey's definition with Studio's `ETag` and sends every request to Studio
with `If-None-Match`. An edit in Studio shows on the next request, and a survey that did not change costs Studio a `304`.

**Preflights.** An `OPTIONS` request with an `Origin` and an `Access-Control-Request-Method` header, to any path, is
answered by the bridge with `204` and the old policy (any origin, the requested method and headers). Every answer the
bridge makes itself carries `Access-Control-Allow-Origin: *` when the request had an `Origin`. Forwarded answers keep the
old service's own CORS headers.

**Errors.** Studio's `429` goes to the caller as `429` with an empty body. A network failure, a timeout, or a Studio
status the action has no answer for becomes an empty `500`, as the old API's unhandled errors were. Every other Studio
status maps to the old answer for that case (for example `400` with its text for an unknown result ID).

## What is forwarded

Every path the table above does not hold goes to the old service, whatever the method. That covers the site's own paths
([Forwarded to the old service](../architecture/legacy-api-usage.md#forwarded-to-the-old-service)), the actions of
[Step 6](../architecture/legacy-api-usage.md#access-key-actions-under-privatesurveys) until they are built, and unknown
paths, so `post/page-number` and the old start page answer exactly as the old service does.

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
| `BRIDGE_FILE_TIMEOUT_MS`   | `120000`    | How long a file's bytes (`image`, `file`, `files?name=`) may take to stream through once Studio has answered (1 to 3,600,000). Studio's headers must still come within `BRIDGE_STUDIO_TIMEOUT_MS`; a file still streaming at the limit is cut off |
| `BRIDGE_TRUST_PROXY`       | none        | Comma-separated IP addresses or CIDR ranges of the reverse proxy in front of the bridge. Empty: the caller is the connection's peer. Set: the caller is the address that proxy's `X-Forwarded-For` names                                          |

There is no setting for the log level (it is `info`) and no health endpoint: an address the bridge answered itself would
differ from the old host, which answers every unknown `GET` with its start page. A probe can use a forwarded path.

## Operator notes

- **The caller's address.** The bridge sends one address in `X-Forwarded-For` to Studio, the caller's, so Studio's IP
  capture and per-address rate limits work per respondent. Studio takes it only from a trusted peer: Studio's
  `TRUST_PROXY` must list the bridge. And the bridge must know the real caller: behind a reverse proxy, set
  `BRIDGE_TRUST_PROXY` to that proxy, or every respondent looks like the proxy.
- **`BRIDGE_TRUST_PROXY` is trusted as set.** The trusted proxy's `X-Forwarded-For` is passed on unvalidated, to Studio
  (the resolved address) and to the old service (the whole chain). List only proxies that overwrite or append the header.
- **Use `https:` for `BRIDGE_LEGACY_URL`** (see the table).
- **The cache is bounded by entries, not bytes.** A definition can be large, so size `BRIDGE_CACHE_ENTRIES` for the memory
  you have. It is per bridge instance; several instances each keep their own.
- **Half-closing clients get no answer.** A client that sends its request and then closes its sending side (a
  half-closed connection) is not answered; Node's server closes such a connection. Ordinary clients do not do this.
- **Slow connections.** The bridge cuts a request that has not finished after 5 minutes, so a hung connection can last
  that long.
- **Body limits.** The bridge accepts up to 30,000,000 bytes in any action's body (as the old host did; empty `413`
  above), and 4 MiB for `post` (empty `413` above). Studio refuses answers over its own limit
  (`LIMIT_MAX_RESPONSE_BYTES`, 1 MiB by default) and files over `LIMIT_MAX_FILE_BYTES`, so a post between 1 and 4 MiB gets
  Studio's refusal mapped to the old text, not `413`.
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
- **Validation texts.** The binder reproduces the old texts for the documented examples. Where the old text named the old
  API's own model type (a top-level array, string or number as the body) or was a long multi-line conversion text (an
  object or array given for `postId`), the bridge answers the framework's generic `The input was not valid.`. Not
  reproduced: `$`-metadata properties, hex or octal numbers, `new Date(…)` constructors, number formats in conversion
  texts beyond plain integers and floats, and charsets other than UTF-8 (the body is read as UTF-8; a byte-order mark is
  ignored). A body that breaks inside a value gives the error recovery the old reader had, emulated from its design.
- Trace IDs in error bodies are new for each answer.

### `upload`

- Studio refuses an empty file (`415`; the old API stored it) and a file over `LIMIT_MAX_FILE_BYTES` (empty `413`; the old
  API had only the host's 30,000,000-byte limit).
- **The extension** of the uploaded name is kept only when it has letters, digits, `_` and `-`; any other extension is
  answered without one.
- A malformed multipart body answers an empty `500`.
- The answer is `dxsimage:` or `dxsfile:` followed by the Studio file ID and the extension. The bridge also reads a
  Studio file name with or without the prefix (the old API failed with `500` on the prefix).

### `getResult`

- Question names are matched exactly; the old API also matched the lower-case name and row properties such as `type` and
  `happendat`.
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
  the bridge waits for `Retry-After` (60 seconds when absent, at most 120 seconds a wait) and goes on while the caller
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
