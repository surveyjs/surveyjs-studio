# Authentication, sessions and CSRF

How a client signs in to the API, how the session cookie works, and what the server checks on each
request. The contract is [`contract/openapi.yaml`](../../contract/openapi.yaml); the operations are
`login`, `loginCallback`, `logout`, `getCurrentUser` and `passwordLogin` (tag Session). How the server
builds the session: [Architecture](../architecture.md#identity-and-session).

## Summary

- Sign-in is a **browser redirect flow**. There is no API call that takes a password
  (`passwordLogin` answers `501 not-implemented`; it is planned for P1).
- The result is a **session cookie** `msid`. It is encrypted and signed. The server keeps no session
  state.
- A request that changes data also needs the **CSRF header** `X-CSRF-Token`.
- API tokens (`Authorization: Bearer ...`) are P1. In Phase 1 they never authenticate a request.
- Operations marked `security: []` in the contract (`login`, `loginCallback`, `getConfig`,
  `passwordLogin` and `/public/*`) need no session. `logout` works with or without one.

## The sign-in flow

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as My Surveys
  participant I as Identity provider
  B->>S: GET /api/v1/auth/login?returnTo=/surveys
  S-->>B: 302 to the provider, Set-Cookie msid_auth_<state key>
  B->>I: sign in (password, consent)
  I-->>B: 302 /api/v1/auth/callback?code=...&state=...
  B->>S: GET /api/v1/auth/callback (with msid_auth_<state key>)
  S->>I: exchange the code (and read UserInfo)
  S-->>B: 302 to returnTo, Set-Cookie msid, msid_csrf
```

1. **`GET /auth/login?returnTo=<path>`** checks `returnTo`, creates a sign-in transaction (random
   `state`, a PKCE verifier and `returnTo`), and seals it into a cookie named after the state,
   `msid_auth_<state key>` (the state key is the first 16 characters of `state`). It answers `302`
   with the identity provider's authorization URL.
2. The user signs in at the identity provider. On the hosted edition this is `auth.surveyjs.io`.
   In a local demo it is the dev "Sign in as…" page or the mock OIDC server.
3. The provider redirects the browser to **`GET /auth/callback?code=...&state=...`**. The server
   opens the transaction cookie of that `state`, compares the full `state` in constant time,
   exchanges the code (PKCE, and the client secret), and reads the user's identity (`sub`, `email`,
   `name`, optional `picture`).
4. The directory is asked for the user `sub`. If it has the user, its display name and email win over
   the provider's. A **blocked** user gets `403 forbidden` and no session. An identity without an
   email address gets `400 bad-request` and no session. A `picture` that is not an absolute http(s)
   URL is dropped.
5. The server sets `msid` and `msid_csrf`, clears that transaction cookie, and answers `302` to
   `PUBLIC_BASE_URL + returnTo`.

A transaction cookie is single use: the callback clears it whatever the outcome. Open `login` again to
retry. A transaction is valid for 10 minutes. Each sign-in has its own cookie, so sign-ins started in
several tabs at once all finish. When the callback finds no matching transaction (or the `state`
differs) but the browser is already signed in, for example because the callback was opened again, it
answers `302` to `PUBLIC_BASE_URL/` instead of `400`.

### Outcomes of the two sign-in operations

| Operation       | Status | Code             | When                                                                                                                                    |
| --------------- | ------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `login`         | 302    |                  | Redirect to the identity provider                                                                                                       |
| `login`         | 400    | `bad-request`    | `returnTo` is not a path on this site                                                                                                   |
| `login`         | 429    | `rate-limited`   | Too many requests (below)                                                                                                               |
| `login`         | 500    | `internal-error` | The identity provider cannot be reached for discovery                                                                                   |
| `loginCallback` | 302    |                  | Signed in; cookies are set. Or: no valid transaction, but already signed in (to `/`)                                                    |
| `loginCallback` | 400    | `bad-request`    | No valid transaction cookie (missing, expired, tampered), `state` mismatch, the provider refuses the code, or the identity has no email |
| `loginCallback` | 403    | `forbidden`      | The account is blocked. No session is created                                                                                           |
| `loginCallback` | 429    | `rate-limited`   | Too many requests                                                                                                                       |
| `loginCallback` | 500    | `internal-error` | The identity provider could not be reached, or rejected the server's client credentials                                                 |

Every error is a [Problem Details](conventions.md#errors) body. The browser shows it as it is, because
both operations are navigations, not `fetch` calls.

## `returnTo`

`returnTo` says where to land after sign-in. It is accepted only when it is a **path on this site**:

- it starts with exactly one `/` (so not `//host` and not `/\host`);
- it has no control characters;
- it is at most 2048 characters;
- resolved against `PUBLIC_BASE_URL`, it keeps the same origin;
- after the URL parser has normalised it (dot segments removed), it does not start with `//`.

Anything else answers `400 bad-request`. A missing `returnTo` means `/`. The server redirects to the
normalised form (percent-encoded). Query and fragment are kept: `returnTo=/?project=personal` returns
to `/?project=personal`.

```sh
curl -i "http://localhost:3000/api/v1/auth/login?returnTo=//evil.example"
# HTTP/1.1 400 Bad Request
```

## Cookies

| Cookie                  | Holds                                                                                     | Attributes                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `msid`                  | The sealed session: user id, name, email, avatar, CSRF token, expiry                      | `HttpOnly; SameSite=Lax; Path=/; Max-Age=SESSION_MAX_AGE_SECONDS` (default 43200, 12 h) |
| `msid_csrf`             | The CSRF token: 32 random bytes, base64url                                                | Same, but **not** HttpOnly: a script must read it                                       |
| `msid_auth_<state key>` | One sealed sign-in transaction; the name ends with the first 16 characters of its `state` | `HttpOnly; SameSite=Lax; Path=/api/v1/auth; Max-Age=600`; cleared by its callback       |

All of them get `Secure` when `PUBLIC_BASE_URL` is `https:`. A production server must be reached over
HTTPS.

- The session is **stateless**: the server stores nothing. It cannot end one session from the
  server side. A session ends by expiry (12 hours after sign-in, no renewal), by `logout` in
  that browser, or when `SESSION_SECRET` changes (that ends every session at once).
- The tokens of the identity provider are discarded after the callback. They are never in a
  cookie.
- The values are opaque to clients. The format, for implementers of another server, is in
  [Architecture](../architecture.md#the-sealed-cookie-format).

## Authenticated requests

The contract's `security` says what an operation needs. In Phase 1:

| Contract `security`                   | The server requires                               | Examples                          |
| ------------------------------------- | ------------------------------------------------- | --------------------------------- |
| `[]`                                  | Nothing                                           | `getConfig`, `login`, `/public/*` |
| `cookieAuth` (reads)                  | A valid `msid`                                    | `getCurrentUser`, `listSurveys`   |
| `cookieAuth` and `csrfToken` (writes) | A valid `msid`, and the CSRF header               | `createSurvey`                    |
| `cookieAuth` and `csrfToken`, or `{}` | Nothing; with a valid `msid`, the CSRF header too | `logout`                          |
| `bearerAuth` alone                    | Not satisfiable (P1)                              |                                   |

Checks run in this order, before the body is read:

1. **Authentication.** No `msid`, or one that is expired, tampered with or sealed with another secret:
   `401 unauthenticated`. For `logout` such a call is anonymous instead, and step 2 is skipped.
2. **CSRF**, for operations that ask for it: `403 csrf-token-invalid`.
3. Request validation: `400` or `422`.
4. The handler. An operation without a handler answers `501 not-implemented`.

So an anonymous call to an operation that is not built yet answers `401`, not `501`, and a signed-in
call without the CSRF header answers `403` before the body is checked.

`getCurrentUser` (`GET /me`) returns the signed-in user:

```json
{
  "id": "11111111-0000-4000-8000-a00000000001",
  "displayName": "Olivia Owner",
  "email": "owner@example.com",
  "avatarUrl": null,
  "notices": []
}
```

`notices` holds the account notices of the shell, such as an expired licence (`code`, `message`,
`actionUrl`, `actionLabel`). The list is empty when there is none, **and also when the notice store
fails**: the failure is logged on the server and `/me` still answers `200`.

## CSRF: the double-submit rule

A browser sends cookies with any request to the site, also one started by another site. For
requests that change data, the server therefore asks for proof that the code that sent the request
could read the `msid_csrf` cookie, which another site cannot.

- Send `X-CSRF-Token` on `POST`, `PUT`, `PATCH` and `DELETE` (that is, every operation whose
  `security` has `csrfToken`).
- Its value is the `msid_csrf` cookie.
- The server accepts the request only when the header, the `msid_csrf` cookie **and** the token
  inside the sealed `msid` are all present and equal. They are compared in constant time.

Example (the cookie jar holds `msid` and `msid_csrf` from a sign-in):

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
curl -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" http://localhost:3000/api/v1/auth/logout
```

Without the header:

```text
HTTP/1.1 403 Forbidden
{"type":"https://my-surveys.surveyjs.io/problems/csrf-token-invalid","title":"Invalid CSRF token","status":403,"code":"csrf-token-invalid","detail":"Send the value of the msid_csrf cookie in the X-CSRF-Token header."}
```

| Status | Code                 | Means                                           | The client should                                            |
| ------ | -------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| 401    | `unauthenticated`    | There is no valid session                       | Send the user to `login` (the web app does, with `returnTo`) |
| 403    | `csrf-token-invalid` | A session exists, but the header does not match | Read the cookie again and retry. Do not sign in again        |
| 403    | `forbidden`          | The user may not do this                        | Show it. A new token does not help                           |

The web app adds the header itself to every unsafe request (`web/src/api/csrf.ts`).

## Sign out

`POST /auth/logout` clears `msid`, `msid_csrf` and every `msid_auth_*` cookie it receives with
`Max-Age=0` and answers `200`:

```json
{
  "redirectUrl": "http://127.0.0.1:18080/surveyjs/endsession?post_logout_redirect_uri=...&client_id=..."
}
```

`redirectUrl` is where the client navigates next:

- **OIDC / auth.surveyjs.io:** the provider's `end_session_endpoint` with `client_id` and
  `post_logout_redirect_uri=PUBLIC_BASE_URL/`, so the provider session ends too. When the provider
  cannot be reached, or offers no end-session endpoint, the URL is `PUBLIC_BASE_URL/`: the local
  sign-out has already happened.
- **Dev provider:** `PUBLIC_BASE_URL/`.

`logout` works **without a session** too: with no `msid`, or one that has expired or is invalid, it
answers `200` with the same `redirectUrl` and clears the cookies. So a user whose session expired while
the page stayed open still ends the provider's session (otherwise the provider would sign them straight
back in). With a valid session the CSRF header is required as usual (`403 csrf-token-invalid`
otherwise). The web app always navigates to `redirectUrl`.

## Rate limiting

`login`, `loginCallback` and `passwordLogin` allow `SIGN_IN_RATE_LIMIT` requests per minute (default
30). The counter is **per operation and per client**. Above it:

```text
HTTP/1.1 429 Too Many Requests
retry-after: 60
{"type":"https://my-surveys.surveyjs.io/problems/rate-limited","title":"Too many requests","status":429,"code":"rate-limited","detail":"Too many sign-in attempts. Try again in 1 minute."}
```

**Known limitation:** the client is the socket's IP address, and the server does not trust
`X-Forwarded-For` yet. Behind a reverse proxy every request comes from the proxy's address, so all
users share one counter. Raise `SIGN_IN_RATE_LIMIT` for such a deployment until trusted-proxy
support arrives (Step 14).

## Edition and provider

| Setting                                     | Effect                                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDENTITY_PROVIDER=surveyjs-oidc` (default) | Sign in at `OIDC_ISSUER_URL`: `auth.surveyjs.io`, or the local mock OIDC server                                                               |
| `IDENTITY_PROVIDER=dev`                     | A "Sign in as…" page at `/__dev/sign-in`. Memory storage, self-hosted, development only. See [ADR 0007](../adr/0007-dev-identity-provider.md) |

`GET /config` lists `authMethods`; only `surveyjs` works in Phase 1.
