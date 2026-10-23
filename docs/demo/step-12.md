# Demo: Step 12, accounts by deployment mode, data protection and hardening

This page lets you check Step 12 without reading code. It takes about forty-five minutes (part 1 uses the Azurite
replica, which pulls Docker images on the first run, see [Step 2](step-02.md); `pnpm demo:preview` builds the app
first, which takes a minute). Commands are for Git Bash (or any POSIX shell).

What Step 12 delivers: **accounts follow the deployment mode.** The users come from a _user directory_ (the memory
seed, the surveyjs.io SQL table, or a surveyjs.io user API that we specify), and a combination that cannot work stops
the server at start-up and names the variable. **Deleting a surveyjs.io account erases the user's data**, through a
signed webhook, through `pnpm account:erase`, or through `pnpm account:reconcile` for a webhook that was lost. The app no
longer answers the old `/published` address (the surveyjs.io site redirects old links, and the map is written down). The
pages send **security headers and a content-security policy**, and a survey that holds script in its names, titles and
HTML shows them as text and runs nothing. The reasons are in [ADR 0018](../adr/0018-accounts-by-deployment-mode.md) and
[ADR 0019](../adr/0019-run-page-isolation-and-security-headers.md); the pages for the surveyjs.io team are
[the user API and webhook](../integrations/surveyjs-user-api.md) and [the redirect map](../operations/surveyjs-redirects.md);
the operator's page is [Operations](../operations.md). The user's side is
[Moving from the old My Surveys](../user-guide/moving-from-the-old-my-surveys.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run `pnpm install`
once. Ports 3000, 4010 and 5173 must be free. For part 1 you also need Docker with Compose, and the ports 10000, 10002,
14333 and 18080 on 127.0.0.1. For the checks on the command line you need `curl`.

If the default `node` of your machine is older than 24 (for example with nvm on Windows), put Node 24 first once in
each Git Bash window, before any `pnpm` command: `export PATH="$APPDATA/nvm/v24.21.0:$PATH"`. Check with
`node --version`; it must print `v24.21.0`.

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start), with one new one (in the mock OIDC form
of Azurite mode you type the short name):

| Name          | Type in the mock OIDC form | Why                                                                                                       |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Erin Erasable | `erasable`                 | **The seed outsider of this demo.** The only user a test may erase. She has no data until you create some |
| Mia Member    | `member`                   | Is added to Erin's project (`member@example.com`); owns the XSS survey                                    |
| Olivia Owner  | `owner`                    | Sees the expired-licence notice in part 4; her data must stay unchanged in part 1                         |
| Adam Admin    | `admin`                    | Creates a project in part 4                                                                               |

**Why Erin and not Oscar.** Earlier demos used Oscar Outsider as the "outsider". Erasing him would break the tests that
read his survey, so Step 12 adds Erin: she has nothing in the fixtures, every erasure demo and test creates her data
first, and Oscar's stays intact. **Do not erase anyone else.** In memory mode a restart resets all data. On the replica
the changes stay until `pnpm legacy:load`.

## 1. Erase an account on the replica (checklist 1)

Start the replica and the app on it:

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

Before you change anything, save what the inspector says about Olivia (it only reads):

```sh
pnpm inspect:legacy --user owner@example.com --env-file docker/azurite.env > "$TEMP/owner-before.txt"
```

Open <http://localhost:5173/>, and on the mock sign-in page type `erasable` (or Erin's id,
`11111111-0000-4000-8000-a00000000006`) as **Erin Erasable**. Create two surveys with **Create a Survey**
(**New Survey 1** and **New Survey 2**). Then open the account menu, **Projects**, **Create a Project**, name it
`Erin project`, open its card, **Add a New Member** and add `member@example.com`.

Now, in another terminal, look at what erasing Erin would do. This is a **dry run**: without `--yes` nothing is written.

```sh
pnpm account:erase --user erasable@example.com --env-file docker/azurite.env
```

Expected, with your own ids:

```text
Account 11111111-0000-4000-8000-a00000000006 (erasable@example.com, Erin Erasable)
Personal surveys to delete: 2
  <id>  New Survey 1
  <id>  New Survey 2
Projects: 1
  <id>  Erin project: leaves the project; 11111111-0000-4000-8000-a00000000003 becomes an admin
The final decision for each project is made at erase time and can differ from this plan.
Dry run: nothing was erased. Run again with --yes to erase.
```

