# 18. Accounts by deployment mode

Date: 2026-10-19

## Status

Accepted. The product owner has not confirmed the successor rule (the first member by name), that the signed webhook
is trusted without asking the user directory, that saved layouts and history entries are kept, that `oidc` is dropped
from `AUTH_METHODS`, the erasure fixture user, that reconciliation is a capped, dry-run-first command, that
`account:erase` stops when the directory lookup fails, and the promotion of a plain member when a project has no
visible admin; see "To confirm".

## Context

The product runs in several deployment modes ([idea section 3.0](../../idea.md)). In mode 1 (the hosted app for
surveyjs.io users, 1.1 to 1.3) the users stay on surveyjs.io and nobody signs up here. In the self-hosted modes (2b
and 3) the app owns the users or takes them from a customer's OAuth2 provider. Until Step 12 the code had one
interface, `Directory`, that held users **and** projects, and it was implemented only for the legacy SQL `Users`
table. Step 12 makes accounts follow the mode through one seam, and finishes mode 1:

- a user directory that can be the legacy SQL, a surveyjs.io user API that we specify, or (later) local accounts;
- erasing a user's data when the surveyjs.io account is deleted;
- start-up rules, so that a combination that cannot work fails at start-up and names the variable.

The surveyjs.io side has no server-to-server credential today, no outgoing webhook, and its account deletion leaves
memberships, projects and project surveys behind (research of the legacy site, Step 12). The old site's account
deletion and the new app's can both run during the transition; deleting twice is a no-op on both sides.

The rulings are numbered R5 to R15 and grouped by topic. (R1 to R4 are process rulings of the Step 12 plan: the
branch, no new dependency, the minimum of end-to-end runs, and test data that is never reset.)

## Decision

### The seam and its two kinds (R5, R6)

`Directory` is replaced by two interfaces in `server/src/providers/types.ts`:

