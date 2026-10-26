# Operations

For the people who run My Surveys: the SurveyJS team and the surveyjs.io site team. It covers the image and how to run
it, monitoring, read-only mode, the configuration of each deployment mode, the settings for accounts, the two commands
that erase an account's data, the webhook secret, the header policy, and the rollout and rollback runbook. Every
variable, with its values and default, is in [Development](development.md#environment-variables-server); how to run
each mode on your own machine is in [Running the app](running.md).

Commands are for Git Bash or any POSIX shell, from the repository root, with Node.js 24. Nothing here depends on a
particular host: "the host" is the machine that runs the container, and "the reverse proxy" is whatever terminates
https in front of it.

## Deployment

My Surveys ships as one Docker image: the server, which also serves the built web app. Build it from the repository
root with `pnpm image:build` (`docker build -t surveyjs-studio:local .`). Try it locally with `pnpm prod-like:up`
([prod-like mode](development.md#prod-like-mode)). The same image serves every deployment mode: only its settings
differ ([below](#configuration-by-deployment-mode)).

| Item     | Value                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Process  | `node --import tsx src/main.ts` in `/app/server`, as the user `node` (uid 1000)                                                                  |
| Port     | `3000` (`EXPOSE 3000`); put an https proxy or load balancer in front                                                                             |
| Set      | `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `WEB_ROOT=/app/web` (the built web app)                                                      |
| Liveness | `GET /healthz`: `200` while the process runs; the image's `HEALTHCHECK` calls it                                                                 |
| Ready    | `GET /readyz`: `200 {"status":"ok"}`, else `503` with `failing`: the failed checks by name, e.g. `sql`. It never shows an error text or a secret |

`HOST=0.0.0.0` makes the server listen on every interface of the container, which is what a container needs; outside a
container the default stays `127.0.0.1`. `WEB_ROOT` makes the server serve the web app with the web app's header
policy (see [below](#the-header-policy)); `/api`, `/__dev`, `/healthz` and `/readyz` keep the server's own routes and
headers. `/__dev` holds only the dev sign-in, and the server refuses to start with it (`IDENTITY_PROVIDER=dev`) when
`NODE_ENV=production` or `APP_EDITION=hosted`, so in production that path answers `404`.

**Timeouts and a proxy.** `REQUEST_TIMEOUT_SECONDS` (default `300`) is the time the whole request, headers and body,
may take; a slower client gets `408` and the connection closes. It also bounds a body the server reads and drops
after an early answer. On shutdown (`SIGTERM`) the server closes idle keep-alive connections at once and waits for
requests in flight, so a request that is still arriving can hold it for up to this time. A proxy or load balancer in
front must allow at least the app's body limit (`LIMIT_MAX_DOCUMENT_BYTES`, 30 MB by default, for a definition) and
this timeout; if its own limits are lower, it answers first, with its own page.

### Running the image

1. **The settings** go in an env file on the host, outside any repository, readable only by the account that starts
   the container (`chmod 600`). The variables of each mode are [below](#configuration-by-deployment-mode).
   With `docker run --env-file`, write each value **without quotes**: Docker keeps quotes and `#` as part of the value
   and does not expand `$`. (Docker Compose's `env_file` removes quotes and expands `$`; see
   [Running the app](running.md#changing-settings).) The commands of this page (`inspect:legacy-schema`,
   `smoke:legacy`, `account:*`) read their `--env-file` with Node's parser instead, which removes quotes and ends an
   unquoted value at `#`: there, quote a value that holds `#`. So give the commands a file of their own.
2. **Start one container**, with the port published to the reverse proxy only, never to the internet:

   ```sh
   docker run -d --name surveyjs-studio --restart unless-stopped \
     --env-file /etc/surveyjs-studio/app.env -p 127.0.0.1:3000:3000 surveyjs-studio:<tag>
   ```

3. **The reverse proxy** terminates https for `PUBLIC_BASE_URL`, forwards every path to port 3000, sets
   `X-Forwarded-For`, and passes the app's headers through unchanged ([the header policy](#the-header-policy)). Its
   body size limit and timeout are at least the app's (above). Compression belongs there too: the app sends none.
   `/readyz` is the one exception: it reaches the stores, so the proxy forwards it only for the monitor's addresses
   (or the monitor calls `http://127.0.0.1:3000/readyz` on the host) and answers `404` to anyone else.
4. **`TRUST_PROXY`** is the address the proxy's connections come from, as the container sees it. Without it every
   user shares the proxy's rate-limit counters (sign-in allows 30 requests a minute per address) and a saved respondent
   address is the proxy's. When the proxy runs on the same host and reaches a published port, that address is
   usually the Docker network's gateway (`docker network inspect bridge`, `Gateway`). A proxy that runs in a container
   on a user-defined network connects from that network's subnet (`docker network inspect <network>`, `Subnet`); with
   host networking (`--network host`) it is `127.0.0.1`. Check it once: the `incoming request` log lines must show
   clients' addresses (truncated, such as `203.0.113.0`) in `remoteAddress`, not the proxy's.

**One instance.** The rate-limit counters live in the process, so a second instance counts alone; sessions are sealed
cookies and need no shared store. One instance is enough for mode 1.1.

**Changing a setting or the image: re-create the container.** A container keeps the environment it was created
with: `docker restart` does **not** read the env file again. After any change to the env file, and to run another
image tag, remove the container and run it again with the same command:

```sh
docker stop --time 60 surveyjs-studio   # SIGTERM: requests in flight may finish; SIGKILL after 60 s
docker rm surveyjs-studio
docker run -d --name surveyjs-studio --restart unless-stopped \
  --env-file /etc/surveyjs-studio/app.env -p 127.0.0.1:3000:3000 surveyjs-studio:<tag>
```

Then check the `starting` log line (`docker logs surveyjs-studio`; [Logs](#logs)): it shows the settings the process
really runs with. (`docker rm -f` would kill it at once, cutting requests in flight.) The app has no database
migrations: the stores keep the legacy formats, so any earlier image runs on the same data, and rolling back the app
is re-creating the container with the previous tag.

**Where the images come from.** Every push to `master` whose CI passes publishes the image CI tested as
`ghcr.io/surveyjs/surveyjs-studio:<commit sha>` (the full 40-character commit id; [Development › CI](development.md#ci)).
There is no `latest` tag: a deployment names the commit it runs. The package is private while the repository is;
pulling it needs a GitHub token with `read:packages`. Docker Hub (`surveyjs/surveyjs-studio`) comes with the self-hosted
track.

**A server for it.** [Setting up a Hetzner server](operations/hetzner-server-setup.md) walks through the server and its
firewall; then `deploy/hetzner/setup.sh` installs Docker and Caddy for https and starts the app, and
`deploy/hetzner/update.sh <tag>` deploys later tags, with a rollback when the new one is not healthy.

**No settings in the image.** `.dockerignore` keeps every `.env`, `*.env`, key and certificate file out of the build
(`pnpm check:deps` checks those lines), and the server package ships only `src` (without tests) and `fixtures`
(`files` in `server/package.json`). Before pushing an image, check that this prints nothing:
`docker run --rm --entrypoint sh surveyjs-studio:<tag> -c 'find /app -name "*.env*"'`.

## Monitoring

### Health and readiness

`/healthz` answers `200` while the process runs. The image's `HEALTHCHECK` calls it every 30 s, but it only marks
the container `unhealthy`: Docker does not restart it (`--restart unless-stopped` acts only when the process exits).
The host's monitoring, or an orchestrator, must alert on an `unhealthy` container and re-create it. `/readyz` checks
what the app needs, in parallel, each with a 5 s limit, and names the checks that failed. Calls that arrive together
share one run of the checks, and its answer, ready or not, is reused for 5 s: the stores see at most one check every
5 s, however often `/readyz` is called.

| Check             | When                            | What it does                                                           |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `sql`             | `STORAGE_PROVIDER=azure-legacy` | `SELECT 1` on the site database (also the `surveyjs-sql` users)        |
| `surveys-storage` | `STORAGE_PROVIDER=azure-legacy` | Reads the surveys account's properties and lists one table             |
| `results-storage` | `STORAGE_PROVIDER=azure-legacy` | The same on the results account                                        |
| `user-api`        | `USER_DIRECTORY=surveyjs-api`   | Looks up an id that never exists: `404` is ready, anything else is not |
| `memory`          | `STORAGE_PROVIDER=memory`       | Always ready                                                           |

```text
200 {"status":"ok"}
503 {"status":"unavailable","failing":["sql"]}
```

The answer never holds an error text, a host name or a key. The sign-in server (`auth.surveyjs.io`) is not checked on
purpose: when it is down, signing in fails and everything else keeps working. Alert when `/readyz` is not `200` for
more than a minute, and look at the logs for the reason. A check that starts failing logs one `warn` line,
`"msg":"readiness check failing"`, with `check` (its name) and `reason`: `timeout`; the driver's or storage SDK's
code (such as `ELOGIN`, `ESOCKET` or `AuthorizationFailure`), with any SQL error number or HTTP status; the user
API's `status 500` or `network error`; or just `error`. It is never the error's text, a host or a key. When the check
passes again, one `"msg":"readiness check ok again"` line follows; a check that keeps failing logs nothing more.

### Logs

The server writes one JSON object per line (pino) to standard output; the container's log driver collects them.
`LOG_LEVEL` (default `info`) is the only setting.

- **The start-up line** has `"msg":"starting"` and says what this process runs with: `edition`, `shell`,
  `storageProvider`, `userDirectory`, `identityProvider`, `accountNotices`, `readOnly`, `webApp` (whether `WEB_ROOT`
  is set), `publicBaseUrl` and `nodeEnv`. Check it after every start: in rollout step 1 it must say
  `"readOnly":true`.
- **Request lines.** Fastify writes `incoming request` and `request completed` (with the status and the time) for
  each request. Both carry `reqId`, and an API call also carries its `operationId` (for example `saveSurveyDefinition`).
  An incoming `x-request-id` of up to 128 characters is used as `reqId`, so a proxy's id links the two logs; every
  answer returns it in `x-request-id`.
- **Errors** are logged with `level` 50 and the error. The storage provider wraps a driver's error without its text,
  so a failing store never brings its server name, account or password into a log line (tests check this with a
  canary secret).
- **Never in a log line:** a connection string, a password, an account key, a secret, a session cookie, the sign-in
  callback's `code` and `state`, a respondent's `clientId` or answers. Client addresses are truncated.

Worth an alert: `/readyz` failing, a run of `5xx` answers (`"statusCode":5..` on `request completed`), and a container
that restarts.

## Read-only mode

`READ_ONLY=true` makes the app read-only: every operation that writes answers `503` with the Problem code `read-only`
("My Surveys is read-only at the moment. Changes cannot be saved."). Browsing, the results, the history, sign-in and
sign-out keep working. The web app shows that sentence in a banner on every page, and the editor opens read-only.
Change the setting and [re-create the container](#running-the-image) to switch.

- **Refused:** every operation that is not a `GET`, except `logout` and `passwordLogin`. Today that is the survey,
  project and member writes, the definition and theme saves, the uploads, Delete Results, the saved layouts, the
  respondent's submit and file upload, and the account-deleted webhook. A write operation added later is refused too
  until someone decides otherwise ([the API reference](api/README.md)).
- **The commands** refuse their writing form too: `account:erase --yes`, `account:reconcile --apply` and
  `smoke:legacy` exit 2 with `Refused: READ_ONLY=true …`. Their dry runs and the read-only inspectors work.
- **Use it** for rollout step 1 ([the runbook](#rollout-and-rollback-runbook)), and whenever the stores must not
  change, for example during maintenance on the site's database.
- **In mode 1.2 the account-deleted webhook is refused too** (`503`). The site should retry it later
  ([the integration](integrations/surveyjs-user-api.md#answers) asks for retries); `account:reconcile` catches an
  account whose retries ran out.

## Configuration by deployment mode

The deployment modes are described in [idea.md §3.0](../idea.md#30-deployment-modes-2026-10-19). One image serves them
all; this section lists the settings of each. In the tables, **required** means the server refuses to start without
it and names the variable; **set** means the default is wrong for the mode; **secret** values never go into a
repository, a ticket or a chat.

### Mode 1.1: hosted, side by side with the old section

The app at `https://studio.surveyjs.io` on the surveyjs.io SQL database and Azure storage accounts, with
surveyjs.io sign-in, while the old My Surveys section still runs.

| Variable                                   | Value                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`                          | Required: the https origin the browser uses, without a path                |
| `SESSION_SECRET`                           | Required: at least 32 random characters; **secret**                        |
| `APP_EDITION`                              | Set: `hosted` (the default is `self-hosted`)                               |
| `STORAGE_PROVIDER`                         | Set: `azure-legacy` (the default is `memory`)                              |
| `LEGACY_SQL_CONNECTION_STRING`             | Required: the site SQL database; **secret**                                |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | Required: the surveys storage account; **secret**                          |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | Required: the results storage account; **secret**                          |
| `IDENTITY_PROVIDER`                        | `surveyjs-oidc`, the default (`dev` is refused when `NODE_ENV=production`) |
| `OIDC_ISSUER_URL`                          | Required: `https://auth.surveyjs.io`                                       |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`     | Required: the client registered there; the secret is **secret**            |
| `ACCOUNT_NOTICES`                          | Set: `surveyjs-licenses` (the default is `none`)                           |
| `USER_DIRECTORY`                           | Leave unset: the default `surveyjs-sql` reads the site's `Users` table     |
| `TRUST_PROXY`                              | Set: the reverse proxy's address ([above](#running-the-image))             |
| `READ_ONLY`                                | `true` in rollout step 1, then unset or `false` (the default)              |
| `SURVEYJS_LICENSE_KEY`                     | Set: the SurveyJS licence key; without it the licence banner shows         |
| `NODE_ENV`, `HOST`, `PORT`, `WEB_ROOT`     | Set by the image; leave them                                               |

The other variables keep their defaults: the limits, the rate limits, `REQUEST_TIMEOUT_SECONDS`, `LOG_LEVEL`,
`OIDC_DISCOVERY` and `OIDC_SCOPES` (which fit `auth.surveyjs.io`), and `API_DOCS` (off in production: the reference is
in the repository). The accounts settings are [below](#configuring-accounts). Register
`<PUBLIC_BASE_URL>/api/v1/auth/callback` as the client's redirect URI and `<PUBLIC_BASE_URL>/` as its address after
sign-out.

An env file for mode 1.1, with placeholders:

```text
PUBLIC_BASE_URL=https://studio.surveyjs.io
SESSION_SECRET=<at least 32 random characters>
APP_EDITION=hosted
STORAGE_PROVIDER=azure-legacy
LEGACY_SQL_CONNECTION_STRING=<the site database>
LEGACY_SURVEYS_STORAGE_CONNECTION_STRING=<the surveys storage account>
LEGACY_RESULTS_STORAGE_CONNECTION_STRING=<the results storage account>
OIDC_ISSUER_URL=https://auth.surveyjs.io
OIDC_CLIENT_ID=<the client id>
OIDC_CLIENT_SECRET=<the client secret>
ACCOUNT_NOTICES=surveyjs-licenses
SURVEYJS_LICENSE_KEY=<the SurveyJS licence key>
TRUST_PROXY=<the proxy's address>
READ_ONLY=true
```

Make a session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
Changing it signs everyone out.

**Credentials for the stores.** Use connection strings with an **account key** or an **account SAS** (Blob and Table
services; service, container and object resource types; read, add, create, write, update, delete and list). The app
creates tables and containers on demand (a survey's `post{postId}` and `SurveyCompletion{id}` tables, its own
`my-surveys-files` and `my-surveys-views` containers), which a container-scoped SAS cannot do, and readiness reads
account properties. An account SAS expires: renew it, and re-create the container, before then. The SQL login needs
read and write on the site's tables. Least privilege (Entra ID roles for the app, containers and tables created ahead)
is later hardening, not done yet. The read-only inspectors can use narrower credentials
([Development › Inspector](development.md#inspector)).

### Mode 1.2: hosted, replacing the old section

The same as 1.1, after the site has removed My Surveys (rollout step 4). The app adds one setting:

| Variable                 | Value                                                               |
| ------------------------ | ------------------------------------------------------------------- |
| `ACCOUNT_WEBHOOK_SECRET` | Set: the site signs the account-deleted webhook with it; **secret** |

How to make it and share it: [the webhook secret](#the-webhook-secret).

When surveyjs.io has built its user API, switch to it at any time in mode 1.1 or 1.2: `USER_DIRECTORY=surveyjs-api`,
`USER_API_URL` and `USER_API_TOKEN` (**secret**). `/readyz` then also checks `user-api`
([Configuring accounts](#configuring-accounts)).

### Mode 4: development

The local configurations, for development, tests and demos. None of them touches real data except the two runs on
production data, which are for the product owner only. [Running the app](running.md) has the commands.

| Configuration      | Storage and users                                  | Sign-in                                         | Settings file                                   |
| ------------------ | -------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Memory demo        | `memory`, `MEMORY_SEED=legacy-fixtures`            | `IDENTITY_PROVIDER=dev`, the "Sign in as…" page | `server/demo.env`                               |
| Azurite demo       | `azure-legacy` on Azurite and SQL Server in Docker | `surveyjs-oidc` against the mock OIDC server    | `docker/azurite.env`, `server/demo-azurite.env` |
| Prod-like          | The image in the mode 1 configuration, on Azurite  | `surveyjs-oidc` against the mock OIDC server    | `docker/prod-like.env`                          |
| On production data | `azure-legacy` on the real stores                  | `surveyjs-oidc` against a local the site's sign-in service   | `server/.env` (never committed)                 |

The dev sign-in is refused at start-up when `NODE_ENV=production` or `APP_EDITION=hosted`, so it cannot reach a
hosted deployment by mistake.

### Modes 2b and 3: coming with the self-hosted track

The free Docker image (2b) and custom development (3) are built by the self-hosted track
([spec](../spec-self-hosted.md), [plan](../plan-self-hosted.md)). Step 12 already defined their account settings,
and today the server refuses them at start-up with a message that names the track:

| Variable         | Mode 2b       | Mode 3                                                           |
| ---------------- | ------------- | ---------------------------------------------------------------- |
| `USER_DIRECTORY` | `local`       | `local`                                                          |
| `AUTH_METHODS`   | `password`    | `password` and any of `surveyjs`, `google`, `github`, `facebook` |
| `APP_EDITION`    | `self-hosted` | `self-hosted`                                                    |

The track adds the SQL storage providers, the "Powered by SurveyJS" shell and the settings they need. Mode 1.3 (the
hosted data off Azure) is the hosted-migration track's ([plan](../plan-hosted.md)); its users come through
`USER_DIRECTORY=surveyjs-api`.

## Configuring accounts

Users come from a **user directory**. Which one is a setting, and some combinations cannot work: the server then
refuses to start and names the variable ([ADR 0018](adr/0018-accounts-by-deployment-mode.md)).

| Variable                 | Values                                                                 | Meaning                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER_DIRECTORY`         | `memory`, `surveyjs-sql`, `surveyjs-api`, `local`                      | Where users come from. Default `memory` with `STORAGE_PROVIDER=memory`, else `surveyjs-sql`. `local` is refused: the self-hosted track builds it                 |
| `USER_API_URL`           | An http(s) URL, such as `https://users.example.com/api`                | The base URL of the surveyjs.io user API. Required for `surveyjs-api`. https unless the host is `localhost`, `127.0.0.1` or `[::1]`. A trailing slash is dropped |
| `USER_API_TOKEN`         | A string; **secret**                                                   | The bearer token for the user API. Required for `surveyjs-api`. Never logged                                                                                     |
| `ACCOUNT_NOTICES`        | `none`, `license-expired`, `license-expires-soon`, `surveyjs-licenses` | The notices of `getCurrentUser`. `surveyjs-licenses` reads real licences and needs `surveyjs-sql` or `surveyjs-api`                                              |
| `ACCOUNT_WEBHOOK_SECRET` | `whsec_` and base64 of at least 24 bytes; **secret**                   | Signs the account-deleted webhook. Unset: the webhook answers `404` (`503 read-only` while `READ_ONLY=true`); [the secret](#the-webhook-secret)                  |

**The rules, all reported together at start-up:**

- `USER_DIRECTORY=memory` needs `STORAGE_PROVIDER=memory`; `surveyjs-sql` needs `STORAGE_PROVIDER=azure-legacy`. These
  apply to an explicit value only: the default always fits.
- `surveyjs-api` needs `USER_API_URL` and `USER_API_TOKEN`.
- `AUTH_METHODS` may list `surveyjs`, `password`, `google`, `github` and `facebook`, but only **`surveyjs`** can start
  today: each of the others needs `USER_DIRECTORY=local` and says so. `oidc` is no longer a value.
- `ACCOUNT_NOTICES=surveyjs-licenses` needs `USER_DIRECTORY=surveyjs-sql` or `surveyjs-api`.

**The usual settings in mode 1** (the hosted app for surveyjs.io users):

```text
# Now (1.1): read the site's users from its SQL database
STORAGE_PROVIDER=azure-legacy        # with the three LEGACY_* connection strings
ACCOUNT_NOTICES=surveyjs-licenses    # USER_DIRECTORY defaults to surveyjs-sql

# When the surveyjs.io user API exists
USER_DIRECTORY=surveyjs-api
USER_API_URL=https://<the site's API address>
USER_API_TOKEN=<the service key>     # secret
ACCOUNT_NOTICES=surveyjs-licenses
ACCOUNT_WEBHOOK_SECRET=whsec_…       # secret; the same one the site signs with
```

With the user API, a failed call (a time-out, a network error, any status but `200` and `404`) is an error and never
read as "unknown". `/readyz` then checks the API too (`user-api`): a lookup of an id that never exists must answer
`404` within 5 s.

## Erasing an account's data

Two commands erase the data of an account, and the webhook does the same when surveyjs.io calls it
([the API](api/README.md#step-12-the-account-deleted-webhook)). What is erased: the user's **personal surveys** (archived
ones too) with their results, files, history and layouts; and the user's **place in every project**. A project whose
last admin leaves passes to its next member (by display name), who becomes an admin; a project with no other member is
deleted with its surveys. **What stays**: the user's saved layouts on surveys they do not own, history entries that
name them, `creatorId` on project surveys, and the legacy `postdelete` copies
([ADR 0018, Open](adr/0018-accounts-by-deployment-mode.md#open)).

Both commands need a **persistent store** (`STORAGE_PROVIDER=azure-legacy`): a memory store lives inside the server
process, so they refuse it and say so. They read the same settings as the server, including `USER_DIRECTORY` (and
`USER_API_URL` and `USER_API_TOKEN` for the API), but skip the sign-in settings. Put the settings in the shell, or in a
file given with `--env-file` (variables already set win). **Keep that file outside the repository** and never commit it.

### `pnpm account:erase`

```sh
pnpm account:erase --user <id or email> [--yes] [--env-file <path>]
```

- Without `--yes` it is a **dry run**: it prints the account, the personal surveys it would delete, and for each
  project what happens (`leaves the project`, `<id> becomes an admin`, or `the project is deleted with its N
surveys`), and writes nothing. The **final decision for each project is made at erase time** and can differ from the
  plan, because the preview works from the visible members and the store decides again under its lock.
- With `--yes` it erases and prints `Erased <id>: <s> surveys deleted, <l> projects left, <d> projects deleted, <p>
admins promoted.`
- An **email** is looked up in the user directory; an unknown email exits 1. An **id** is erased even when the
  directory does not know it. **If the directory lookup fails** (it only supplies the name for the plan), the command
  exits **1 and erases nothing**; run it again when the directory is back.
- Erasing twice is harmless: the second run finds nothing.
- With `READ_ONLY=true` it refuses `--yes` (`Refused: READ_ONLY=true`, exit 2) before it opens the stores; the dry
  run still works.
- Exit codes: `0` success (or a dry run), `1` the user is not found or a store or directory error, `2` a usage error, an
  unreadable env file, no persistent store or `--yes` with `READ_ONLY=true`.

### Reconciling accounts

```sh
pnpm account:reconcile [--apply] [--max <n>] [--env-file <path>]
```

This is the safety net for a webhook that never arrived. It collects every id that owns a personal survey or holds a
project membership, asks the user directory which of them it **positively does not know**, and lists them. **Run it
without `--apply` first.** With `--apply` it erases each listed id as `account:erase` does, **unless there are more than
`--max`** (default 10): then it erases nothing, prints `Refused: …` and exits 1. If the directory fails, the run stops
with nothing erased and exits 1; a failure is never read as "unknown".

- **The list can hold more than people.** It names owner ids the directory does not know. When surveys still point at
  a project whose row is gone (a "dangling project id"), that id is listed too, and `--apply` would delete those
  surveys, which nobody could open. The dry run shows them and `--max` covers them: look before you apply.
- **An erased id is not listed again.** Erasure deletes every row the list is built from, also legacy rows the app
  cannot show (a membership with no role, a survey without a post id, a membership of a project whose row is gone), so
  an id that was erased once does not come back on every run and does not count against `--max`. If an id is listed
  after an `--apply` run, something new was written for it (for example by a browser session that was still open);
  the next run erases that too.
- **The first run on 1.1 will find users the legacy site already deleted.** The old site removes the user and the
  personal surveys but leaves memberships, so their ids still appear. Review that first list; apply it once by hand
  with a `--max` that fits it; only then schedule the command.
- With `READ_ONLY=true` it refuses `--apply` (`Refused: READ_ONLY=true`, exit 2) before it opens the stores; the
  dry run still works.
- Exit codes: `0` success (or a dry run, or nothing to erase), `1` refused or a store or directory error, `2` a
  usage error, an unreadable env file, no persistent store or `--apply` with `READ_ONLY=true`.
- **`listPersonalOwnerIds` reads the whole `Surveys` table** (an index on `userid` exists). Measure the run time of
  the first dry run on production before scheduling it (rollout step 4).

**Scheduling it.** It is a command for the operator's scheduler, not a timer inside the server: several instances
would race. A daily run is enough. Give the job the same settings as the server (the `LEGACY_*` connection strings, and
`USER_DIRECTORY` with `USER_API_URL` and `USER_API_TOKEN`), through its environment or an env file kept outside the
repository with restricted permissions. For example, a cron job that first only reports, and that you change to
`--apply --max 10` after you have reviewed the first list:

```text
0 3 * * *  cd /srv/surveyjs-studio && node --import tsx server/src/cli/account-reconcile.ts -- --env-file /etc/surveyjs-studio/accounts.env >> /var/log/surveyjs-studio/reconcile.log 2>&1
```

Alert on a non-zero exit: it means a refusal (more candidates than `--max`, which is worth a look), or a store or
directory failure.

## The webhook secret

The account-deleted webhook is signed with a secret of the form `whsec_` and the base64 of at least 24 random bytes
([Standard Webhooks](https://www.standardwebhooks.com/)). The server has it in `ACCOUNT_WEBHOOK_SECRET`; surveyjs.io
keeps the same value. A server without it answers the webhook with `404` (`503 read-only` while `READ_ONLY=true`,
which refuses every call before the signature is checked). A malformed value stops the server at start-up, without
printing it. The site calls `POST <PUBLIC_BASE_URL>/api/v1/webhooks/account-deleted`
([the integration](integrations/surveyjs-user-api.md#the-account-deleted-webhook)).

**Generate one:**

```sh
node -e "console.log('whsec_' + require('node:crypto').randomBytes(32).toString('base64'))"
```

Give it to the site through a secure channel and set it in the server's environment, never in a file of the
repository. The demo secret in `server/demo.env` is a local test value; **never use it anywhere else**.

**Rotate it by dual signing.** The server holds one secret, so the site bridges the change:

1. The site starts signing each message with both the old and the new secret, sending both signatures in
   `webhook-signature` (`v1,<old> v1,<new>`). The server accepts either while it still has the old secret.
2. Set the new secret in `ACCOUNT_WEBHOOK_SECRET` and [re-create the container](#running-the-image). The new
   signature now matches.
3. The site stops signing with the old secret.

The same applies to the user API token: the site accepts two tokens at a time, so change `USER_API_TOKEN` between the
two steps ([the API document](integrations/surveyjs-user-api.md#authentication)).

## The header policy

The server sends the security headers of every answer itself, so the reverse proxy only passes them through. Two
policies apply, chosen by the path ([ADR 0021](adr/0021-production-image-and-web-serving.md),
[ADR 0019](adr/0019-run-page-isolation-and-security-headers.md)):

| Path                                                | What answers                                           | `Content-Security-Policy`                             |
| --------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `/api`, `/api/*`, `/__dev/*`, `/healthz`, `/readyz` | The server's routes; an unknown one is a `404` Problem | `default-src 'none'; frame-ancestors 'none'`          |
| `/api/docs` (only with `API_DOCS=true`)             | The API reference                                      | `frame-ancestors 'none'` (it needs its inline script) |
| `/s/*`                                              | The web app: the run page                              | The web app's policy with `frame-ancestors *`         |
| Anything else                                       | The web app: a file, or `index.html`                   | The web app's policy with `frame-ancestors 'none'`    |

The dev sign-in page and the file downloads under `/api` set policies of their own. Every answer also has:

```text
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000      (only when PUBLIC_BASE_URL is https)
```

**The web app's policy** (from `server/src/web/security-headers.ts`):

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- **`frame-ancestors` per route.** `'none'` everywhere, except `/s/*` (the run page), which is `*`: a hosted survey is
  embedded as a frame of its run address. Everything else in the policy is the same.
- **Scripts only from the app.** There is no `unsafe-inline` and no `unsafe-eval` in `script-src`, and no host is
  allowed. Do not add one. `https:` is allowed for images, media, data and frames because surveys use them.
- **Status and caching.** A client route (`/`, `/projects`, `/surveys/<id>/edit|history|results`, `/s/<id>`,
  `/results/<id>`) answers `index.html` with `200`; any other path gets the same page with `404` and the app's "Page
  not found", so an old address such as `/published?id=…` stays a real `404`. `/assets/*` (hashed names) are cached
  for a year (`immutable`); `index.html` is `no-cache`.

**The reverse proxy** must not replace or drop these headers, and must not add its own `Content-Security-Policy` or an
`X-Frame-Options` (which would stop embedded run pages). It may add compression. If it sets `x-request-id`, it must
overwrite one a client sent, so a caller cannot choose the id that appears in the logs.

**Another static host.** If the web app is ever served apart from the server (a CDN for `web/dist`), that host must
send the same values per path and route the server paths above to the server; otherwise the run page loses its
protection against a script in a survey. `vite preview` (and `pnpm demo:preview`, and the end-to-end tests) send them
from the same module; the Vite dev server (`pnpm demo`) sends none.

**Check it** after each deployment:

```sh
curl -sI https://<host>/ | grep -i content-security-policy                 # web policy, frame-ancestors 'none'
curl -sI https://<host>/s/<a survey id> | grep -i content-security-policy  # web policy, frame-ancestors *
curl -sI https://<host>/api/v1/config | grep -i content-security-policy    # default-src 'none'
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/no-such-page          # 404
```

## Rollout and rollback runbook

For the SurveyJS team and the surveyjs.io site team. It takes My Surveys from the old section of surveyjs.io to
`https://studio.surveyjs.io` in four steps, then lists the rollback of each step and the handover to the
hosted-migration track ([plan.md › After Phase 1](../plan.md#after-phase-1)). Phase 1 moves no data: the app reads and writes the existing stores in
their formats, and the old section and `api.surveyjs.io` keep working on the same data. Go to the next step only when
the current one has run without problems for as long as the team wants.

### What each step needs

| Input                                                                      | From                   | Step |
| -------------------------------------------------------------------------- | ---------------------- | ---- |
| The host, its outbound address, DNS for `studio.surveyjs.io`, https        | The hosting step       | 1    |
| The client registration at `auth.surveyjs.io` (id and secret)              | Site team              | 1    |
| Network rules for the host on the SQL server and both storage accounts     | Whoever runs Azure     | 1    |
| The store connection strings (account key or account SAS)                  | Whoever runs Azure     | 1    |
| The SurveyJS licence key, at the latest for step 2                         | SurveyJS team          | 1    |
| A test account used for nothing else, and its `api.surveyjs.io` access key | Product owner          | 1    |
| The header's account item and the 1,000-responses banner (ADR 0020)        | Product owner          | 2    |
| The run page's "Disclaimer of liability" (ADR 0020, ADR 0014 S13)          | Product owner          | 3    |
| The redirects and the new links on the site                                | Site team              | 3    |
| The webhook secret, and the site's call on account deletion                | Operator and site team | 4    |
| The user API's address and token, once the site has built it               | Site team              | Any  |

There is no staging copy of the data: the compatibility smoke test runs on production with the dedicated test account
(product owner's decision, 2026-10-21), and touches only that account's data.

### Step 1: internal use on production data, read-only first

1. **Register the app at `auth.surveyjs.io`** (site team): a confidential client with the redirect URI
   `https://studio.surveyjs.io/api/v1/auth/callback` and the address after sign-out
   `https://studio.surveyjs.io/`. Hand the client id and secret to the operator through a secure channel.
2. **Open the network** (Azure): add the host's outbound address to the Azure SQL server's firewall rules and to the
   network rules of the surveys and the results storage accounts. Keep the address of the machine that runs the
   commands below allowed too, or run them from the host.
3. **Write the env file on the host**: the [mode 1.1 settings](#mode-11-hosted-side-by-side-with-the-old-section) with
   `READ_ONLY=true`, `TRUST_PROXY` and `SURVEYJS_LICENSE_KEY`. `chmod 600`; outside any repository. Without the
   licence key the editor and the results pages show the SurveyJS libraries' missing-licence banner: acceptable for
   the team, not for step 2.
4. **Check the schema** from a checkout of this repository, with an env file holding at least
   `LEGACY_SQL_CONNECTION_STRING`. A read-only login is enough, but SQL Server hides the metadata of objects a login
   has no permission on: with `SELECT` alone the triggers and the column default may not show, and the check would
   print `none` for them either way. Give that login `VIEW DEFINITION` on `Surveys`, or use the app's login:

   ```sh
   pnpm inspect:legacy-schema --env-file <path>
   ```

   On 2026-10-22 production printed `Surveys.theme: varchar(max) COLLATE SQL_Latin1_General_CP1_CI_AS`,
   `Surveys triggers: none`, `Surveys.ispublished: tinyint, nullable yes, default none` and N of N surveys
   with an empty `ispublished`. If the theme column or the triggers differ, stop: the theme save's compare-and-set
   needs a look ([ADR 0012](adr/0012-editor-content-and-history.md)).

5. **Start the container** ([Running the image](#running-the-image)) and check:
   - `GET /healthz` is `200` and `GET /readyz` is `{"status":"ok"}` (on the host, or from the monitor's address);
   - the `starting` log line says `"readOnly":true`, `"webApp":true`, `"storageProvider":"azure-legacy"`,
     `"userDirectory":"surveyjs-sql"` and the right `publicBaseUrl`;
   - the headers, with the `curl` commands of [the header policy](#the-header-policy);
   - `TRUST_PROXY`: after a request from your browser, an `incoming request` log line shows your own address,
     truncated, in `remoteAddress`, not the proxy's ([Running the image](#running-the-image)).
6. **Browse read-only.** Team members sign in with their surveyjs.io accounts and open the list, the projects, the
   editor, the results and the history of their own surveys. Every page shows the read-only banner, and a save is
   refused with it. Nothing is written.
7. **Run the smoke test while the app is still read-only.** The script writes through the app's code in its own
   process, with its own env file, so the container's `READ_ONLY` does not matter to it; a `FAIL` then stops the
   rollout before anyone writes through the app ([Legacy smoke test](operations/smoke-test.md)):

   ```sh
   pnpm smoke:legacy --account <test account email> --yes --env-file <path>
   ```

   Its env file has write credentials and `SMOKE_ACCESS_KEY`, and **not** `READ_ONLY=true`: a copy of the container's
   file from this step makes it refuse (exit 2). Every row must be `pass` (and `manual` for the project delete). A
   `FAIL` stops the rollout until it is understood.

8. **Switch to read-write**: set `READ_ONLY=false` (or remove the line), [re-create the container](#running-the-image)
   and check that the `starting` line says `"readOnly":false`. Then walk the smoke test's
   [manual checklist](operations/smoke-test.md#manual-checklist-on-surveyjsio) on surveyjs.io: it needs surveys made in
   the app.
9. **Internal use.** The team works in the app on real surveys for a while, side by side with the old section.

Nothing in the app limits sign-in to the team: anyone with a surveyjs.io account who finds the address can use it, on
their own surveys, as in the old section. If that matters during this step, limit access at the reverse proxy (an
address allow-list, for example).

**What the team will see that differs from the old section** (expected, not failures):

- **The published flag.** most of production surveys have an empty `ispublished` (never switched on the old site).
  The app reads an empty flag as published, as the old run page does, and lists those surveys with **Run** and
  **Unpublish**; the old list shows **Publish** for them. Nothing rewrites the stored flags
  ([ADR 0014](adr/0014-run-page-and-response-collection.md), S1). New and cloned surveys keep an empty flag on both
  sides.
- **History saved before the site's fix was deployed.** The old site's history writer was fixed in surveyjs.io commit
  `3389d6cd49` ("Fix empty survey editing history page", 2026-10-20); since its deployment both sides write and
  list `surveyjsonhistory/{surveyId}/{pointId}`. Points the old code wrote before that are lost to both sides: a new
  survey's points went to the container's root as `{pointId}` and belong to no survey, and an older survey's later
  saves rewrote its first point instead of adding one. Nothing migrates them
  ([legacy data layout, 3.4](architecture/legacy-data-layout.md#34-survey-history-blob-container-surveyjsonhistory)).

### Step 2: an opt-in beta link from the old section

**Before:** the product owner has answered the header's account item and the 1,000-responses banner
([ADR 0020 › To confirm](adr/0020-visual-parity-baselines.md#to-confirm)): real users see both from this step on.

1. The site team adds a link from the old My Surveys page to `https://studio.surveyjs.io/` (for example "Try the
   new My Surveys"). Both sections keep working on the same data; a user can go back at any time.
2. Watch `/readyz`, the `5xx` answers and the errors in the logs; a support report can be matched to the logs by the
   time, and by `x-request-id` if the user can send it.

### Step 3: the redirects, the app becomes the default

**Before:** the product owner has decided the run page's "Disclaimer of liability"
([ADR 0020](adr/0020-visual-parity-baselines.md#to-confirm), [ADR 0014](adr/0014-run-page-and-response-collection.md)
S13): after this step respondents no longer see the old run page.

1. The site team switches on the redirects of [the redirect map](operations/surveyjs-redirects.md) and checks them as
   it describes.
2. The site's "My Surveys" and "All-in-One Demo" links point to the app.
3. The old pages still exist; only the redirects lead users away from them.

### Step 4: the site removes My Surveys, the webhook goes on

This step makes it mode 1.2.

1. **The webhook secret** (operator): generate it ([the webhook secret](#the-webhook-secret)), set
   `ACCOUNT_WEBHOOK_SECRET` in the env file, [re-create the container](#running-the-image), and give the same value to
   the site team through a secure channel. Check that it took effect: an unsigned call must answer `401` (it was
   `404` without the secret; `503` means the app is still read-only):

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' \
     https://studio.surveyjs.io/api/v1/webhooks/account-deleted
   ```

2. **The site** removes the My Surveys section and **Settings → Manage MySurveys** (D13), and calls the
   [account-deleted webhook](integrations/surveyjs-user-api.md#the-account-deleted-webhook) instead of deleting My
   Surveys data itself. Keep what the redirect map lists under
   [What else changes on the site](operations/surveyjs-redirects.md#what-else-changes-on-the-site): the free creator
   pages share old views, and `api.surveyjs.io` still uses the shared storage code.
3. **Reconcile once by hand** (operator): run `pnpm account:reconcile` without `--apply`, review the list (the old site
   left the memberships of users it deleted), measure how long it takes, apply it once with a `--max` that fits, then
   schedule it daily ([Reconciling accounts](#reconciling-accounts)).

### Step 5: rollback

| After step | To roll back                                                                                  | Who       |
| ---------- | --------------------------------------------------------------------------------------------- | --------- |
| 1          | Stop and remove the container. Nothing on the site changed                                    | Operator  |
| 2          | Remove the beta link                                                                          | Site team |
| 3          | Remove the redirects and point the site's links back to the old section                       | Site team |
| 4          | Redeploy the previous site release: the old pages exist only there. Then remove the redirects | Site team |
| Any        | Re-create the container with the previous tag: no migrations, it runs on the same data        | Operator  |

What users wrote in the app stays valid after any rollback: the app writes the legacy formats, which the old section
and `api.surveyjs.io` read. After rolling back step 4 the old site deletes My Surveys data itself again when an account
is deleted; the webhook can stay configured, and `account:reconcile` catches what either side misses.

### Step 6: handover to the hosted-migration track (mode 1.3)

The hosted-migration track ([plan](../plan-hosted.md)) starts from this state. Check each item when the track begins:

- [ ] **The data is still on the legacy stores**: the site's SQL database (`Surveys`, `Users`, `Organizations`,
      `OrganizationUsers`), the surveys storage account (definitions, history, the `surveys` event table, the app's
      `my-surveys-files` and `my-surveys-views`) and the results storage account (`post{postId}`,
      `SurveyCompletion{id}`, `postdelete{postId}`), as the [legacy data layout](architecture/legacy-data-layout.md)
      describes.
- [ ] **`api.surveyjs.io` still serves legacy clients** on the same data (D1). `pnpm smoke:legacy` protects it until
      1.3 replaces it with the compatibility layer (D18).
- [ ] **The running configuration**: the image tag and its commit, the env file's variable names (not values), and
      who holds each secret (the session secret, the OIDC client, the connection strings, the webhook secret, the user
      API token).
- [ ] **The user directory** in use (`surveyjs-sql` or `surveyjs-api`) and the state of the site's user API.
- [ ] **The scheduled jobs**: `account:reconcile`, its schedule and its alert.
- [ ] **The redirects** and where they live on the site; 1.3 keeps them.
- [ ] **Open items carried over**: least-privilege store credentials (above); the race between creating or moving a
      survey and deleting its project on Azure ([ADR 0010](adr/0010-writing-to-the-legacy-stores.md)); the empty
      published flags left as they are, and a setting for the initial state of new surveys
      ([ADR 0014, Open](adr/0014-run-page-and-response-collection.md#open)); the history points lost before the site's
      fix (step 1); a cookie-less run-page origin and CORS ([ADR 0019, Open](adr/0019-run-page-isolation-and-security-headers.md#open)).
