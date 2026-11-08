# Demo: Step 14, production readiness and the rollout kit

This page lets you check Step 14 without reading code. It follows the step's four checkpoints and takes about an
hour (the first image build takes several minutes). Commands are for Git Bash (or any POSIX shell).

What Step 14 delivers: **one production image** that serves the web app and the API from one origin; **operations**
(a readiness check that names what fails, JSON logs with a start-up summary and the operation of each request, a
`READ_ONLY` switch); the **costs and hygiene** carried over from earlier steps (results read by keys first, the schema
check, port checks before the e2e runs, survey libraries 3.2.2); **compatibility** with the old site (an empty
published flag means published, the history answer, the `pnpm smoke:legacy` test); and the **operations
documentation**: the configuration by deployment mode and the rollout and rollback runbook
([Operations](../operations.md), [ADR 0021](../adr/0021-production-image-and-web-serving.md)).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2), and Docker with
Compose. Run `pnpm install` once.

If the default `node` of your machine is older than 24 (for example with nvm on Windows), put Node 24 first once in
each Git Bash window, before any `pnpm` command: `export PATH="$APPDATA/nvm/v24.21.0:$PATH"`. Check with
`node --version`; it must print `v24.21.0`.

Prod-like mode uses the host ports **8080**, 10000, 10002, 14333 and 18080, the same as the Azurite demo except 8080.
If the Azurite demo runs, stop it first: `docker compose --env-file docker/azurite.env -f docker/compose.azurite.yaml
stop` keeps its data ([Running the app](../running.md#stopping-the-docker-services)). Part 2 also needs 3000 and 5173.

## 1. The image in prod-like mode (checkpoint 1)

```sh
pnpm prod-like:up
```

It builds the image `surveyjs-studio:local`, starts it with the replica and the mock OIDC server in the mode 1
configuration, waits until all are healthy and loads the fixtures. Open <http://localhost:8080> and type `owner` on
the mock's sign-in page. The list, the editor, the run page, the results, the history and the projects work as in the
earlier demos, from one origin: there is no Vite here.

The container runs as `node` and is healthy:

```sh
docker inspect --format '{{.Config.User}} {{.State.Health.Status}}' surveyjs-studio-prod-like-app-1
```

Expected: `node healthy`.

**The headers.** Each page gets the web app's policy, the server's paths keep their own:

```sh
curl -sI http://localhost:8080/ | grep -i -e '^HTTP' -e content-security-policy -e cache-control
curl -sI http://localhost:8080/s/22222222-0000-4000-8000-a00000000001 | grep -i content-security-policy
curl -sI http://localhost:8080/api/v1/config | grep -i content-security-policy
```

Expected:

- `/`: `200`, `default-src 'self'; script-src 'self'; …; frame-ancestors 'none'` and `cache-control: no-cache`;
- `/s/…`: the same policy ending in `frame-ancestors *`;
- `/api/v1/config`: `default-src 'none'; frame-ancestors 'none'`.

No `strict-transport-security`: the origin is http. It appears when `PUBLIC_BASE_URL` is https.

**Unknown addresses.** An old address is a real `404` with the app's "Page not found"; an unknown API path is a
Problem:

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' "http://localhost:8080/published?id=22222222-0000-4000-8000-a00000000004"
curl -s http://localhost:8080/api/v1/nope
```

Expected: `404 text/html; charset=utf-8`, then a JSON body with `"code":"not-found"`. Open
<http://localhost:8080/no-such-page> in the browser: "Page not found".

**The image on production data** (`pnpm image:prod-data`) is for the product owner only: it reads and writes the real
stores ([Development](../development.md#the-image-on-production-data)).

## 2. Readiness, logs and read-only (checkpoint 2)

**Readiness.** With prod-like running:

```sh
curl -s http://localhost:8080/readyz
docker compose --env-file docker/azurite.env -f docker/compose.prod-like.yaml stop legacy-sql
curl -s http://localhost:8080/readyz
docker compose --env-file docker/azurite.env -f docker/compose.prod-like.yaml start legacy-sql
```

Expected: `{"status":"ok"}`, then (within about 5 s) `{"status":"unavailable","failing":["sql"]}`. After the start,
`/readyz` is `ok` again within a few seconds. `/healthz` stays `200` throughout: the process is alive.

**Logs.**

```sh
docker compose --env-file docker/azurite.env -f docker/compose.prod-like.yaml logs app | grep -e '"msg":"starting"' -e '"msg":"request completed"' | tail -n 3
```

Expected: the `starting` line with `"edition":"hosted"`, `"storageProvider":"azure-legacy"`,
`"userDirectory":"surveyjs-sql"`, `"readOnly":false`, `"webApp":true`; and `request completed` lines with `reqId`,
the status and, for API calls, an `operationId` such as `listSurveys`. No line holds a connection string, a key or a
password.

**Read-only.** In another window start the memory demo read-only (Git Bash; PowerShell:
`$env:READ_ONLY = "true"; pnpm demo`):

```sh
READ_ONLY=true pnpm demo
```

Open <http://localhost:5173>, sign in as Olivia Owner. Expected: a banner on every page, "My Surveys is read-only at
the moment. Changes cannot be saved."; the list and the results open; renaming a survey fails with that text; the
editor opens read-only. Then:

```sh
curl -s http://127.0.0.1:3000/api/v1/config | grep -o '"readOnly":true'
curl -si -X POST http://127.0.0.1:3000/api/v1/surveys -H 'content-type: application/json' -d '{}' | head -n 1
READ_ONLY=true pnpm account:erase --user erasable@example.com --yes --env-file docker/azurite.env; echo "exit $?"
```

Expected: `"readOnly":true`; `HTTP/1.1 503 Service Unavailable` (the write is refused before anything else is
checked); `Refused: READ_ONLY=true …` and `exit 2`. Stop the demo with Ctrl+C.

## 3. The schema check and the costs (checkpoint 3)

With prod-like (or the Azurite demo) running:

```sh
pnpm inspect:legacy-schema --env-file docker/azurite.env
```

Expected, on the replica:

```text
Surveys.theme: varchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS
Surveys triggers: none
Surveys.ispublished: tinyint, nullable yes, default none
Surveys with an empty ispublished: <n> of <m>
```

The counts depend on what the replica holds. The product owner ran it on production on 2026-10-22: the same column
type, collation and triggers, and most surveys with an empty flag. The theme save needs no change
([ADR 0012](../adr/0012-editor-content-and-history.md)).

**The port check.** Start `pnpm demo` in one window and run `pnpm e2e` in another. Expected: the e2e run stops at once
with `Port 3000 is in use by <program> (PID <n>). Stop it and run again.` Stop the demo.

**Survey libraries 3.2.2.** `grep '"survey-' web/package.json` lists the five packages at `3.2.2`. On the Windows
machine that holds the baselines, `pnpm e2e:visual` passes with `55 passed` (18 screens in three browsers, history
included, and the setup).

**Results read by keys first.** On "API created" (1,500 responses) the Table pages through the responses as before;
the provider suite proves the order and the cursors (`pnpm test:providers:azurite`).

## 4. Compatibility (checkpoint 4)

**An empty published flag means published.** In prod-like, create a survey: its "…" menu shows **Run** and
**Unpublish** at once, and **Run** opens it. The fixture "API created", whose flag was never set, is published too
([ADR 0014](../adr/0014-run-page-and-response-collection.md), S1).

**The smoke test refuses to run by accident.**

```sh
pnpm smoke:legacy --account owner@example.com --env-file docker/azurite.env; echo "exit $?"
```

Expected: it does nothing without `--yes` and exits `2`. The full run against a local stand-in of `api.surveyjs.io`
is part of the provider suite: stop prod-like (`pnpm prod-like:down`), run `pnpm demo:azurite:up`, then
`pnpm test:providers:azurite`.

**On production (product owner only).** With the dedicated test account and its access key:
`pnpm smoke:legacy --account <test account email> --yes --env-file <path>`, then the manual checklist on surveyjs.io
([Legacy smoke test](../operations/smoke-test.md)). Every row is `pass`, and `manual` for the project delete.

**Review the documents** with the site team: [Configuration by deployment mode](../operations.md#configuration-by-deployment-mode)
and [the rollout and rollback runbook](../operations.md#rollout-and-rollback-runbook), with the
[redirect map](../operations/surveyjs-redirects.md).

When you are done: `pnpm prod-like:down` (it deletes the prod-like data).

## Checklist

| #   | Check                                                                                                       | Result |
| --- | ----------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `pnpm prod-like:up`: the app works at <http://localhost:8080>; the container runs as `node` and is healthy  |        |
| 2   | `curl -sI`: `/` and `/s/<id>` carry the web policy (`'none'` and `*`), `/api/v1/config` the server's policy |        |
| 3   | An old address answers `404` with the app's page; an unknown API path a `404` Problem                       |        |
| 4   | SQL stopped: `/readyz` is `503` with `failing:["sql"]`; started again: `ok`                                 |        |
| 5   | The logs show the `starting` line and request lines with `reqId` and `operationId`, and no secret           |        |
| 6   | `READ_ONLY=true`: browsing works, the banner shows, saves and `account:erase --yes` are refused             |        |
| 7   | `pnpm inspect:legacy-schema` prints the theme column, the triggers and the published flag                   |        |
| 8   | `pnpm e2e` stops with a message naming the port when a demo holds it                                        |        |
| 9   | A new survey shows **Run** and **Unpublish** at once                                                        |        |
| 10  | `pnpm smoke:legacy` on production passes, and the manual checklist on surveyjs.io (product owner)           |        |
| 11  | The configuration reference and the runbook are reviewed with the site team                                 |        |

## Known differences

- **The published flag.** The old list shows **Publish** for a survey whose flag is empty; the app lists it as
  published, with **Run** and **Unpublish**. On production that is most of the surveys. Expected (product owner,
  2026-10-21).
- **History saved before the site's fix was deployed** on the old site is lost to both sides; surveyjs.io fixed its history writer in
  commit `3389d6cd49`, and new saves on either side are listed by both
  ([layout, 3.4](../architecture/legacy-data-layout.md#34-survey-history-blob-container-surveyjsonhistory)).
- **No HSTS in prod-like**, because it is served over http.

## Troubleshooting

- **`prod-like:up` fails with a port in use.** The Azurite demo or another service holds 10000, 10002, 14333, 18080
  or 8080. Stop it (see Before you start).
- **`/readyz` stays `503` after the SQL container is back.** Wait a few seconds: the next check opens a new
  connection.
- **The first `prod-like:up` is slow.** The image installs every workspace once; later builds reuse the layers.

## What is not in Step 14

- Hosting: the server, the reverse proxy and TLS, DNS, the Azure network rules, pushing images to a registry and a CI
  deploy job. That is the next, separate step (most likely Hetzner).
- Modes 1.3, 2a, 2b and 3 (the track plans). The configuration reference lists 2b and 3 as coming.
- Visual tests in CI (kept local; [ADR 0020](../adr/0020-visual-parity-baselines.md) says what CI would need).
- A setting for the initial published state of new surveys, and least-privilege store credentials (recorded as later
  work in [ADR 0014](../adr/0014-run-page-and-response-collection.md#open) and [Operations](../operations.md)).
