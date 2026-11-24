# Taking over `api.surveyjs.io`: the runbook

> **Changed 2026-11-24 by [ADR 0042](../adr/0042-one-switch-to-the-new-server.md).** There is no early switch:
> `api.surveyjs.io` moves to the new server together with `studio.surveyjs.io` at the cutover, and the bridge calls the
> Studio on its own server from the start. The cutover runbook (hosted Step 11) takes over the sequence below; its
> checks, what to watch and the Prometheus queries still apply. The preconditions about today's server (Steps 3–6
> deployed there, `--trusted-proxies`) no longer do.

This runbook moves the old API's host, `api.surveyjs.io`, to the bridge while the data is still in the legacy stores
(hosted Step 7, [ADR 0041](../adr/0041-taking-over-the-legacy-api-host.md)). It is written in general terms: the
server-specific commands and every address are in the private deployment notes (plan-hosted.md, rule 6). Run it with
the SurveyJS team, who make the DNS change.

**The picture.** Two servers take part. **Today's server** runs Studio at `studio.surveyjs.io` on the legacy stores.
**The target server**, where Studio moves at the cutover, runs the bridge, Prometheus and a web front with two sites:
`api.surveyjs.io` and a test host name. Until the cutover the bridge calls today's Studio by its public URL
(`BRIDGE_STUDIO_URL=https://studio.surveyjs.io/api/v1`) and forwards the paths it does not own to the old service by
that service's own host name. The DNS record of `api.surveyjs.io` is switched once, here; the cutover does not touch it.

## 1. Preconditions

Check each item; the switch waits until all of them hold.

1. **Hosted Steps 3 to 6 are deployed on today's Studio:** legacy keys as bearer tokens, the new public operations,
   `APP_EDITION=hosted`. Today's Studio keeps `LEGACY_KEY_REVOKE=false` for now.