Erin is the only admin and Mia (`…a03`) the other member, so Mia would become the admin. (The final decision is made
again at erase time, under the project's lock: the preview works from the members it can see.) Erase:

```sh
pnpm account:erase --user erasable@example.com --env-file docker/azurite.env --yes
```

Expected: the same plan, then `Erased 11111111-0000-4000-8000-a00000000006: 2 surveys deleted, 1 projects left, 0
projects deleted, 1 admins promoted.`

Check the result:

- Sign in as **Erin** again (sign out first). The survey list is **empty**, and there is **no project selector**: she
  belongs to no project. (Her account still exists. Erasing removes her data, not the surveyjs.io account.)
- `pnpm inspect:legacy --user member@example.com --env-file docker/azurite.env` now lists `Project Erin project (<id>,
role admin)` for Mia: she administers the project.
- Olivia's data did not change:

  ```sh
  pnpm inspect:legacy --user owner@example.com --env-file docker/azurite.env > "$TEMP/owner-after.txt"
  diff "$TEMP/owner-before.txt" "$TEMP/owner-after.txt" && echo unchanged
  ```

  Expected: `unchanged`.

Running the erase again does nothing (all counts 0). Without a persistent store the command refuses:
`pnpm account:erase --user erasable@example.com` (no `--env-file`) prints `STORAGE_PROVIDER must name a persistent store:
memory keeps its data inside the server process. …` and exits 2.

Stop the demo (Ctrl+C in its terminal). Leave the replica for later parts, or clean up now with `pnpm legacy:load`
(it brings the fixtures back and removes `Erin project`).

## 2. Send a signed webhook (checklist 2)

This part uses the memory demo with the production-like headers, so stop any other demo first:

```sh
pnpm demo:preview
```

Open <http://localhost:5173/> and choose **Erin Erasable** on the "Sign in as…" page. Create a survey. Now, in another
terminal, send the event that surveyjs.io sends when Erin deletes her account:

```sh
pnpm webhook:account-deleted --user 11111111-0000-4000-8000-a00000000006 --env-file server/demo.env
```

Expected: `HTTP 204` (the exit code is 0). The command signs the message with the local demo secret in `server/demo.env`
(never use that secret anywhere else) and sends it to `http://127.0.0.1:3000`. **Reload** the survey list in the
browser: Erin's survey is gone. (She is still signed in: her session does not depend on the data.)

Now a call with the wrong signature:

```sh
pnpm webhook:account-deleted --user 11111111-0000-4000-8000-a00000000006 --env-file server/demo.env --bad-signature
```

Expected: `HTTP 401` and a body with `"code":"invalid-signature"` (the exit code is 1). Nothing was erased. The server
checks the signature **before** it reads the body, and a timestamp more than five minutes off is refused the same way.

Stop the demo with Ctrl+C.

## 3. An impossible configuration (checklist 3)

Start the server with a user directory and a sign-in method that cannot work together, on the replica settings:

```sh
USER_DIRECTORY=surveyjs-sql AUTH_METHODS=password node --env-file=docker/azurite.env --import tsx server/src/main.ts
```

Expected: the server does **not** start and prints

```text
Invalid configuration:
  - AUTH_METHODS: password requires USER_DIRECTORY=local, which is not available yet (self-hosted track)
```

and exits with code 1. The variable is named, and every problem is listed at once. Only `surveyjs` can start today;
`password` and the OAuth2 methods wait for the local user directory of the self-hosted track. (`oidc` is no longer a
value of `AUTH_METHODS`.)

## 4. The user API and its stub (checklist 4)

Run the conformance suite with the server on `USER_DIRECTORY=surveyjs-api`. It starts the stub itself:

```sh
pnpm test:conformance:user-api
```

Expected: all pass. Sign-in, adding members by email and the licence notices go through the user API.

Now by hand. In one terminal start the stub, a local stand-in for the surveyjs.io user API with the seed users:

```sh
pnpm user-api:stub
```

Expected: `User API stub listening on http://127.0.0.1:4010`. In another terminal start the app on it:

```sh
USER_DIRECTORY=surveyjs-api USER_API_URL=http://127.0.0.1:4010 USER_API_TOKEN=local-stub-token ACCOUNT_NOTICES=surveyjs-licenses pnpm demo:preview
```

Open <http://localhost:5173/> and choose **Olivia Owner**. Expected: the **expired-licence notice** of the surveyjs.io
look: one of her licences ended on 2026-08-01, and the notice comes from the stub's licence answer. Sign out and sign
in as **Adam Admin**; open **Projects**, create `API project`, **Add a New Member** `member@example.com`: **Mia Member**
is added (the address was looked up through the API). An address nobody registered gives "… is not a registered
surveyjs.io user …". Delete the project at the end.

To see that the API is really used, stop the stub (Ctrl+C in its terminal) and try to add a member again: the page shows
an error, not "is not a registered surveyjs.io user". **A failing API is never read as "unknown".**

Stop the demo with Ctrl+C.

## 5. The old address is unknown (checklist 5)

With `pnpm demo:preview` running again (no special settings), open
`http://localhost:5173/published?id=22222222-0000-4000-8000-a00000000004`. Expected: the page **Page not found**, "This
page doesn't exist or has moved.", and the link **Go to My Surveys**; the address stays as typed. The app redirects no old
address. Then the server's own answer:

```sh
curl -i "http://127.0.0.1:3000/published?id=22222222-0000-4000-8000-a00000000004"
```

Expected: `HTTP/1.1 404 Not Found`, `Content-Type: application/problem+json`, `"code":"not-found"`, and **no `Location`
header**. The redirect is the surveyjs.io site's job: [the redirect map](../operations/surveyjs-redirects.md) lists
every old address and its new one.

The server's security headers are on that answer too:

```sh
curl -si "http://127.0.0.1:3000/published" | grep -i "content-security-policy\|x-content-type-options\|referrer-policy"
```

Expected: `content-security-policy: default-src 'none'; frame-ancestors 'none'`, `x-content-type-options: nosniff` and
`referrer-policy: strict-origin-when-cross-origin`. The pages of the web app have their own, stricter policy:

```sh
curl -sI http://localhost:5173/ | grep -i content-security-policy
curl -sI http://localhost:5173/s/22222222-0000-4000-8000-a00000000004 | grep -io "frame-ancestors [^;]*"
```

Expected: the first policy ends with `frame-ancestors 'none'` and has `script-src 'self'`; the second prints
`frame-ancestors *`: only the run page may be framed.

## 6. The XSS survey (checklist 6)

Use `pnpm demo:preview` (**not** `pnpm demo`: Vite's dev server sends no content-security policy, so the inline handlers
would run there). Sign in as **Mia Member** (`member@example.com`). Expected: the survey list shows
`XSS in question name <img src=x onerror=alert(1)>` as **plain text**, and no alert appears.

Open that survey in the editor (click the row, or **Edit** in its "…" menu). Expected: the Creator opens and shows the
question title `<script>alert(3)</script>` as text; no alert. (The editor saves nothing on open.)

Now open the survey's run page **signed out** (a private window), with markup in the prefilled answer:

```text
http://localhost:5173/s/22222222-0000-4000-8000-a00000000009?q1=%3Cimg%20src%3Dx%20onerror%3Dalert(6)%3E
```

Expected: the survey title, the question title and "Hello, `<img src=x onerror=alert(6)>`." show as text. Click
**Complete**: the thank-you text also shows the markup as text. **No alert appears at any point.** Open the browser's
console (F12): there are **CSP refusals** ("Refused to execute inline event handler …"). That is the policy working: the
survey's inline handlers are blocked. (Completing it stores one response in this demo's data, in the survey of Mia; the
automatic tests do not.)

