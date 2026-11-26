# Implementation plan: hosted migration track (deployment mode 1.3)

Status: draft · 2026-10-19 · refreshed 2026-11-12 against what the self-hosted track built · the path to the cutover revised 2026-11-24 ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md))
Implements: [spec-hosted.md](spec-hosted.md), within [idea.md](idea.md) (§3.0, D16–D22) and the contract [contract/openapi.yaml](contract/openapi.yaml).
Starts after: Phase 1 ([plan.md](plan.md) Steps 1–14, done 2026-10-23). It was planned to run beside [plan-self-hosted.md](plan-self-hosted.md); the self-hosted track finished first (all 11 steps merged by 2026-11-08), so this track starts on its results ([What the self-hosted track already built](#what-the-self-hosted-track-already-built)).

## How to use this plan

- Everything in [plan.md › How to use this plan](plan.md#how-to-use-this-plan) applies: one prompt per step, the steps in order, one branch and one PR per step, and the same reference notation.
- **Branches** are named `hosted/NN-short-name`. Demo scripts go in `docs/demo/hosted-NN.md`.
- **Two lines of code** ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md)): `master` is the new server, and every step merges into it. `production` is today's server (from `master` at `15e30d8`): fixes only, each merged into `master` too, and deleted with today's server. Today's server never runs Steps 3 onwards.
- **Additional reference notation:**
  - `HS › Compatibility layer` means spec-hosted.md, that heading;
  - `H5` is a user story in spec-hosted.md;
  - `SH Step 2` is a step of plan-self-hosted.md.

## Rules that apply to every step

[plan.md › Rules that apply to every step](plan.md#rules-that-apply-to-every-step) applies, with these changes:

1. **Development modes.**
   - "Both demo modes" means every development mode the step touches: memory, Azurite, and the chosen SQL provider in Docker once SH Step 1 exists.
   - Azurite mode stays until Step 12 of this plan removes it.
2. **Providers under test.** The conformance and provider suites run on memory, Azure legacy (Azurite) and, from Step 8, the chosen SQL provider. Token and partial-response operations run on every provider.
3. **The compatibility suite** (`legacy-compat-tests`, from Step 5) is a fourth seam. It works like the conformance suite but checks legacy response shapes against golden files. Any step that touches result, survey or file behaviour keeps it green.
4. **Operational steps** need people on the surveyjs.io side. Such steps list their **Inputs needed**, and their demo checklist is run with the SurveyJS team.
5. **Contract edits** stay small, one concern per PR. Any new UI is checked in both the `surveyjs-site` and `self-hosted` shells, and a hosted-only feature stays hidden in `self-hosted`.
6. **Production data stays private.** The repository is public ([Going public](docs/operations/going-public.md)), and its history was cleaned of production figures. These never go into the repository, a PR, an issue or an Actions log:
   - access logs, client IP addresses, user agents and origins of named integrators;
   - counts and sizes measured on production or on a staging copy of it (`inspect:legacy --stats`, `migrate:hosted plan`, `verify`, rehearsal timings);
   - replay and rehearsal reports, and golden responses recorded on production before they are reviewed.

   They go to the private working location agreed with the SurveyJS team, outside this repository. The repository gets only what the decision needs: shares and orders of magnitude (for example "under 1 % of requests", "tens of GB"), the chosen thresholds, and pass or fail. A PR that rests on private data says so and names the file there, not its content. Tests use the fixtures and synthetic data only.

## What the self-hosted track already built

Checked against `master` on 2026-11-12. Each step below says what it reuses.

| Piece                                                                                                                                                          | Where                                                                                           | Used by        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| The logical schema; SQLite and PostgreSQL providers with plain-SQL migrations `0001`–`0005`                                                                    | `server/sql/`, [data-model.md](docs/architecture/data-model.md), ADRs 0023, 0024                | Steps 3, 4, 8  |
| Local, S3-compatible and Azure file stores                                                                                                                     | [ADR 0025](docs/adr/0025-file-storage-for-the-sql-providers.md)                                 | Steps 5, 8, 9  |
| `surveyjs.io` sign-in through OIDC beside Google, GitHub and Facebook, with linked identities                                                                  | `server/src/auth/providers/`, [ADR 0029](docs/adr/0029-linking-identities-by-verified-email.md) | Step 2         |
| The `local` directory, its join policy, and `project_invitations` (`addMember` with an unknown email, `removeInvitation`, turned into a membership at sign-in) | `USER_DIRECTORY=local`, migration `0005`                                                        | Step 2         |
| The `partial` column on responses                                                                                                                              | migration `0002`                                                                                | Step 4         |
| The `self-hosted` and `surveyjs-site` shells; `config.edition` (`hosted` or `self-hosted`)                                                                     | [ADR 0027](docs/adr/0027-branding-and-the-licence-key.md)                                       | Steps 2, 3, 10 |
| `surveyjs-studio backup`, `restore`, `migrate`, `rebase-urls`                                                                                                  | [Self-hosting](docs/self-hosting.md)                                                            | Steps 8, 9     |
| The hosted production server on Hetzner, with health-checked deploys and rollback by image tag                                                                 | [Setting up a Hetzner server](docs/operations/hetzner-server-setup.md)                          | Steps 1, 7, 10 |

**Not built,** although the self-hosted plan allowed for it: the `api_tokens` table (SH Step 2 left it to Step 3; [data-model.md › `api_tokens`](docs/architecture/data-model.md#api_tokens-0006)), the hosted-only tables, CORS and bearer authentication.

## Cross-track dependencies

All met. The rule "the later of the two adds the SQL side" now means that this track adds every SQL table it needs, as migrations after `0005`.

| This plan                                 | Needs                                                                                          | State                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Step 8 (target provider readiness)        | The logical schema, the SQL provider for the chosen database, and the S3-compatible file store | Built for PostgreSQL and S3 (SH Steps 1–3). Another choice in Step 1 makes Step 8 build that provider |
| Steps 3 and 4 (tokens, partial responses) | Storage on the SQL providers                                                                   | Step 3 adds `api_tokens`; Step 4 uses the existing `partial` column                                   |
| Step 2 (users from sign-in)               | The `UserDirectory` seam and the webhook; SQL storage for users and invitations                | plan.md Step 12; `users`, `user_identities` and `project_invitations` from SH Steps 4 and 8           |
| Step 10 (maintenance states)              | `READ_ONLY`                                                                                    | plan.md Step 14                                                                                       |

## Progress

| Step | Name                                                           | Status |
| ---- | -------------------------------------------------------------- | ------ |
| 1    | Decisions and evidence: target stores, legacy traffic, mapping | ☑      |
| 2    | Users from sign-in: the local directory and licence notices    | ☑      |
| 3    | API tokens, legacy access keys and CORS                        | ☑      |
| 4    | Partial responses                                              | ☑      |
| 5    | The bridge: public actions and legacy files                    | ☑      |
| 6    | The bridge: access-key actions and the migration guide         | ☑      |
| 7    | Taking over `api.surveyjs.io` traffic                          | ☑      |
| 8    | Target provider readiness                                      | ☐      |
| 9    | The migration tool                                             | ☐      |
| 10   | The cutover kit                                                | ☐      |
| 11   | The test migration and the cutover runbook                     | ☐      |
| 12   | Retiring the legacy code in this repository                    | ☐      |

Results on the server (once Step 8b) waits until after the migration ([After the migration](#after-the-migration)). Steps 2, 3 and 4 do not depend on each other. Step 8 waits for the self-hosted foundation. The cutover itself is an operational event between Steps 11 and 12. It is run from the Step 11 runbook and is not a code step.

**The path to the cutover** ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md)): the new server is built and checked empty (Step 8); about 10 % of the data, as whole accounts, is migrated to it and tested through its test host names, functionally and under load, then wiped (Step 11); everything is pre-copied while the old side runs, with a daily `delta`; in the window the old service stops, today's Studio is read-only, and the final `delta` is verified; then `studio.surveyjs.io` and `api.surveyjs.io` switch to the new server together. Step 2 and the site's own host for its demos and housekeeping (`demoapi.surveyjs.io`) come before the test migration.

---

## Step 1: Decisions and evidence: target stores, legacy traffic, mapping

**Goal:** the three facts the rest of the track depends on:

- which database and file store the hosted service moves to;
- which legacy endpoints are really used;
- where every legacy entity goes.

**Inputs needed** (all kept private, rule 6):

- 30 days of `api.surveyjs.io` access logs, or per-endpoint statistics;
- storage volumes (table and blob counts and sizes) from production, measured by the SurveyJS team with the `--stats` command this step builds;
- the location of the production Hetzner server (chosen next to the Azure region of the stores, [Setting up a Hetzner server › The server](docs/operations/hetzner-server-setup.md#3-the-server)) and the current Hetzner offer for PostgreSQL and object storage there.

**Can start without them:** the `--stats` command, the ADR's shortlist and criteria, and the mapping. The store choice, the scope decision and the window estimate wait for the inputs.

**References**

- HS › Target stores; › Data model and mapping; › Compatibility layer (scope); › Decisions on the open questions.
- idea D10 (revised), D15, D18; `legacy-data-layout.md` §3, §7.
- H16, H17.

**Build**

- **ADR "Hosted target stores":**
  - the hosting: Hetzner, in the production server's location unless the stores call for another, with the GDPR basis for the choice. The app already runs there in mode 1.1; after the cutover its stores should be in the same location, since every page makes several store calls;
  - the shortlist: databases (PostgreSQL managed or self-run on Hetzner, MySQL as a contrast) and file stores (Hetzner Object Storage, AWS S3, Cloudflare R2, Backblaze B2, self-run MinIO);
  - the criteria: data location and data-processing agreement, point-in-time restore, cost including egress, closeness to the app, provider already in the repository;
  - the choice, and how backups and point-in-time restore work with it (managed, or WAL archiving to object storage when PostgreSQL is self-run).
- **`pnpm inspect:legacy --stats`:** read-only counts and sizes per entity, from a configured store. It extends today's `inspect:legacy`, which lists one user's surveys (`--user`). Used on the replica in CI and on production by the SurveyJS team; its production output stays private.
- **`docs/architecture/legacy-api-usage.md`:** the share of requests per endpoint and per client type (Form Library version, server-side caller), with the **scope decision** for the compatibility layer: kept, or `410`. Recorded in an ADR (0034, since superseded by [ADR 0035](docs/adr/0035-legacy-api-bridge.md): a bridge answers every action, and the usage data sets its build order). Shares and orders of magnitude only; no counts, addresses or integrator names (rule 6).
- **`docs/architecture/hosted-migration-mapping.md`:**
  - every legacy entity and property, mapped to the logical schema;
  - the hosted-only tables;
  - the normalisation rules;
  - what is not migrated, and why.
- **A window estimate** from the volumes: pre-copy duration, delta size per hour of changes. The calculation stays private; the ADR records the order of magnitude and whether it fits the one-hour target.

**Tests**

- **Back-end unit:** the stats aggregation.
- **Back-end e2e:** `inspect:legacy --stats` on the Azurite fixtures matches the known fixture counts.
- **Front-end:** none.

**Documentation:** the two ADRs, `legacy-api-usage.md`, `hosted-migration-mapping.md`, `docs/development.md` (the stats command), `docs/demo/hosted-01.md`.

**Demo checklist**

1. `pnpm inspect:legacy --stats` on the replica prints counts that match the fixtures.
2. Reviewers agree with the store choice, the compatibility scope and the mapping. Every entity in `legacy-data-layout.md` §3 appears in the mapping.
3. `pnpm scan:secrets` passes, and the new documents hold no production counts, addresses or integrator names.

---

## Step 2: Users from sign-in: the local directory and licence notices

> **Changed 2026-11-24 by [ADR 0043](docs/adr/0043-hosted-users-on-the-local-directory.md).** The hosted directory is the existing `local` one, extended, not a `profiles` directory. Licences come as a sign-in claim, not from a site endpoint, and the site sends the account-deleted webhook through an outbox. Built on branch `hosted/02-users-from-sign-in`.

**Needed before the test migration** (Step 11, [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md)): the new server reads no site user table.

**Goal:** after the cutover the app needs nothing from the site's user tables. Users come from sign-in through `auth.surveyjs.io`, members are added by email through invitations, licence notices come from a claim at sign-in, and deleted accounts arrive by the webhook ([ADR 0022](docs/adr/0022-users-from-sign-in.md), [ADR 0043](docs/adr/0043-hosted-users-on-the-local-directory.md)). Until the cutover today's server stays on `surveyjs-sql`.

**Inputs needed** (the site's changes, in its own repository, built next):

- the `blocked` claim in `/OAuth/UserInfo` and the re-read on `/OAuth/Authorize` (built 2026-10-28), deployed;
- a per-client `license_expires_at` claim for Studio's OAuth client: the earliest licence expiry, RFC 3339 UTC, or `null` ([the claims](docs/integrations/surveyjs-user-api.md#sign-in-claims)), deployed;
- the outbox that sends the account-deleted webhook, written before the account is deleted and sent only once it is gone, delivering from the cutover to the new server, with Studio's webhook URL and the shared secret per environment ([the webhook](docs/integrations/surveyjs-user-api.md#the-account-deleted-webhook)).

**References**

- HS › Users; ADR 0043 (the decision), ADR 0022, ADR 0018 (the seam, the webhook, erasure), ADR 0029 (linking by verified email).
- H27.

**Already built** (SH Steps 4 and 8): the `users`, `user_identities` and `project_invitations` tables; surveyjs.io sign-in through OIDC; `addMember` with an unknown email answering with a pending member, `removeInvitation`, and invitations turned into memberships at sign-in by any method; a `disabled` account refused at sign-in with its sessions ended ([ADR 0029](docs/adr/0029-linking-identities-by-verified-email.md) D11); the webhook's receiving end with erasure.

**Built**

- **The `local` directory on hosted** (`APP_EDITION=hosted`, `AUTH_METHODS=surveyjs`, `USER_DIRECTORY=local`): the account id is the surveyjs.io id (a `sub` that is not a GUID is refused); every sign-in refreshes email (verified only, and not when another account holds it), name, the site's `blocked` and the licence date; the site's block (`users.site_blocked`) is separate from an admin's disable; migration `0010` adds `site_blocked` and `licence_expires_at`.
- **Two new refusals:** `blocked` ("Account blocked", `403` for an API client; a blocked first sign-in creates nothing) and `identity-conflict` (the email's account belongs to another surveyjs.io id; `409 email-taken`, "Email in use"). An account whose id is the sub but has lost its identity is linked again.
- **`ADMIN_EMAIL` on hosted** creates no account; it makes the matching account admin at sign-in only on an instance that has never had an admin. `pnpm account:make-admin --email <address>` names an admin afterwards.
- **`ACCOUNT_NOTICES=sign-in-licence`** (needs `local`): the notices from the stored licence date.
- **The webhook on hosted** finds the account by its `surveyjs` identity, then by id; erases the data (also under the surveyjs.io id) and deletes the account; the last instance admin becomes a placeholder instead.
- **`account:reconcile` refuses on hosted:** a person who has not signed in is unknown, not deleted.
- **The user API client is removed:** the `surveyjs-api` directory, its stub and conformance run, `USER_API_URL`, `USER_API_TOKEN` and the `user-api` readiness check; the user API document now covers the sign-in claims and the webhook. `surveyjs-sql` stays for today's server until Step 12.
- **Not changed:** invitations (the existing operations and members page), no new contract operations.
- **Profiles in the migration** are Step 9's: a `users` row and a `surveyjs` identity for every person the copied data names ([ADR 0043](docs/adr/0043-hosted-users-on-the-local-directory.md) point 6).

**Tests (as built)**

- **Back-end unit:** the sign-in refresh, `blocked` and unblocked, the two refusals, the bootstrap rule, the webhook lookup and the last-admin placeholder, `account:make-admin`, `account:reconcile` refusing; the account store suite on memory and SQL.
- **End to end:** `pnpm e2e:hosted-oauth` against the OAuth stub: a new person, the licence notice and its removal at the next sign-in, a blocked person, and the email conflict. The e2e servers moved to ports 3091 and 3092.
- **Not run here:** the site's own claim and outbox, tested in its repository, then together on the new server in the test migration (Step 11).

**Documentation:** `docs/operations.md` (hosted sign-in), `docs/architecture.md` (users on hosted), the API reference (authentication, the contract's `loginCallback`), `docs/customizing/sign-in.md`, `docs/integrations/surveyjs-user-api.md`, `docs/demo/hosted-02.md`.

**Demo checklist** ([the demo](docs/demo/hosted-02.md))

1. Locally on the hosted directory, sign in through the surveyjs.io stub as a new user. The account is written with the surveyjs.io id, and the account menu shows the name.
2. Sign in with a licence that expired: the notice shows; a later date at the next sign-in removes it.
3. Sign in with the stub's blocked box ticked: "Account blocked".
4. Sign in with a known email and another id: "email in use".
5. Send the account-deleted webhook with `pnpm webhook:account-deleted`: the account's surveys are gone.
6. Delete the last admin's account the same way: the account stays as a placeholder, and `pnpm account:make-admin` names a new admin.
7. With the site's changes deployed (the test migration): the same on the new server's environment with the real claims and a real deletion.

---

## Step 3: API tokens, legacy access keys and CORS

**Goal:** integrators can call the new API from their servers with a per-scope token, and from browsers through CORS. A legacy access key works as a token, so the bridge ([ADR 0035](docs/adr/0035-legacy-api-bridge.md)) can pass it through. Tokens work before the cutover. The design is [ADR 0037](docs/adr/0037-access-keys-and-api-tokens.md): one credential list, legacy keys and new `sjs_` tokens.

Studio's public API is what the bridge calls, so it must cover everything the old API can do before the cutover (ADR 0035, point 4). That coverage is built with the bridge, action by action, in Steps 5 and 6; this step builds the authentication it rests on.

**References**

- HS › API tokens and CORS; idea §6.2 B7; contract `bearerAuth` (`x-phase: P1`); ADR 0035; ADR 0037.
- H12, H13, H14; H15 (revoking a legacy key, moved here from Step 6).

**Build**

- **Contract:**
  - `bearerAuth` without `x-phase`;
  - token operations: list, create (the secret is returned once), revoke;
  - a `Token` schema with name, scope (`personal` or a project ID), created and last used.
- **TokenStore:**
  - memory;
  - Azure legacy, as a new app-owned table that legacy code never reads;
  - SQL: the `api_tokens` table of [data-model.md › `api_tokens`](docs/architecture/data-model.md#api_tokens-0006), as the next migration for SQLite and PostgreSQL, moved to the built tables in that document.

  Only a hash is stored.

- **Authentication:**
  - a bearer value starting with `sjs_` is an API token, any other a legacy key (ADR 0037, point 1); it resolves to the user and scope;
  - no bearer credential manages credentials, the account, project members or projects; the one exception is replacing the credential the request carries (for the bridge's `generateAccessKey`);
  - a blocked or disabled owner's credentials get `401`;
  - the permissions are those in the spec;
  - CSRF does not apply to bearer requests;
  - the last-used time is updated, at most once a minute.
- **Legacy access keys as tokens:**
  - a bearer value in the legacy key format is checked as the owner's Personal-and-projects key, with the rights the old API gave it;
  - before the cutover the key is looked up in the site database through the Azure legacy provider; after it, against the hashes the migration copies into `legacy_access_keys` (Steps 8 and 9);
  - a wrong or revoked key gets `401`; the bridge turns it into the old API's answer.
- **The legacy key on the API tokens page:** shown as "Legacy access key". Until Step 7 the row links to the site's own "generate new key"; **Revoke** and its app-owned store are built behind a setting that Step 7 turns on (ADR 0037, point 4). The page offers no way to make a new legacy key: users create `sjs_` tokens instead.
- **CORS:**
  - `/public/*` and bearer requests answer any origin without credentials;
  - cookie requests stay same-origin;
  - preflights are answered.
- **The "API tokens" page,** surveyjs-site shell only: Personal tokens, plus the tokens of projects the user administers. Create shows the secret once; revoke asks for confirmation.

**Tests**

- **Back-end unit:** token hashing and comparison; scope rules; the CORS decision table.
- **Back-end e2e:**
  - conformance on every provider:
    - create, list and revoke;
    - a revoked token gets `401`;
    - a project token cannot touch another project or Personal;
    - a member who is not admin gets `403` when creating a project token;
    - bearer requests need no CSRF;
    - the CORS headers per request type;
    - a legacy access key lists its owner's surveys; with the Step 7 setting on, once revoked it gets `401`; with it off, the revoke operation is refused;
    - a credential replaces itself through the bearer-only operation, and the old value gets `401`;
    - a blocked owner's legacy key and tokens get `401`;
  - provider suite: the TokenStore; the legacy key lookup on Azurite.
- **Front-end unit:** the tokens page's visibility rules; the one-time secret display.
- **Front-end e2e:** create a token, use it with `fetch` from a page on another origin, revoke it, and the next call fails. The legacy key row appears; with the Step 7 setting on it can be revoked.

**Documentation:** API guide "API tokens" and "Calling the API from a browser", the API reference (generated), user guide "API tokens", `docs/demo/hosted-03.md`.

**Demo checklist**

1. On the API tokens page, create a Personal token. `curl -H "Authorization: Bearer …" /api/v1/surveys` lists the personal surveys.
2. Create a project token as the project admin. It lists only that project's surveys.
3. Revoke it. The same `curl` gets `401`.
4. From a page served on another port, `fetch` the public survey endpoint. CORS allows it.
5. `curl -H "Authorization: Bearer <a seeded user's legacy access key>" /api/v1/surveys` lists that user's surveys.

---

## Step 4: Partial responses

> **Changed 2026-11-19 by [ADR 0038](docs/adr/0038-partial-responses.md).** Results fold a client's partial saves into
> one response when reading; storage stays append-only. The ADR is the step's record of differences from the legacy
> readers.

**Goal:** partial saves are stored and reported as the legacy service did, through the contract's `partial` and `lastPageIndex`.

**References**

- HS › Partial responses; contract `SubmitResponse.partial`, `lastPageIndex`, `SurveyResponse.partial` (`x-phase: P1`); `legacy-data-layout.md` §3.6–3.7.
- H6.

**Build**

- **Contract:** drop `x-phase: P1` from `partial`, `lastPageIndex` and `SurveyResponse.partial`.
- **ResultStore:**
  - append a partial response;
  - the completion state becomes `partial`;
  - a later completed response for the same client ID makes it `completed`.

  This is implemented on memory, on Azure legacy (writing `ispartialcompleted` as `Edm.Boolean`, as the legacy service did) and on SQL. The SQL tables already have a `partial` column (migration `0002`); check what the SQL ResultStore does with it today before adding anything.

- **Results:**
  - lists and exports include partial responses, marked;
  - statistics count completed responses only;
  - the Table shows a "Partial" column when any exists.
- **Run page:** unchanged. Our run page does not save partials yet; resuming is a P1 product feature.

**Tests**

- **Back-end unit:** completion state transitions.
- **Back-end e2e:**
  - conformance:
    - a partial then a complete submission for the same client ID;
    - `getPublishedSurvey` reports `completed` only after the complete one;
    - export marks partial responses;
    - statistics ignore them;
  - provider suite: partial append and completion on every provider, and the legacy format on Azurite.
- **Front-end e2e:** a survey with a partial response shows it marked in the Table.

**Documentation:** API guide "Responses" (partial saves), an ADR recording any difference from the legacy readers, `docs/demo/hosted-04.md`.

**Demo checklist**

1. Submit `partial: true` through the API with a client ID. The Table shows the response marked partial, and the statistics count 0.
2. Submit the complete response. The statistics count 1, and the run page reports the survey completed for that client.

---

## Step 5: The bridge: public actions and legacy files

> **Changed 2026-11-19 by [ADR 0039](docs/adr/0039-bridge-public-actions.md).** Exact where a caller can depend on
> it, with three listed differences (two leaks fixed, no HTML sanitizer, unknown paths forwarded). Golden files are
> derived from the old code now and replaced by recordings before Step 7. The results-layout reads move to Step 6.

**Goal:** a separate service, the bridge ([ADR 0035](docs/adr/0035-legacy-api-bridge.md)), answers the old API's public and unauthenticated actions exactly as `api.surveyjs.io` does, through Studio's public API only. Studio's public API gains what those actions need. The site's demos and jobs are forwarded to the old service.

**Inputs needed:** golden responses recorded from the real `api.surveyjs.io` for a set of known test surveys on production, made by the SurveyJS team with a script from this step. The surveys belong to a test account and hold made-up answers; the recordings are reviewed in the private location (rule 6) before any is committed, and ids, emails and addresses that are not the test account's are replaced. The reference for an answer with no recording is the old API's code (legacy documentation).

**References**

- ADR 0035; HS › Compatibility layer (changed by ADR 0035); idea §2.8; `legacy-data-layout.md` §3.9, §7; [Legacy API usage](docs/architecture/legacy-api-usage.md) (the build order).
- H5, H6, H7, H8, H30.

**Build**

- **`bridge/`, a new workspace package and image** (a Dockerfile target of its own):
  - TypeScript, a small HTTP server with no store and no store credentials;
  - a client generated from `contract/openapi.yaml`, so a breaking contract change fails the bridge's build;
  - settings: Studio's API base URL, the old service's own host name, the cache size.
- **Routing, as the old API routes:** both prefixes (`public/Survey` and `public/v1/Survey`), paths without regard to letter case, with and without a trailing slash, and with and without an `{id}` segment where the old route has one.
- **Public actions:** `getSurvey`, `getSurveyAndIsCompleted`, `post`, `upload` (the `dxsimage:`/`dxsfile:` answers), `getResult`, `isCompleted`, `image`, `file`. `getSurveyAndIsCompleted` and `image` work as their code intends (ADR 0035), although they fail today. The old API has no `post/page-number` route, so there is none.
- **Unauthenticated private actions:** `files?name=`, `getSurveyPublicResults/{id}` and the other `private/Surveys` actions the old API answers without a key.
- **Forwarding:** the site's demos and jobs (the list in ADR 0035, point 5) go unchanged to the old service, method, headers and body included.
- **The `getSurvey` cache:** answers are kept with Studio's `ETag` and revalidated with `If-None-Match`, so an edit in Studio shows at once and the busy scheduled caller costs Studio little.
- **Studio's public API, as these actions need it:** reading a survey's definition by ID with the old rules (the old `getSurvey` ignores the publish state; the API offers that read explicitly, documented as the legacy read), submitting by `postId` with a client ID, a respondent's completion state, one question's aggregate, respondent and editor files by their legacy names, public results. Each is a contract change with conformance tests on every provider.
- **Legacy files in Studio:**
  - a `legacy_files` lookup (name → file ID), filled by the migration (Step 9);
  - before the cutover, the Azure legacy provider reads the `surveyfiles` and `files` shares directly. That needs `@azure/storage-file-share` and a stub in tests, because Azurite has no Files service.
- **Shared rules stay in Studio:** rate limits on the public paths, the response size limits, IP capture only when the setting is on, and idempotency where the legacy client sends a repeat. The bridge passes the client address in `X-Forwarded-For`, and Studio trusts it from the bridge only.
- **`legacy-compat-tests`:**
  - a new package: HTTP only, with a base URL;
  - golden files for every action of this step;
  - a recording script for the SurveyJS team.

**Tests**

- **Back-end unit:** each answer mapper in the bridge (casing, `{ Data, ResultCount }`, `isCompleted` values, `getResult` aggregation, error texts); the route matching (prefixes, case, trailing slash); the cache's revalidation.
- **Back-end e2e:**
  - `legacy-compat-tests` against the bridge in front of Studio on memory and on Azure legacy, against golden files;
  - Form Library v1.x (pinned in the test package) loading a survey with `surveyId` and posting with `surveyPostId` through the bridge;
  - forwarding: a site path reaches a stub of the old service unchanged;
  - conformance: the new contract operations on every provider.
- **Front-end:** none; no UI.

**Documentation:** `docs/api/legacy-compat.md` (the bridge: what it answers, how, and its settings), `docs/testing.md` (recording golden files), `docs/operations.md` (running the bridge), `docs/demo/hosted-05.md`.

**Demo checklist**

1. With the bridge running in front of the local app, a small HTML page using Form Library v1.x and `surveyId` loads a seeded survey through the bridge, and its result appears in the Table.
2. `curl …/public/v1/Survey/getResult?resultId=…&name=q1` on the bridge matches the golden file.
3. A survey whose JSON holds a legacy `files?name=` image shows it, served through the bridge.
4. A request to a site path (for example `private/Surveys/getTempFile`) reaches the stub of the old service.

---

## Step 6: The bridge: access-key actions and the migration guide

> **Changed 2026-11-20 by [ADR 0040](docs/adr/0040-bridge-access-key-actions.md).** Exact wherever a caller can depend on
> it, with the listed differences (a project's members no longer all change its surveys, `changeOrganization` is
> checked, the CSV export quotes, bad-key answers lose the redirect and encode the key). Studio's public API gains the
> operations the actions need, among them a survey's shared results layout; no setting is stored "as given", and the
> request's credential scope becomes required. The recordings still replace the derived golden files before Step 7.

**Goal:**

- every access-key action of the old API answers exactly as before, through Studio's public API with the caller's key, used or not;
- Studio's public API covers everything the old API can do;
- integrators have a migration guide that maps each old action to the public API.

**References**

- ADR 0035; HS › Compatibility layer (changed by ADR 0035); [Legacy API usage](docs/architecture/legacy-api-usage.md) (the build order).
- H9, H11.

**Build**

- **The access-key actions of `private/Surveys`,** in the order of their use (ADR 0034's evidence), then the unused ones:
  - survey records: the active and archived lists, create, clone, rename, archive, restore, delete, move to a project, `getSurveyInfo`;
  - content: `changeJson` (a history point, as the editor saves), `changeTheme`, `uploadFiles`, `getHistoryPoint`;
  - publishing: `publish`, `unpublish`, `getIsPublished`, `publishVersion`, `changeVersionTitle`;
  - responses: `getSurveyResults` (paging with `continuationToken`), `getSurveyDemoResults`, `exportSurveyResults`, `deleteResult`, `deleteAllResults`;
  - settings and layouts: `setUseCookies`, `setGenerationJSONType`, `storeIPAddressInResult`, the result columns, table and summary states, permissions and public access;
  - `generateAccessKey`, which replaces the caller's legacy key.
- **The key:** the bridge forwards `accessKey` as the bearer token (Step 3). A wrong or revoked key gets the old API's answer. The cookie sign-in is not accepted (ADR 0035).
- **Studio's public API, as these actions need it:** each capability as an ordinary operation of the contract. An old setting Studio has no concept for is stored as given, with the survey or the user, so the old answer comes back unchanged (ADR 0035, point 4).
- **Golden files for every action:** recorded from production for the used ones; for the actions production traffic never calls, recorded on purpose by the SurveyJS team with the test account.
- **`docs/api/migrating-from-api-surveyjs-io.md`:** every old action, its public API operation, and examples. The bridge's mapping is the source, so the guide and the code say the same.

**Tests**

- **Back-end unit:** each answer mapper; the old error answers for a missing, wrong and revoked key.
- **Back-end e2e:**
  - `legacy-compat-tests`: each action against golden files, with a valid, wrong and revoked key;
  - conformance: the new contract operations on every provider.
- **Front-end:** none beyond Step 3.

**Documentation:** the migration guide, `docs/api/legacy-compat.md` (private actions), `docs/demo/hosted-06.md`.

**Demo checklist**

1. `getActive` through the bridge with a seeded user's access key matches the golden file.
2. `changeJson` through the bridge changes the survey; the editor shows the new definition and a history entry.
3. Revoke the key on the API tokens page. The same call now gets the old API's answer for a wrong key.

---

## Step 7: Taking over `api.surveyjs.io` traffic

> **Changed 2026-11-23 by [ADR 0041](docs/adr/0041-taking-over-the-legacy-api-host.md).** There is no staging copy of
> the data, and the old service's logs hold no request bodies: the replay compares reads only, on production, and the
> writes are checked by `pnpm legacy:replay smoke` with the test account. The bridge runs on the cutover target server
> from the switch on, calling today's Studio by its public URL until the cutover. Studio and the bridge gain `/metrics`.
>
> **Changed 2026-11-24 by [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md).** There is no early switch. The
> tools below are built (this step's PR); the switch of `api.surveyjs.io` happens at the cutover, together with
> `studio.surveyjs.io`, and the bridge calls the Studio on its own server from the start. The replay gate, the switch
> and what to watch move into the cutover runbook (Step 11).

**Goal:** the tools to check the bridge on real traffic and to watch it after the switch: the replay and `smoke`, `/metrics` in Studio and the bridge, the caller log, and the fixes the switch needs. The switch itself is part of the cutover.

**Inputs needed** (by the test migration, Step 11):

- **`demoapi.surveyjs.io`**, built and deployed by the SurveyJS team for the site's demos and housekeeping, which share `api.surveyjs.io` today ([Legacy API usage › Results](docs/architecture/legacy-api-usage.md#results-2026-11-13)); the bridge forwards those paths there (`BRIDGE_LEGACY_URL`);
- **the new server** with the bridge, Prometheus and test host names, from the private deployment playbooks;
- **a recent sample of the old service's requests** (its HTTP logs, on since 2026-11-13), as a neutral CSV made by a query kept private (rule 6);
- **the test account's access key** for `smoke`, used for nothing else;
- **the recordings** of Steps 5 and 6, made with the SurveyJS team and reviewed, which replace the derived golden files before the cutover;
- **the load to take over:** most `getSurvey` traffic is one scheduled server-side job that re-reads a fixed set of
  surveys every few minutes ([Legacy API usage › Client types](docs/architecture/legacy-api-usage.md#client-types-preview-2026-11-17)).
  The bridge's cache and Studio serve that steady rate from the first minute of the switch, and Step 11's load test
  includes it; the SurveyJS team found its owner (2026-11-18) and contacts them before the cutover.

**References**

- ADR 0035, ADR 0041; HS › Routing `api.surveyjs.io` (changed by ADR 0035).
- H18, H19.

**Build**

- **`pnpm legacy:replay`** (a workspace package, run from an operator's machine, never in CI with real data):
  - reads the sample (`time,method,path,query,status`) and replays only the `GET`s of actions the bridge's mapping table marks `effect: "read"`, on allowlisted paths; writes, forwarded paths, other methods and unsafe paths are counted and never sent;
  - sends each request to the old service, the bridge, then the old service again (`changed` when the two old answers differ), paced under Studio's per-address limits, with keys as recorded;
  - writes an HTML report outside the repository (key hashes only) and prints counts and the verdict;
  - `smoke`: the write actions with the test account's key against both, on a new survey each, compared with ids, dates and generated names normalised.
- **`effect` in the mapping table:** every action is a `read` or a `write`.
- **Metrics:** `/metrics` on a separate port in Studio (`METRICS_PORT`) and the bridge (`BRIDGE_METRICS_PORT`), never on the main port, with bounded labels only (a shared `metrics/` package); Studio times every store call; the self-hosted Compose examples gain a `monitoring` profile with Prometheus.
- **The caller log:** one bridge log line per request with the key only as a hash prefix, and `bridge-callers` in the bridge image to sum a day of it per key prefix and action, so the remaining callers can be found before the bridge is retired.
- **Before the switch:** the bridge cuts an upload whose body is not read within `BRIDGE_UPLOAD_READ_TIMEOUT_MS` (`408`); uploads that belong to no survey count against `LIMIT_MAX_LEGACY_FILES_PER_USER`; `setup.sh` gains `--trusted-proxies` (the target server's addresses, so today's server keeps the caller's address) and keeps the public definition's `ETag` (no compression), so the bridge's cache works across the two servers.
- **The bridge image** is published by CI beside the app's, at the same commit.
- **`docs/operations/legacy-api-takeover.md`:** the preconditions, the gate (the replay with no unexplained difference, and `smoke`), the switch at a quiet hour and the certificate, what to watch with the Prometheus queries, `LEGACY_KEY_REVOKE` on after a day, switching back, and the cutover's one change. In general terms; the server-specific steps stay in the private deployment notes.

**Tests**

- **Back-end unit:** the comparison rules, the classification and pacing of the replay, the sample parser, the report, `smoke`'s normalisation; the metrics' labels (no key, id or path; forwarded requests and callers that leave are counted); the caller log and `bridge-callers`; the upload deadline; the generated web-front configuration.
- **Back-end e2e:** the replay and `smoke` of a fixture sample against two local servers (`legacy-compat-tests`); conformance for the legacy-file cap.
- **On the new server, run manually** (Step 11): the replay of a recent sample, limited to the migrated sample, and `smoke`. The reports stay private; the PR states the result (no unexplained differences, or the list of explained ones in general terms).

**Documentation:** the takeover runbook (its checks and Prometheus queries; the cutover runbook takes over its sequence), `docs/operations.md` (metrics, the caller log), `docs/self-hosting.md` (metrics), `docs/api/legacy-compat.md`, `docs/demo/hosted-07.md`.

**Demo checklist**

1. Locally: Studio's and the bridge's `/metrics` answer on their own ports only, and a second `getSurvey` is a cache `hit`.
2. Locally: the replay and `smoke` of the fixture sample against two local servers (`docs/demo/hosted-07.md`).

The checks on real traffic, the switch, and `LEGACY_KEY_REVOKE` a day after it are in Step 11 and the cutover.

---

## Step 8: Target provider readiness

**Goal:** the chosen SQL provider and file store are ready to hold the hosted data at production size, including the hosted-only tables, and the tools to prove it exist. What needs the new server waits for it.

> **Changed 2026-11-25 by [ADR 0036](docs/adr/0036-history-snapshots-above-a-size-limit.md), [ADR 0037](docs/adr/0037-access-keys-and-api-tokens.md), [ADR 0033](docs/adr/0033-hosted-target-stores.md#readiness-hosted-step-8-2026-11-25) and [ADR 0043](docs/adr/0043-hosted-users-on-the-local-directory.md).** There is no byte store for history snapshots: a survey keeps at most N history entries (`HISTORY_MAX_ENTRIES`, 20 on the new server). Legacy access keys work on the SQL providers, and a key can be replaced there. The archive tables get a purge command. The hosted edition refuses password sign-in. The scale check has targets and a generator, and the work that needs the new server (the scale run, the production measurement, the restore) is listed apart below. The results on the server (the Table's server mode, the Summary's limit) wait until after the migration ([After the migration](#after-the-migration)).

**Inputs needed:** the new server ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md)), built by the private deployment playbooks: Studio on PostgreSQL and the provider's object storage, the bridge, Prometheus, test host names for Studio and the API, and the backups set up. It is checked empty in this step. Everything below that does not name the new server is built and tested locally.

**References**

- HS › Data model and mapping (hosted-only tables); › Target stores; SH Steps 1–3; the Step 1 ADRs.
- H25.

**Build**

- **If the choice is not PostgreSQL with S3-compatible storage:** the chosen provider, built against the existing provider and conformance suites. The step grows by that work.
  **Already built** (SH Steps 1–3): the PostgreSQL provider, its migrations `0001`–`0005`, the S3-compatible file store, and `surveyjs-studio backup`/`restore`, which cover SQLite and local files only. A PostgreSQL deployment is backed up with the database's own tools ([Self-hosting › Backups](docs/self-hosting.md#backups)).

- **The history limit** (ADR 0036, changed 2026-11-25): `HISTORY_MAX_ENTRIES`, a positive integer; unset keeps every entry, so self-hosted installations are unchanged. A save that adds an entry deletes, in its transaction, the entries beyond the newest N (by time, then id), on the SQL and memory providers; with `azure-legacy` the setting is a start-up error. There is no `HISTORY_INLINE_MAX_BYTES`, byte store or sweep.
- **Hosted-only tables, one migration** (`0011-hosted-archives-and-keys`; `legacy_files` is Step 5's `0008`), empty in the self-hosted image:
  - `legacy_access_keys` (hash, owner, last four, created and revoked times), which the SQL credential store reads with the Azure legacy provider's behaviour. A legacy key works as a bearer credential and on the bridge; `replaceCurrentCredential` with one revokes it and returns a new 32-digit key, so the bridge's `generateAccessKey` is answered by Studio (Azure legacy keeps the `409`). Revoking a key revokes all of the user's rows, and account erasure revokes it too. `pnpm seed` writes the fixtures' keys;
  - `survey_events` and `deleted_responses`, filled by the migration (Step 9) and read by nothing in Studio;
  - **`pnpm purge:deleted-responses --before <date> [--apply]`:** a dry run by default; the cutover runbook runs it 30 days after the cutover. No background job.
- **The hosted edition refuses `password`** in `AUTH_METHODS` (ADR 0043, changed 2026-11-25).
- **The scale tools:**
  - `pnpm scale:generate`: a synthetic data set (users, surveys, history, responses, API tokens) in a migrated SQL database, sizes as parameters so the real figures stay out of the repository, one survey of millions of responses; it refuses a database that holds data;
  - `pnpm scale:check`: the survey list, a page of the results, the export and a save through the HTTP API, 95th percentile, against the targets of [ADR 0033](docs/adr/0033-hosted-target-stores.md#readiness-hosted-step-8-2026-11-25). It prints counts and times only.
- **The new server's profile,** ready but not active: the settings in the deployment's example environment file, `docker/prod-like.sql.env` and `pnpm prod-like-sql:up` (the image on PostgreSQL and S3), and the `prod-like-sql` CI job.
- **What waits for the new server,** with figures added (rounded, rule 6) to ADR 0033 when done:
  - the scale run: `scale:generate` at production size, then `scale:check`, and index changes (migrations) until the targets hold; the targets for a filtered and sorted Table page and for the Summary's newest 25,000 responses wait for results on the server, after the migration ([After the migration](#after-the-migration));
  - the production measurement: `pnpm inspect:legacy --stats` with the 20 newest history entries of each survey, run once on production, to size the database;
  - the backup and restore (H25), tested once into a scratch instance: a point-in-time restore of the database and a file from the bucket's old versions. The commands are in the private deployment notes; `docs/operations.md` has the outline.

**Tests**

- **Back-end e2e:** the provider and conformance suites on PostgreSQL, including tokens, partial responses, legacy keys (find, replace, revoke, erase) and the history limit; `pnpm test:conformance:postgres:hosted` runs the hosted edition on PostgreSQL with the mock OIDC server (CI runs it); the purge command's dry run, `--apply` and `READ_ONLY`.
- **Unit:** the generator and the check's arithmetic; the refusals (`HISTORY_MAX_ENTRIES`, hosted with `password`).
- **Scale:** the check, run manually on the new server.
- **Front-end e2e:** the Phase 1 user-story suites on PostgreSQL (`pnpm e2e:postgres`).

**Documentation:** ADR 0033's readiness section, `docs/architecture/data-model.md` (the three tables, the history limit), `docs/operations.md` (the new server's profile, the purge, the scale tools, the restore outline), `docs/self-hosting.md`, `docs/api/api-tokens.md`, `docs/demo/hosted-08.md`.

**Demo checklist**

1. `HISTORY_MAX_ENTRIES=3 pnpm dev:postgres`: five saves leave three entries in History.
2. A legacy key (a seeded row) signs in to `GET /api/v1/me`; `generateAccessKey` through the bridge returns a new key and the old one is refused.
3. The purge's dry run counts, `--apply` deletes.
4. `scale:generate` small, then `scale:check`.
5. `pnpm prod-like-sql:up`: `/readyz` is ready on PostgreSQL and S3.
6. `pnpm e2e:postgres` is green. (The demo page is [docs/demo/hosted-08.md](docs/demo/hosted-08.md).)

**Demo, on the new server, empty (after it is built):**

1. Studio and the bridge answer on their test host names, and Prometheus scrapes both.
2. The scale report shows the largest survey's export and paging within the agreed times.
3. A restore into a scratch instance brings back a deleted survey and a deleted file.

---

## Step 9: The migration tool

**Goal:** a tool that copies all legacy data except users into the target exactly, can be resumed and repeated safely, and proves the copy is complete.

**References**

- HS › Migration tool; › Data model and mapping; `hosted-migration-mapping.md`.
- H1, H2, H20, H21, H22.

**Build**

- **Exporter** (the Azure legacy provider and the file shares) to a neutral NDJSON record stream:
  - record types: survey, definition, theme, history entry with snapshot, response, completion, view, file, legacy file name, project, member, profile (for every user the data names, from `Users`), access key, event, deleted response;
  - the normalisation rules from the mapping.
- **Importer** (the target), with idempotent upserts keyed by ID and exact timestamps. It is a separate port from the request-path interfaces.
- **Commands:**
  - `pnpm migrate:hosted plan`: volumes and estimate;
  - `copy`: full, with checkpoints;
  - `delta`: since the high-water marks. It must not list every blob or file: listing the production history alone takes hours. It reads only what belongs to surveys changed after the pre-copy, and only the responses added since ([ADR 0033 › Window estimate](docs/adr/0033-hosted-target-stores.md#window-estimate));
  - `reconcile`: key-set comparison and deletions;
  - `verify`: counts, checksums, sample deep compares through both providers' interfaces;
  - **`--sample`** for `plan`, `copy`, `delta`, `reconcile` and `verify`: whole accounts only (an account's surveys, results, history, files, projects with their members), chosen by a given share and a list of accounts that must be in it (the test account, a few large surveys' owners). `verify` and `reconcile` then compare that set only, and `plan` writes the sample's survey IDs and key hashes for the replay's filter ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md));
  - **`wipe`:** empties the target's database and file store after the test migration, with a typed confirmation of the target's name.
- **Safety:**
  - every run reads the source only;
  - a dry run into a scratch target is the default unless `--target` is given;
  - progress logs, and a machine-readable report; reports from production or a staging copy stay private (rule 6).
- **Files:** only the files that a copied definition, theme, history entry or response links go into the target file store (the exporter scans for the references), with `legacy_files` filled for the legacy names: a deterministic id from kind, name and size, and the all-zero survey, so outside every quota. `delta` copies files linked after the pre-copy; files nobody links stay behind. Blobs in `my-surveys-files` (Step 7 of Phase 1) are copied by ID, with their surveys.
- **History:** the 20 newest entries of each survey, by time, then id ([ADR 0036](docs/adr/0036-history-snapshots-above-a-size-limit.md), changed 2026-11-25). A published snapshot is one of them only when its time places it among the 20 newest; nothing has served it since the old run page. The snapshots stay inline in `survey_history`.
- **The hosted-only tables of Step 8** are filled here: `legacy_access_keys` with the site's keys hashed (lower-cased) and their last four characters, `survey_events` and `deleted_responses` from the legacy logs.
- **Hidden public-results columns:** a survey's `private_questions` is the union of the questions its permissions marked not public and the answer columns its saved column layout hid or marked not public. When the layout lists at least one column, an answer it does not list takes the layout's "new columns" visibility, and the response time and id columns are private when the layout hides or omits them. An empty layout is no layout. An unreadable setting turns public results off for that survey, reported. The layout itself is kept in `survey_layouts` ([ADR 0044](docs/adr/0044-the-hosted-migration-tool.md), [legacy-compat.md](docs/api/legacy-compat.md#which-responses-are-counted)).
- **People:** a `users` row and a linked `surveyjs` sign-in for every person the copied data names (`site_blocked` from the site's block flag, no password, no licence date); a person with no email, or an email equal to another's after lower-casing, gets none and is reported. Legacy access keys are copied hashed. A survey whose project is gone or has no members moves to its creator's personal surveys, reported.
- **Where it runs and how it is used:** inside the hosted image (`surveyjs-studio migrate-hosted <command>`) or from a checkout (`pnpm migrate:hosted`). `verify`, `delta`, `reconcile` and `wipe` need `--target`. The run order (pre-copy, daily `delta` and `reconcile`, a full `verify` the day before, the window's `delta`, `reconcile` and incremental `verify`) and what a failed `verify` means are in [Operations › Hosted migration](docs/operations/hosted-migration.md). Open inputs from the SurveyJS team: the real column list of the old SQL tables and read-only credentials (the time zone and clock questions were settled on 2026-11-26: the old stores set their change times themselves; `plan` and `copy` check the SQL defaults, [ADR 0044](docs/adr/0044-the-hosted-migration-tool.md)).
- **Not copied, by decision:** Studio's own legacy-key revocations, API tokens and uploads that belong to no survey (production has none; `verify` flags any), and files nobody links.

**Tests**

- **Back-end unit:**
  - each record mapper and normalisation rule;
  - high-water mark selection;
  - the reconcile difference.
- **Back-end e2e, with Azurite and the SQL Server replica as the source and a containerised target:**
  - `copy` then `verify` passes on the golden fixtures plus the 1,500-response survey;
  - a second `copy` changes nothing;
  - a run killed halfway and restarted ends identical;
  - edits, new responses and deletions after `copy` are carried by `delta` and `reconcile`;
  - after migration, the conformance and compatibility suites pass against the target;
  - a `--sample` copy holds whole accounts only (no survey whose owner or project is missing), and `verify --sample` is green on it;
  - `wipe` refuses without the confirmation and leaves an empty target with it.

**Documentation:** [ADR 0044](docs/adr/0044-the-hosted-migration-tool.md), [`docs/operations/hosted-migration.md`](docs/operations/hosted-migration.md) (commands, report fields, what a failed `verify` means), `hosted-migration-mapping.md` (final, private), [`docs/demo/hosted-09.md`](docs/demo/hosted-09.md).

**Demo checklist**

1. `pnpm migrate:hosted copy` from the replica into a local target, then `verify`: all green.
2. Change a survey, add a response and delete another survey in the replica. `delta`, `reconcile`, `verify`: green, and the changes are visible in the app on the target.
3. Kill `copy` midway and run it again. It resumes, and `verify` is green.
4. `copy --sample` of a share of the replica's accounts, `verify --sample` green, then `wipe`: the target is empty.

---

## Step 10: The cutover kit

> **Changed 2026-11-24 by [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md).** In the window today's Studio
> is frozen with its existing `READ_ONLY` mode (plan.md Step 14: the banner on the list and the run page, the
> read-only editor) and the old service is stopped. The new server is not live until the switch, so no new maintenance
> states are built, and `production` needs no new code for the window.

**Goal:** the operator has one scripted path through the window, with a go or no-go on evidence, and a deploy on the new server can roll back once its database has migrations.

**References**

- HS › Cutover; ADR 0042; plan.md Step 14 (`READ_ONLY`).
- H3 and H4 (met by today's read-only mode), H23, H26.

**Build**

- **`pnpm cutover`,** a guided script run against the new server through its test host names. Each step asks for confirmation and appends to a cutover record, which stays private (rule 6); `--resume` continues from the record's last step:
  1. preflight: the target is ready (migrations applied, Studio and the bridge healthy), `demoapi.surveyjs.io` answers a forwarded path, and the last daily `delta` and its time are shown;
  2. the freeze: today's Studio reports `readOnly` in `/config`, and the old service no longer answers. People make both changes; the script checks them;
  3. `delta` and `reconcile`;
  4. `verify`;
  5. the integrity checks: `smoke` with the test account, and a fixed set of user-story checks on the test host names;
  6. go or no-go: the evidence, then the next manual step. Go: switch both DNS records. No-go: start the old service and turn `READ_ONLY` off; the legacy stores were only read.

- **Rollback of a deploy on the new server.** Today a deploy rolls back by image tag because the app has no database migrations ([Setting up a Hetzner server › Update, roll back, status](docs/operations/hetzner-server-setup.md#6-update-roll-back-status)). On the new server it has. The step decides how a deploy and its rollback treat an image whose migrations ran (for example: migrations are only ever additive, so the previous image still runs), with the backup before each deploy ([ADR 0033](docs/adr/0033-hosted-target-stores.md)), and documents it.

- **`docs/operations/legacy-azure-resources.md`:** every legacy resource the cutover leaves unused, for the SurveyJS team to remove when it chooses:
  - each storage account with its tables, blob containers and file shares;
  - the My Surveys tables in the site database (`Surveys`, `Organizations`, `OrganizationUsers`), with `Users` marked as staying.

  `pnpm inspect:legacy --stats` produces the list of per-survey tables.

**Tests**

- **Back-end unit:** the cutover state machine (each step's preconditions, `--resume`, a no-go from each state).
- **Back-end e2e:** `pnpm cutover` from the replica to a local target, with a read-only Studio and a stopped stand-in for the old service: go; and a no-go at `verify` after a row changed in the target, with nothing written to the replica.

**Documentation:** `docs/operations/hosted-cutover.md` (the script, every prompt, the record, no-go), `docs/demo/hosted-10.md`.

**Demo checklist**

1. Locally, `pnpm cutover` from the replica to a target with a read-only Studio: every step green, then go.
2. Again with a row changed in the target before `verify`: no-go at `verify`, and the replica was not written.

---

## Step 11: The test migration and the cutover runbook

> **Changed 2026-11-24 by [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md).** There is no staging copy.
> About 10 % of the data on the new server replaces the rehearsal, and the daily `delta` before the window measures its
> length.

**Goal:** the new server is proven on real data, functionally and under load, before the final migration; the window's length is measured; the runbook is final.

**Inputs needed:**

- Steps 2, 8, 9 and 10 merged and deployed on the new server;
- `demoapi.surveyjs.io` live, with the bridge forwarding the site's paths to it;
- Step 7's request sample and the test account's key;
- the new server at production size before the full pre-copy ([ADR 0033](docs/adr/0033-hosted-target-stores.md#the-volumes-2026-11-18); the size is in the private infrastructure notes). The resize is one-way: the disk cannot shrink again;
- the SurveyJS team for the checks and the window;
- a date for the announcement, one to two weeks before the window.

**References**

- HS › Cutover; › Retirement (the site team's part); ADR 0041, ADR 0042; Steps 7–10.
- H18, H19, H24, H26, H28.

**Build**

- **The test migration:** `pnpm migrate:hosted copy --sample` of about 10 % of the accounts into the new server, then `verify --sample`. Then, on the test host names:
  - the compatibility, conformance and Phase 1 user-story suites;
  - `delta --sample`, then `pnpm legacy:replay` limited to the sample (the replay gains a filter of survey IDs and key hashes, written by `plan --sample`), so stale data does not read as a difference;
  - `pnpm legacy:replay smoke`;
  - the load test.

  Then `wipe`: test writes never reach the final data.

- **The load test** (`load-tests/`, k6 scripts, run from an operator's machine and never in CI against a real server): the scheduled job's `getSurvey` rate through the bridge, bursts of `post`, and Studio's survey list, results pages and export on the largest sampled survey, with the thresholds of Step 8's scale ADR. The results stay private; the PR states pass or fail.
- **Fixes** found in the test migration, in this step's PR or follow-up PRs before the cutover. A fix that changes what is copied repeats the test migration.
- **The full pre-copy and the daily `delta`,** after the resize and while the old side runs: each `delta`'s time is recorded, and the last ones give the window estimate.
- **`docs/operations/hosted-cutover-runbook.md`:**
  - announcements one to two weeks ahead, with templates for users and integrators. The integrator template says that access keys can no longer be viewed after the cutover. Both say the data moves to another provider, and the privacy statement is updated in the same release ([ADR 0033](docs/adr/0033-hosted-target-stores.md));
  - roles and the go/no-go criteria;
  - the timeline: the time-to-live of both DNS records lowered at least two days before; the window (the old service stopped by the SurveyJS team, today's Studio on `READ_ONLY`, `pnpm cutover`); the switch of `studio.surveyjs.io` and `api.surveyjs.io` at a quiet hour, with the certificates issued over HTTP; what to watch in the first hour and the first day ([the takeover runbook's](docs/operations/legacy-api-takeover.md) Prometheus queries); `LEGACY_KEY_REVOKE` on a day later;
  - no-go before the switch; after it, problems are fixed on the new server;
  - post-cutover checks; the one-month checking period, after which today's server and the `production` branch are removed (the old service is not started again);
  - the purge date of `deleted_responses`;
  - the **handover to the site team**:
    - removing the My Surveys code from surveyjs.io and `api.surveyjs.io`;
    - removing the access key from the manage account page in the cutover release;
    - the resource list for the team to remove legacy resources when it chooses.

**Tests**

- **On the new server:** the reports from `verify`, the suites, the replay, `smoke` and the load test on the sample. They stay private (rule 6); the PR states pass or fail, and the window estimate against the limit.

**Documentation:** the runbook (timings rounded), a test-migration summary without production figures, `docs/demo/hosted-11.md`.

**Demo checklist**

1. The test-migration report: `verify` green; the suites, the replay and `smoke` pass; the load test within its thresholds; after `wipe` the target is empty.
2. The daily `delta` puts the window under the agreed limit.
3. The SurveyJS team signs off the runbook and sets a date.

**After this step: the cutover.** The SurveyJS team runs it from the runbook. Mode 1.3 is live when the post-cutover checks pass. Step 12 starts after the one-month checking period.

---

## Step 12: Retiring the legacy code in this repository

**Goal:** the repository no longer carries the legacy stores, formats or replica.

**Starts after:** one month without rollback-class incidents after the cutover (spec-hosted › Retirement).

**References**

- HS › Retirement; idea D18 (documents may stay, without secrets).
- H29.

**Build**

- **Remove:**
  - the Azure legacy provider and its tests;
  - the Azurite and SQL Server replica (`docker/compose.azurite.yaml` and the fixtures loader);
  - the golden legacy fixtures and the inspector;
  - the legacy-format rules (event rows, ADR 0010 writes);
  - the Azure SDK dependencies;
  - `pnpm demo:azurite`;
  - the `production` branch and the CI path that publishes from it ([ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md)), once today's server is gone.
- **Keep:**
  - the migration tool's importer and NDJSON format, which are reusable for provider-to-provider moves;
  - the bridge and `legacy-compat-tests`, which call only Studio's public API, until the bridge's traffic has gone and it is retired on its own (ADR 0035);
  - `legacy-data-layout.md` and the mapping, marked historical.
- **Update** the CI pipeline, the development modes (memory, SQLite, PostgreSQL, S3) and the provider lists in all documentation.
- **ADRs** that describe legacy behaviour (0006, 0010 and others) are marked superseded, with a pointer to this step.

**Tests**

- **All suites** pass on memory and the SQL providers; CI no longer needs Azurite or SQL Server.
- **`pnpm check:deps`** shows no Azure packages.

**Documentation:** `docs/development.md`, `docs/testing.md`, `docs/architecture.md`, README, superseded ADRs, `docs/demo/hosted-12.md`.

**Demo checklist**

1. A fresh clone runs `pnpm install && pnpm test && pnpm e2e` without Docker images for Azure or SQL Server.
2. `grep -ri azure server/src` finds only the historical documents.

---

## After the migration

Improvements the product owner moved after the cutover. They are not part of the path to it.

### Results on the server

**Goal:** a survey with millions of responses opens, pages, filters and exports without the page reading every response, as [ADR 0015](docs/adr/0015-results-summary-table-and-views.md) (changed 2026-11-25) decided.

> **Deferred 2026-11-25 by the product owner:** the Summary and the Table as built, which already run on `studio.surveyjs.io`, are enough until the migration; this and every other analytics improvement comes after it. Kept here as written (once Step 8b).
>
> **Added 2026-11-25 by [ADR 0015](docs/adr/0015-results-summary-table-and-views.md).** The product owner decided that the Summary shows at most 25,000 responses, the Table pages, filters and sorts on the server, and the export returns every matching response. Summarising more is a later task. This touches the shared API and the results page, so it is a step of its own.

**References**

- ADR 0015 › Changed 2026-11-25; R11, R14 and R20 of the Phase 1 spec; [ADR 0033](docs/adr/0033-hosted-target-stores.md#readiness-hosted-step-8-2026-11-25) (the scale targets).

**Build**

- **`queryResults`** in the contract: a survey's responses with filters (field, type, value), sort orders (field, direction), an offset and a limit; the answer is one page and the total count (the shape of the Dashboard's `GetDataFn`: `{ filter, sort, offset, limit }` → `{ data, totalCount }`). Who may call it is `listResults`'s rule. The generated client and `docs/api` follow.
- **Providers:** on SQLite and PostgreSQL the filter and the sort run in the database on the stored answers (the JSON functions of each); the memory and Azure legacy providers compute the same results in memory. Indexes, as migrations, where the scale targets need them.
- **The Table** uses the Dashboard's server mode for every survey, one page at a time, with paging, filters and sorts sent to the server (no threshold: one path serves every survey).
- **The Summary** is built from the newest 25,000 responses, and says how many it covers when a survey has more.
- **The export** keeps the three formats (CSV, Excel, PDF) and returns every response that matches the Table's filters, in its order, fetched through `queryResults` in pages.
- **The two scale targets this step adds** to `scale:check` (the others are Step 8's): a page of the Table of the largest survey, with a filter and a sort, under 2 s; the Summary's data, the newest 25,000 responses, under 5 s ([ADR 0033](docs/adr/0033-hosted-target-stores.md#readiness-hosted-step-8-2026-11-25)).

**Tests**

- **Back-end:** `queryResults` on every provider through the shared suite: each filter type, sort order, paging and the total; permissions as `listResults`; the same results on memory, SQLite, PostgreSQL and Azure legacy.
- **Front-end e2e:** the results user stories in the server mode: paging, filter, sort, the Summary's note over 25,000, and an export of a filtered Table.
- **Scale:** `scale:check` with the two targets, on the new server.

**Documentation:** ADR 0015's change, `docs/api`, the user guide's results page, a demo script of its own.

**Demo checklist**

1. Generate a survey of a few hundred thousand responses (`scale:generate`) and open its results: the Table opens at once and pages.
2. Filter and sort the Table: the page changes, the total follows.
3. The Summary says it covers the newest 25,000 responses.
4. Export with a filter set: the file holds every matching response, in the Table's order.

---

## Consistency check against spec-hosted.md

**User stories:** all 30 are assigned.

| Steps | Stories                 |
| ----- | ----------------------- |
| 1     | H16, H17                |
| 2     | H27                     |
| 3     | H12, H13, H14, H15      |
| 4     | H6                      |
| 5     | H5, H6, H7, H8, H30     |
| 6     | H9, H11                 |
| 7     | H19 (the tools)         |
| 8     | H25                     |
| 9     | H1, H2, H20, H21, H22   |
| 10    | H3, H4, H23, H26        |
| 11    | H18, H19, H24, H26, H28 |
| 12    | H29                     |

H10 (a clear `410` for a retired endpoint) no longer applies: under ADR 0035 nothing is retired.

H18 and H24 are met as [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md) changes them: both host names switch once, and before the switch a no-go restores the old side; the test migration on the new server stands in for the staging copy.

**Decisions:**

- **D17:** Step 2 completes the switch from the user API to sign-in claims and the webhook ([ADR 0043](docs/adr/0043-hosted-users-on-the-local-directory.md)).
- **D18:** Steps 1, 5–11 (migration, the bridge, tokens before the cutover, IDs kept). Step 12 removes the legacy code, and the documents stay.
- **D19:** nothing here; the site's redirects are in place since plan.md Step 14.
- **D10 (revised):** Step 1 chooses the stores.
- **D22:** planned to run beside the self-hosted track, which finished first; see [What the self-hosted track already built](#what-the-self-hosted-track-already-built).

**Contract:**

- `bearerAuth` (Step 3), and `partial`, `lastPageIndex` and `SurveyResponse.partial` (Step 4) lose `x-phase: P1`;
- the token operations are new (Step 3);
- Steps 5 and 6 add the operations the bridge needs, so the contract covers everything the old API can do (ADR 0035);
- the bridge's old routes stay outside the contract.

## Open points this plan depends on

- The open questions of spec-hosted are answered (2026-10-19). Step 1 still needs the store choice; the app's Hetzner location is set by the production server.
- **A private location for production data** (rule 6), agreed with the SurveyJS team before Step 1 receives its inputs.
- **The surveyjs.io side:**
  - the sign-in claim for licences and the account-deleted webhook outbox (Step 2, built in the site's repository);
  - logs and statistics (Step 1);
  - golden responses (Step 5);
  - `demoapi.surveyjs.io` for the site's demos and housekeeping, live before the test migration (Step 11, [ADR 0042](docs/adr/0042-one-switch-to-the-new-server.md));
  - stopping the old service in the window, and the DNS change of `studio.surveyjs.io` and `api.surveyjs.io` at its end (the cutover);
  - **the largest survey** (before Step 9): one customer's survey holds about two thirds of all responses. The SurveyJS team talks to its owner before the cutover: the move to another provider, and whether all of its responses must move. (The site's demo results, checked 2026-11-18, are not an issue);
  - removing the access key from the manage account page (cutover);
  - no staging copy: the test migration on the new server replaces it (Step 11);
  - removing the legacy code after the cutover.
- **The self-hosted track's SQL foundation** for Step 8: built (2026-11-08).
