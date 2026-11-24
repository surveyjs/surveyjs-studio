# ADR 0043: Hosted users on the local directory, from surveyjs.io sign-in

Status: Accepted (hosted Step 2, 2026-11-24). Changes [ADR 0022](0022-users-from-sign-in.md): the hosted directory is
the existing `local` one, extended, not a new `profiles` directory; licences come as a sign-in claim, not from a site
endpoint. The rest of ADR 0022 stands (no user API, the account-deleted webhook, profiles seeded by the migration).

## Context

On the new server ([ADR 0042](0042-one-switch-to-the-new-server.md)) Studio must know people without reading the
surveyjs.io site's database: who is signing in, names and emails for members and history, who is blocked, the
licence-expiry notices, and which accounts were deleted. ADR 0022 settled that this comes from sign-in through
`auth.surveyjs.io` plus the account-deleted webhook. What exists on 2026-11-24:

- **Studio:** the `local` directory (self-hosted Steps 4 and 8): `users`, `user_identities` (linked sign-ins),
  `project_invitations`, the join policy (`OPEN_SIGN_UP`), the instance admin's Users page, and the webhook's
  receiving end with erasure ([the webhook contract](../integrations/surveyjs-user-api.md#the-account-deleted-webhook)).
  The new server's private set-up already runs `USER_DIRECTORY=local` with surveyjs.io sign-in only and
  `ACCOUNT_NOTICES=none`.
- **`local` falls short for hosted:** a returning user's email and name are never refreshed; the `blocked` claim is
  ignored; an account made at sign-in gets a random id, so the webhook (which names the surveyjs.io id) would not find
  it; there is no licence data; `account:reconcile` would read "never signed in" as "deleted".
- **The sign-in server** already re-reads the account at `/OAuth/Authorize` and returns `blocked` in UserInfo. It has
  no licence data in its answers, and the site sends no account-deleted webhook yet.

## Decision

### 1. `local`, extended for hosted sign-in

The hosted edition keeps `USER_DIRECTORY=local`. What follows applies to a sign-in through `surveyjs` in the hosted
edition (`APP_EDITION=hosted`); every other sign-in, and the self-hosted edition, behave as today.

- **The account id is the surveyjs.io id.** An account created at such a sign-in takes the `sub` claim (a GUID) as its
  id. Migrated people keep theirs (point 6). Studio's user ids, API token creators and legacy access-key owners then
  name the same id as the site does. A `sub` that is not a GUID is refused.
- **Every sign-in refreshes the account** from the claims: email, display name, the site's `blocked`, and the licence
  date (point 3). A new email that another Studio account already holds is not taken over: the old one stays and a
  warning is logged (without either address).
- **Blocked by the site and disabled by an admin stay apart.** A new column holds the site's `blocked`, refreshed at
  sign-in; `status = disabled` stays the admin's. Either one refuses sign-in ("Account blocked" for the site's) and
  makes the account's API tokens and legacy key fail the owner check; neither side clears the other. A blocked user
  signing in for the first time gets no account.
- **Linking by email is narrower.** A surveyjs.io id Studio has not seen links to the account with its verified email
  only when that account has no `surveyjs` identity yet (an account an admin created). When the account with that
  email already belongs to another surveyjs.io id (a person who deleted their site account and registered again, or a
  reused address), sign-in is refused with a problem that says so, and a warning is logged; once the old id's webhook
  has erased that account, the next sign-in creates a new one. Nobody takes over another id's surveys.
- **The full admin stays** (product owner, 2026-11-24): the Users page works as in the self-hosted edition. Deleting a
  user in Studio does not close the surveyjs.io account; with `OPEN_SIGN_UP=on` that person gets a new, empty account
  at the next sign-in.
- **`ADMIN_EMAIL` promotes, it does not create.** On hosted the first-admin bootstrap creates no account (it would get a
  random id and collide with the migration's seed). Instead, while there is no instance admin, the account whose email
  equals `ADMIN_EMAIL` becomes admin at its sign-in, whether it was seeded or is new.

### 2. The account-deleted webhook finds the account by its linked sign-in

The webhook's `data.userId` is the surveyjs.io id. Studio looks it up as the subject of a `surveyjs` identity first,
then as a user id, and erases that account; an account an admin created (with a random id) and the person later
linked is found too. Erasure removes the account row and its identities as well as its data. An id Studio does not
know is acknowledged (`204`) and changes nothing.

### 3. Licences as a sign-in claim

- **The site:** each OAuth client in the sign-in server's configuration can list extra claims. For Studio's client
  only, `/OAuth/Authorize` reads the user's licences when it re-reads the account and UserInfo returns
  **`license_expires_at`**: the earliest expiry instant among the user's licences (the same set the legacy notices
  read: owned licences, developer seats through their parent licence, and licences transferred to the user), in RFC
  3339 UTC, or `null` when none has an expiry. Other clients get no new claim.
- **Studio** stores it at every sign-in and a new `ACCOUNT_NOTICES` value computes the notices from it with the
  existing rule: the earliest expiry decides both "expired" and "expires soon", so one date gives the same notice as
  the list. A missing claim stores `null` (no notice).
- **Freshness:** a renewal, a block or a new email reaches Studio at the next sign-in, at most one session
  (`SESSION_MAX_AGE_SECONDS`, 12 hours by default) later. The sign-in server's own session keeps that sign-in silent.

### 4. The site sends the webhook through an outbox

The site's account deletion (the user's own "Delete account"; the site's admin only blocks) records the deletion in
a durable outbox **before** it deletes anything: the site's storage has no transactions. A background sender in the
site sends an entry only once the account is really gone, and drops an entry whose account still exists after a grace
period (a deletion that failed), so a crash never erases a living person's data in Studio. It delivers as the contract
describes (signed, same `webhook-id` on retries) and retries with back-off until Studio answers `2xx`. A `400` stops the retries
and is logged; `503` (Studio read-only, as in the cutover window) and other failures are retried. The site-side design
details stay in the site's repository.

**From when, and to where.** The outbox records deletions from the day it ships, but **delivers only from the
cutover**, to `https://studio.surveyjs.io`, which by then is the new server. Until then the site's own account deletion
keeps removing the person's surveys and results from the legacy stores, as it does today, so the final migration does
not copy them; the queued messages then erase anything a pre-copy took along. Today's server never receives the
webhook.

### 5. Reconciliation is refused on hosted

With the hosted edition on `local`, `missingUsers` rejects and `account:reconcile` says it is not available: a person
who has not signed in since the migration is unknown, not deleted. Deleted accounts arrive by the webhook only.

### 6. What the migration seeds (hosted Step 9)

For every person the copied data names (owners, members, history authors, access-key holders): a `users` row with the
surveyjs.io id, email, display name, role `user`, status `active`, no password, the site's `blocked`, no licence date;
and a `surveyjs` identity with that id as subject. Their first sign-in then finds them by identity. The seed goes
into empty tables: wiping after the test migration empties the whole database, accounts included. The migration's
`reconcile` also removes the accounts of people no longer named by the source, as a second line behind the webhook.

### 7. The user API client goes

The `surveyjs-api` directory, its stub and conformance run, `USER_API_URL`, `USER_API_TOKEN` and the `user-api`
readiness check are removed, and with them the API sections of the user API document (the webhook sections stay).
`surveyjs-sql` stays for today's server (modes 1.1 and 1.2) until hosted Step 12.

## Approaches considered

| Option                                                    | Why not, or why                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **`local`, extended (chosen)**                            | The new server already runs it; invitations, linked sign-ins and the admin the product owner wants exist and are tested                  |
| A separate `profiles` directory (ADR 0022's working name) | Same jobs in a second directory; invitations and identity handling written again; no admin unless that is rebuilt too                    |
| Keep `surveyjs-sql` on the new server                     | Every sign-in and member lookup would cross to the site's database in another provider, and the new server would hold its credentials    |
| A licence endpoint on the site, asked by Studio           | Needs a way for Studio to authenticate per user; the claim rides on the sign-in the site already re-reads (the product owner's proposal) |
| The webhook sent once at deletion, failures logged        | A deletion made while Studio is down or read-only is lost unless someone reads the log; erasure must not depend on that                  |
| No instance admin on hosted, or a read-and-disable one    | The product owner chose the full admin, as self-hosted                                                                                   |

## Consequences

- **Migration `0010`** adds the site's `blocked` and the licence date to `users` (SQLite and PostgreSQL). Both stay
  empty in the self-hosted edition.
- **The new server's settings** gain the new `ACCOUNT_NOTICES` value and `ACCOUNT_WEBHOOK_SECRET`; the site gets
  Studio's webhook URL and the same secret, per environment. Private set-up, outside this repository.
- **Two repositories change:** this one (Studio's half) and the site's (the claim and the outbox), tested together
  through the OAuth stub here and the site's own tests there.
- **Gone:** the user API client and its settings (point 7); ADR 0018's user API half was already superseded by ADR 0022.
- **Not in this step:** Google or GitHub sign-in on hosted, telling the site about deletions made in Studio, and live
  (not per-sign-in) blocking or licences.

## Left to the builder

The names of the new columns and of the `ACCOUNT_NOTICES` value; the retry schedule, the outbox's shape and its
delivery switch on the site; the wording of the refused-link problem and the log lines; whether `getUser` exposes the
licence date; the stub's new claim.
