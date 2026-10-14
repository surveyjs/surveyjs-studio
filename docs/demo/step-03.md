# Demo: Step 3, sign-in, session and the surveyjs.io shell

This page lets you check Step 3 without reading code. It takes about twenty minutes (the Azurite
part pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or
any POSIX shell); in PowerShell the same commands work, except where a variable is set.

What Step 3 delivers: sign-in and sign-out, a stateless session with CSRF protection, private pages
that send an anonymous visitor to sign-in, `GET /me` with account notices, and the **surveyjs.io
shell** (header with the account menu, footer, cookie banner and licence dialogs, copied from
surveyjs.io). There are still no survey screens: the home page shows who is signed in.

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2).
Run `pnpm install` once. Ports 3000 and 5173 must be free. For part 4 you also need Docker with
Compose, and the ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts (synthetic; in memory mode they come from `MEMORY_SEED=legacy-fixtures`, in Azurite
mode from the replica):

| Name           | Email                  | Type in the mock OIDC form | Use                   |
| -------------- | ---------------------- | -------------------------- | --------------------- |
| Olivia Owner   | `owner@example.com`    | `owner`                    | The user of this demo |
| Adam Admin     | `admin@example.com`    | `admin`                    |                       |
| Mia Member     | `member@example.com`   | `member`                   |                       |
| Oscar Outsider | `outsider@example.com` | `outsider`                 |                       |
| (blocked)      | `blocked@example.com`  | `blocked`                  | Sign-in answers `403` |

## 1. Sign in (memory mode)

```sh
pnpm demo
```

Expected: the same output as in Step 1, and a warning line
`SESSION_SECRET is not set: using the development-only session secret`. That is normal here.

Before signing in, ask the API who you are:

```sh
curl -i http://localhost:3000/api/v1/me
```

PowerShell: `curl.exe -i http://localhost:3000/api/v1/me`.

Expected: `HTTP/1.1 401 Unauthorized` and a Problem body with `"code":"unauthenticated"`.

Now open <http://localhost:5173/>.

Expected:

- The browser is sent to `http://localhost:5173/__dev/sign-in?state=...`, a plain page titled
  **Sign in as…**, with a list of five people. The blocked one is shown by email and marked
  "blocked". The page says that no password is asked.
- Click **Olivia Owner**. You land on `http://localhost:5173/`.
- The page shows the surveyjs.io header: the SurveyJS logo, the menus, and, at the right, an account
  icon with the name **Olivia Owner**. Below the content there is the surveyjs.io footer, and at the
  bottom a **Your cookie settings** banner. The page text says `signed in as: Olivia Owner`,
  `edition: self-hosted`, `shell: surveyjs-site`.
- Hover over the name (or Tab to it and press Enter). The menu shows **Settings**, **Help Desk**,
  **Billing** and **Sign Out**. Settings opens `https://surveyjs.io/manage`.

Click **Accept All** in the cookie banner. It closes and does not come back after a reload.

Open the browser's developer tools, then Application (Storage), Cookies. Expected: `msid` (HttpOnly),
`msid_csrf` (not HttpOnly), both with an expiry of about 12 hours.

## 2. A deep link survives sign-in

Open a private window (so there is no session) and go to:

<http://localhost:5173/?project=personal&archived=true>

Expected: the "Sign in as…" page. Choose **Adam Admin**.

Expected: you land on `http://localhost:5173/?project=personal&archived=true` (the same path and
query), and the header shows **Adam Admin**.

`returnTo` only accepts a path on this site. A link that points elsewhere is refused:

```sh
curl -i "http://localhost:3000/api/v1/auth/login?returnTo=//evil.example"
```

Expected: `HTTP/1.1 400 Bad Request`, `"code":"bad-request"`.

## 3. Sign out

In the window of part 1, hover over **Olivia Owner** and click **Sign Out**.

Expected: you are sent to `/`, which sends you to the "Sign in as…" page again. In the developer
tools the `msid` and `msid_csrf` cookies are gone. Open <http://localhost:5173/> again: still the
sign-in page.

The CSRF rule (optional). This signs in with `curl` and then tries to sign out without the token. It
needs the server of part 1 running. It calls the callback with the user id as the code, which is what
the "Sign in as…" link does.

