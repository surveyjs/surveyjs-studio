# ADR 0041: Taking over the old API's host, and metrics for Studio and the bridge

Status: Accepted (hosted Step 7, 2026-11-23); points 1, 2 and 7 changed by
[ADR 0042](0042-one-switch-to-the-new-server.md) (2026-11-24): no early switch, both host names move together after
the final migration, and the bridge calls the Studio on its own server from the start. Builds on [ADR 0035](0035-legacy-api-bridge.md) (the bridge),
[ADR 0039](0039-bridge-public-actions.md) and [ADR 0040](0040-bridge-access-key-actions.md) (its actions). Settles
where the bridge runs from the DNS switch on, how its answers are checked against the old service before the switch,
and how Studio and the bridge are monitored.

## Context

Hosted Step 7 moves `api.surveyjs.io` to the bridge while the data is still in the legacy stores
([plan-hosted.md › Step 7](../../plan-hosted.md#step-7-taking-over-apisurveyjsio-traffic)). The plan assumed a
staging environment, a replay of the access logs (writes included) against it, and the bridge "on the same server" as
Studio, unchanged at the cutover. Checked on 2026-11-23:

- **There is no staging copy of the data** (product owner, 2026-10-21; [Operations](../operations.md)). The
  compatibility smoke test runs on production with a test account used for nothing else.
- **The old service's HTTP logs hold no request bodies:** method, path, query string, status and time only. A write
  (`post`, `changeJson`) cannot be replayed from them.
- **Two servers.** Today's `studio.surveyjs.io` runs on the Azure legacy provider, read-write, and has replaced the
  site's My Surveys section. The cutover target (PostgreSQL and S3-compatible files, [ADR 0033](0033-hosted-target-stores.md))
  is a second server, built by the private deployment playbooks, to which `studio.surveyjs.io` moves at the cutover.
- **Nothing collects metrics.** Production is watched through `/healthz`, `/readyz` and the container logs. Self-hosted
  operators get the same and nothing they can point a monitoring system at.
- **Items left for "before Step 7"** by Steps 5 and 6: slow uploads can hold all 8 of the bridge's upload slots; a proxy
  in front of the bridge needs a read-idle timeout above 120 s; uploads that belong to no survey have no per-user cap;
  the golden files are derived, and the recordings from production that are to replace them are not made yet.

## Decision

### 1. The bridge runs on the target server from the switch on

The bridge, its metrics and the `api.surveyjs.io` site are set up on the **cutover target server**, which is built
before Step 7 and is tested empty. Until the cutover the bridge calls today's Studio by its public URL
(`BRIDGE_STUDIO_URL=https://studio.surveyjs.io/api/v1`). At the cutover only that setting changes, to the app on the
same server. `api.surveyjs.io` is switched once, and the cutover does not touch it.

- **Today's server passes the caller's address on.** The bridge sends the caller's address in `X-Forwarded-For`
  ([ADR 0039](0039-bridge-public-actions.md)), and today's server must keep it so that Studio's per-address rate limits
  and IP capture work per caller. Without it every caller of the old API shares one limit. Two changes, both in
  `deploy/hetzner/setup.sh`, applied by running it again on today's server:
  - a new option `--trusted-proxies "IPS"` that writes the web front's `trusted_proxies` for those addresses (the
    target server's public IPv4 and IPv6). Without it the web front replaces the header of an untrusted peer instead of
    appending to it;
  - the app's `TRUST_PROXY` gains the same addresses (`app.env`), and `setup.sh` stops warning about a list that holds
    the subnet and more.
- **`getSurvey`'s cache works across the two servers.** The web front's compression rewrites an `ETag` (`"v"` becomes
  `"v-zstd"`), so it already skips the survey documents. The public definition
  (`/api/v1/public/surveys/*/definition`) is added to that exception; otherwise the bridge's `If-None-Match` never
  matches and every `getSurvey` is a `miss`. A test of the generated configuration holds both paths.
- **Preconditions:** hosted Steps 3–6 merged and deployed on today's Studio (legacy keys as bearer tokens, the new
  public operations, `HOSTED_OPERATIONS`); the bridge image published at the same commit; `setup.sh` run again with
  the two changes above.
- **The target server's set-up stays private** (plan-hosted rule 6): the deployment playbooks run the bridge image at
  the app's tag, a Prometheus server, and a web front with one site for `api.surveyjs.io` and one for a test host name.
  This repository gets the images, the commands, the change to today's `setup.sh`, and a runbook in general terms.

### 2. The switch

- **One DNS record.** Its time-to-live is lowered at least two days before. Switching back restores the old record;
  the bridge holds no data, so nothing is lost either way. One thing does not survive a switch back intact: files
  uploaded through the bridge (`upload`, `uploadFiles`) are in Studio's own file store under Studio's names, which the
  old service cannot serve. Studio still has them and serves them again once the host is switched forward; the
  runbook says so, and a switch back is for emergencies only.
- **Revoking legacy keys (`LEGACY_KEY_REVOKE`)** is turned on in Studio once the switch has held for a day
  ([ADR 0037](0037-access-keys-and-api-tokens.md) planned it for this step). Earlier, a revoked key would still work
  for callers whose resolvers had not yet moved. A switch back turns it off again first; keys revoked meanwhile then
  work again on the old service, and the runbook says so.
- **The test host name** reaches the same bridge before the switch. The replay and the demo use it; it stays after
  the switch for checks that must not depend on DNS.
- **The certificate for `api.surveyjs.io` is issued at the switch** over HTTP (the user's choice, 2026-11-23): the web
  front asks for it once the record points at the server, and the runbook has it retried at once rather than after the
  web front's back-off. Clients that resolve the new address before it is issued get TLS errors for about a minute,
  so the switch is made at a quiet hour. Issuing it beforehand over DNS would need a web-front build with the DNS
  provider's module and a token for the zone.
- **The web front's read-idle timeout** for the bridge's site is above 120 seconds (`getSurveyPublicResults` waits that
  long between pages on Studio's `429`).

### 3. `pnpm legacy:replay`: reads compared on production

A new workspace package, `legacy-replay/`, run from an operator's machine, never in CI with real data.

- **Input:** a sample of the old service's requests in a neutral CSV (`time`, `method`, `path`, `query`, `status`),
  produced by a query kept in the private location. The code knows no monitoring product's column names.
- **What is replayed:** requests whose action is marked `effect: "read"` in the bridge's mapping table, a new field
  that every entry carries (checked by a test; `GET generateAccessKey` is a `write`). An action is a `write` when any
  Studio operation it calls is not a `GET` or when it takes any method other than `GET`, `HEAD` and `OPTIONS`. Only a
  `GET` on a path of plain segments (letters, digits, `_`, `-`, `{`, `}`) is replayed. Forwarded paths are not
  replayed: some of the site's paths may change something on a `GET`, and forwarding passes bytes through unchanged
  (covered by the bridge's forwarding tests and by the demo). Everything else is skipped and counted by reason
  (`write`, `forwarded`, `unknown-method`, `unsafe-path`).
- **Paced under Studio's per-address limits.** Every replayed request reaches Studio from the operator's one address.
  The replay knows which Studio limit each action falls under (from the mapping table's `studio` operations) and
  stays below it (`--public-limit`, `--summary-limit`, `--file-limit`, defaulting to Studio's defaults of 60, 10 and
  600 a minute). A `429` from the bridge is retried once after its `Retry-After`; a second one counts as
  `rate-limited`, a skip reason, not a difference.
- **Keys are replayed as recorded** (the user's choice, 2026-11-23): the keyed reads (`getSurveyResults`, `getActive`,
  `getSurveyInfo`, `exportSurveyResults`) are the riskiest actions. The report never shows a key, only the first 16
  hex digits of its hash (as Studio hashes legacy keys, `hashCredential`).
- **Each request goes to the old service, then the bridge, then the old service again.** When the two old answers
  differ, the data moved between calls (a new response, an edit) and the case counts as `changed`, not as a difference.
  Each case ends `same`, `different`, `changed`, `rate-limited` or `error`; the verdict fails on any `different` or
  `error`, and an action whose cases are mostly `changed` is flagged, since nothing of it was compared.
- **Comparison rules** (one module, unit-tested): status; content type; the headers callers read (ADR 0039 point 1);
  JSON with property names, order and values exact; arrays in order, except those the old service orders by nothing
  (listed in the module, each with its reason); text bodies exact. Ignored: trace ids (`traceId` in problem bodies),
  `Date`, `Server`, platform headers, whitespace between JSON tokens, chunking. Each difference is reported with a path
  into the body.
- **Selection options:** `--actions`, `--since`, `--limit`. A sample of a few thousand requests takes hours at these
  rates, which is acceptable for a gate run once or twice.
- **Output:** an HTML report written to `--out`, which must be outside the repository (the command refuses a path
  inside it); the console prints only counts per action and the verdict, which may be quoted in a PR.
- **Writes: `pnpm legacy:replay smoke`.** A fixed sequence of the write actions (create, `changeJson`, `changeName`,
  `publish`, `post`, `upload`, `getSurveyResults`, `deleteResult`, `deleteAllResults`, `archive`, `restore`, `delete`)
  with the test account's key (`SMOKE_ACCESS_KEY`), run against the old service and against the bridge, each run on its
  own new survey; the answers are compared with ids, dates and generated names normalized. It cleans up after itself
  and reports cleanup failures without hiding the outcome. Both sides write to the same legacy stores, so only the test
  account's data changes.
- **The gate for the switch:** the replay of a recent sample shows no unexplained difference, and `smoke` passes. An
  explained difference goes into [Legacy API compatibility](../api/legacy-compat.md), in general terms.

### 4. Metrics: `/metrics` in Studio and in the bridge

- **A shared workspace package, `metrics/`**, on `@prometheus-io/client` (0.16.1, the maintained successor of the
  deprecated `prom-client`): a registry per app, the Node process metrics, request timing as a Fastify hook with a
  label function, and a listener on its own port. Both images include it.
- **Off unless asked for, and never on the main port.** `METRICS_PORT` (Studio) and `BRIDGE_METRICS_PORT` (the bridge)
  start a second HTTP listener that answers `GET /metrics` and nothing else, on `METRICS_HOST` / `BRIDGE_METRICS_HOST`
  (default `127.0.0.1`; the images set `0.0.0.0`, and no Compose file publishes the port). No token: whoever reaches
  the port reaches nothing but counts.
- **No label holds a key, an id, a path, an e-mail or an address.** Every label has a bounded set of values.
- **Studio** (prefix `surveyjs_studio_`):
  - `http_requests_total{operation, method, status}` and `http_request_duration_seconds{operation, method}`
    (histogram). `operation` is the contract's `operationId`; `web` for the web app's pages and assets; `system` for
    `/healthz`, `/readyz` and the sign-in callbacks; `unmatched` for anything else.
  - `store_call_duration_seconds{store, method, outcome}` (histogram): every call into the provider set
    (`store` = the provider interface, `method` = its method, `outcome` = `ok` or `error`), wrapped once where the
    providers are built, so every provider is measured alike.
  - the Node process metrics (CPU, memory, event-loop lag, garbage collection), with the prefix.
- **The bridge** (prefix `surveyjs_bridge_`):
  - `requests_total{action, method, status}` and `request_duration_seconds{action, method}`. `action` is the mapping
    table's action name, `preflight` for a CORS preflight the bridge answers itself, or `forwarded` for every forwarded
    path (the site's paths are not named in this repository;
    the log line has the path, without its query, for a breakdown).
  - `studio_calls_total{operation, status}` and `studio_call_duration_seconds{operation}`. `operation` is the method and
    the contract's path template (`GET /public/surveys/{surveyId}/definition`), not an `operationId`; `status` is
    `timeout` or `network` when no answer came, `aborted` when the caller left first.
  - `survey_cache_total{result}`: `hit` (Studio's `304`), `miss` (`200`), `stale` (the cached copy served on a
    `429`), `none` (not cached and refused).
  - `forward_failures_total{reason}`: `timeout`, `network`, `aborted`.
  - `uploads_in_progress` (gauge, against the limit of 8).
  - the Node process metrics.
- **Self-hosted:** [Self-hosting](../self-hosting.md) documents the settings and the metrics, and both Compose files
  gain a `monitoring` profile with Prometheus scraping the app (example configuration next to them).
- **Hosted:** Prometheus on the target server scrapes Studio and the bridge every 15 s and keeps 30 days. It is
  reached through an SSH tunnel; the runbook holds the queries for the switch. Dashboards and alerts are later work.
- **Between the switch and the cutover** Studio still runs on today's server, out of that Prometheus's reach. The
  runbook watches Studio through the bridge's `studio_calls_total` and `studio_call_duration_seconds` (Studio's `429`s
  and latency as the bridge sees them). Today's Studio sets `METRICS_PORT` too, for checks on that server
  (`curl` on the host); it is not scraped across servers.

### 5. Remaining callers, from the logs

Metrics cannot say who still calls an action: a label per key would let any caller create series at will. The bridge
writes one log line per request (`action`, `status`, `ms`, `cache`, and `key`: the 16-hex-digit prefix of the key's
hash, absent when there is no key). A command in the bridge image, `bridge-callers`, reads such lines (the container's
log) and writes one CSV row per day, key prefix and action: the count, the first and the last time. An hourly job on the
server runs it over the last full hour and appends the rows to that day's file, kept until the bridge is retired. No addresses, no full keys. The hash is
Studio's `hashCredential` for a legacy key (SHA-256 of the lower-cased key; of an `sjs_` token as sent), the one
`legacy_access_keys` will hold from the migration on (Steps 8–9); until then the owners are found by hashing the
site's keys the same way.

### 6. Fixed before the switch

- **Slow uploads:** the bridge cuts an `upload` whose body is not read within `BRIDGE_UPLOAD_READ_TIMEOUT_MS` (default
  60 000) and frees its slot; the caller gets an empty `408`.
- **Uploads that belong to no survey** (`uploadLegacyFile`) count against a per-user cap (`LIMIT_MAX_LEGACY_FILES_PER_USER`,
  default 1,000 files); one more answers `409 legacy-file-limit`, which the bridge maps to the old upload error text.
  On the Azure legacy provider the count lists Studio's own uploads (a small set, since only Studio writes there) on
  each such upload; that is accepted until the cutover, as `uploadFiles` is rare. The SQL providers count by index.
- **The recordings** from production (the recording script of Steps 5 and 6, run with the SurveyJS team) replace the
  derived golden files, and the round of fixes they bring is made, before the switch. The recordings stay private until
  reviewed (rule 6).

### 7. The runbook

`docs/operations/legacy-api-takeover.md`, in general terms (no provider, server or address): the preconditions; the
gate (replay and `smoke`); the switch; what to watch for the first hour and the first day (error rate and latency per
action, forwarded paths' failures, the cache's `hit` share, Studio's `429`s, uploads in progress), with the Prometheus
queries; when and how to switch back; and the cutover's one change (`BRIDGE_STUDIO_URL`). The server-specific steps
are in the private deployment notes.

## Why not the alternatives

| Option                                                                   | Why not                                                                                                                          |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| The bridge on today's server, moved with Studio at the cutover           | A second DNS switch inside the cutover window, the riskiest moment of the track                                                  |
| The bridge on today's server, left there after the cutover               | Every call crosses between two servers for good, and the old server stays only to run the bridge                                 |
| A staging copy of the data to replay against, writes included            | Against the product owner's decision; the logs hold no bodies, so writes could not be replayed anyway                            |
| Only keyless reads replayed; keyed actions checked with the test account | The keyed reads are the actions most likely to differ, and one account's data would not show it                                  |
| A log line and a report command instead of `/metrics`                    | Serves only this track; self-hosted operators expect `/metrics`, and Studio itself needs per-operation numbers after the cutover |
| Keys (hashed) as metric labels, for the caller list                      | Any caller could create series at will with made-up keys                                                                         |
| A token on `/metrics` on the main port                                   | One more secret to rotate, and the endpoint would be one proxy rule away from public; a port that is never published is simpler  |

## Consequences

- The target server exists, without data, from Step 7. Step 8 (provider readiness) and Step 11 (rehearsal) use it.
- Until the cutover each bridge call crosses from the target server to today's Studio, which reaches the legacy
  stores: the replay report shows the added latency per action, and the runbook watches it.
- Studio and the bridge gain a dependency (`@prometheus-io/client`) and a second, optional listener each.
- The mapping table gains `effect`; the migration guide's table is unchanged.
- The private playbooks gain the bridge, Prometheus, the two sites and the daily caller job; that change is made in the
  private repository, outside this ADR's PR.
- Today's server is set up again with `setup.sh` (the trusted proxies, the compression exception, `METRICS_PORT`)
  before the switch.

## Corrections from the build

Made on 2026-11-23, while the step was built; the points above are amended in place.

- **The metrics library** is `@prometheus-io/client` 0.16.1, not `prom-client`, which is deprecated in its favour.
  Request timing is a hook, and each app owns its registry.
- **Labels.** The bridge's `action` has a third kind of value, `preflight`, so CORS preflights neither dilute an
  action's error share nor count as forwarded. The Studio-call `operation` is `"<METHOD> <path template>"`, since the
  bridge's client knows the path, not the `operationId`; its `status` also has `aborted`. The duration histograms
  carry no `status` label.
- **The caller summaries** are hourly, not daily (point 5): the job runs `bridge-callers` over the last full hour and
  appends to a per-day CSV, so a day has up to 24 rows per key and action, to be summed. Lines of a container replaced
  mid-hour, and hours the server was down, are not counted.
- **The replay** sends only allowlisted paths, and its skip reasons are `write`, `forwarded`, `unknown-method` and
  `unsafe-path`. The `effect` rule is stated, `--file-limit` paces the file reads, and `traceId` values in problem
  bodies are not compared.
