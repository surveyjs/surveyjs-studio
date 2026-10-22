# The surveyjs.io user API and the account-deleted webhook

For the surveyjs.io team. This page says what My Surveys needs from surveyjs.io, and what surveyjs.io must send to
it, so that deleting a surveyjs.io account also erases the user's surveys in My Surveys. We specify both; nothing
here exists on the site yet. We ask for your changes before anything is built.

## Purpose and the two halves

My Surveys does not keep its own users in mode 1. It reads them from surveyjs.io. Today it reads the site's SQL
`Users` table directly. That works, but it ties My Surveys to the table, and a reconciliation that asks "which of
these users still exist?" is a poor fit for a direct read. The API replaces the direct read.

| Half                            | Direction                    | What it does                                                                                      |
| ------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| **The user API**                | My Surveys calls surveyjs.io | Looks up users by id, by email, and many by id; lists a user's licences (for the renewal notices) |
| **The account-deleted webhook** | surveyjs.io calls My Surveys | Tells My Surveys that a user deleted their account, so their data is erased                       |

The API is read only. It serves identity and licence state and never changes anything on the site.

## Authentication

- **A bearer token over HTTPS.** Every call carries `Authorization: Bearer <token>`. The token is a long random
  service key that My Surveys keeps in its configuration (`USER_API_TOKEN`) and never logs. Plain http is accepted
  only for a loopback host, for local tests.
- **Two tokens are accepted at a time**, so the key can be rotated without a gap: surveyjs.io adds the new token,
  My Surveys switches, then surveyjs.io removes the old one.
- A call without a valid token answers `401`. The site has no service credential today; this one is new. A private
  network path that does not go through the public front door would be better still, if you have one.

JSON, camelCase, UTF-8. Ids are GUIDs in any letter case; My Surveys sends them in lower case.

## The four calls

### The user

Every user answer has these four members and no others:

| Member        | Type           | Meaning                                                                              |
| ------------- | -------------- | ------------------------------------------------------------------------------------ |
| `id`          | string         | The user id (GUID). The stable key: an email can change, the id cannot               |
| `email`       | string         | The current email address                                                            |
| `displayName` | string or null | The name shown to other users. A blank name is fine: My Surveys then shows the email |
| `blocked`     | boolean        | Whether the user is blocked                                                          |

### `GET /users/{id}`

Answers `200` with the user, or `404` when there is no such user.

### `POST /users/by-email`

Body `{ "email": "<address>" }`. Answers `200` with the user, or `404`. The match ignores case. It is a POST so that
an address stays out of URLs and access logs.

### `POST /users/lookup`

Body `{ "ids": ["<id>", …] }` with **at most 100** ids. Answers `200 { "users": [ user, … ] }`. **An id that is not in
`users` is unknown.** My Surveys uses this for member lists and for the reconciliation, which asks which of many ids
still exist. More than 100 ids, or a body that is not that shape, is `400`.

### `GET /users/{id}/licences`