```sh
JAR=$(mktemp)
LOC=$(curl -s -D - -o /dev/null -c "$JAR" "http://localhost:5173/api/v1/auth/login" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
STATE=${LOC##*state=}
curl -s -o /dev/null -b "$JAR" -c "$JAR" "http://localhost:5173/api/v1/auth/callback?code=11111111-0000-4000-8000-a00000000001&state=$STATE"
curl -s -b "$JAR" http://localhost:5173/api/v1/me; echo
curl -s -b "$JAR" -X POST http://localhost:5173/api/v1/auth/logout; echo
CSRF=$(awk '$6=="msid_csrf"{print $7}' "$JAR")
curl -s -b "$JAR" -X POST -H "X-CSRF-Token: $CSRF" http://localhost:5173/api/v1/auth/logout; echo
```

Expected, in order:

1. `/me`: `{"id":"11111111-0000-4000-8000-a00000000001","displayName":"Olivia Owner","email":"owner@example.com","avatarUrl":null,"notices":[]}`
2. logout without the header: `403` with `"code":"csrf-token-invalid"`;
3. logout with the header: `{"redirectUrl":"http://localhost:5173/"}`.

Stop the demo with Ctrl+C in the terminal that runs `pnpm demo`. Check that nothing is left listening
(`netstat -ano | findstr ":3000 :5173"` on Windows shows no `LISTENING` lines).

## 4. Sign in through the mock OIDC server (Azurite mode)

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

Expected: `up` starts three containers (Azurite, SQL Server and `mock-oidc`), waits until all are
healthy, and loads the fixtures. Then `demo:azurite` starts the server on the replica (it reads
`docker/azurite.env`) and the web app.

Open <http://localhost:5173/>.

Expected:

- The browser goes to the **mock OIDC server**: `http://127.0.0.1:18080/surveyjs/authorize?...`, a page
  with a "Username" field and a **Sign-in** button.
- Type `owner`, leave the claims box empty, and press **Sign-in**.
- You land on `http://localhost:5173/` with the surveyjs.io shell, and the header shows **Olivia Owner**.
  The server did the same steps as for `auth.surveyjs.io`: code flow with PKCE, then the identity from
  UserInfo. The name comes from the replica's directory.

Click **Sign Out**. Expected: the browser goes to
`http://127.0.0.1:18080/surveyjs/endsession?...`, the mock's end-session endpoint, then back to
`http://localhost:5173/`, which asks you to sign in again.

Try the blocked user: type `blocked`. Expected: the browser shows a Problem body, `403`,
`"code":"forbidden"`, "This account is blocked." No session starts.

The hosted edition signs in the same way (the dev provider is refused there, this one is not). Stop the
demo (Ctrl+C) and start it with:

Git Bash:

```sh
APP_EDITION=hosted pnpm demo:azurite
```

PowerShell:

```powershell
$env:APP_EDITION = "hosted"; pnpm demo:azurite
Remove-Item Env:APP_EDITION
```

Expected: `curl http://localhost:5173/api/v1/config` shows `"edition":"hosted"`, and sign-in works as above.

Stop the demo with Ctrl+C. Keep the replica running for the tests in part 6, or remove it now:

```sh
pnpm demo:azurite:down
```

## 5. The licence notice

Start the memory demo with the expired-licence notice:

Git Bash:

```sh
ACCOUNT_NOTICES=license-expired pnpm demo
```

PowerShell:

```powershell
$env:ACCOUNT_NOTICES = "license-expired"; pnpm demo
```

Sign in as **Olivia Owner**. Expected:

- A dialog opens over the page with the text **Your renewal subscription has expired.** and the buttons
  **Renew** and **Later**, as on surveyjs.io. The account icon pulses, and **Settings** in the
  account menu has a warning mark.
- `curl` shows the same notice in the API (after signing in with the cookie jar from part 3):
  `"notices":[{"code":"license-expired","message":"Your renewal subscription has expired.","actionUrl":"https://surveyjs.io/manage","actionLabel":"Renew"}]`.
- **Renew** opens `https://surveyjs.io/manage`. **Later** closes the dialog. After a reload, and after
  signing out and in again, the dialog stays closed: the browser remembers the choice, as on surveyjs.io.
  The warning mark on Settings stays.

To see the dialog again, delete the key `expiredNotificationDateTime` from the site's local storage
(developer tools, Application, Local Storage).

Try the other setting (stop the demo first): `ACCOUNT_NOTICES=license-expires-soon`. Expected: **Your
renewal subscription expires soon.**

