# Demo: hosted Step 2, users from sign-in

This page lets you check hosted Step 2 without reading code. It takes about twenty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root.

What Step 2 delivers: **on the new server Studio knows its people from their sign-in, and nothing else.** A person who
signs in with surveyjs.io gets an account whose id is the surveyjs.io id. Every sign-in refreshes the email, the name,
whether the site blocked the account and the licence date; the renewal notice comes from that date. A blocked account
is refused. An email that belongs to another surveyjs.io id is refused too. The site's account-deleted webhook erases a
person's account and data, and when the person is the last admin the account stays as a placeholder until an operator
names a new admin with `pnpm account:make-admin`. The design is
[ADR 0043](../adr/0043-hosted-users-on-the-local-directory.md); the operator's page is
[Operations › Hosted sign-in](../operations.md#hosted-sign-in); the claims and the webhook, for the surveyjs.io team,
are [the integration page](../integrations/surveyjs-user-api.md). The site's side (the licence claim and the outbox
that sends the webhook) is built in its own repository: this demo stands in for it with the OAuth stub and the
`webhook:account-deleted` command.

## Before you start

You need the tools of [the Step 1 demo of the self-hosted track](self-hosted-01.md) and free ports **3000** (Studio),
**5173** (the web app) and **5180** (the stub). Check them (nothing is printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|5173|5180) '
```

The demo keeps its database in a folder of its own, outside the repository. Every shell below starts with these lines
(use Git Bash for this demo: the settings are many):

```sh
DEMO=~/hosted-02-demo
mkdir -p "$DEMO"
cat > "$DEMO/studio.env" <<EOT
NODE_ENV=development
HOST=127.0.0.1
PUBLIC_BASE_URL=http://localhost:5173
APP_EDITION=hosted
APP_SHELL=surveyjs-site
USER_DIRECTORY=local
AUTH_METHODS=surveyjs
OPEN_SIGN_UP=on
ACCOUNT_NOTICES=sign-in-licence
ADMIN_EMAIL=admin@example.com
STORAGE_PROVIDER=sqlite
SQLITE_PATH=$DEMO/studio.db
FILES_PATH=$DEMO/files
OIDC_ISSUER_URL=http://127.0.0.1:5180/surveyjs
OIDC_CLIENT_ID=demo
OIDC_CLIENT_SECRET=stub-secret-surveyjs
ACCOUNT_WEBHOOK_SECRET=whsec_bXktc3VydmV5cy1sb2NhbC1kZW1vLXdlYmhvb2sta2V5
EOT
set -a; . "$DEMO/studio.env"; set +a
```

Start four shells, each with those lines:

1. **The sign-in stub** (shell 1). It stands in for `auth.surveyjs.io`, with the form's `blocked` and
   `license_expires_at` fields:

   ```sh
   pnpm oauth-stub
   ```

   - **Check:** it prints `OAuth stub on http://127.0.0.1:5180`.

2. **Studio** (shell 2), the hosted edition on the local directory:

   ```sh
   pnpm --filter @surveyjs-studio/server start
   ```

   - **Check:** a log line `ADMIN_EMAIL is made admin at its first sign-in while there is no admin`, and the `starting`
     line with `userDirectory: local` and `accountNotices: sign-in-licence`.

3. **The web app** (shell 3):

   ```sh
   pnpm --filter @surveyjs-studio/web dev
   ```

   Open <http://localhost:5173>.

4. **The commands** (shell 4).

The people of the demo, with their surveyjs.io ids (GUIDs):

| Person            | `sub`                                  | Email                |
| ----------------- | -------------------------------------- | -------------------- |
| Olivia            | `aaaaaaaa-0000-4000-8000-000000000001` | `olivia@example.com` |
| Blake             | `aaaaaaaa-0000-4000-8000-000000000002` | `blake@example.com`  |
| Olivia, recreated | `aaaaaaaa-0000-4000-8000-000000000003` | `olivia@example.com` |
| Admin             | `aaaaaaaa-0000-4000-8000-0000000000a1` | `admin@example.com`  |
| Bob               | `aaaaaaaa-0000-4000-8000-000000000004` | `bob@example.com`    |

At each sign-in the stub's form opens: enter the `sub`, the email and a name, and choose **Sign in**. To sign out, use
the account menu, then open <http://localhost:5173> again.

## 1. A new person gets an account (checklist 1)

