# 26. Revoking stateless sessions with an epoch

Date: 2026-10-29

## Status

Accepted.

## Context

The session cookie `msid` is sealed and stateless ([Architecture › The sealed cookie format](../architecture.md#the-sealed-cookie-format)):
the server keeps nothing, so until now a session could not end before its 12 hours. With accounts of its own
(`USER_DIRECTORY=local`, spec-self-hosted.md › Local accounts and the instance admin) an instance must end a user's
sessions when the password changes, when it is reset and when an admin disables the user (S13, S14, S21). Several
browsers can be signed in at once.

A session table would make every session revocable one by one, but it is a write on every sign-in, a read on every
request, and a second kind of state next to the cookie that the hosted edition (where sessions stay as they are)
does not need. The spec asks for the stateless cookie to stay.

The same step settles three more questions of local accounts: how passwords are hashed, how repeated failures are
slowed down, and how the first admin is made without a default password (S4).

## Decision

**A session epoch per account.** The `users` table (migration 0004, [data model](../architecture/data-model.md)) has
`session_epoch`, an integer that starts at 0. The sealed `msid` payload carries the account's epoch from the
moment of sign-in (`epoch`, optional; a cookie without it counts as 0).

- **Checked on each request** with a session (`auth/session-check.ts`): the account's status and epoch are read
  through the `LocalAccountStore` and cached per user for at most **60 seconds**. A session whose epoch is not the
  account's, or whose account is gone or not active, is `401 unauthenticated`. On `logout` it counts as no
  session.
- **Raised by one statement** (`session_epoch = session_epoch + 1`), so two changes at once both count. A password
  change, a set-password link, an instance admin's reset and disabling the user (Step 5) raise it. A reset also
  clears the password and ends the user's unused links.
- **The session that changed the password** gets a new cookie with the new epoch, and the server drops the user's
  cache entry: on one instance every other session ends at once. Behind several instances another one may take up to
  the 60 seconds of its own cache.
- **A forced change.** An account with `must_change_password` (the first admin from `ADMIN_PASSWORD`) may only call
  `getCurrentUser`, `changeOwnPassword` and `logout`; every other session operation answers
  `401 password-change-required`. Only 17 of the contract's operations document `403`, and all document `401`.

**Passwords** are argon2id through Node's built-in `crypto.argon2` (Node 24.7 and later), stored as PHC strings with
m=19456 KiB, t=2, p=1 (OWASP's minimum); each hash carries its parameters, so raising them later keeps old hashes
working. The spec names `@node-rs/argon2`; the built-in one is the same algorithm without a native module in the
image (the reasoning of [ADR 0023](0023-sqlite-driver-node-sqlite.md)). The rules: at least 12 characters (code
points) and not on a bundled list of common passwords.

**The back-off** is kept per normalised email in process memory, for known and unknown emails alike: the fifth failure
in a row locks the email for 60 seconds, and each failure after a lock doubles the wait, up to an hour; a
successful sign-in clears it. An attempt counts as a failure from the moment it starts, before its password is
checked, so attempts sent at the same time cannot all pass the lock. When the map is full (10,000 emails) an email that
is not locked is dropped first, so failures for other emails cannot push a locked one out. A locked email answers
`429 account-locked` with `Retry-After`. A wrong password, an unknown email and a disabled, invited or password-less
account all answer the same `401 invalid-credentials`, and an unknown email is checked against a dummy hash, so
neither the answer nor its time shows whether an email exists. The per-address `SIGN_IN_RATE_LIMIT` applies on top.

**The first admin** is made at start-up while no account is an active admin:

- with `ADMIN_EMAIL` and `ADMIN_PASSWORD` (both or neither; the password must pass the rules), that admin is created
  and must change the password at the first sign-in; an `ADMIN_EMAIL` that names an existing account changes nothing
  and logs a warning;
- without them, a one-time setup link `/set-password?setup=<token>` is written to the log at `warn`, the one secret
  the server logs on purpose. The token lives in the process only: it works once, and a restart writes a new one
  while there is still no admin. The setup page asks for the admin's email, name and password
  (`setPasswordWithLink` with `email` and `displayName`). The token is taken before the first await, so two submits
  at once make one admin; an email that already has an account, or a failed write, keeps the link usable.

`READ_ONLY=true` makes no admin.

## Consequences

- Revoking costs one indexed read per user per minute per instance, and no write on sign-in or per request (the last
  sign-in time is one update per sign-in).
- A single session cannot be ended on its own: the epoch ends all of a user's sessions at once. "Sign out
  everywhere" is the same operation, should it be wanted.
- Sessions of the dev sign-in carry no epoch and count as 0, so on a local directory a password change ends them too.
  A surveyjs.io identity has no local account to sign in to until identities are linked (self-hosted Step 8), so the
  server refuses `AUTH_METHODS` with `surveyjs` on `USER_DIRECTORY=local` until then. The hosted edition has no local
  accounts and checks nothing.
- The forced change refuses the current password as the new one, so the password from the settings cannot stay.
- The back-off resets on a restart and is per instance; with one instance (operations › "One instance") that is
  enough. Persisting it would need the `users` table, which knows only existing emails and would leak which exist.
- A lost setup link is recovered by restarting the server.
