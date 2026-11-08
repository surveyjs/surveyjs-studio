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

| Operation             | Request                                 | Success                     |
| --------------------- | --------------------------------------- | --------------------------- |
| `listUsers`           | `GET /admin/users?limit=&cursor=`       | `200` a page of `AdminUser` |
| `createUser`          | `POST /admin/users`                     | `201` the user and a link   |
| `updateUser`          | `PATCH /admin/users/{userId}`           | `200` the `AdminUser`       |
| `deleteUser`          | `DELETE /admin/users/{userId}`          | `204`                       |
| `createUserResetLink` | `POST /admin/users/{userId}/reset-link` | `201` a new link            |

The list is ordered by email and paged like every list ([Paging](paging.md)).

```json
{
  "id": "3c4a7fdf-94a1-41ec-96d0-41749c260100",
  "email": "alex@example.com",
  "displayName": "Alex",
  "instanceRole": "user",
  "status": "active",
  "createdAt": "2026-10-29T10:00:00.000Z",
  "lastSignInAt": "2026-10-30T08:15:00.000Z"
}
```

`status` is `invited` (no password yet), `active` or `disabled`; `lastSignInAt` is the last password
sign-in, `null` before the first.

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
  stops their sign-ins. `status: "active"` enables them again; an account that never set a password
  becomes `invited`. `invited` cannot be set (`422`).
- `instanceRole: "admin"` makes an instance admin; `"user"` takes the role away.
- Demoting or disabling the **last active instance admin** answers `409 last-instance-admin`, also
  for yourself.

## Reset a password

```sh
curl -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" \
  http://localhost:3000/api/v1/admin/users/3c4a7fdf-94a1-41ec-96d0-41749c260100/reset-link
```

The answer is a new link (`url`, `expiresAt`). The user's password is cleared, their sessions end
within a minute, and their earlier links stop working. For an `invited` user it is a new invitation.

## Delete a user

`DELETE /admin/users/{userId}` erases the user's data as the account-deleted webhook does: their
personal surveys with results and files, their memberships (an admin is promoted where none would
remain; a project with no other member is deleted with its surveys), then the account. The last
active instance admin cannot be deleted (`409 last-instance-admin`).

## Every project

An instance admin is an admin of every project: `getProject`, `updateProject`, `deleteProject`
and the member operations work on any project, and the project's `role` is `admin` for them.
`GET /projects?scope=all` lists every project of the instance; for anyone else `scope=all` answers
`403 forbidden`. Without `scope` the list stays the user's own projects.

| Status | Code                  | When                                                                 |
| ------ | --------------------- | -------------------------------------------------------------------- |
| 403    | `forbidden`           | The caller is not an instance admin                                  |
| 404    | `not-found`           | No such user                                                         |
| 409    | `email-taken`         | `createUser`: the email has an account                               |
| 409    | `last-instance-admin` | The last active instance admin would be demoted, disabled or deleted |
| 422    | `validation-failed`   | A field is missing or not allowed                                    |
| 501    | `not-implemented`     | The instance has no local accounts                                   |
| 503    | `read-only`           | The writes, under `READ_ONLY=true`                                   |