| Interface       | Holds                                                                                                                  | Authority for                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `UserDirectory` | Users: `getUser`, `findUserByEmail`, `signInUser`, `missingUsers`                                                      | Sign-in, lookup by email, licence notices and erasure detection |
| `ProjectStore`  | Projects, members and roles (today's operations), and the two erasure operations `eraseMember` and `listMemberUserIds` | Who belongs to a project                                        |

`ProviderSet` loses `directory` and gains `users` and `projects`. `notices` stays on the set but is chosen together
with the user directory. Every call site moves: the surveys, content, files, results and views services take
`projects`; the session handlers take `users`; the projects service takes both.

A user directory has a **kind**:

- **`external`**: the users belong to another system (surveyjs.io in mode 1, a customer's OAuth2 provider in mode 3)
  and are never created here. `signInUser(claims)` returns `getUser(claims.sub)`, and `null` for an unknown user.
- **`local`**: the app owns the users, created or invited by an instance admin; no email, the admin resets
  passwords. It serves modes 2b and 3. **Not built in Step 12**: the self-hosted track builds it.

`missingUsers(ids)` returns the ids the directory positively does not know: lower-case, each once, in order of first
occurrence, ids that are not GUIDs never reported. It rejects on any failure. A failure is never read as "missing",
because the reconciliation reads "missing" as "erase".

**R6, how a project store knows users.** A `ProjectStore` keeps resolving member users from its own provider's rows:
Azure joins the site's `Users` table; memory uses the seed's users. The `UserDirectory` is the authority for
sign-in, email lookup, notices and erasure detection. A mixed configuration (the user API over memory storage) works
when both hold the same users, which the stub guarantees. The consequence for the hosted track is below.

If this is wrong: an interface rename later. The seam is internal.

### Sign-in methods, directories and the start-up rules (R8)

The new variables are `USER_DIRECTORY`, `USER_API_URL`, `USER_API_TOKEN` and `ACCOUNT_WEBHOOK_SECRET`
([Development](../development.md#environment-variables-server)). `USER_DIRECTORY` defaults to `memory` with
`STORAGE_PROVIDER=memory` and to `surveyjs-sql` otherwise. `AUTH_METHODS` is now a list of `surveyjs`, `password`,
`google`, `github` and `facebook`; **`oidc` is dropped**, because nothing implements it and the self-hosted track
names the providers this way (contract change C1).

Mode by mode, the intended combinations are:

| Mode                   | Sign-in methods                                                         | User directory                                             |
| ---------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1 (hosted)             | `surveyjs`                                                              | `surveyjs-sql` (now), `surveyjs-api` (when the API exists) |
| 2b (self-hosted)       | `password`                                                              | `local` (self-hosted track)                                |
| 3 (self-hosted, mixed) | `password` and OAuth2 providers (Google, GitHub, Facebook, surveyjs.io) | `local`; a user is created on first OAuth2 sign-in         |

A rule is a pure function in `config.ts`, with the format `VARIABLE: reason`, and all problems are reported together:

| Case                                                                           | Message                                                                                                |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `USER_DIRECTORY=memory`, storage is not memory                                 | `USER_DIRECTORY: memory requires STORAGE_PROVIDER=memory`                                              |
| `USER_DIRECTORY=surveyjs-sql`, storage is not azure-legacy                     | `USER_DIRECTORY: surveyjs-sql requires STORAGE_PROVIDER=azure-legacy`                                  |
| `USER_DIRECTORY=local`                                                         | `USER_DIRECTORY: local is not available yet (self-hosted track)`                                       |
| `surveyjs-api` without the URL or the token                                    | `USER_API_URL: required when USER_DIRECTORY=surveyjs-api` (and `USER_API_TOKEN: …`)                    |
| `USER_API_URL` over plain http, not loopback                                   | `USER_API_URL: must be https unless its host is localhost, 127.0.0.1 or [::1]`                         |
| `password`, `google`, `github` or `facebook` in `AUTH_METHODS` (one line each) | `AUTH_METHODS: <method> requires USER_DIRECTORY=local, which is not available yet (self-hosted track)` |
| `ACCOUNT_NOTICES=surveyjs-licenses` without an SQL or API directory            | `ACCOUNT_NOTICES: surveyjs-licenses requires USER_DIRECTORY=surveyjs-sql or surveyjs-api`              |
| A bad `ACCOUNT_WEBHOOK_SECRET`                                                 | `ACCOUNT_WEBHOOK_SECRET: must be whsec_ followed by the base64 of at least 24 bytes`                   |

The rules run for every caller, also for the command-line tools that skip the identity rules, because a tool needs a
working directory too. A default `USER_DIRECTORY` always fits its storage provider, so the storage rules apply only
to an explicit value. The consequence: with `oidc` dropped and the others refused, **`surveyjs` is the only valid
`AUTH_METHODS` value today**. The demo shows it: `USER_DIRECTORY=surveyjs-sql AUTH_METHODS=password` stops with the
`AUTH_METHODS` line.

If this is wrong: the self-hosted track lifts the "not available" refusals and may rename a method.

### The three mode-1 directories and `AccountNotices` (R7)

| `USER_DIRECTORY` | Built in                                        | Users from                          | Licence notices (`ACCOUNT_NOTICES=surveyjs-licenses`)         |
| ---------------- | ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------- |
| `memory`         | `providers/memory.ts`                           | The seed's users                    | Refused; the demo values only                                 |
| `surveyjs-sql`   | `providers/azure-legacy/index.ts` (SELECT only) | The site's `Users` table, as before | The SQL licence reader                                        |
| `surveyjs-api`   | `server/src/users/surveyjs-api/client.ts`       | The user API (below)                | The API's licence list through the same `licenceNotices` rule |
| `local`          | not built                                       | Refused at start-up                 |                                                               |

`createProviders` composes them: the storage provider builds its own pieces, and with `surveyjs-api` the set's
`users` and `notices` come from the client. `AccountNotices` follows the directory choice; the demo values
(`none`, `license-expired`, `license-expires-soon`) work on any directory. Readiness stays the storage provider's:
the API's readiness is part of hosted Step 2.

### The user API and its stub (R9)

The surveyjs.io site has no API that serves this: its profile endpoints answer for the signed-in user only and return
the user's access key, and it has no service credential. We specify the API in
[`docs/integrations/surveyjs-user-api.md`](../integrations/surveyjs-user-api.md), for the surveyjs.io team: user by
id, user by email (a POST, so an address stays out of URLs and access logs), many users by id (for `missingUsers`
and for member lists), and a user's licences. Each call carries a bearer token over HTTPS. The document says what
the API never returns (access keys, password hashes, billing data) and what does not exist (an avatar, an
email-verified flag). **A failure is never "unknown"**: only `404` means unknown, and the client treats any other
status, a time-out, a network error or a malformed body as a failure.

A **stub server** (`pnpm user-api:stub`) serves the same API from the fixture users, so the client, a run of the
provider suite, a conformance run and the demo need no surveyjs.io. The client follows no cache or retry rules yet
(hosted Step 2).

If this is wrong: the surveyjs.io team asks for changes to the document before building, and the client follows.

### Erasure and its three triggers (R10 to R13)

`eraseAccount(userId, { now })` follows idea section 8. **Projects first**: the user leaves each project through the
atomic `projects.eraseMember`, which applies the pure rule `decideMemberErasure`:

| Decision      | When                                             | Effect                                                                                                                |
| ------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `not-member`  | The user has no row in the project               | Nothing                                                                                                               |
| `last-member` | No other visible member                          | Nothing from the store; the service deletes every survey of the project and the project                               |
| `promote`     | Other visible members but no other visible admin | The user's rows are deleted and the first other member (by display name ignoring case, then user id) becomes an admin |
| `remove`      | Otherwise                                        | The user's rows are deleted                                                                                           |

A project whose `Organizations` row is gone but which still has rows of the user (Azure only; the replica's foreign
key forbids it, older production rows may hold it) also answers `remove`: those rows are deleted.

**Personal surveys last**: for each (archived ones too) the files, then the survey with its results, history, theme
and layouts. No archive rule and no permission check. It returns and logs ids and counts only, and a second run does
nothing. Erasure bypasses the last-admin refusal of [ADR 0017](0017-projects-and-members.md), because the erased user
has to leave; the Azure write is described in [ADR 0010](0010-writing-to-the-legacy-stores.md#step-12-member-erasure).
A plain member of a project with no visible admin also gives `promote`: it repairs a legacy project without admins.

**Erasure reaches every row the reconciliation sees.** It walks the projects of `projects.listUserProjectIds` (every
membership row of the user, raw: any role, also a project whose row is gone) and deletes the surveys of
`surveys.listSurveyIds` (every survey row of the owner, also one with a NULL `postid` or `resultid`), not the mapped
lists, which skip legacy rows the domain cannot represent. The Azure survey delete reads the row raw and skips the
results tables of a NULL `postid`. The reconciliation reads raw ids too (`listMemberUserIds`,
`listPersonalOwnerIds`), so an erased id does not come back on every run and does not count against `--max` for
ever (Step 12 final review, I1).

The **triggers** all call this one service:

1. **The account-deleted webhook** (R10), `POST /api/v1/webhooks/account-deleted`, in the public contract (C2) because
   a port must implement it for mode 1 and the conformance suite tests it over HTTP. It follows
   [Standard Webhooks](https://www.standardwebhooks.com/), so the site can use a library: the headers `webhook-id`,
   `webhook-timestamp` and `webhook-signature` (`v1,` and the base64 HMAC-SHA256 of `{id}.{timestamp}.{body}`), a
   `whsec_` secret whose decoded bytes are the key, `timingSafeEqual`, and a **five-minute window** on either side.
   There is no store of seen ids: the erasure is idempotent, so a replay does nothing harmful and the server stays
   stateless. The signature is checked on the raw body **before** anything is parsed. Answers: `204` (finished, or an
   event of another type), `401 invalid-signature`, `400` for a signed but invalid body, `404` when no secret is
   configured, `413` over 64 KiB. **The signed message is authoritative**: the endpoint does not check that the
   directory has forgotten the user (conformance must be able to erase a user the memory directory still knows). No
   rate limit of its own: the check is cheap, and a bulk deletion must not be throttled.
2. **`pnpm account:erase --user <id or email> [--yes]`** (R13). An email is looked up in the directory; an id is
   erased even if the directory does not know it. Without `--yes` it prints the plan and writes nothing. It refuses the
   memory store, whose data lives in the server process. If the directory lookup fails (it is used only to print the
   name), the command exits 1 and erases nothing.
3. **`pnpm account:reconcile [--apply] [--max N]`** (R12), the safety net for a lost webhook. Not an in-process
   timer: several instances would race. The candidates are the owner ids of personal surveys and the member ids of
   projects that `users.missingUsers` does not know. Without `--apply` it lists and erases nothing; with `--apply` it
   erases each candidate unless there are more than `--max` (default 10), in which case it erases nothing and exits
   non-zero. A directory failure aborts the run with nothing erased. The first run on 1.1 data will find users the
   legacy site already deleted (it leaves their memberships), and may list the id of a deleted project whose surveys
   still point at it; the dry run and the cap are what make it safe.

In mode 2b the instance admin's "delete user" will call the same service (self-hosted track).

### The erasure fixture user (R14) and the contract (R15)

A sixth fixture user, **Erin Erasable** (`11111111-0000-4000-8000-a00000000006`, `erasable@example.com`), has no
surveys and no memberships in the fixtures. Every erasure test and demo erases only Erin or a fresh random id, and
creates the data first, so the fixtures that other tests read stay intact. Oscar Outsider is never erased. On the
replica `OrganizationUsers.userid` has a foreign key, so memberships exist only for fixture users, and orphan
memberships are tested on the memory provider only. The unmappable rows (a NULL role, a NULL `postid` or `resultid`)
are tested on the replica in the null-rows suite; a membership of a missing project is tested there too, with the
`organizationid` foreign key switched off for that one insert (the suite reloads the schema afterwards).

The contract changes are two: C1, the `AppConfig.authMethods` values, and C2, the webhook operation
`receiveAccountDeleted`, its `AccountDeletedEvent` schema, the `Integrations` tag and the `invalid-signature` problem
code. Nothing else changed.

## Consequences

- **For the hosted track.** Mode 1 keeps the users on surveyjs.io, and the projects move to the app's own stores at
  1.3. An own-store `ProjectStore` must therefore resolve member users through the `UserDirectory` (R6), and hosted
  Step 2 keeps read access to the site's `Users` for the Azure join until the cutover. Skipping this means reworking
  `listMembers` and the member rules.
- Only `surveyjs` can be a sign-in method until the self-hosted track builds the local directory.
- The surveyjs.io site must call the webhook after a successful deletion and stop deleting My Surveys data itself,
  or the two deleters race (the document says so). Until then both run, and deleting twice is harmless.
- A lost webhook is repaired by the reconciliation, which is an operator command and not a timer
  ([Operations](../operations.md)).
- Erasure is stricter than the old site's deletion: it also removes memberships, hands over projects and deletes
  files. It is not complete; see "Open".
- History names cost one API call for each distinct user with `surveyjs-api`, until hosted Step 2 adds a cache.

## Open

- **Saved layouts on surveys the user does not own** are not erased (Azure would need a container scan).
- **History entries that name the user** on project surveys, and **`creatorId` on project surveys**, are kept
  (the entry and the creator are part of the survey).
- **The legacy `postdelete` copies** of results deleted on the old site stay on the surveys that are not erased (a
  shared project's surveys); the hosted track purges them. An erased survey's `postdelete{postId}` table goes with it
  (the Step 5 survey delete).
- **No lock between the `last-member` decision and the project delete.** A member who joins in that window
  finds the project deleted with the others. A fix would hold the project lock across both steps.
- **The dry run of `account:erase` can differ from the store's decision.** `previewErasure` works from the visible
  members; the store decides again when erasing, so orphan rows can change the outcome. A project whose row is gone
  shows as `last-member` when the user has its only rows, while the store answers `remove`. Rows that cannot be read
  are listed by id without a name. The command says so.
- **`listPersonalOwnerIds` on the real `Surveys` table is a full scan** (an index on `userid` exists). To measure
  later, with the other large scans (Step 14 did not).
- **A session outlives its erased account.** The app session is a stateless sealed cookie, so after the webhook
  erases a user, a browser that is still signed in can create new personal surveys until the session expires. The
  next reconciliation run finds and erases them. Per-request user checks or session epochs are self-hosted-track
  scope.
- **No time-out retry, by-id cache or readiness check of the API** until hosted Step 2.
- **Billing data** on the surveyjs.io side is not touched by any deletion; whether it must go is a question for the
  surveyjs.io team (in the user API document).

## To confirm

These are decisions of the team, not of the product owner. Until the owner confirms them they stand as written.

- **The successor rule.** When the last admin of a project is erased, the first other member by display name becomes
  the admin. The owner may prefer the longest-standing member, or a project that is deleted.
- **A plain member erased from a project without a visible admin** also promotes the successor (it repairs a legacy
  project without admins). The owner may prefer to leave such a project alone.
- **The signed webhook is trusted** without asking the user directory. The cost of a guard is one directory call per
  event; the cost of none is that a leaked secret can erase any user.
- **Saved layouts and history entries are kept** after an erasure (see "Open").
- **`oidc` is dropped** from `AUTH_METHODS`; `google`, `github` and `facebook` take its place for the self-hosted
  track, and all are refused until then.
- **Erin Erasable**, a sixth fixture user for erasure tests and demos.
- **Reconciliation is a capped, dry-run-first command** (default `--max 10`) run by an operator's scheduler, not an
  automatic job.
- **`account:erase --user <id>` stops with exit 1 and erases nothing** when the directory lookup fails, even though
  the lookup only prints a name. The owner may prefer that it erases anyway.