2. **The bridge image is published at the same commit** as the app image today's server runs
   (`ghcr.io/surveyjs/surveyjs-studio-bridge:<commit id>`, [The images on ghcr.io](../../README.md#the-images-on-ghcrio)).
3. **Today's server passes the caller's address on.** The bridge sends the caller's address in `X-Forwarded-For`;
   without the two changes below, every caller of the old API shares one of Studio's per-address limits.
   - Studio's `TRUST_PROXY` (in the server's settings file) holds the web front's Docker subnet **and** the target
     server's public IPv4 and IPv6 addresses, comma-separated. Set `METRICS_PORT` there too, for the checks in [section 4](#4-watch).
   - The set-up script is run again with `--trusted-proxies "<the target server's addresses>"`
     ([its options](hetzner-server-setup.md#5-run-setupsh)). **Repeat every address option on each run**
     (`--trusted-proxies`, `--restrict-to`, `--readyz-allow`): the script does not remember them, and a run without
     one writes the web front's configuration without it. Print the configuration first with the same options and
     `--print-caddyfile`, and check that it has the `trusted_proxies` line and that the public definition
     (`/api/v1/public/surveys/*/definition`) is in the list of paths that are not compressed.
4. **The target server is set up** by the private playbooks: the bridge at the app's tag, with `BRIDGE_METRICS_PORT`
   set, `BRIDGE_TRUST_PROXY` set to its web front, and `BRIDGE_LEGACY_URL` an `https:` URL of the old service's own host
   name; Prometheus scraping the bridge; the web front's read-idle timeout for the bridge's sites above 120 seconds
   ([why](../api/legacy-compat.md#operator-notes)); the hourly caller job ([section 6](#6-the-days-after)).
5. **The test host name answers through the bridge.** From a machine outside both servers:
   - `curl -i https://<test host>/public/Survey/getSurvey` answers `400` from the bridge (no survey ID);
   - `getSurvey` of a published survey, twice, answers the definition both times, and the bridge's log shows
     `"cache":"miss"` and then `"cache":"hit"` (a `miss` every time means the web front on today's server still
     compresses the public definition and rewrites its `ETag`);
   - Studio's log on today's server shows that call's `incoming request` with the calling machine's (truncated)
     address in `remoteAddress`, not the target server's;
   - a path the bridge does not own (`curl -i https://<test host>/`) shows the old service's answer.
6. **The recordings are made and reviewed.** The golden files recorded on production with the SurveyJS team replace
   the derived ones, the round of fixes they bring is merged and deployed, and the recordings stay in the private
   location (rule 6).
7. **The record's time-to-live is lowered** at least two days before the switch, so that a switch back takes effect
   quickly.

## 2. The gate

Two commands, run from an operator's machine against the old service and the test host name. Both reports stay in the
private location; a PR or a ticket quotes only the console's counts and verdict.

1. **The replay of a recent sample of reads**, [`pnpm legacy:replay`](#the-replay). Take a sample of the old
   service's requests from the last days with the private query (CSV columns `time,method,path,query,status`), then:

   ```sh
   pnpm legacy:replay --sample <sample.csv> --old https://<the old service's host> \
     --bridge https://<test host> --out <a folder outside the repository>/replay.html
   ```

   It passes when the verdict is `pass` and every `different` case seen in earlier runs is either fixed or explained
   in [Legacy API compatibility](../api/legacy-compat.md), in general terms. An action flagged
   `old service varies — compared nothing` was not checked: replay it again at a quieter time, or with `--actions`
   and a newer sample.

2. **The writes, `pnpm legacy:replay smoke`,** with the test account's key, used for nothing else
   ([below](#smoke-the-writes)):

   ```sh
   SMOKE_ACCESS_KEY=<the test account's key> pnpm legacy:replay smoke \
     --old https://<the old service's host> --bridge https://<test host>
   ```

   It passes when the verdict is `pass`. Each `explained (docs/api/legacy-compat.md): …` line is a documented difference
   it set aside. A `cleanup …: failed …; remove survey … by hand` line names a survey left in the test account; it
   does not change the verdict.

### The replay

- **What is sent.** Only a `GET` whose action the bridge's mapping table marks `effect: "read"`, on a path of plain
  segments (letters, digits, `_`, `-`, `{`, `}`). An action is a `write` when any Studio operation it calls is not a
  `GET`, or when it takes any method other than `GET`, `HEAD` and `OPTIONS`. Everything else is counted and never sent,
  by reason: `write`, `forwarded` (a path the bridge forwards), `unknown-method`, `unsafe-path`.
- **Each case** goes to the old service, then the bridge, then the old service again, and ends as one of `same`,
  `different`, `changed` (the old service's two answers differ: the data moved between the calls, so nothing is
  compared), `rate-limited` (the bridge answered `429` twice) or `error` (a request failed). The verdict fails on any
  `different` or `error`. An action whose cases are mostly `changed` is flagged.
- **What is compared:** the status, the content type, the headers callers read and the body (JSON exactly, property
  order included; text exactly). Not compared: `Date`, `Server`, the platform's headers, whitespace between JSON tokens,
  and `traceId` values in problem bodies.
- **Pacing.** Every request reaches Studio from the operator's one address, so the replay stays under Studio's
  per-address limits: `--public-limit` (default 60 a minute), `--summary-limit` (10) and `--file-limit` (600). A
  sample of a few thousand requests takes hours.
- **Keys are sent as recorded.** The report shows a key only as the first 16 hex digits of its hash; the console shows
  only counts and the verdict.
- **`--old` and `--bridge` are bare origins** (no path, query or fragment), and **`--out` must be outside the
  repository**, in a folder that exists; otherwise the command stops before sending anything (exit `2`). Exit `1` is a
  failing verdict.
- **Selection:** `--actions a,b`, `--since <ISO time>`, `--limit <n>`.

### `smoke`: the writes

`pnpm legacy:replay smoke` runs a fixed sequence (create, `changeJson`, `changeName`, `publish`, `post` twice,
`upload`, `getSurveyResults`, `deleteResult`, `deleteAllResults`, `archive`, `restore`, `delete`) with the key in
`SMOKE_ACCESS_KEY`, read from the environment only and never printed. It runs against the old service first, each run
on a new survey of its own, then against the bridge, and compares the answers with ids, dates and generated names
replaced. When the old service's create fails (a wrong key, the service down), the bridge run is skipped and the
verdict fails. Both runs write to the same legacy stores, so only the test account's data changes.

## 3. The switch

1. **Pick a quiet hour.** The certificate for `api.surveyjs.io` is issued over HTTP once the record points at the
   target server; callers that resolve the new address before it is issued get TLS errors for about a minute.
2. **The SurveyJS team changes the record** to the target server's addresses.
3. **Make the web front ask for the certificate at once,** as soon as the target server's addresses resolve from
   outside, rather than after its back-off (the command is in the private deployment notes). Check:
   `curl -s -o /dev/null -w "%{http_code}\n" https://api.surveyjs.io/public/Survey/getSurvey` prints `400` (the
   bridge's answer for a missing survey ID), with no certificate error.
4. **Check a page built for the old API** (a Form Library v1 page with `surveyId`) and a site path that is forwarded.

## 4. Watch

Prometheus on the target server is reached through an SSH tunnel to it (the private deployment notes). Watch these
queries closely for the first hour, then a few times on the first day. Compare the latencies with the replay report:
until the cutover each bridge call crosses to today's Studio, and the report shows that cost per action.

Each query below can be pasted into Prometheus as it stands.

**Error share per action** (CORS preflights left out, so they dilute nothing):

```promql
sum by (action) (rate(surveyjs_bridge_requests_total{action!="preflight",status=~"5.."}[5m]))
  / sum by (action) (rate(surveyjs_bridge_requests_total{action!="preflight"}[5m]))
```

**Error share overall:**

```promql
sum(rate(surveyjs_bridge_requests_total{action!="preflight",status=~"5.."}[5m]))
  / sum(rate(surveyjs_bridge_requests_total{action!="preflight"}[5m]))
```

**Requests per action and status:**

```promql
sum by (action, status) (rate(surveyjs_bridge_requests_total[5m]))
```

**Latency per action, p95:**

```promql
histogram_quantile(0.95, sum by (action, le) (rate(surveyjs_bridge_request_duration_seconds_bucket{action!="preflight"}[5m])))
```

**Forwarded paths: errors, and requests the old service did not answer completely:**

```promql
sum by (status) (rate(surveyjs_bridge_requests_total{action="forwarded",status=~"5..|none"}[5m]))
```

```promql
sum by (reason) (rate(surveyjs_bridge_forward_failures_total[5m]))
```

**The `getSurvey` cache's hit share:**

```promql
sum(rate(surveyjs_bridge_survey_cache_total{result="hit"}[15m]))
  / sum(rate(surveyjs_bridge_survey_cache_total[15m]))
```

**Studio's `429`s, as the bridge sees them:**

```promql
sum by (operation) (rate(surveyjs_bridge_studio_calls_total{status="429"}[5m]))
```

**Studio failing or slow, as the bridge sees it:**

```promql
sum by (operation, status) (rate(surveyjs_bridge_studio_calls_total{status=~"5..|timeout|network"}[5m]))
```

```promql
histogram_quantile(0.95, sum by (operation, le) (rate(surveyjs_bridge_studio_call_duration_seconds_bucket[5m])))
```

**Uploads in progress** (at 8 the next upload is refused with `503`), and the uploads refused or cut off:

```promql
surveyjs_bridge_uploads_in_progress
```

```promql
sum by (status) (rate(surveyjs_bridge_requests_total{action="upload",status=~"408|503"}[5m]))
```

How to read them:

- **`status="none"`** is a request whose answer never started, mostly a caller that left. A few are normal; a run of
  them on one action points at a slow Studio call.
- **Latency of streaming actions** (`getSurveyPublicResults`, the file reads, `upload`) includes the time the body
  takes to stream, so their p95 is high by nature; watch it for change, not for its level.
- **The cache's hit share** is high from the first minutes, as callers that re-read the same surveys often hit it. A
  share near zero means `If-None-Match` never matches: check the compression exception on today's server
  ([section 1](#1-preconditions), item 3).
- **Studio's `429`s** on the public operations mean many callers share one address: check that Studio's log shows the
  callers' addresses (section 1, item 5). `aborted` in `studio_calls_total` is a caller that left, not a Studio failure.
- **Studio itself** runs on today's server, out of this Prometheus's reach until the cutover. For a closer look, read
  its metrics on that server from inside the app container:
  `docker compose exec app node -e "fetch('http://127.0.0.1:'+process.env.METRICS_PORT+'/metrics').then(r=>r.text()).then(console.log)"`
  ([the metrics](../operations.md#metrics)).
- **The bridge's log** has one `"msg":"request"` line per request, with the path of each forwarded one: use it to see
  which forwarded path fails.

**When to switch back:** a failure that the gate did not show and that cannot be fixed forward quickly: an action
that callers depend on answering `5xx` or wrongly, or the forwarded paths failing. A slow action or a few `429`s are
fixed forward.

## 5. Switching back

A switch back is for emergencies only.

1. **If `LEGACY_KEY_REVOKE` is already on, turn it off first** in today's Studio's settings and re-create its
   container. Keys revoked in Studio in the meantime work again on the old service: tell their owners to regenerate the
   key on the site.
2. **The SurveyJS team restores the old record.** The bridge holds no data, so nothing is lost.
3. **Files uploaded through the bridge** (`upload`, `uploadFiles`) are in Studio's own file store under Studio's names,
   which the old service cannot serve. Their links break until the host is switched forward again; Studio keeps them
   and serves them again then.

## 6. The days after

- **After a day without trouble, turn on `LEGACY_KEY_REVOKE=true`** in today's Studio's settings and re-create its
  container ([ADR 0037](../adr/0037-access-keys-and-api-tokens.md)). Earlier, a key revoked in Studio would still work
  for callers whose resolvers still pointed at the old service.
- **The remaining callers.** An hourly job on the target server runs `bridge-callers` over the last full hour's request
  lines and appends the rows to that day's file, kept in the private location until the bridge is retired:
  `day,key,action,count,first,last`, one row per UTC day, key hash prefix and action in each run, so a day has up to
  24 rows per key and action (sum them). Lines of a container replaced mid-hour, and hours the server was down, are not
  counted
  ([the caller log](../operations.md#the-callers-of-each-action)).
- **The time-to-live** of the record can go back up once the switch is settled.

## 7. At the cutover: the one change

When Studio moves to the target server (Step 11's runbook), the bridge's `BRIDGE_STUDIO_URL` changes from today's
Studio's public URL to the app on the same server, and the bridge is re-created. Nothing else about the bridge or
`api.surveyjs.io` changes. From then on Prometheus scrapes Studio too.