1. Sign in as Olivia: `sub` `aaaaaaaa-0000-4000-8000-000000000001`, email `olivia@example.com`, name `Olivia`.
   - **Check:** the survey list opens on **Personal**, and the account menu shows `Olivia`.
2. Make a survey (**New survey**, any name), so there is data to erase later.

## 2. The licence notice (checklist 2)

1. Sign out. Sign in as Olivia again, with `license_expires_at` `2020-01-01T00:00:00Z`.
   - **Check:** a dialog says "Your renewal subscription has expired."
2. Sign out. Sign in once more, with `license_expires_at` `2999-01-01T00:00:00Z` (or leave it empty).
   - **Check:** no notice. The date is refreshed at every sign-in; Studio asks the site nothing in between.

## 3. Blocked (checklist 3)

Sign out. Sign in as Blake (`sub` `aaaaaaaa-0000-4000-8000-000000000002`, `blake@example.com`) with **blocked** ticked.

- **Check:** the page "You can't sign in yet" says "This surveyjs.io account is blocked. Contact SurveyJS support if you
  think this is a mistake." A blocked first sign-in creates no account, so Blake is not on the Users page (section 6).
  Signing in again with the box cleared works.

## 4. An email another surveyjs.io id holds (checklist 4)

This is a person who deleted their surveyjs.io account and registered again with the same address. Sign in as Olivia,
recreated: `sub` `aaaaaaaa-0000-4000-8000-000000000003`, `olivia@example.com`.

- **Check:** "This email is already used by another surveyjs.io account in SurveyJS Studio. If you recreated your
  surveyjs.io account, you can sign in once the old one has been removed." Nobody takes over Olivia's survey.

## 5. The webhook erases the account (checklist 5)

1. In shell 4, send the account-deleted webhook for Olivia's id, signed as the site signs it:

   ```sh
   pnpm webhook:account-deleted --user aaaaaaaa-0000-4000-8000-000000000001
   ```

   - **Check:** `HTTP 204`. A call signed with another key (add `--bad-signature`) is refused, and the command exits
     with 1.

2. Reload the browser that is signed in as Olivia, if one is.
   - **Check:** she is signed out (her sessions ended).
3. Sign in as Olivia, recreated (`…0003`) again.
   - **Check:** the sign-in works now and the survey list is empty. Olivia's survey from section 1 is gone: the old
     account and its data were erased, and a new account was made for the new id.

## 6. The last admin and `account:make-admin` (checklist 6)

1. Sign in as the admin: `sub` `aaaaaaaa-0000-4000-8000-0000000000a1`, `admin@example.com`. `ADMIN_EMAIL` makes this
   account admin at its sign-in, because the instance has never had an admin.
   - **Check:** the account menu has **Users**; the list shows Olivia (recreated) and the admin.
2. Sign out, sign in as Bob (`sub` `aaaaaaaa-0000-4000-8000-000000000004`, `bob@example.com`), and sign out again. He is
   an ordinary user.
3. Delete the admin's surveyjs.io account:

   ```sh
   pnpm webhook:account-deleted --user aaaaaaaa-0000-4000-8000-0000000000a1
   ```

   - **Check:** `HTTP 204`, and a warning in the Studio log that the last admin was kept as a placeholder. `ADMIN_EMAIL`
     promotes nobody from now on: whoever registers that address on surveyjs.io gets no admin rights.

4. Try to name the placeholder an admin, and then Bob:

   ```sh
   pnpm account:make-admin --email "deleted-aaaaaaaa-0000-4000-8000-0000000000a1@invalid"
   pnpm account:make-admin --email bob@example.com
   ```

   - **Check:** the first refuses (it is a deleted account's placeholder); the second prints Bob's user id, which is his
     surveyjs.io id.

5. Sign in as Bob.
   - **Check:** the account menu has **Users**. The list shows the placeholder, "Deleted account", disabled, next to the
     other accounts.

## 7. The checklist on the new server (with the SurveyJS team)

When the site's changes are deployed (the licence claim and the outbox), at the test migration of the cutover:

1. Sign in on the new server with a test account: it has the surveyjs.io id, and the account menu shows its name.
2. A test account whose licence has expired sees the notice.
3. Block a test account in the site's admin and sign in: "Account blocked".
4. Delete a test account on the site: the webhook arrives and the account's surveys are gone.

## Clean up

Stop the shells with Ctrl+C, then remove the demo's folder: `rm -r ~/hosted-02-demo`.