Optional, in Azurite mode (replica running): `ACCOUNT_NOTICES=surveyjs-licenses pnpm demo:azurite` reads
the licence rows of the replica. The fixture licences have fixed expiry dates, so as of October 2026 the
owner and the admin get the expired dialog, and the member and the outsider none. What you see depends on
today's date.

Stop the demo with Ctrl+C. In PowerShell remove the variable: `Remove-Item Env:ACCOUNT_NOTICES`.

## 6. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected:

- `pnpm test:unit`: all pass (`Test Files 40 passed`, `Tests 593 passed`).
- `pnpm test:conformance`: `Test Files 3 passed`, `Tests 34 passed`. This includes the sign-in flow,
  `getCurrentUser`, `logout`, CSRF and `passwordLogin` answering `501`.
- `pnpm e2e`: `23 passed` and `1 skipped` (the Escape test is skipped on WebKit, which does not Tab to
  links). The browsers sign in, follow a deep link, sign out, and see the licence dialog.

With the replica running (`pnpm demo:azurite:up`):

```sh
pnpm test:providers:azurite
pnpm test:conformance:azurite
pnpm e2e:azurite
```

Expected: all pass. The conformance run and the e2e run sign in through the mock OIDC server. `e2e:azurite`
shows `4 passed`. It uses ports 3000 and 5173, so stop any demo first. Then:

```sh
pnpm demo:azurite:down
```

## Checklist

| #   | Check                                                                                                                                        | Result |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | In memory mode `/` goes to "Sign in as…"; choosing Olivia Owner shows her name and the account menu in the surveyjs.io header                |        |
| 2   | A deep link opened while signed out is opened after sign-in; a `returnTo` outside the site gives `400`                                       |        |
| 3   | Sign Out ends the session, and private pages go to sign-in again; a sign-out without the CSRF header gives `403`                             |        |
| 4   | In Azurite mode sign-in goes through the mock OIDC server and sign-out through its end-session page; `blocked` gives `403`                   |        |
| 5   | With `ACCOUNT_NOTICES=license-expired` the renewal dialog appears, and Later keeps it closed                                                 |        |
| 6   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green |        |

## Troubleshooting

- You are sent in circles between `/` and the sign-in page: cookies are blocked for `localhost`. Allow
  them. Also open the app on `http://localhost:5173` (not `127.0.0.1:5173`): the sign-in redirects use
  `PUBLIC_BASE_URL=http://localhost:5173`, and the cookies belong to that host.
- "The sign-in expired or was not started in this browser" (`400`): the sign-in cookie was lost. Open
  the page again and sign in again. Do not reuse an old sign-in page.
- The server stops at start-up with `IDENTITY_PROVIDER: dev is not allowed ...`: the dev provider is
  refused with `NODE_ENV=production`, with `APP_EDITION=hosted`, and with a storage other than
  `memory`. Use the Azurite mode for those.
- The server stops with `OIDC_ISSUER_URL: required when IDENTITY_PROVIDER=surveyjs-oidc`: you started
  the server without `IDENTITY_PROVIDER=dev` and without the `OIDC_*` settings. Use `pnpm demo`, or
  `node --env-file=docker/azurite.env --import tsx server/src/main.ts` for the replica.
- "Sign-in is unavailable" (`500`) in Azurite mode: the mock OIDC server is not running. Check
  `docker ps` for `my-surveys-legacy-mock-oidc-1`.
- Port 18080 is in use: stop what holds it; the port is fixed and bound to 127.0.0.1 only.
- The licence dialog does not appear: you dismissed it before. Delete `expiredNotificationDateTime` (or
  `expiresSoonNotificationDateTime`) from the local storage of the site.

## What is not in Step 3

- Password sign-in (`passwordLogin` answers `501`) and API tokens: phase 2.
- Ending a session on the server: the session is a sealed cookie with no server state, so it ends only
  by expiry (12 hours), by Sign Out in that browser, or by changing `SESSION_SECRET`.
- Rate limiting behind a reverse proxy: the limit keys on the socket IP. Trusted-proxy support comes in
  Step 14.
- The visual parity pass of the shell (keyboard and ARIA polish, the Open Sans font) and a review of
  the copied cookie-banner text for the hosted deployment: Step 13.
- Survey screens: Step 4 onwards.
