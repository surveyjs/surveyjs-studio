# Demo: self-hosted Step 8, OAuth2 sign-in and pending invitations

This page lets you check self-hosted Step 8 without reading code. It takes about twenty minutes. Commands are for Git
Bash (or any POSIX shell), from the repository root. It needs no Docker and no account at Google or GitHub: a local
stand-in plays the providers.

What Step 8 delivers: **sign-in with Google, GitHub, Facebook and surveyjs.io on an instance with its own accounts,
and invitations for people who have not signed in yet.** A person signs in with a provider only with a verified email.
That email links to the account that has it, or creates an account when the person was invited, their domain is
allowed (`SIGN_UP_DOMAINS`) or `OPEN_SIGN_UP=on`. A project admin can add an email nobody has used yet: the person
shows as **Pending** and joins the project at their first sign-in. Details:
[Signing in with Google and others](../customizing/sign-in.md) and
[ADR 0029](../adr/0029-linking-identities-by-verified-email.md).

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists. Ports 3000, 5173 and 5180 must be
free, and two browsers (or one normal and one private window).

Start from a fresh database:

```sh
rm -rf server/.data
pnpm seed:sqlite
```

Terminal 1: the stand-in for the providers. It stays running.

```sh
pnpm oauth-stub --port 5180
```

**Check:** it prints `OAuth stub on http://127.0.0.1:5180`.

Terminal 2: the app, with passwords, GitHub and Google, all pointed at the stand-in. The stand-in accepts any client ID
and the secret `stub-secret-<provider>`. The first admin's password is a local demo constant, passed by name:

```sh
export ADMIN_PASSWORD='a long local password'
USER_DIRECTORY=local AUTH_METHODS=password,github,google \
  OAUTH_STUB_URL=http://127.0.0.1:5180 \
  GITHUB_CLIENT_ID=demo-github GITHUB_CLIENT_SECRET=stub-secret-github \
  GOOGLE_CLIENT_ID=demo-google GOOGLE_CLIENT_SECRET=stub-secret-google \
  ADMIN_EMAIL=first-admin@example.test \
  pnpm dev:sqlite
```

Open <http://localhost:5173>. **Check:** the **Sign in** page has the email and password form, and the links
**Sign in with GitHub** and **Sign in with Google**. Sign in as `first-admin@example.test` with
`a long local password`, and change the password to `the admin's own new password` when asked.

Open **Projects** in the account menu, click **Create a Project**, and create `Demo project`.

## 1. An invited person signs in with GitHub (checklist 1)

1. Open the **Demo project** card, click **Add a New Member**, type `new@example.test` and click **Add**.
   - **Check:** the card says `new@example.test will join when they first sign in.`, and the member list shows a row
     for `new@example.test` with a **Pending** badge and no **Make Admin** link.
2. In the private window open <http://localhost:5173> and click **Sign in with GitHub**. **Check:** the stand-in's
   page "Sign in to the GitHub stub" opens, with sub, email and name fields and an `email_verified` box (checked).
3. Enter sub `new-person`, email `new@example.test`, name `New Person`, leave `email_verified` checked, and click
   **Sign in**.
   - **Check:** My Surveys opens signed in as **New Person**, and the account menu has no **Change password** item
     (the account has no password).
4. Open **Projects**. **Check:** `Demo project` is there, and its members include **New Person** and the first admin.
5. In the first browser reload **Projects** and open `Demo project`. **Check:** **New Person** is a member, with no
   **Pending** badge.

## 2. An uninvited GitHub account is refused (checklist 2)

1. Sign out in the private window, then open <http://localhost:5173> and click **Sign in with GitHub**.
2. Enter sub `stranger`, email `stranger@example.test`, name `Stranger`, and click **Sign in**.
   - **Check:** the page **You can't sign in yet** explains that the instance is open to invited people only, with a
     **Back to sign in** link. The address is `/sign-in/refused?reason=not-invited&provider=github`.
3. Click **Back to sign in**. **Check:** the **Sign in** page, and no session: open
   <http://localhost:5173/api/v1/me>, which answers `401`.
4. Try again with sub `stranger` and email `stranger2@example.test`, but clear the `email_verified` box.
   **Check:** the refused page again, now saying the GitHub account "didn't share a verified email address"
   (`reason=email-unverified`).
5. In the first browser, open **Users** in the account menu. **Check:** neither stranger is in the list.

## 3. A password user signs in with Google and lands in the same account (checklist 3)

1. In the private window open <http://localhost:5173> and click **Sign in with Google**.
2. Enter sub `admin-google`, email `first-admin@example.test`, name `Some Google Name`, leave `email_verified` checked,
   and click **Sign in**.
   - **Check:** My Surveys opens signed in as **first-admin**, not as "Some Google Name", and the account menu has
     **Users**: it is the password account you signed in to at the start, now linked to this Google identity.
3. In the first browser reload **Users**. **Check:** there is still one row for `first-admin@example.test`, and no new
   account.
4. In the private window sign out and click **Sign in with Google** again with the same sub, and an email of
   `somebody-else@example.test`. **Check:** it still signs in as **first-admin**: a known identity wins over the
   email. (The email does not matter any more once the identity is linked.)
5. Sign out, then sign in with the password form and `the admin's own new password`. **Check:** it works too.

## Clean up

Stop both terminals with Ctrl+C. Then:

```sh
rm -rf server/.data
unset ADMIN_PASSWORD
```

## What the automated tests cover

- `pnpm test:unit`: the join policy and the callback's order (a known identity, linking by verified email, creating,
  refusing, a disabled and an invited account, two sign-ins at once), each provider's endpoints, the verified-email
  rules and the Facebook proof, `READ_ONLY=true` writing nothing, and the stand-in itself.
- `pnpm test:conformance:oauth`: a server on SQLite with local accounts and all four providers against the stand-in,
  plus a second server with `OPEN_SIGN_UP=on`: an invited email creates an account and joins its projects, a stranger
  is refused, `SIGN_UP_DOMAINS` and a look-alike domain, an unverified email, linking Google to the first admin's
  account, a disabled account, two sign-ins at once, and the pending member of `addMember`.
- `pnpm e2e:oauth` (Chromium; the stand-in and the server are started for you): an invited person is pending, then
  joins with GitHub and sees the project; a stranger is refused and stays signed out; Google with the admin's
  verified email is the same account.
- In CI (Linux): the conformance and the e2e runs above.

This page does not check Facebook or surveyjs.io in the browser; the conformance run covers both against the
stand-in. Real providers are not called by any test.
