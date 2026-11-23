# Demo: hosted Step 7, taking over `api.surveyjs.io`

This page lets you check hosted Step 7 without reading code. The local part takes about twenty minutes. Commands are
for Git Bash (or any POSIX shell), from the repository root; the answers are shown with `jq`.

What Step 7 delivers: **everything needed to point `api.surveyjs.io` at the bridge, and to watch it once it is
there.** Studio and the bridge serve Prometheus metrics on a port of their own; the bridge logs each request with the
caller's key reduced to a hash prefix, and `bridge-callers` sums that log per day, key and action; `pnpm legacy:replay`
compares the old service's answers with the bridge's for a sample of real reads, and its `smoke` command does the same
for the writes with a test account; the set-up script of today's server keeps the caller's address when the bridge
calls it from another server. The switch itself is made with the SurveyJS team, from
[the runbook](../operations/legacy-api-takeover.md). The design is
[ADR 0041](../adr/0041-taking-over-the-legacy-api-host.md); the metrics are in
[Operations › Metrics](../operations.md#metrics). Studio has no new screen in this step.

Sections 1 to 5 run locally; [section 6](#6-the-checklist-with-the-surveyjs-team) is the checklist run with the
SurveyJS team on production.

## Before you start

You need what [the Step 5 demo](hosted-05.md#before-you-start) lists (the self-hosted Step 1 tools, `jq`) and free ports
**3000** (Studio), **5173** (the web app), **3002** and **3003** (two bridges), **9464** and **9465** (the metrics
listeners). Check them (nothing is printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|3002|3003|5173|9464|9465) '
```

The replay refuses to write its report into the repository, so this demo keeps its files in a folder of its own,
outside it. Every shell below starts with the same two lines:

```sh
DEMO=~/hosted-07-demo
mkdir -p "$DEMO"
```

Start four shells, from the repository root.

1. **Studio** (shell 1) in the hosted edition, as in Steps 5 and 6, with its metrics on port 9464. Nothing here signs
   in through the browser, so the sign-in stub is not needed (PowerShell: set each variable with `$env:NAME = "value"`
   first, then run `pnpm demo`):

   ```sh
   APP_EDITION=hosted IDENTITY_PROVIDER=surveyjs-oidc OIDC_ISSUER_URL=http://127.0.0.1:5180/surveyjs \
     OIDC_CLIENT_ID=demo OIDC_CLIENT_SECRET=stub-secret-surveyjs METRICS_PORT=9464 pnpm demo
   ```

   - **Check:** the server's `starting` line has `"metrics":"127.0.0.1:9464"`.

2. **The bridge** (shell 2) with its metrics on port 9465, its log also written to a file:

   ```sh
   BRIDGE_METRICS_PORT=9465 pnpm dev:bridge 2>&1 | tee "$DEMO/bridge.log"
   ```

   - **Check:** its `starting` line has `"metrics":"127.0.0.1:9465"` and `"uploadReadTimeoutMs":60000`, then
     `Server listening at http://127.0.0.1:3002`.

3. **A second bridge** (shell 3) on port 3003, in front of the same Studio. In section 4 it plays the bridge, and the
   first one plays the old service:

   ```sh
   BRIDGE_PORT=3003 pnpm dev:bridge
   ```

4. **The commands** (shell 4):

   ```sh
   API=http://localhost:3000/api/v1
   BRIDGE=http://localhost:3002
   KEY=access-key-1
   ```

   `access-key-1` is Olivia Owner's legacy access key in the seeded data. The demo keeps its data in memory: stop it with
   Ctrl+C and start it again for a clean slate.

## 1. Metrics on their own port only (checklist 1)

1. Read both metrics listeners:

   ```sh
   curl -s http://127.0.0.1:9465/metrics | grep -E '^# (HELP|TYPE) surveyjs_bridge_requests_total'
   curl -s http://127.0.0.1:9464/metrics | grep -E '^# (HELP|TYPE) surveyjs_studio_http_requests_total'
   curl -s http://127.0.0.1:9464/metrics | grep -c '^surveyjs_studio_process_'
   ```

   - **Check:** the `HELP` and `TYPE` lines of each counter, then a count of the Node process metrics (above zero).

2. The main ports never answer metrics, and the listeners answer nothing else:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/metrics
   curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9464/
   curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/metrics"
   ```

   - **Check:** `404` (Studio: an unknown path), `404` (the listener: any other path), then `500`: the bridge forwarded
     `/metrics` to the old service like any path it does not own, and nothing listens on the old service's port here
     (`bridge/demo.env`). Shell 2 shows that request's line with `"action":"forwarded"` and `"path":"/metrics"`.

## 2. `getSurvey` twice: the cache hit (checklist 1)

1. Make a survey, then read it through the bridge twice:

   ```sh
   ID=$(curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"name":"Metrics demo","definition":{"title":"Metrics demo","elements":[{"type":"text","name":"q1"}]}}' \
     "$API/surveys" | jq -r .id)
   curl -s "$BRIDGE/public/v1/Survey/getSurvey?surveyId=$ID" | jq -c .
   curl -s "$BRIDGE/public/v1/Survey/getSurvey?surveyId=$ID" | jq -c .
   ```

   - **Check:** the definition twice, `{"title":"Metrics demo","elements":[{"type":"text","name":"q1"}]}`.

2. The bridge's numbers:

   ```sh
   curl -s http://127.0.0.1:9465/metrics | grep -E '^surveyjs_bridge_(survey_cache_total|studio_calls_total\{operation="GET /public)'
   ```

   - **Check:** `survey_cache_total{result="miss"} 1` and `{result="hit"} 1`, and the Studio calls
     `{operation="GET /public/surveys/{surveyId}/definition",status="200"} 1` and `…,status="304"} 1`: the second read
     asked Studio with `If-None-Match` and got `304`, so the bridge served its cached copy. The `operation` label is the
     contract's path template, never the survey's id.

3. Shell 2 shows the two `"msg":"request"` lines: `"action":"getSurvey"`, `"status":"200"`, then `"cache":"miss"` and
   `"cache":"hit"`.

## 3. Who calls what: the caller log and `bridge-callers`

1. Two more requests: an action with a key, and a CORS preflight, which the bridge answers itself:

   ```sh
   curl -s "$BRIDGE/private/Surveys/getActive?accessKey=$KEY" | jq -r '.[0].Name'
   curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS -H "Origin: https://example.com" \
     -H "Access-Control-Request-Method: GET" "$BRIDGE/public/v1/Survey/getSurvey"
   ```

   - **Check:** a survey's name, then `204`. The `getActive` line in shell 2 has `"key":"c81dae3a7718687e"`, never the
     key itself.

2. That prefix is the first 16 hex digits of the key's SHA-256 (a legacy key lower-cased first), as Studio stores it:

   ```sh
   printf '%s' "$KEY" | sha256sum | cut -c1-16
   ```

   - **Check:** `c81dae3a7718687e`.

3. Sum the log. In the bridge image the command is `bridge-callers`, reading the container's log
   ([how](../operations.md#the-callers-of-each-action)); here, the same code on the file shell 2 writes:

   ```sh
   node --import tsx bridge/src/cli/callers.ts < "$DEMO/bridge.log"
   ```

   - **Check:** the header `day,key,action,count,first,last`, then one row per action and key prefix for today (UTC):
     `forwarded` with `count` 1, `getSurvey` with 2, `preflight` with 1 (all with an empty `key`), and
     `c81dae3a7718687e,getActive` with 1. Lines that are not request lines (the start-up, pnpm's header) are skipped.

4. The counters agree:

   ```sh
   curl -s http://127.0.0.1:9465/metrics | grep '^surveyjs_bridge_requests_total'
   ```

   - **Check:** `action="getSurvey",method="GET",status="200"} 2`, `action="getActive"…} 1`,
     `action="preflight",method="OPTIONS",status="204"} 1` and `action="forwarded",method="GET",status="500"} 1`.

## 4. The replay and `smoke`, against two local bridges

On production the replay compares the old service with the bridge. Here the first bridge (port 3002) plays the old
service and the second (port 3003) the bridge; both read the same Studio, so every case should be `same`.

1. A sample in the replay's input format (`time,method,path,query,status`): two `getSurvey` reads, a keyed read, a
   write, a site path the bridge forwards, and a path with a dot segment:

   ```sh
   cat > "$DEMO/sample.csv" <<EOF
   time,method,path,query,status
   2026-11-20T10:00:00Z,GET,/public/v1/Survey/getSurvey,surveyId=$ID,200
   2026-11-20T10:00:05Z,GET,/public/v1/Survey/getSurvey,surveyId=$ID,200
   2026-11-20T10:00:10Z,GET,/private/Surveys/getActive,accessKey=$KEY,200
   2026-11-20T10:00:15Z,POST,/public/v1/Survey/post,,200
   2026-11-20T10:00:20Z,GET,/some/site/path,,200
   2026-11-20T10:00:25Z,GET,/private/Surveys/../getActive,,200
   EOF
   pnpm -s legacy:replay --sample "$DEMO/sample.csv" --old http://127.0.0.1:3002 \
     --bridge http://127.0.0.1:3003 --out "$DEMO/replay.html"; echo "exit $?"
   ```

   - **Check:** the console shows only counts and the verdict:

     ```text
     action     same  different  changed  rate-limited  error
     getActive     1          0        0             0      0
     getSurvey     2          0        0             0      0

     skipped: write 1, forwarded 1, unknown-method 0, unsafe-path 1; not selected 0
     verdict: pass
     exit 0
     ```

     The `POST` was never sent (a write), nor the site path (forwarded) or the dot segment (unsafe).

2. Open `$DEMO/replay.html` in a browser (Windows: `start "$DEMO/replay.html"`).

   - **Check:** each case with its outcome; the keyed case shows the key as `c81dae3a7718687e`, and
     `grep -c access-key-1 "$DEMO/replay.html"` prints `0`.

3. The report must stay outside the repository:

   ```sh
   pnpm -s legacy:replay --sample "$DEMO/sample.csv" --old http://127.0.0.1:3002 \
     --bridge http://127.0.0.1:3003 --out ./replay.html; echo "exit $?"
   ```

   - **Check:** `--out is inside the repository; write the report outside it`, the usage, and `exit 2`. Nothing was
     sent. (Running `pnpm legacy:replay` with no options prints the usage the same way.)

4. The writes, with the key taken from the environment only:

   ```sh
   SMOKE_ACCESS_KEY=$KEY pnpm -s legacy:replay smoke --old http://127.0.0.1:3002 --bridge http://127.0.0.1:3003
   ```

   - **Check:** `smoke: the old service`, `smoke: the bridge`, then every step `same` (create, `changeJson`,
     `changeName`, `publish`, `post`, `post (clientId)`, `upload`, `getSurveyResults`, `deleteResult`,
     `deleteAllResults`, `archive`, `restore`, `delete`), `cleanup old: not needed`, `cleanup bridge: not needed` (each
     run deleted its own survey) and `verdict: pass`. On production, a difference documented in
     [Legacy API compatibility](../api/legacy-compat.md) is printed as `explained (docs/api/legacy-compat.md): …`
     instead of failing; here there is none. `pnpm legacy:replay smoke --help` describes the steps.

## 5. Today's server keeps the caller's address

The bridge will call today's Studio from another server, so the web front there must trust that server's
`X-Forwarded-For` and must not compress the public definition (compressing rewrites its `ETag`, and every `getSurvey`
would be a `miss`). The set-up script prints the configuration it would write, and changes nothing:

```sh
bash deploy/hetzner/setup.sh --print-caddyfile --trusted-proxies "203.0.113.7 2001:db8::7"
```

- **Check:** a global block with `trusted_proxies static 203.0.113.7 2001:db8::7` (documentation addresses), and the
  `@compressible not path` line ending in `/api/v1/public/surveys/*/definition`. Without `--trusted-proxies` the
  global block is gone: the option must be given again on every run of the script.

**Self-hosted, optional (needs Docker):** the Compose examples start Prometheus only with the `monitoring` profile.
From `deploy/compose`, `docker compose --env-file .env.example -f compose.sqlite.yml --profile monitoring config --services`
lists `app` and `prometheus`; without `--profile monitoring`, only `app` ([Self-hosting › Metrics](../self-hosting.md#metrics)).

## 6. The checklist with the SurveyJS team

Run on production, from [the runbook](../operations/legacy-api-takeover.md), once its
[preconditions](../operations/legacy-api-takeover.md#1-preconditions) hold. The reports stay in the private location;
only the verdicts and counts are quoted.

1. Locally: sections 1 and 2 above.
2. The replay of a recent sample, through the test host name, shows no unexplained difference, and `smoke` passes
   ([the gate](../operations/legacy-api-takeover.md#2-the-gate)).
3. The switch: a page built for Form Library v1 with `surveyId` still works, a site path reaches the old service, and
   [the queries](../operations/legacy-api-takeover.md#4-watch) show no rise in errors over the first hour.
4. A day later: `LEGACY_KEY_REVOKE` is on, a key revoked on the API tokens page gets the old API's wrong-key answer
   through `api.surveyjs.io`, and `bridge-callers` lists the previous day's callers.

## Clean up

Stop the shells with Ctrl+C (the bridges and Studio), then remove the demo's folder: `rm -r ~/hosted-07-demo`.