## 7. Optional: look at the reconciliation

With the replica running (`pnpm demo:azurite:up`; stop other demos first):

```sh
pnpm account:reconcile --env-file docker/azurite.env
```

Expected on the fixtures: `Users the directory does not know: 0` and `Nothing to erase.` (it is a dry run: without
`--apply` it never erases, and with `--apply` it refuses more than `--max` ids, default 10). Against real data the first
run lists users the old site already deleted, and can list the id of a deleted project whose surveys still point at it;
see [Operations](../operations.md#reconciling-accounts).

## 8. Tests

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:conformance
```

Expected: all pass. The new unit tests cover the start-up rules, the webhook signature and window, the erasure rule and
service, both commands, the user API client and stub, the security headers, the respondent-data log check and the
run page's Idempotency-Key without `crypto.randomUUID`. With the replica running (`pnpm demo:azurite:up`), run these one
after the other, not together (both erase Erin's data on the one replica):

```sh
pnpm test:providers:azurite
pnpm test:conformance:azurite
```

Browser tests are left to CI. When you run them: `pnpm e2e` runs the new `security-headers.spec.ts` and `xss.spec.ts`, and
`pnpm e2e:azurite` the XSS spec on the replica. Then stop the replica:

```sh
pnpm demo:azurite:down
```

## Checklist

| #   | Check                                                                                                                                                                                                                                  | Result |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | On the replica, `pnpm account:erase --user erasable@example.com` prints the plan; with `--yes` it erases; Erin then has an empty list and no project selector, Mia administers the project, and Olivia's inspector output is unchanged |        |
| 2   | In memory mode, `pnpm webhook:account-deleted` answers `HTTP 204` and Erin's survey is gone after a reload; with `--bad-signature` it answers `HTTP 401` with `invalid-signature`                                                      |        |
| 3   | `USER_DIRECTORY=surveyjs-sql AUTH_METHODS=password` stops the server with `Invalid configuration:` and the `AUTH_METHODS` line                                                                                                         |        |
| 4   | `pnpm test:conformance:user-api` passes; with `pnpm user-api:stub` and `USER_DIRECTORY=surveyjs-api`, Olivia sees the expired-licence notice and adding `member@example.com` to a project works                                        |        |
| 5   | `/published?id=…` shows "Page not found" in the browser and `404` (no `Location`) from the server; `docs/operations/surveyjs-redirects.md` lists the site's redirect                                                                   |        |
| 6   | With `pnpm demo:preview`, the XSS survey shows as text in the list, the editor and the run page; no alert appears; the console shows CSP refusals                                                                                      |        |
| 7   | `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit` and `pnpm test:conformance` are green, and with the replica the two Azurite suites                                                                                |        |

## Known differences

- **Erasure is not complete.** It leaves the user's **saved layouts on surveys they do not own**, **history entries**
  that name them on project surveys, **`creatorId`** on project surveys, and the legacy **`postdelete` copies** of
  deleted results. It is stricter than the old site's deletion, which left memberships, projects and project surveys
  ([ADR 0018, Open](../adr/0018-accounts-by-deployment-mode.md#open)).
- **`pnpm demo` has no content-security policy**; `pnpm demo:preview` has. A production host must send the same
  headers ([Operations](../operations.md#the-header-policy)).
- **The dry run of `account:erase` is a preview.** The decision for each project is taken again when you erase.
- **If the directory lookup of `account:erase --user <id>` fails**, the command stops with exit 1 and erases nothing,
  even though the lookup only prints a name.
- **The webhook trusts the signed message.** It does not ask the user directory whether the account is gone, which is
  why the memory demo can erase Erin while the seed still lists her.
- **CORS is not built.** The Embed tab's code works on the app's own origin only, until the hosted track's Step 3.
- **Only `surveyjs` can be a sign-in method.** `password`, `google`, `github` and `facebook` need the local user
  directory (self-hosted track).

## Troubleshooting

- **`pnpm account:erase` prints "STORAGE_PROVIDER must name a persistent store".** Add `--env-file docker/azurite.env`
  and start the replica (`pnpm demo:azurite:up`).
- **`pnpm webhook:account-deleted` prints "no answer from http://127.0.0.1:3000".** The server is not running, or runs on
  another port: pass `--url http://127.0.0.1:<port>`.
- **It answers `HTTP 404`.** The server has no `ACCOUNT_WEBHOOK_SECRET`. `pnpm demo` and `pnpm demo:preview` read it from
  `server/demo.env`; a server you started by hand needs the same variable.
- **It answers `HTTP 401` without `--bad-signature`.** The server has another secret than the file you passed, or the
  two clocks differ by more than five minutes.
- **The alert in part 6 appears.** You are on `pnpm demo`, which sends no policy. Use `pnpm demo:preview`.
- **`pnpm demo:preview` is slow to start.** It builds the app first.
- **Part 4 shows no licence notice.** `ACCOUNT_NOTICES=surveyjs-licenses` is missing, or the stub is not running on port
  4010, or you signed in as a user without an expired licence (Olivia has one).
- **"port already in use".** A demo is still running on 3000, 4010 or 5173.

## What is not in Step 12

- The local user directory, password and OAuth2 sign-in, and the instance admin (the self-hosted track). A per-request
  user check and session epochs.
- A client time-out retry, a cache of users by id and the API's readiness (hosted Step 2).
- Erasing layouts on others' surveys, history entries, `creatorId` on project surveys and `postdelete` copies.
- Redirects in this app: the surveyjs.io site makes them, from [the map](../operations/surveyjs-redirects.md).
- A cookie-less origin for the run page and CORS (hosted Step 3), and the not-found page's look (Step 13).
