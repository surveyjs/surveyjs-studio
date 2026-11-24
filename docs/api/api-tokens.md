# API tokens

How a script, a server or a browser app calls the API without signing in: an **API token**, or the **legacy access
key** a user already has. The design and the reasons are in
[ADR 0037](../adr/0037-access-keys-and-api-tokens.md). The people-facing page is
[API tokens](../user-guide/api-tokens.md) in the user guide. The operations are `listApiTokens`, `createApiToken`,
`revokeApiToken`, `revokeLegacyAccessKey` (tag API tokens) and `replaceCurrentCredential` (tag Session).

## Summary

- A credential goes in the header `Authorization: Bearer <value>`. A bearer request needs **no CSRF token**.
- A value that starts with `sjs_` is an **API token**. Any other value is a **legacy access key**. A value is never
  tried as the other kind.
- A token has **one scope**: Personal (the owner's personal surveys) or one project (a project admin's rights). The
  legacy key acts as its owner, on personal and project surveys, as it always did.
- **Managing credentials needs a session.** No token or key can create, list or revoke credentials.
- A bearer request from a browser page of another origin works: see
  [Calling the API from a browser](#calling-the-api-from-a-browser).

## The two kinds

| Kind              | Value                                    | Rights                                                       | Made by                                 | Revoked by                                          |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------ | --------------------------------------- | --------------------------------------------------- |
| API token         | `sjs_` and 43 characters                 | Personal, or one project with a project admin's rights       | The owner (Personal) or a project admin | The same people, in a session                       |
| Legacy access key | 32 hexadecimal digits, as on the old API | What its owner can do, on their personal and project surveys | Not in Studio: users have one already   | The owner, where the instance allows it (see below) |

The examples use a sample token. It is not a real credential.

```sh
API=http://localhost:3000/api/v1
TOKEN=sjs_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEX
curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys"
```

## What a bearer credential cannot do

These stay with the signed-in session (cookie and CSRF), so a leaked credential cannot make another one or take over
an account:

- creating, listing and revoking tokens and the legacy key;
- changing the account (the password, for example);
- creating or deleting a project;
- adding, changing or removing project members and invitations.

A token or key that calls one of these operations gets `401 unauthenticated`, because the operation accepts a session
only. A project token **can** list the project's members (`listMembers`); it cannot change them.

API tokens and legacy keys keep working after a password change; to stop them, revoke them.

One operation is for bearer requests only: [`replaceCurrentCredential`](#replacing-the-credential-of-a-request).

## Scopes

| Credential        | Reaches                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| Legacy access key | Everything its owner can reach: personal surveys and the projects they belong to       |
| Personal token    | The owner's personal surveys                                                           |
| Project token     | One project: its surveys, and its members (read only). It acts as that project's admin |

- Outside its scope a token sees nothing. A survey or a project it may not reach answers `404 not-found`, as an
  unknown one does, so a token cannot be used to find out what exists. A Personal token that asks for a project's
  surveys, or a project token that asks for another project's, gets `404`.
- Without a `project` parameter, `listSurveys` lists the **token's own space**: the personal surveys for a Personal
  token, the project's surveys for a project token.
- A project token **belongs to the project**. It keeps working when the person who made it leaves the project or stops
  being an admin, and it goes when the project is deleted. The person who made it is shown in the list and is recorded
  as the author of what the token changes. Deleting that person's account revokes their tokens.
- A **blocked or disabled owner** stops every credential they own: the legacy key, their Personal tokens and the
  project tokens they made. Their calls answer `401 unauthenticated`. The server checks this on each request, with a
  cache of at most 60 seconds.
- A bearer credential does **not** carry instance-admin rights, even when its owner is an instance admin. The
  `/admin/users` operations need a session.

## Making, listing and revoking tokens (session only)

All four operations need a session; the writes also need the CSRF header
([Authentication](authentication.md#csrf-the-double-submit-rule)). The examples use a cookie jar `cookies.txt` of a
signed-in session:

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
```

| Operation               | Request                                        | Answer                                                    |
| ----------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `listApiTokens`         | `GET /api-tokens`, optional `?project=<id>`    | `200` `{ legacyKey, tokens }`, newest first               |
| `createApiToken`        | `POST /api-tokens`, body `{ name, projectId }` | `201` `{ token, value }`                                  |
| `revokeApiToken`        | `DELETE /api-tokens/{tokenId}`                 | `204`                                                     |
| `revokeLegacyAccessKey` | `DELETE /api-tokens/legacy-key`                | `204`, or `409 legacy-key-revoke-unavailable` (see below) |

**List.** Without `project`: the caller's Personal tokens and their legacy key (`null` when they have none). With
`project`: that project's tokens, for its admins, and `legacyKey` is `null`. A member who is not an admin gets
`403 forbidden`; a person who does not belong to the project, or an unknown project, gets `404`. A token shows its
`id`, `name`, `projectId` (`null` for Personal), `lastFour`, `createdAt`, `lastUsedAt` and `createdBy`. **The value is
never returned.** The legacy key shows `lastFour` and `revocable`.

**Create.** `name` has 1 to 100 characters. `projectId` is `null` for a Personal token, or a project the caller
administers (`403` for another member, `404` for a project they do not belong to).

```sh
curl -s -b cookies.txt -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -d '{"name":"Nightly export","projectId":null}' "$API/api-tokens"
```

```json
{
  "token": {
    "id": "5b0f6c0e-0000-4000-8000-000000000001",
    "name": "Nightly export",
    "projectId": null,
    "lastFour": "EEEX",
    "createdAt": "2026-11-18T10:00:00.000Z",
    "lastUsedAt": null,
    "createdBy": { "id": "11111111-0000-4000-8000-a00000000001", "displayName": "Olivia Owner" }
  },
  "value": "sjs_EXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEXAMPLEEX"
}
```

**The value is in this answer only.** The server keeps a hash and the last four characters, so it cannot show the
value again. A lost token is revoked and replaced.

**Revoke.** The owner revokes a Personal token and a project admin a project token. The token stops working at once:
the next call with it answers `401`. Anyone else gets `404`.

**Last used.** `lastUsedAt` is written at most once a minute per credential, so it can be up to a minute old.

## The legacy access key

Users who had an access key on the old API keep it: it works as a bearer value, with the rights it always had.

- It is **never shown** in Studio, only its last four characters, in `listApiTokens` as `legacyKey`. Nobody can make a
  legacy key in Studio; a user makes a new token instead.
- **Revoke is available only where the instance allows it.** The setting `LEGACY_KEY_REVOKE` (default `false`) turns it
  on. While it is off, `revokeLegacyAccessKey` answers `409 legacy-key-revoke-unavailable` and the list shows the key
  with `revocable: false`. Until the old API checks keys through Studio, a revoke here alone would not stop the key, so
  the people who run the instance turn the setting on only when it does. With it on, Revoke switches the key off, and
  the next call with it answers `401`. A key the owner makes again on the site afterwards is a new key and works.
  Without a legacy key the operation answers `404`.
- Studio never changes the key on the site.

## Replacing the credential of a request

`replaceCurrentCredential` (`POST /me/credential`) is **bearer only**: a session cannot call it. It replaces the
credential that signs the request, so an integration can rotate its own value:

- with an **API token**: the old value stops working, and the answer is a new `sjs_` value with the same name and
  scope, shown once: `200 { "value": "sjs_…" }`;
- with a **legacy access key**: `409 legacy-key-replace-unavailable`. A legacy key cannot be replaced here.

```sh
curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/me/credential"
```

Use the new value from the next request on.

## Errors

| Status | Code                             | Means                                                                                          |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------- |
| 401    | `unauthenticated`                | No credential; an unknown, revoked or malformed one; a blocked owner; a session-only operation |
| 403    | `forbidden`                      | A member who is not an admin asked for a project's tokens or tried to make one                 |
| 404    | `not-found`                      | Outside the token's scope, or a project the caller does not belong to                          |
| 409    | `legacy-key-revoke-unavailable`  | `LEGACY_KEY_REVOKE` is off                                                                     |
| 409    | `legacy-key-replace-unavailable` | `replaceCurrentCredential` with a legacy key                                                   |

## Calling the API from a browser

A web page on **another origin** can call the API with `fetch` in two cases. In both, the answer carries
`Access-Control-Allow-Origin: *` and **never** `Access-Control-Allow-Credentials`: the browser sends no cookies with
these requests, and the page cannot ask for them.

| Request                                                             | CORS headers                     |
| ------------------------------------------------------------------- | -------------------------------- |
| Any `/api/v1/public/*` operation                                    | `Access-Control-Allow-Origin: *` |
| Any operation with an `Authorization: Bearer` header                | `Access-Control-Allow-Origin: *` |
| A request with a cookie and no `Authorization` header (the web app) | None: the API stays same-origin  |

A **preflight** (`OPTIONS`) is answered `204` for a public path, and for any path when it asks to send `Authorization`.
It allows the methods `GET`, `POST`, `PUT`, `PATCH` and `DELETE` and the request headers `Authorization`,
`Content-Type`, `Idempotency-Key`, `If-Match` and `If-None-Match`; the browser may keep the answer for 10 minutes. The
page can read these response headers: `ETag`, `Location`, `Retry-After` and `Content-Disposition`.

```js
// On a page served from another origin:
const response = await fetch("http://localhost:3000/api/v1/surveys", {
  headers: { Authorization: "Bearer " + token },
});
const page = await response.json();
```

A public survey needs no credential:

```js
const survey = await (await fetch("http://localhost:3000/api/v1/public/surveys/" + id)).json();
```

**Keep a token out of public pages.** A token in a page's code is visible to every visitor. Call the API with a token
from your server, or from a page only your team can open.
