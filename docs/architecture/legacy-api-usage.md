# Legacy API usage (`api.surveyjs.io` My Surveys)

Status: 2026-11-18 · usage measured (the old service's monitoring, 30 days; its HTTP logs, first days) · the endpoints are all
served by the bridge ([ADR 0035](../adr/0035-legacy-api-bridge.md))

This page lists the endpoints of `api.surveyjs.io`, says how their use is measured, and what the measurement means for
the bridge. It is the evidence for
[plan-hosted.md › Step 1](../../plan-hosted.md#step-1-decisions-and-evidence-target-stores-legacy-traffic-mapping)
(H17).

**What the usage decides.** Since [ADR 0035](../adr/0035-legacy-api-bridge.md) (2026-11-17) a separate service, the
bridge, answers every action of the old API exactly as it does today, through Studio's public API; nothing answers
`410`. So the usage no longer decides which endpoints are kept. It decides:

- **the build order** of the bridge (Steps 5 and 6): most used first;
- **which actions need a recording made on purpose** for their golden files, because production never calls them;
- **the load** the bridge and Studio take over in Step 7;
- **whom the SurveyJS team contacts** before the cutover: the few steady integrators of the private API, and the
  scheduled job behind most of the traffic.

The first plan, endpoints kept or answered `410` by usage, is recorded in [ADR 0034](../adr/0034-legacy-api-scope.md),
superseded by ADR 0035 for its decisions.

**Privacy.** The repository is public, so rule 6 of
[plan-hosted.md › Rules that apply to every step](../../plan-hosted.md#rules-that-apply-to-every-step) applies in full.
This page holds **shares** (per cent of requests) and **client types** only. It never holds request or client counts,
IP addresses, access keys, the user agents or origins of named integrators, or customer names. The raw logs, the
counts and the working files stay in the private location agreed with the SurveyJS team. A change to this page that
rests on them names the file there, not its content.

**Sources.** The actions and their routes come from the old API's code, checked 2026-11-18; its structure is described
in the legacy documentation (private location). Their behaviour comes from
[legacy-data-layout.md](legacy-data-layout.md) (§3, §4, §5.1, §7),
[idea.md › 2.8](../../idea.md#28-current-api-for-reference), the [smoke test](../operations/smoke-test.md) and the
SurveyJS Form Library documentation.

## Endpoints

The old API mounts its public handlers at both `public/Survey` and `public/v1/Survey`, and its private handlers at both
`private/Surveys` and `private/v1/Surveys` ([legacy-data-layout.md §7](legacy-data-layout.md#7-how-apisurveyjsio-reads-results-and-inline-files)).
Each row covers both prefixes; the measurement reports the `v1` part beside the total, since the Form Library v1.x
service calls the `v1` prefix. Paths are matched without regard to letter case, with or without a trailing slash, as
the old API routes them. Many actions also take their survey id as a path segment (`{id}`) as well as a parameter.

**The Bridge column** names the step that builds the action. _Recorded_: its golden files come from production
traffic. _Recorded on purpose_: production never called it in the measured period, so the SurveyJS team's test account
makes the recording. _Forwarded_: the bridge passes the request unchanged to the old service, which keeps it.

### Public reads

| Path                                    | What it does                                                                                                | Caller                                                                  | Bridge                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET public/Survey/getSurvey?surveyId=` | The survey JSON. No publish check; `400` when none is stored                                                | Form Library v1.x (`surveyId`); pages and servers that call it directly | Step 5, first; recorded; cached with `ETag` revalidation                         |
| `GET …/getSurveyAndIsCompleted`         | `{ survey, isCompleted }` for `surveyId` and `clientId`                                                     | Form Library v1.x (`surveyId` with a client ID)                         | Step 5. **Fails today; made to work** (ADR 0035), tested from its documented use |
| `GET …/getResult?resultId=&name=`       | Answer counts of one question: `{ AnswersCount, QuestionResult, FirstResultAt, LastResultAt, ResultCount }` | Form Library v1.x service; direct callers                               | Step 5; recorded                                                                 |
| `GET …/isCompleted?resultId=&clientId=` | The string `no`, `partial` or `completed`                                                                   | Form Library v1.x service; direct callers                               | Step 5; recorded                                                                 |
| `GET …/image?filePath=`                 | Meant to serve a respondent image (`dxsimage:` answer)                                                      | Pages that show `dxsimage:` values                                      | Step 5. **Fails today (layout gap 14); made to work**: the image's bytes         |
| `GET …/file?filePath=`                  | Serves a respondent file (`dxsfile:` answer)                                                                | As `image`                                                              | Step 5; recorded                                                                 |

`…` stands for `public/Survey` or `public/v1/Survey`.

### Public writes

| Path            | What it does                                                                                         | Caller                                                                                                                                       | Bridge                                    |
| --------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `POST …/post`   | Stores a response: `{ postId, surveyResult, clientId?, isPartialCompleted? }`. No publish check      | Form Library v1.x (`surveyPostId`, partial saves); v2 and later pages that follow the documentation's `onCompleting` example; direct callers | Step 5; recorded; `post/` as well         |
| `POST …/upload` | Stores a respondent file (multipart `file`, `postId`); answers `dxsimage:{name}` or `dxsfile:{name}` | Form Library v1.x (file questions with the service)                                                                                          | Step 5; recorded on purpose if not caught |

**`post/page-number` is not an action of the old API.** idea §2.8 and the Form Library documentation's
`onCurrentPageChanging` example name it, but the old API has only `post`. A request to it gets `404` today,
and the bridge answers it the same way.

### Unauthenticated reads under `private/Surveys`

| Path                                              | What it does                                                                                                                       | Caller                                                                                                             | Bridge           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `GET private/Surveys/files?name=`                 | An editor image, as `application/octet-stream`. No key                                                                             | Any browser that shows a survey whose JSON holds a legacy image URL: customer pages, the surveyjs.io site, the app | Step 5; recorded |
| `GET private/Surveys/getSurveyPublicResults/{id}` | `{ Data, ResultCount }` when Grant Access is on (`from`, `till`); `InstanceId` nulled, columns limited by the saved layout. No key | Dashboard examples and customer pages; direct callers                                                              | Step 5; recorded |

The other unauthenticated reads of the results layouts (`getIsResultPublic`, `getResultPublicColumns`,
`getPublicResultSummaryState`, `getPublicResultTableState`) are built in Step 6 with the layout actions.

### Access-key actions under `private/Surveys`

All take the `accessKey` query parameter. "Old My Surveys pages" are the surveyjs.io site's own pages, which call these
from the browser with the signed-in user's key ([smoke test › Getting the access key](../operations/smoke-test.md)).
All are built in Step 6, most used first.

| Action                                                                                                                                                                          | What it does                                                                                          | Caller                                                    | Bridge (Step 6)                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `GET getActive` (`ownerId` optional)                                                                                                                                            | The owner's active survey records                                                                     | Old My Surveys pages; server integrations; the smoke test | Recorded                                                |
| `GET getArchive` (`ownerId` optional)                                                                                                                                           | The owner's archived survey records                                                                   | Old My Surveys pages; server integrations                 | Recorded on purpose                                     |
| `GET getSurveyInfo` (`surveyId`)                                                                                                                                                | `{ Info, Json }`, `Json` HTML-encoded                                                                 | Server integrations                                       | Recorded                                                |
| `GET getIsPublished[/{id}]`                                                                                                                                                     | `IsPublished ?? false` and a `publishid`; false after a plain publish                                 | Server integrations                                       | Recorded on purpose; the answer is kept as it is        |
| `GET getHistoryPoint[/{id}]` (`pointId`)                                                                                                                                        | The definition stored with one history point                                                          | Old My Surveys pages (history); the smoke test            | Recorded on purpose                                     |
| `GET getSurveyResults[/{id}]`                                                                                                                                                   | Every response with full access, `{ Data, ResultCount }`; `from`, `till`, `take`, `continuationToken` | Server integrations; the smoke test                       | Recorded                                                |
| `GET getSurveyDemoResults[/{id}]`                                                                                                                                               | The first 1,000 responses in storage order                                                            | The old results page                                      | Recorded; the site stops calling it at the cutover      |
| `GET exportSurveyResults[/{id}]`                                                                                                                                                | CSV, or JSON for any other format                                                                     | Old My Surveys pages; server integrations                 | Recorded                                                |
| `POST create`                                                                                                                                                                   | Creates a survey                                                                                      | Server integrations                                       | Recorded on purpose                                     |
| `DELETE delete[/{id}]`                                                                                                                                                          | Deletes a survey; needs the `admin` role                                                              | Server integrations                                       | Recorded on purpose                                     |
| `PUT changeName[/{id}]`                                                                                                                                                         | Renames a survey                                                                                      | Old My Surveys pages; server integrations                 | Recorded                                                |
| `PUT changeJson`                                                                                                                                                                | Saves the definition (and a history point)                                                            | The old editor (every auto-save); server integrations     | Recorded                                                |
| `PUT changeTheme` (body `ThemeJson`)                                                                                                                                            | Saves the theme                                                                                       | The old editor                                            | Recorded                                                |
| `PUT publish[/{id}]`, `PUT unPublish[/{id}]`                                                                                                                                    | Sets the published flag                                                                               | Old My Surveys pages; server integrations                 | Recorded                                                |
| `PUT archive[/{id}]`, `PUT restore[/{id}]`                                                                                                                                      | Archives a survey, and back                                                                           | Old My Surveys pages                                      | Recorded; `restore` on purpose                          |
| `POST clone`, `PUT clone[/{id}]`                                                                                                                                                | Copies a survey                                                                                       | Old My Surveys pages                                      | Recorded on purpose                                     |
| `PUT changeOrganization[/{id}]`                                                                                                                                                 | Moves a survey to a project                                                                           | Server integrations                                       | Recorded on purpose                                     |
| `POST uploadFiles`                                                                                                                                                              | Uploads an editor image                                                                               | The old editor                                            | Recorded                                                |
| `DELETE deleteResult` (`postId`, `instanceId`)                                                                                                                                  | Deletes one response and keeps an audit copy                                                          | Old results page; server integrations                     | Recorded                                                |
| `DELETE deleteAllResults[/{id}]`                                                                                                                                                | Deletes every response of a survey                                                                    | Old results page; server integrations                     | Recorded                                                |
| `PUT setUseCookies[/{id}]`                                                                                                                                                      | Sets "Limit to one response"                                                                          | Server integrations                                       | Recorded on purpose                                     |
| `PUT makeResultPublic[/{id}]`, `PUT storeIPAddressInResult[/{id}]`                                                                                                              | Grant Access and "Save Respondent IP"                                                                 | Old My Surveys pages                                      | Recorded                                                |
| Results layouts: `getResultColumns`, `setResultColumns`, `getResultSummaryState`, `setResultSummaryState`, `getResultTableState`, `setResultTableState`, `setResultPermissions` | The saved Summary and Table layouts, and who may see results                                          | Old results page                                          | Recorded where seen, else on purpose                    |
| `PUT setGenerationJSONType`                                                                                                                                                     | A setting Studio has no concept of; stored as given so the old answer round-trips (ADR 0035, point 4) | Unknown                                                   | Recorded on purpose                                     |
| `PUT publishVersion`                                                                                                                                                            | Hidden: sets `publishid` and a published snapshot                                                     | Unknown                                                   | Recorded on purpose; stored as given                    |
| `PUT changeVersionTitle`                                                                                                                                                        | Hidden: builds an event and discards it                                                               | Unknown                                                   | Recorded on purpose; changes nothing, as today          |
| `GET generateAccessKey`                                                                                                                                                         | Makes a new access key; the old one stops working                                                     | Old account pages                                         | Recorded on purpose; replaces the key (Step 3's tokens) |

### Forwarded to the old service

These serve the surveyjs.io site's demos and jobs, not My Surveys (SurveyJS team, 2026-11-13). The bridge forwards them
unchanged to the old service, which keeps their data in Azure (ADR 0035, point 5):

- under `private/Surveys`: `getTempFile`, `tempFiles` (GET, POST, DELETE), `uploadTempFiles`, `deleteTempFile`, `nps`,
  `getSurveyNPCResults`, `getSurveyNPSResults`, `getSurveyPublicDemoResults[/{id}]`;
- the site's scheduled jobs (their paths are in the legacy documentation).

## Results (2026-11-13)

From the old service's monitoring, with
[the usage queries](../operations/legacy-api-usage-queries.md), over the 30 days to 2026-11-13. The counts are in the
private location; this section holds shares and plain words only.

**How far to trust it.**

- **Shares hold; totals do not.** Adaptive sampling keeps a small part of the rows, and the data has gaps (days that stop
  part-way, and two missing stretches; about two-thirds of the days have data; the cause is not known, and there is
  no daily cap). Shares between endpoints are sound; absolute rates come from the complete days only.
- **Callers are lower bounds.** A key with few requests can be sampled away. "One caller" means one key makes nearly
  all of an endpoint's requests.
- **No client types.** The monitoring has no user agent or referer. The one hint it gives is the `OPTIONS`
  preflight: an endpoint with about one preflight per request is called from web pages on other origins. The client
  types come from the HTTP logs ([below](#client-types-preview-2026-11-17)).
- **Shares** are of all requests to `/public/` and `/private/` paths, without preflights. Scanner probes (`/.env`,
  `*.php`) are left out.

### The endpoints, measured

| Endpoint                                                                                           | Share   | What the data says                                                                                | For the bridge                                   |
| -------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `public/Survey/getSurvey`                                                                          | 84.7 %  | Every day; nearly all succeed; only a small part on the `v1` prefix                               | Step 5, first; the cache takes most of it        |
| `…/getSurveyAndIsCompleted`                                                                        | < 0.1 % | Most days, but **no request succeeds**                                                            | Step 5; made to work                             |
| `…/getResult`                                                                                      | < 0.1 % | Most days; most succeed                                                                           | Step 5                                           |
| `…/isCompleted`                                                                                    | < 0.1 % | Most days; about two-thirds succeed                                                               | Step 5; the failures are recorded too            |
| `…/image`                                                                                          | < 0.1 % | Some days; **no request succeeds**, as layout gap 14 expected                                     | Step 5; made to work                             |
| `…/file`                                                                                           | 0.1 %   | Every day, nearly all on `v1`; most succeed (whether with the file's bytes is not in the data)    | Step 5                                           |
| `…/post`                                                                                           | 0.9 %   | Every day, nearly all on `v1`; most succeed; called from web pages (preflights)                   | Step 5, early                                    |
| `…/post/page-number`                                                                               | none    | Not seen: not an action of the old API                                                            | `404`, as today                                  |
| `…/upload`                                                                                         | < 0.1 % | One day                                                                                           | Step 5                                           |
| `private/Surveys/files?name=`                                                                      | 2.8 %   | Every day, never with a key; nearly all succeed                                                   | Step 5, early                                    |
| `private/Surveys/getSurveyPublicResults/{id}`                                                      | < 0.1 % | A few days                                                                                        | Step 5                                           |
| `getActive`                                                                                        | < 0.1 % | Every day; a few callers; no preflights (servers)                                                 | Step 6, early                                    |
| `getArchive`                                                                                       | none    | Not seen                                                                                          | Step 6; recorded on purpose                      |
| `getSurveyInfo`                                                                                    | 0.2 %   | Every day; a few steady callers; no preflights (servers)                                          | Step 6, early                                    |
| `getIsPublished`, `getHistoryPoint`                                                                | none    | Not seen                                                                                          | Step 6; recorded on purpose                      |
| `getSurveyResults/{id}`                                                                            | 0.4 %   | Most days; **one caller** makes nearly all, from a web page on another origin (preflights)        | Step 6, early                                    |
| `getSurveyDemoResults`                                                                             | 0.2 %   | Most days; the site's own My Surveys section (HTTP logs and SurveyJS team, 2026-11-17)            | Step 6; the site stops calling it at the cutover |
| `exportSurveyResults`                                                                              | 0.1 %   | Most days; a few callers                                                                          | Step 6, early                                    |
| `changeJson`                                                                                       | 0.3 %   | Many callers, each on a few days, from web pages: the pattern of the old editor's auto-save       | Step 6                                           |
| `changeTheme`, `changeName`                                                                        | < 0.1 % | Many callers, from web pages: the old editor                                                      | Step 6                                           |
| `publish`, `unpublish`                                                                             | < 0.1 % | A few callers on a few days                                                                       | Step 6                                           |
| `deleteResult`                                                                                     | 0.1 %   | Some days; **one caller** makes nearly all, from a web page on another origin                     | Step 6                                           |
| `deleteAllResults`                                                                                 | < 0.1 % | One to a few days                                                                                 | Step 6                                           |
| `deleteSurveyInstance`                                                                             | < 0.1 % | One to a few days                                                                                 | Not an action of the old API: `404`, as today    |
| `uploadFiles`                                                                                      | < 0.1 % | A few days                                                                                        | Step 6                                           |
| `getTempFile`                                                                                      | 10.0 %  | **Every day, never with a key**; about a third fail. The site's demos (SurveyJS team, 2026-11-13) | Forwarded                                        |
| `changeOrganization`, `setUseCookies`, `publishVersion`, `changeVersionTitle`, `generateAccessKey` | none    | Not seen                                                                                          | Step 6; recorded on purpose                      |

The create action was not identified in the logs; the old API names it `create` (`POST`).

### Not in the first inventory

| Endpoint                                                                                                                        | Share   | What the data says                                            | For the bridge                              |
| ------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------- | ------------------------------------------- |
| `uploadTempFiles`                                                                                                               | < 0.1 % | Most days, never with a key                                   | Forwarded: the site's demos                 |
| The site's scheduled jobs                                                                                                       | < 0.1 % | Regular, no key: scheduled jobs of the site                   | Forwarded: the site's jobs                  |
| `private/Surveys/nps`, `nps/data.json`, `getSurveyNpcResults`, `getSurveyPublicDemoResults`                                     | < 0.1 % | Most days, no key                                             | Forwarded: the site's demos                 |
| `archive`, `makeResultPublic`, `storeIpAddressInResult`, `setResultSummaryState`, `setResultTableState`, `setResultPermissions` | < 0.1 % | One or a few callers, from web pages                          | Step 6                                      |
| `removeResults`, `clearResults`, `resetResults`, `deleteSurveyResults` and similar                                              | < 0.1 % | One caller, one day, nothing succeeds: someone guessing names | Not actions of the old API: `404`, as today |

**Calls on the old service's own host name** carried no API path: only its start page, assets and `robots.txt` (health
checks). So moving `api.surveyjs.io` in Step 7 leaves no API caller behind on that name, and the bridge can use that
name to reach the old service for the forwarded paths.

### Client types (preview, 2026-11-17)

From the old service's HTTP logs (queries 5 to 5d), over their first days, from 2026-11-13. These logs are not sampled.
A run over two weeks, from about 2026-11-27, checks the picture; it changes the build order at most. Shares and plain
words only; the counts, addresses and survey ids are in the private location.

- **`getSurvey` is mostly one server-side caller.** About nine in ten of its requests carry no user agent and no
  referer. Nearly all of those come from **one scheduled job** that reads the same fixed set of surveys again every few
  minutes, around the clock. It is not the surveyjs.io site. So one caller makes most of the host's traffic.
- **The Form Library on web pages** makes under a tenth of the `getSurvey` requests, from many sites; crawlers and
  monitors a little; surveyjs.io pages very little.
- **`changeJson`:** only one outside web page, on one day. No steady outside caller so far.
- **`getSurveyDemoResults`:** a steady server-side caller; the SurveyJS team confirms it is the site's own My Surveys
  section.
- **`post/page-number`:** not seen in the unsampled logs either.
- **Trailing slashes are common:** `post/` is called far more often than `post`, and `getSurvey/` and `getActive/`
  appear too. The bridge accepts both forms.
- **The old service's own host name** carries no API call here either.

### What the data changes

1. **A tenth of the host's traffic is not My Surveys:** `getTempFile`, `uploadTempFiles` and the `nps` endpoints
   serve the site's demos (SurveyJS team, 2026-11-13), and the site's scheduled jobs run there
   too. The bridge forwards them to the old service, so Step 7 is one DNS change of the whole host.
2. **Most of the host's traffic is one integration** ([preview](#client-types-preview-2026-11-17)): a scheduled job
   that re-reads a fixed set of surveys every few minutes. It sends no access key and no user agent, so a general
   announcement may not reach it: the SurveyJS team found the surveys' owner (2026-11-18) and tells them before the
   cutover. The bridge's `getSurvey` cache and Step 7's sizing take its steady rate.
3. **Two public endpoints do not work today** (`getSurveyAndIsCompleted`, `image`) and one works only partly
   (`isCompleted`). The bridge makes the first two work (ADR 0035) and keeps `isCompleted` as it answers today.
4. **The private API has few real integrators.** Most private actions have one or a few steady callers; the rest of
   the private traffic has the pattern of the old surveyjs.io pages, which go at the cutover. The SurveyJS team can
   contact the integrators by access key, with the migration guide (Step 6).

## Measuring the use

The SurveyJS team supplies the use of `api.surveyjs.io`, as access logs or per-endpoint statistics with the same split;
the ready-made queries for the old service's monitoring and HTTP logs are in
[Queries for the legacy API usage](../operations/legacy-api-usage-queries.md). All processing runs in the private
location. Only the percentage tables come back to this page.

**Fields needed per request.**

| Field                  | Use                                                          | Handling                                                                                    |
| ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Time                   | Window and daily pattern                                     | As logged                                                                                   |
| Method                 | Read or write group                                          | As logged                                                                                   |
| Path                   | The endpoint and the prefix (`v1` or not)                    | Lower-cased; ids in the path replaced by `{id}`; query values dropped, parameter names kept |
| Status                 | Share of requests that succeed; `image` and `file` behaviour | As logged                                                                                   |
| Response size          | Whether `image` and `file` return bytes                      | As logged                                                                                   |
| User agent             | Browser, server library or bot                               | Reduced to a client type in the first pass                                                  |
| `Origin` and `Referer` | Browser page on surveyjs.io, on the app, or elsewhere        | Reduced to the origin, then to a client type                                                |
| Client hash            | Distinct clients per endpoint                                | A salted hash of the IP address; the salt is discarded after the run                        |
| Access-key hash        | Distinct integrators per private endpoint                    | A salted hash of the `accessKey` value, made in the first pass                              |

**The access key is in the query string** of every private request, so the logs hold live keys. The first pass replaces
each key with its hash and drops every other query value before anything is stored or shared. No key reaches a report,
a ticket or this repository.

**Client types.** Each request gets one:

| Client type                    | How it is recognised                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Form Library page, `v1` prefix | A browser user agent, an `Origin` or `Referer` outside surveyjs.io, a `public/v1/Survey` path                      |
| Browser page, other path       | As above on `public/Survey` or `private/Surveys`: own `fetch` calls, for example from the documentation's examples |
| surveyjs.io site page          | `Origin` or `Referer` `https://surveyjs.io`: the old My Surveys pages, the old run and results pages               |
| The app's pages                | `Referer` of the app's own host: legacy image URLs inside survey JSON                                              |
| Server-side caller             | No `Origin` and no `Referer`, and a user agent of an HTTP library or none                                          |
| Crawler or monitor             | A known bot or uptime-check user agent                                                                             |
| SurveyJS team tools            | The smoke test (`pnpm smoke:legacy`) and later the golden-file recording, run with the test account's key          |
| Unknown                        | Anything else                                                                                                      |

The Form Library version is not in the request. The `v1` prefix and the request shape of the built-in service point to
v1.x. If a finer split is needed, a small sample of referring pages is checked by hand in the private location, and
only the resulting shares come back. Image requests (`files?name=`) often carry no `Origin`; their `Referer` and user
agent decide.

**What comes back to this page.**

- Per endpoint: its share of all requests, the `v1` part, and its share answered with `2xx`.
- Per endpoint: the share of its requests from each client type.
- Per private endpoint: its callers in plain words (one, a few, many), never a number.
- Shares are rounded: under 0.1 % reads "< 0.1 %", and other values keep one decimal. A share that would let a reader
  work out a small count is widened to a band (for example "< 1 %").

The team's own tools are left out of the shares. Crawlers are reported but do not count as use.

## Decision

[ADR 0035](../adr/0035-legacy-api-bridge.md) (accepted 2026-11-17): a bridge in front of Studio's public API answers
every action of the old API exactly, makes `getSurveyAndIsCompleted` and `image` work, does not accept the cookie
sign-in, and forwards the site's demos and jobs to the old service. It supersedes the decisions of
[ADR 0034](../adr/0034-legacy-api-scope.md), whose evidence (shares, callers, days of use) this page keeps and which
now sets the bridge's build order.
