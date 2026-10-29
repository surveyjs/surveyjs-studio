# Demo: self-hosted Step 4, password sign-in and local accounts

This page lets you check self-hosted Step 4 without reading code. It takes about twenty minutes. Commands are for Git
Bash (or any POSIX shell), from the repository root.

What Step 4 delivers: **a self-hosted instance keeps its own accounts.** With `USER_DIRECTORY=local` the users are in
the database's `users` table, and with `AUTH_METHODS=password` they sign in with an email and a password on the app's
own page. Passwords are hashed with argon2id; the first admin is made from the settings or from a one-time link in the
log, and must change a password chosen in the settings. A password change ends the user's other sessions, and repeated
failures lock an email out for a while. The reasons are in
[ADR 0026](../adr/0026-revoking-stateless-sessions-with-an-epoch.md). Production (studio.surveyjs.io,
`STORAGE_PROVIDER=azure-legacy`, sign-in through surveyjs.io) is not affected.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists. Ports 3000 and 5173 must be free,
and two browsers (or one normal and one private window).

Start from a fresh database and load the seed: `rm -rf server/.data`, then `pnpm seed:sqlite`. It prints
`Applied 4 migrations: 0001-surveys, 0002-results-views-projects, 0003-files, 0004-local-accounts`.

## 1. The first admin must change the password (checklist 1)

1. Start the app with passwords and a first admin:

   ```sh
   USER_DIRECTORY=local AUTH_METHODS=password \
     ADMIN_EMAIL=first-admin@example.test ADMIN_PASSWORD='a long local password' \
     pnpm dev:sqlite
   ```

   - **Check:** the server's log says `created the first admin from ADMIN_EMAIL; the password must be changed at first
sign-in`.

2. Open <http://localhost:5173/?project=personal>.
   - **Check:** the **Sign in** page opens (`/sign-in?returnTo=…`), with Email and Password, and no "Sign in as…" page.
3. Enter `first-admin@example.test` and `a long local password`, and click **Sign in**.
   - **Check:** the **Change your password** page opens: "You must choose a new password before you continue."
4. Type `/projects` into the address bar. **Check:** you are sent back to **Change your password**.
5. Enter `a long local password` as the current password, then `password1234` twice, and click **Change password**.
   - **Check:** "This password is too common. Choose another one." Try `short` twice: "Use at least 12 characters."
6. Enter `the admin's own new password` twice and click **Change password**.
   - **Check:** My Surveys opens at `/?project=personal`, with **first-admin** in the header.

## 2. A password change signs the other browser out (checklist 2)

1. In a second browser (or a private window) open <http://localhost:5173> and sign in as `first-admin@example.test`
   with `the admin's own new password`. **Check:** My Surveys opens, with no forced change this time.
2. In the first browser open <http://localhost:5173/change-password> (the surveyjs.io look has no menu item for it;
   with `APP_SHELL=plain` the header has a **Change password** link). Change the password to
   `a third long password`.
3. In the second browser reload the page.
   - **Check:** the **Sign in** page opens. On one server this is at once; the spec allows up to a minute.
4. Sign in there with `the admin's own new password`. **Check:** "The email or the password is wrong." Sign in with
   `a third long password`: My Surveys opens.

## 3. Too many failed attempts (checklist 3)

1. Sign out (hover over **first-admin**, then **Sign Out**). **Check:** the **Sign in** page opens.
2. Sign in as `first-admin@example.test` with a wrong password five times.
   - **Check:** each time, "The email or the password is wrong."
3. Try a sixth time, with the right password or a wrong one.
   - **Check:** "Too many failed attempts. Try again in 1 minute(s)."
4. Enter an email nobody has, such as `nobody@example.test`, with any password. **Check:** the same "The email or the
   password is wrong." as for a wrong password.
5. Wait a minute and sign in with `a third long password`. **Check:** My Surveys opens.

Stop the app with Ctrl+C.

## 4. The setup link when no admin is set

1. Start from a fresh database again: `rm -rf server/.data`, then `pnpm seed:sqlite`.
2. Start the app without the admin's settings: `USER_DIRECTORY=local AUTH_METHODS=password pnpm dev:sqlite`.
   - **Check:** the log has a warning `This instance has no admin yet. Open this one-time link to create the first one:
http://localhost:5173/set-password?setup=…`.
3. Open that link. **Check:** **Create the first admin**, with Email, Name, Password and Repeat the password.
4. Enter `owner-admin@example.test`, `Owner Admin` and a long password twice, and click **Create the admin**.
   - **Check:** "The admin was created. You can sign in now." Click **Sign in** and sign in with those details: My
     Surveys opens, with **Owner Admin** in the header and no forced change.
5. Open the setup link again and try once more. **Check:** "This link was used already, has expired, or is not a link
   of this site."

## Clean up

Stop the app with Ctrl+C. `rm -rf server/.data` removes the local database and files.

## What the automated tests cover

- `pnpm test:unit`: hashing and verification, the password rules, the back-off, the session epoch and its cached check,
  the first-admin rules, the settings, the local account suites on memory and SQLite, and the full provider suite on the
  local directory; the web app's sign-in, set-password and change-password pages and the forced-change redirect.
- `pnpm test:providers:postgres`: the local account suite and the provider suite on the local directory on PostgreSQL.
- `pnpm test:conformance:password`: the HTTP conformance suite on local accounts, with password sign-in, the forced
  change, the same answer for a wrong password and an unknown email, the back-off, and a password change ending the
  other sessions.
- `pnpm e2e:password`: the first admin signs in, must change the password, signs out and signs in again; the back-off
  message.
