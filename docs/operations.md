# Operations

For the people who run My Surveys. This is the first version: it covers the settings for accounts, the two commands that
erase an account's data, the webhook secret and the header policy a static host must send. Everything else about
configuration is in [Development](development.md#environment-variables-server).

Commands are for Git Bash or any POSIX shell, from the repository root, with Node.js 24.

## Configuring accounts

Users come from a **user directory**. Which one is a setting, and some combinations cannot work: the server then
refuses to start and names the variable ([ADR 0018](adr/0018-accounts-by-deployment-mode.md)).

| Variable                 | Values                                                                 | Meaning                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `USER_DIRECTORY`         | `memory`, `surveyjs-sql`, `surveyjs-api`, `local`                      | Where users come from. Default `memory` with `STORAGE_PROVIDER=memory`, else `surveyjs-sql`. `local` is refused: the self-hosted track builds it                 |
| `USER_API_URL`           | An http(s) URL, such as `https://users.example.com/api`                | The base URL of the surveyjs.io user API. Required for `surveyjs-api`. https unless the host is `localhost`, `127.0.0.1` or `[::1]`. A trailing slash is dropped |
| `USER_API_TOKEN`         | A string; **secret**                                                   | The bearer token for the user API. Required for `surveyjs-api`. Never logged                                                                                     |
| `ACCOUNT_NOTICES`        | `none`, `license-expired`, `license-expires-soon`, `surveyjs-licenses` | The notices of `getCurrentUser`. `surveyjs-licenses` reads real licences and needs `surveyjs-sql` or `surveyjs-api`                                              |
| `ACCOUNT_WEBHOOK_SECRET` | `whsec_` and base64 of at least 24 bytes; **secret**                   | Signs the account-deleted webhook. Unset: the webhook answers `404` (see [the secret](#the-webhook-secret))                                                      |

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
read as "unknown". The API's readiness is not part of `/readyz` yet.

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
- Exit codes: `0` success (or a dry run), `1` the user is not found or a store or directory error, `2` a usage error, an
  unreadable env file or no persistent store.

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
- Exit codes: `0` success (or a dry run, or nothing to erase), `1` refused or a store or directory error, `2` a
  usage error, an unreadable env file or no persistent store.
- **`listPersonalOwnerIds` reads the whole `Surveys` table** (an index on `userid` exists). Measure the run time on
  production data before scheduling it (Step 14).

**Scheduling it.** It is a command for the operator's scheduler, not a timer inside the server: several instances
would race. A daily run is enough. Give the job the same settings as the server (the `LEGACY_*` connection strings, and
`USER_DIRECTORY` with `USER_API_URL` and `USER_API_TOKEN`), through its environment or an env file kept outside the
repository with restricted permissions. For example, a cron job that first only reports, and that you change to
`--apply --max 10` after you have reviewed the first list:

```text
0 3 * * *  cd /srv/my-surveys && node --import tsx server/src/cli/account-reconcile.ts -- --env-file /etc/my-surveys/accounts.env >> /var/log/my-surveys/reconcile.log 2>&1
```

Alert on a non-zero exit: it means a refusal (more candidates than `--max`, which is worth a look), or a store or
directory failure.

## The webhook secret

The account-deleted webhook is signed with a secret of the form `whsec_` and the base64 of at least 24 random bytes
([Standard Webhooks](https://www.standardwebhooks.com/)). The server has it in `ACCOUNT_WEBHOOK_SECRET`; surveyjs.io
keeps the same value. A server without it answers the webhook with `404`. A malformed value stops the server at
start-up, without printing it.

**Generate one:**

```sh
node -e "console.log('whsec_' + require('node:crypto').randomBytes(32).toString('base64'))"
```

Give it to the site through a secure channel and set it in the server's environment, never in a file of the
repository. The demo secret in `server/demo.env` is a local test value; **never use it anywhere else**.

**Rotate it by dual signing.** The server holds one secret, so the site bridges the change:

1. The site starts signing each message with both the old and the new secret, sending both signatures in
   `webhook-signature` (`v1,<old> v1,<new>`). The server accepts either while it still has the old secret.
2. Set the new secret in `ACCOUNT_WEBHOOK_SECRET` and restart the server. The new signature now matches.
3. The site stops signing with the old secret.

The same applies to the user API token: the site accepts two tokens at a time, so change `USER_API_TOKEN` between the
two steps ([the API document](integrations/surveyjs-user-api.md#authentication)).

## The header policy for the static host

The server sends its own security headers on every answer. The **web app's pages** are static files, and their
headers come from whoever serves them. `vite preview` (and `pnpm demo:preview`, and the end-to-end tests) send them
from `server/src/web/security-headers.ts`, as does the server itself when `WEB_ROOT` is set; **a production host must send the same values**, or the run page loses its protection
against a script in a survey ([ADR 0019](adr/0019-run-page-isolation-and-security-headers.md)). The Vite dev server
(`pnpm demo`) sends none.

**For every page except the run page:**

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000
```

- **`frame-ancestors` per route.** `'none'` everywhere, except `/s/*` (the run page), which is `*`: a hosted survey is
  embedded as a frame of its run address. Everything else in the policy is the same.
- **HSTS only on HTTPS.** Send `Strict-Transport-Security` only when the site is served over https. Never on plain http.
- **Scripts only from the app.** There is no `unsafe-inline` and no `unsafe-eval` in `script-src`, and no host is
  allowed. Do not add one. `https:` is allowed for images, media, data and frames because surveys use them.
- **Paths that go to the server keep the server's headers**: do not add these to `/api` (and `/__dev`, `/healthz`,
  `/readyz`). The server's policy there is `default-src 'none'; frame-ancestors 'none'` (for `/api/docs`, only
  `frame-ancestors 'none'`).
- Check it with `curl -sI https://<host>/` and `curl -sI https://<host>/s/<a survey id>`: the first must say
  `frame-ancestors 'none'` and the second `frame-ancestors *`.