Answers `200 { "licences": [ { "expiresAt": "<ISO 8601 instant>" | null } ] }`, or `404` for an unknown user. The list
is every licence that counts for the user: the licences they own (a child licence with its parent's expiry) and the
licences transferred to them. `null` means no expiry. My Surveys applies its own rule to the dates (a licence is
expired when its expiry is past, and "expires soon" when fewer than 15 whole days are left; expired wins), so the site's time zone
question stays on the site: **please send instants with an offset or `Z`.**

### Errors and "a failure is never 'unknown'"

| Answer                                                                               | Meaning for My Surveys                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `200`                                                                                | The answer                                       |
| `404`                                                                                | **Unknown**: there is no such user               |
| anything else, a time-out, a connection error, an answer that is not the shape above | **A failure.** My Surveys stops and does nothing |

This rule is the one that matters most. My Surveys reads "unknown" as "this account is gone, erase its data". A `500`,
a slow answer or a half-written body must therefore never look like `404`. Use `404` only for a user that does not
exist. A call times out after five seconds.

### What is never returned

**No access keys, no password hashes, no billing or address data.** The site's own profile endpoint returns the access
key; this API must not. There is **no avatar and no email-verified field**: the site has neither, and My Surveys does
not ask for them.

## The account-deleted webhook

When a user deletes their surveyjs.io account, the site sends one signed message to My Surveys, which erases the
user's data: their personal surveys with results and files, and their place in every project. A project that would
lose its last admin passes to its next member; a project with no other member is deleted with its surveys.

`POST https://<my-surveys origin>/api/v1/webhooks/account-deleted`

### Signing

The message is signed as [Standard Webhooks](https://www.standardwebhooks.com/) describes, so you can use one of its
libraries.

- **The secret** is a string `whsec_` followed by the base64 of at least 24 random bytes. My Surveys has it in
  `ACCOUNT_WEBHOOK_SECRET`; you keep your copy. The HMAC key is the **decoded bytes**.
- **The headers:**

  | Header              | Value                                                                                                                                  |
  | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
  | `webhook-id`        | A unique message id (up to 128 characters). A retry sends the same id                                                                  |
  | `webhook-timestamp` | When the message was sent, in Unix seconds                                                                                             |
  | `webhook-signature` | `v1,` and the base64 HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{raw body}`. Several signatures separated by spaces are accepted |
  | `content-type`      | `application/json`                                                                                                                     |

- **The window is five minutes.** A timestamp more than five minutes from My Surveys' clock, on either side, is
  refused. Keep your clock right, and sign a retry again with a new timestamp.
- **Rotation by dual signing.** To change the secret, send both signatures in `webhook-signature`
  (`v1,<signature with the old secret> v1,<signature with the new secret>`). My Surveys accepts a message when any one of
  its signatures matches the secret it has. Once My Surveys has switched to the new secret, send only the new one.

### The body

```json
{ "type": "account.deleted", "data": { "userId": "<the deleted user's id>" } }
```

The body is at most 64 KiB. An event of another `type` is acknowledged (`204`) and ignored, so the site can add
event types later.

### Answers

| Status | Meaning                                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `204`  | The erasure is **finished** (it is done before the answer), or the event was of another type                                  |
| `400`  | The signature is valid, but the body is not an account event or `data.userId` is not an id                                    |
| `401`  | `invalid-signature`: the signature is missing, wrong, or its timestamp is outside the window. Checked before the body is read |
| `404`  | My Surveys has no webhook secret configured                                                                                   |
| `413`  | The body is over 64 KiB                                                                                                       |
| `5xx`  | A store failure; retry                                                                                                        |

**Retries are welcome.** Erasing the same user twice does nothing the second time, so send again after any answer other
than `204`. My Surveys does not keep the ids of messages it has seen; the five-minute window and the idempotent
erasure are what make a replay harmless. My Surveys trusts the signed message: it does not ask the user API whether
the account is gone.

### Where the site can hook it in

Right after a surveyjs.io account is deleted successfully (after the user row is removed). Send the message, and if it
does not answer `204`, retry later. Once My Surveys owns the surveys, the site's deletion should **stop deleting My
Surveys data itself** and only send the webhook: two deleters at once race, and the site's code leaves memberships and
files that My Surveys' erasure handles. Until then both run, and that is harmless. If a message is ever lost, My
Surveys has a command that finds users surveyjs.io no longer knows and erases their data; it relies on the `404` rule
above.

## Questions for the surveyjs.io team

1. Which server-to-server credential can the site host for the user API and the webhook: a service key in a header,
   as above, or request signing? Is there a private network path that does not go through the front door?
2. Is the live `Users` table newer than the SQL script in the site's repository (columns such as email confirmation,
   lockout and marketing preferences)? My Surveys reads only `id`, `email`, `displayname` and `blocked`.
3. Must billing records go when an account is deleted, or are they kept for tax reasons? My Surveys deletes none; this
   concerns the site's own data.
4. Does the site's account deletion write an audit row, and does the auth server revoke the user's tokens on deletion?
5. Does any link outside the site use the old run address with a publish id (not a survey id)? How many outside
   links are there? The front-door logs would tell. ([Redirect map](../operations/surveyjs-redirects.md).)
6. Can the old-address redirects live in the site's redirect middleware (which can look things up in SQL), or only in
   front-door rules (no lookups)? Two links need a lookup.
7. Is a blocked creator meant to unpublish their surveys' run pages? The old run page treats a survey whose creator is
   blocked or missing as unpublished; My Surveys does not do that yet, and would need `blocked` by id for it.

**A note on other endpoints.** Some of the site's existing endpoints that answer licence status, customer status or the
licence list for a given owner appear to be reachable without signing in, and they accept an email address. That would
let anyone learn a person's licence status. We did not rely on them and do not suggest copying the pattern; please
check whether they are meant to be open.

## The stub, for your own testing

My Surveys includes a local stand-in for this API, so you can see the shape of every answer and point a test client at
it without the site:

```sh
pnpm user-api:stub
```

It listens on `http://127.0.0.1:4010` with the token `local-stub-token` and serves a few synthetic users and licences
(all `example.com`). `GET /healthz` answers `200 {"status":"ok"}` without a token. It answers `401 {"error":"unauthorized"}`
without the token, `404 {"error":"not found"}` for an unknown user or path and `400 {"error":"bad request"}` for a bad
lookup body. Options: `--port`, `--host` (loopback hosts only), `--token`, `--help`. It is for tests and demos only.

To send a signed webhook to a local My Surveys server, use `pnpm webhook:account-deleted`
([the Step 12 demo](../demo/step-12.md)). The reference for the webhook operation is the
[API contract](../api/README.md#step-12-the-account-deleted-webhook). The decisions behind all of this are in
[ADR 0018](../adr/0018-accounts-by-deployment-mode.md).
