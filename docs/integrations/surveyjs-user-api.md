# The surveyjs.io sign-in claims and the account-deleted webhook

For the surveyjs.io team. This page says what My Surveys needs from surveyjs.io: two claims at sign-in, and one
signed message when an account is deleted, so that deleting a surveyjs.io account also erases the user's surveys in
My Surveys. We specify both; we ask for your changes before anything is built.

> **There is no user API.** An earlier version of this page asked for four read calls (a user by id, by email, many
> by id, and a user's licences). They are withdrawn ([ADR 0022](../adr/0022-users-from-sign-in.md)) and My Surveys
> no longer contains a client for them. Please do not build them.

## Purpose and the two halves

My Surveys keeps its own account for each person who signs in (a "local" account), linked to the surveyjs.io
sign-in. It reads what it needs about the person from the sign-in itself, and it needs one message back from the
site when the account is deleted.

| Half                            | Direction                    | What it does                                                                      |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| **The sign-in claims**          | surveyjs.io sends to Studio  | Says whether the account is blocked, and when the user's earliest licence expires |
| **The account-deleted webhook** | surveyjs.io calls My Surveys | Tells My Surveys that a user deleted their account, so their data is erased       |

## Sign-in claims

My Surveys signs people in with surveyjs.io as an OpenID Connect provider. The user-info answer
(`/OAuth/UserInfo`) carries these claims in addition to the standard ones. The account is re-read on each
`/OAuth/Authorize`, so a change shows at the user's next sign-in.

| Claim                | Type                            | Meaning                                                                                                                                                                                     |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blocked`            | boolean                         | `true` blocks the user in Studio: the sign-in is refused. `false`, or an absent claim, does not block                                                                                       |
| `license_expires_at` | string (RFC 3339 UTC) or `null` | The earliest expiry among the user's licences, such as `2027-03-01T00:00:00Z`; `null` when the user has no licence with an expiry. Sent only to Studio's OAuth client, not to other clients |

Studio uses `license_expires_at` for the renewal notices it shows the user. It reads no other licence data.

## The account-deleted webhook

When a user deletes their surveyjs.io account, the site sends one signed message to My Surveys, which erases the
user's data: their personal surveys with results and files, and their place in every project. A project that would
lose its last admin passes to its next member; a project with no other member is deleted with its surveys.

On the hosted service, `data.userId` is found as the surveyjs.io sign-in linked to a My Surveys account first, then as a
My Surveys account id, and that account is deleted with its linked sign-ins after its data is erased
([ADR 0043](../adr/0043-hosted-users-on-the-local-directory.md)). When the account has another id, the data under the
surveyjs.io id is erased too. The last instance admin is the exception: its data is erased, but the account is kept
as a deleted placeholder (no name or email, no linked sign-ins, disabled, still an admin) and a warning is logged.
`ADMIN_EMAIL` is not made admin again; an operator names a new admin with `pnpm account:make-admin`
([Operations](../operations.md#pnpm-accountmake-admin)).

`POST https://<app origin>/api/v1/webhooks/account-deleted`

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

| Status | Meaning                                                                                                                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `204`  | The erasure is **finished** (it is done before the answer), or the event was of another type. An id no account has is acknowledged (`204`): any data held under that id is erased, and nothing else changes |
| `400`  | The signature is valid, but the body is not an account event or `data.userId` is not an id                                                                                                                  |
| `401`  | `invalid-signature`: the signature is missing, wrong, or its timestamp is outside the window. Checked before the body is read                                                                               |
| `404`  | My Surveys has no webhook secret configured                                                                                                                                                                 |
| `413`  | The body is over 64 KiB                                                                                                                                                                                     |
| `5xx`  | A store failure; retry                                                                                                                                                                                      |

**Retries are welcome.** Erasing the same user twice does nothing the second time, so send again, with back-off, after
any answer other than `2xx`, except `400`: that message will never be accepted, so log it and stop. A `503` (My Surveys
is read-only, as in a maintenance window) and every other failure are retried. My Surveys does not keep the ids of messages it has seen; the five-minute window and the idempotent
erasure are what make a replay harmless. My Surveys trusts the signed message: it does not ask the site whether
the account is gone.

### Where the site can hook it in

Right after a surveyjs.io account is deleted successfully, once the account is really gone. Send the message, and
retry as above until My Surveys answers `2xx`. Once My Surveys owns the surveys, the site's deletion should **stop
deleting My Surveys data itself** and only send the webhook: two deleters at once race, and the site's code leaves
memberships and files that My Surveys' erasure handles. Until then both run, and that is harmless. The webhook is the
only way a deletion reaches the hosted My Surveys: it has no command that looks for deleted accounts (a person who has
not signed in yet is unknown, not deleted), so a message must not be dropped while My Surveys can still accept it.

## Questions for the surveyjs.io team

1. Which server-to-server credential can the site host for the webhook: the signed message above, or something else?
   Is there a private network path that does not go through the front door?
2. Is the live `Users` table newer than the SQL script in the site's repository (columns such as email confirmation,
   lockout and marketing preferences)? My Surveys needs only `blocked` and the licence expiry.
3. Must billing records go when an account is deleted, or are they kept for tax reasons? My Surveys deletes none; this
   concerns the site's own data.
4. Does the site's account deletion write an audit row, and does the auth server revoke the user's tokens on deletion?
5. Does any link outside the site use the old run address with a publish id (not a survey id)? How many outside
   links are there? The front-door logs would tell. ([Redirect map](../operations/surveyjs-redirects.md).)
6. Can the old-address redirects live in the site's redirect middleware (which can look things up in SQL), or only in
   front-door rules (no lookups)? Two links need a lookup.
7. Is a blocked creator meant to unpublish their surveys' run pages? The old run page treats a survey whose creator is
   blocked or missing as unpublished; My Surveys does not do that yet, and would need a way to ask whether a given creator is blocked.

**A note on other endpoints.** Some of the site's existing endpoints that answer licence status, customer status or the
licence list for a given owner appear to be reachable without signing in, and they accept an email address. That would
let anyone learn a person's licence status. We did not rely on them and do not suggest copying the pattern; please
check whether they are meant to be open.

To send a signed webhook to a local My Surveys server, use `pnpm webhook:account-deleted`
([the Step 12 demo](../demo/step-12.md)). The reference for the webhook operation is the
[API contract](../api/README.md#step-12-the-account-deleted-webhook). The decisions behind all of this are in
[ADR 0018](../adr/0018-accounts-by-deployment-mode.md).
