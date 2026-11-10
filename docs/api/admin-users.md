# Managing users (instance admins)

The `/admin/users` operations of a self-hosted instance with local accounts
(`USER_DIRECTORY=local`, tag Admin in the contract). Only an **instance admin** may call them:
anyone else gets `403 forbidden`, a request without a session `401`. Without local accounts every
one answers `501 not-implemented`. How the server keeps the accounts:
[Architecture](../architecture.md#the-instance-admin).

The examples sign in as an instance admin first and send the CSRF header on writes (see
[Authentication](authentication.md#csrf-the-double-submit-rule)):

```sh
curl -c cookies.txt -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@example.test","password":"the admin password"}' \
  http://localhost:3000/api/v1/auth/password/login
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
```

## Operations

| Operation             | Request                                                        | Success                     |
| --------------------- | -------------------------------------------------------------- | --------------------------- |
| `listUsers`           | `GET /admin/users?limit=&cursor=`                              | `200` a page of `AdminUser` |
| `createUser`          | `POST /admin/users`                                            | `201` the user and a link   |
| `updateUser`          | `PATCH /admin/users/{userId}`                                  | `200` the `AdminUser`       |
| `deleteUser`          | `DELETE /admin/users/{userId}`                                 | `204`                       |
| `createUserResetLink` | `POST /admin/users/{userId}/reset-link`                        | `201` a new link            |
| `listUserIdentities`  | `GET /admin/users/{userId}/identities`                         | `200` the linked sign-ins   |
| `unlinkUserIdentity`  | `DELETE /admin/users/{userId}/identities/{provider}/{subject}` | `204`                       |

The list is ordered by email and paged like every list ([Paging](paging.md)).

```json
{
  "id": "3c4a7fdf-94a1-41ec-96d0-41749c260100",
  "email": "alex@example.com",
  "displayName": "Alex",
  "instanceRole": "user",
  "status": "active",
  "hasPassword": false,
  "pendingLink": { "purpose": "reset", "expiresAt": "2026-11-06T09:00:00.000Z" },
  "createdAt": "2026-10-29T10:00:00.000Z",
  "lastSignInAt": "2026-10-30T08:15:00.000Z"
}
```

- `status` is `invited` (no password yet), `active` or `disabled`.
- `hasPassword` says whether the user has a password. It is `false` after a reset, until the user
  uses the new link, and for a user who signs in only with Google, GitHub, Facebook or surveyjs.io.
- `pendingLink` is the user's set-password link that is not used and not expired: its `purpose`
  (`invitation`, `reset`, or `setup` for the first admin) and `expiresAt`. It is `null` when there
  is none, also when the link expired. The link itself is never shown again. Above: Alex's password
  was reset, and the link waits to be used.
- `lastSignInAt` is the last sign-in, `null` before the first.

## Create a user

```sh
curl -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -d '{"email":"alex@example.com","displayName":"Alex","instanceRole":"user"}' \
  http://localhost:3000/api/v1/admin/users
```

```json
{
  "user": { "id": "…", "email": "alex@example.com", "status": "invited", "…": "…" },
  "link": {
    "url": "http://localhost:5173/set-password?token=7cJ2rQ0wUu8xXnYk3fVb1A",
    "expiresAt": "2026-11-05T10:00:00.000Z"
  }
}
```

- `instanceRole` defaults to `user`.
- The link holds 128 random bits. The server keeps only its hash, so this answer is the only time
  it is shown. It works once and for 7 days.
- The user sets a password with it: `POST /auth/password-link` with `token` and `password`
  ([Password sign-in](authentication.md#password-sign-in)). The account becomes `active`, and the
  answer sets its session cookies: the user lands signed in. A used,
  expired or unknown link gets `410 link-invalid`.
- An email that already has an account (any case) gets `409 email-taken`.

## Change the role or the status

`PATCH` with `application/merge-patch+json` (or `application/json`) and `instanceRole` and/or
`status`:

```sh
curl -b cookies.txt -X PATCH -H "X-CSRF-Token: $CSRF" \
  -H "Content-Type: application/merge-patch+json" \
  -d '{"status":"disabled"}' http://localhost:3000/api/v1/admin/users/3c4a7fdf-94a1-41ec-96d0-41749c260100
```

- `status: "disabled"` ends the user's sessions within a minute (at once on the same server) and
  stops their sign-ins. `status: "active"` enables them again; an account with neither a password nor
  a linked Google, GitHub, Facebook or surveyjs.io sign-in becomes `invited`. `invited` cannot be set
  (`422`).
- `instanceRole: "admin"` makes an instance admin; `"user"` takes the role away.
- Demoting or disabling the **last active instance admin** answers `409 last-instance-admin`, also
  for yourself.
- A disabled user cannot sign in by any method: not with a password, and not with a linked Google,
  GitHub, Facebook or surveyjs.io sign-in (the sign-in ends on `/sign-in/refused?reason=disabled`).
  Their linked sign-ins stay, so enabling them lets those work again.

### When a role change takes effect

Each server checks every request's session against the account, and keeps the account's state
(status, role, session epoch) for up to **60 seconds** ([ADR 0026](../adr/0026-revoking-stateless-sessions-with-an-epoch.md)).
The server that makes a change forgets the account's state at once. So:

- on the server that answered `updateUser`, the new role applies to the user's next request;
- on another server of the same instance (several replicas behind a load balancer), it applies
  within 60 seconds;
- a page the user has open shows the old menu (for example **Users**) until it reads `GET /me`
  again: when the user reloads it or comes back to the tab. The server already refuses what the
  old role allowed.

Disabling, a reset and an unlink take effect in the same way.

## Reset a password

```sh
curl -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" \
  http://localhost:3000/api/v1/admin/users/3c4a7fdf-94a1-41ec-96d0-41749c260100/reset-link
```

The answer is a new link (`url`, `expiresAt`). The user's password is cleared, **every linked
sign-in is unlinked**, their sessions end within a minute, and their earlier links stop working. For
an `invited` user it is a new invitation.

- After a reset, the new link is the only way in that the admin chose. A Google, GitHub, Facebook or
  surveyjs.io sign-in with the account's **verified** email links again by itself
  ([ADR 0029](../adr/0029-linking-identities-by-verified-email.md) D3); one whose provider gives
  another email now does not.
- Resetting **your own** password answers `403 forbidden`: it would end your session, and with it
  the page that shows the link. Change it with `changeOwnPassword`, or ask another instance admin.

## Linked sign-ins

`GET /admin/users/{userId}/identities` lists the user's linked Google, GitHub, Facebook and
surveyjs.io identities, ordered by provider, then by when they were linked. It is not paged: a user
has a few at most.

```json
{
  "items": [
    {
      "provider": "github",
      "subject": "583231",
      "email": "alex@example.com",
      "linkedAt": "2026-11-03T14:00:00.000Z"
    }
  ]
}
```

- `subject` is the provider's stable id of the person. `email` is the one the provider gave when the
  identity was linked (`null` when it gave none). The server keeps no account name.
- `DELETE /admin/users/{userId}/identities/{provider}/{subject}` unlinks one, with `subject`
  URL-encoded. That identity no longer signs in to the account, and the user's sessions end within a
  minute (one of them may come from it). `404 not-found` for an unknown user or an identity the user
  does not have.
- Unlinking does not keep a person out. If the provider still gives the account's email as verified,
  the next sign-in with it links it again. To keep someone out, disable them.

```sh
curl -b cookies.txt -X DELETE -H "X-CSRF-Token: $CSRF" \
  http://localhost:3000/api/v1/admin/users/3c4a7fdf-94a1-41ec-96d0-41749c260100/identities/github/583231
```

## Delete a user

`DELETE /admin/users/{userId}` first disables the account, so the user cannot sign in and their
sessions end. Then it erases the user's data as the account-deleted webhook does: their personal
surveys with results and files, their memberships (an admin is promoted where none would remain; a
project with no other member is deleted with its surveys), then the account with its links and
linked sign-ins. If the erasure fails, the account stays disabled; send the `DELETE` again. The last
active instance admin cannot be deleted (`409 last-instance-admin`), and nothing is erased then.

## Every project

An instance admin is an admin of every project: `getProject`, `updateProject`, `deleteProject`
and the member operations work on any project, and the project's `role` is `admin` for them.
`GET /projects?scope=all` lists every project of the instance; for anyone else `scope=all` answers
`403 forbidden`. Without `scope` the list stays the user's own projects.

| Status | Code                  | When                                                                                    |
| ------ | --------------------- | --------------------------------------------------------------------------------------- |
| 403    | `forbidden`           | The caller is not an instance admin; `createUserResetLink` for the caller's own account |
| 404    | `not-found`           | No such user; `unlinkUserIdentity`: the user has no such identity                       |
| 409    | `email-taken`         | `createUser`: the email has an account                                                  |
| 409    | `last-instance-admin` | The last active instance admin would be demoted, disabled or deleted                    |
| 422    | `validation-failed`   | A field is missing or not allowed                                                       |
| 501    | `not-implemented`     | The instance has no local accounts                                                      |
| 503    | `read-only`           | The writes, under `READ_ONLY=true`                                                      |
