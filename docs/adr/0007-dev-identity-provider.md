# 7. A development identity provider, outside the contract

Date: 2026-10-14

## Status

Accepted

## Context

Every private page needs a signed-in user. The real identity provider is `auth.surveyjs.io`, which a
developer, a contributor or a CI job cannot and must not use: it needs a registered client and a
real account, and this repository never connects to it.

Memory mode is the fastest way to run the application (`pnpm demo`, the default tests, the first
five minutes of a fork). It has no Docker and no network. A mock OIDC server in Docker exists for
Azurite mode ([Development](../development.md#signing-in-through-the-mock-oidc-server)), but asking
every contributor to start a container just to see a page is a high price.

We also want one sign-in code path. A shortcut that sets a cookie directly would leave the real flow
(state, cookies, the blocked-user check, the redirect to `returnTo`) untested in the fast mode.

## Decision

Add a second implementation of the `IdentityProvider` interface, the **dev identity provider**
(`IDENTITY_PROVIDER=dev`, `server/src/auth/providers/dev.ts`).

- **It is a real provider, not a bypass.** `login` redirects to `/__dev/sign-in?state=...`. The page
  lists the users of the memory seed, each with a link to the regular
  `/api/v1/auth/callback?code=<user id>&state=...`. The callback, the sealed cookies, the directory
  lookup, the blocked-user `403` and the redirect to `returnTo` are the code that runs with OIDC.
- **It lives outside the contract.** `GET /__dev/sign-in` is registered by the provider itself, only
  when `IDENTITY_PROVIDER=dev`. It is not under `/api/v1`, not in `openapi.yaml` and not in the API
  reference. A port to another language does not implement it. The conformance suite knows it only
  through its sign-in driver, which completes it when it is the login target.
- **It is refused where it would be dangerous.** The configuration fails to load, with a message that
  names the variable, when `IDENTITY_PROVIDER=dev` is set together with any of:
  - `NODE_ENV=production`;
  - `APP_EDITION=hosted`;
  - `STORAGE_PROVIDER` other than `memory` (real stores hold real accounts).
- **It cannot be unlocked by accident.** The default is `surveyjs-oidc`, which needs the `OIDC_*`
  settings. `dev` is never a default of any script that starts a production-like server.
- **The page is inert.** No password is asked, so the page says so. It has no scripts and no
  forms (a strict Content-Security-Policy), is not cached, is not framed, and escapes every name and
  email. With no seed users it explains how to load them (`MEMORY_SEED=legacy-fixtures`).

## Consequences

- `pnpm demo`, the default conformance run and the memory-mode end-to-end tests sign in without
  Docker, through the same endpoints as production.
- Azurite mode, and CI after the memory run, check the OIDC code against the mock OIDC server.
  The dev provider never replaces that check.
- A deployment that sets `IDENTITY_PROVIDER=dev` by mistake does not start. A deployment with
  `NODE_ENV` unset and the memory provider can run it; `NODE_ENV=production` is therefore part of
  the production checklist (it also requires `SESSION_SECRET` and `PUBLIC_BASE_URL`).
- Anyone who can reach a dev-mode server can become any seed user. Run it on localhost.
