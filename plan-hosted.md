# Implementation plan: hosted migration track (deployment mode 1.3)

Status: draft · 2026-10-19 · refreshed 2026-11-12 against what the self-hosted track built
Implements: [spec-hosted.md](spec-hosted.md), within [idea.md](idea.md) (§3.0, D16–D22) and the contract [contract/openapi.yaml](contract/openapi.yaml).
Starts after: Phase 1 ([plan.md](plan.md) Steps 1–14, done 2026-10-23). It was planned to run beside [plan-self-hosted.md](plan-self-hosted.md); the self-hosted track finished first (all 11 steps merged by 2026-11-08), so this track starts on its results ([What the self-hosted track already built](#what-the-self-hosted-track-already-built)).

## How to use this plan

- Everything in [plan.md › How to use this plan](plan.md#how-to-use-this-plan) applies: one prompt per step, the steps in order, one branch and one PR per step, and the same reference notation.
- **Branches** are named `hosted/NN-short-name`. Demo scripts go in `docs/demo/hosted-NN.md`.
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

**Not built,** although the self-hosted plan allowed for it: the `api_tokens` table (SH Step 2 left it to Step 3; [data-model.md › Planned](docs/architecture/data-model.md#planned)), the hosted-only tables, a `profiles` directory, CORS and bearer authentication.

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
| 1    | Decisions and evidence: target stores, legacy traffic, mapping | ☐      |
| 2    | Users from sign-in: profiles, invitations and licence notices  | ☐      |
| 3    | API tokens, legacy access keys and CORS                        | ☐      |
| 4    | Partial responses                                              | ☐      |
| 5    | The bridge: public actions and legacy files                    | ☐      |
| 6    | The bridge: access-key actions and the migration guide         | ☐      |
| 7    | Taking over `api.surveyjs.io` traffic                          | ☐      |
| 8    | Target provider readiness                                      | ☐      |
| 9    | The migration tool                                             | ☐      |
| 10   | Maintenance states and the cutover kit                         | ☐      |
| 11   | Rehearsal and the cutover runbook                              | ☐      |
| 12   | Retiring the legacy code in this repository                    | ☐      |

Steps 2, 3 and 4 do not depend on each other. Step 8 waits for the self-hosted foundation. The cutover itself is an operational event between Steps 11 and 12. It is run from the Step 11 runbook and is not a code step.

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

## Step 2: Users from sign-in: profiles, invitations and licence notices

**Goal:** after the cutover the app needs nothing from the site's user tables. Users come from sign-in, members are added by email through profiles or invitations, licence notices come from a site endpoint, and deleted accounts arrive by the webhook ([ADR 0022](docs/adr/0022-users-from-sign-in.md)). Until the cutover the hosted configuration stays on `surveyjs-sql`.

**Inputs needed:**

- the `blocked` claim in `/OAuth/UserInfo` and the re-read on `/OAuth/Authorize`, in the site's sign-in server (built 2026-10-28), deployed to staging;
- the licence endpoint on the surveyjs.io staging site, designed with the site team;
- the account-deleted webhook on staging, built to `docs/integrations/surveyjs-user-api.md` (plan.md Step 12).

**References**

- HS › Users; ADR 0022; ADR 0018 (the seam, the webhook, erasure).
- H27.

**Already built** (SH Steps 4 and 8): the `users`, `user_identities` and `project_invitations` tables; surveyjs.io sign-in through OIDC; `addMember` with an unknown email answering with a pending member, `removeInvitation`, and invitations turned into memberships at sign-in by any method; a `disabled` account refused at sign-in with its sessions ended ([ADR 0029](docs/adr/0029-linking-identities-by-verified-email.md) D11).

**Build**

- **The hosted directory: a decision first, recorded in an ADR.** Either:
  - **reuse `local`** with `AUTH_METHODS=surveyjs`, the join policy open to every surveyjs.io identity, and no passwords or instance admin in the `surveyjs-site` shell; or
  - **a thin `profiles` directory** on the same tables, if `local` brings behaviour the hosted edition must not have.

  Either way, on the memory provider and the SQL providers:
  - every sign-in refreshes the user: email, display name, `blocked` (stored as `status` `disabled`, [data-model.md](docs/architecture/data-model.md)), last sign-in;
  - `getUser` and `findUserByEmail` read these users;
  - `missingUsers` refuses, and `account:reconcile` says it is not available with this directory.

- **`blocked` from UserInfo.** The identity claims carry it; a blocked user gets the `403` "Account blocked", as with `surveyjs-sql`, and a user unblocked on the site works again at the next sign-in.
- **Invitations in the hosted edition:** the existing operations, plus the pending list in the `surveyjs-site` shell's members page if it lacks it. No new contract operations unless the pending list needs one.
- **Licence notices from the site.** In the hosted edition the web app's shell asks the site endpoint for the signed-in user. The server's `surveyjs-licenses` stays for `surveyjs-sql`.
- **Profiles in the migration.** Step 9 exports a profile for every user the copied data names, from the site's `Users` table.
- **Removing the user API client:** the `surveyjs-api` directory, its stub and conformance run, `USER_API_URL`, `USER_API_TOKEN` and the `user-api` readiness check. The API sections of the user API document go too.

**Tests**

- **Back-end unit:** the user refresh at sign-in; `blocked` and unblocked. Invitation matching is covered since SH Step 8; add cases only for what the hosted directory changes.
- **Back-end e2e:** the provider suite for the hosted directory on memory and SQL; the conformance suite's invitation operations run with it.
- **Front-end e2e:** inviting an unknown email, the pending list and cancelling; the licence notice from a stubbed site endpoint.

**Documentation:** `docs/operations.md` (the directory settings), `docs/architecture.md` (profiles and invitations), the API reference, the user guide on projects and members, `docs/demo/hosted-02.md`.

**Demo checklist**

1. Locally on the hosted directory, sign in through the surveyjs.io stub as a new user. The profile is written, and the account menu shows the name.
2. As a project admin, add an email nobody has signed in with. It is listed as pending. Sign in with that email: the project is there, with the invited role.
3. On staging, block a test account in the site admin and sign in to the app with it: "Account blocked".
4. On staging, the licence notice of a user with an expired licence comes from the site endpoint.
5. Delete a test account on the staging site. The webhook arrives, and the account's personal surveys are gone.

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
  - SQL: the `api_tokens` table of [data-model.md › Planned](docs/architecture/data-model.md#planned), as the next migration for SQLite and PostgreSQL, moved to the built tables in that document.

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

**Goal:** `api.surveyjs.io` points at the bridge while the data is still on the legacy stores: the bridge answers the My Surveys actions through Studio, which still runs on the Azure legacy provider, and forwards the site's paths to the old service. The old service is out of the My Surveys request path before any data moves, and the bridge does not change at the cutover.

**Inputs needed:**

- **the DNS switch, made by the SurveyJS team** ([ADR 0035](docs/adr/0035-legacy-api-bridge.md)). The host also serves the site's demos and jobs ([Legacy API usage › Results](docs/architecture/legacy-api-usage.md#results-2026-11-13)); the bridge forwards them to the old service by that service's own host name, so they keep working without a proxy by path;
- an access-log sample, kept private (rule 6): the old service's HTTP logs, on since 2026-11-13;
- **the load to take over:** most `getSurvey` traffic is one scheduled server-side job that re-reads a fixed set of
  surveys every few minutes ([Legacy API usage › Client types](docs/architecture/legacy-api-usage.md#client-types-preview-2026-11-17)).
  The bridge's cache and Studio serve that steady rate from the first minute of the switch; the SurveyJS team found its owner (2026-11-18) and contacts them before
  the cutover;
- the staging environment. The production app runs on the Hetzner server in mode 1.1 ([Setting up a Hetzner server](docs/operations/hetzner-server-setup.md)); the bridge runs on the same server, with its own site and certificate for `api.surveyjs.io` (private infrastructure notes).

**References**

- ADR 0035; HS › Routing `api.surveyjs.io` (changed by ADR 0035); plan.md Step 14 (the production image and staging).
- H18, H19.

**Build**

- **`pnpm legacy:replay`:**
  - reads an access-log sample;
  - replays read requests against both the old service and the bridge, compares the answers, and writes an HTML report of differences;
  - with `--writes`, replays write requests only against staging.
- **The bridge in production:** the playbooks or Compose file run the bridge image next to the app, at the same version; the server's web front serves `api.surveyjs.io` and gets its certificate. The certificate needs the DNS record, so the first one is requested at the switch (or by a DNS challenge before it).
- **Switching the host:** the DNS record of `api.surveyjs.io` moves to the server, with the time-to-live lowered days before, so switching back is fast. Switching back restores the old record; the bridge holds no data, so nothing is lost.
- **`docs/operations/legacy-api-takeover.md`:**
  - the replay gate: no unexplained differences;
  - the switch, and what to watch: error rate and latency per action, the forwarded paths' errors, the cache hit rate;
  - rollback.
- **Operating the bridge:** structured logs and metrics per old action, with the caller's key reduced to a hash, so remaining users of each action can be found and contacted before the bridge is retired.

**Tests**

- **Back-end unit:** the comparison rules (ordering, the date formats the legacy service emits).
- **Back-end e2e:** replay of a recorded fixture log against two local servers (the bridge and a golden-file stub) produces the expected report.
- **Staging:** the replay of the real sample, run manually. The report stays private; the PR states the result (no unexplained differences, or the list of explained ones in general terms).

**Documentation:** the takeover runbook, `docs/operations.md` (bridge monitoring), `docs/demo/hosted-07.md`.

**Demo checklist**

1. The replay report for the staging sample shows no unexplained differences.
2. On staging, point a staging host name at the bridge, check that a v1.x page still works and that a site path reaches the old service, and switch back. Both moves take effect without downtime.

---

## Step 8: Target provider readiness

**Goal:** the chosen SQL provider and file store are ready to hold the hosted data at production size, including the hosted-only tables.

**References**

- HS › Data model and mapping (hosted-only tables); › Target stores; SH Steps 1–3; the Step 1 ADRs.
- H25.

**Build**

- **If the choice is not PostgreSQL with S3-compatible storage:** the chosen provider, built against the existing provider and conformance suites. The step grows by that work.
  **Already built** (SH Steps 1–3): the PostgreSQL provider, its migrations `0001`–`0005`, the S3-compatible file store, and `surveyjs-studio backup`/`restore`, which cover SQLite and local files only. A PostgreSQL deployment is backed up with the database's own tools ([Self-hosting › Backups](docs/self-hosting.md#backups)).

- **Hosted-only tables as SQL migrations** after Step 3's:
  - `legacy_files`;
  - `legacy_access_keys`;
  - `survey_events`;
  - `deleted_responses`, and a job that purges it 30 days after the cutover.

  These are empty and unused in the self-hosted image.

- **History snapshots above a size limit in the byte store** ([ADR 0036](docs/adr/0036-history-snapshots-above-a-size-limit.md)): a migration of `survey_history` (`snapshot` nullable, `snapshot_key`, the check constraint), the `HISTORY_INLINE_MAX_BYTES` setting (no limit by default), the object-first save, the delete order and the weekly sweep. The hosted limit comes from the history's size distribution, which the stats command measures (bytes below a few thresholds). This one is not hosted-only: self-hosted installations can set the limit too.
- **A scale check** on a synthetic data set the size of production (from the Step 1 estimate; the generator takes the size as a parameter, so the real figures stay private):
  - list, page, export and statistics times on the largest surveys, including **one survey with millions of responses**: one production survey holds most of them ([ADR 0033](docs/adr/0033-hosted-target-stores.md#the-volumes-2026-11-18));
  - index fixes until they meet targets agreed in the step's ADR.
- **Backup and restore** for the hosted stores, tested once with a restore into a scratch instance (H25):
  - point-in-time restore: managed, or WAL archiving to object storage when PostgreSQL runs on our own Hetzner servers (Step 1 ADR);
  - object-store versioning, or a scheduled copy where the store has no versioning.
- **The hosted production profile on the new stores,** ready but not active: the settings in `deploy/hetzner/app.env.example`, `docker/prod-like.env` kept in step, and a `prod-like` CI variant on PostgreSQL and S3.

**Tests**

- **Back-end e2e:** provider and conformance suites on the chosen provider, including tokens, partial responses and the hosted-only tables; the purge job.
- **Scale:** the scale check, run manually with results in the ADR.
- **Front-end e2e:** the Phase 1 user-story suites on the chosen provider.

**Documentation:** the scale ADR, `docs/architecture/data-model.md` (hosted-only tables), `docs/operations.md` (the hosted profile on the new stores, backups and restore), `docs/demo/hosted-08.md`.

**Demo checklist**

1. `pnpm dev:<provider>` runs the full Phase 1 demo on the chosen provider.
2. The scale report shows the largest survey's export and paging within the agreed times.
3. A restore into a scratch instance brings back a deleted survey.

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
  - `verify`: counts, checksums, sample deep compares through both providers' interfaces.
- **Safety:**
  - every run reads the source only;
  - a dry run into a scratch target is the default unless `--target` is given;
  - progress logs, and a machine-readable report; reports from production or a staging copy stay private (rule 6).
- **Files:** editor images and respondent files go into the target file store, with `legacy_files` filled for the legacy names. Blobs in `my-surveys-files` (Step 7 of Phase 1) are copied by ID.
- **History snapshots** go inline or to the byte store by the ADR 0036 limit, the object before its row, so a resumed `copy` is safe.

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
  - after migration, the conformance and compatibility suites pass against the target.

**Documentation:** `docs/operations/hosted-migration.md` (commands, report fields, what a failed `verify` means), `hosted-migration-mapping.md` (final), `docs/demo/hosted-09.md`.

**Demo checklist**

1. `pnpm migrate:hosted copy` from the replica into a local target, then `verify`: all green.
2. Change a survey, add a response and delete another survey in the replica. `delta`, `reconcile`, `verify`: green, and the changes are visible in the app on the target.
3. Kill `copy` midway and run it again. It resumes, and `verify` is green.

---

## Step 10: Maintenance states and the cutover kit

**Goal:** during the window, users and respondents see clear maintenance states, and the operator has one scripted path to switch over, or back.

**References**

- HS › Cutover; plan.md Step 14 (`READ_ONLY`).
- H3, H4, H23, H26.

**Build**

- **Maintenance states:**
  - with `READ_ONLY=true`, `/config` reports `maintenance` (Step 14's `/config` has only the `readOnly` flag);
  - the signed-in app shows a banner ("Saving is paused for maintenance until about …"), and editors are read-only;
  - the run page shows "temporarily unavailable, please try again shortly";
  - legacy `post` answers a legacy-shaped error.
  - `MAINTENANCE_UNTIL` sets the time shown.
- **`pnpm cutover`,** a guided script:
  1. preflight (target ready, user API ready, `verify` of the pre-copy);
  2. read-only on;
  3. `delta` and `reconcile`;
  4. `verify`;
  5. switch the configuration;
  6. read-only off;
  7. post-checks.

  `pnpm cutover --rollback` restores the old configuration. Each step asks for confirmation and logs to a cutover record.

- **Rollback on the server.** Today a deploy rolls back by image tag because the app has no database migrations ([Setting up a Hetzner server › Update, roll back, status](docs/operations/hetzner-server-setup.md#6-update-roll-back-status)). On the target stores it has. The step decides how `update.sh` and the auto-update timer treat an image whose migrations ran (for example: migrations are only ever additive, so the previous image still runs), and documents it in that page.

- **`docs/operations/legacy-azure-resources.md`:** every legacy resource the cutover leaves unused, for the SurveyJS team to remove when it chooses:
  - each storage account with its tables, blob containers and file shares;
  - the My Surveys tables in the site database (`Surveys`, `Organizations`, `OrganizationUsers`), with `Users` marked as staying.

  `pnpm inspect:legacy --stats` produces the list of per-survey tables.

**Tests**

- **Back-end unit:** the cutover state machine (each step's preconditions; rollback from each state).
- **Back-end e2e:** conformance in maintenance (every write refused with the maintenance Problem, reads work); the compatibility suite's `post` in maintenance.
- **Front-end unit:** the banner and the read-only editor.
- **Front-end e2e:** the maintenance banner, the read-only editor and the run page's maintenance state; after `READ_ONLY` is turned off, they return to normal without a reload beyond the next navigation.

**Documentation:** `docs/operations/hosted-cutover.md` (the script, every prompt, rollback), the user guide note on maintenance, `docs/demo/hosted-10.md`.

**Demo checklist**

1. Locally, `pnpm cutover` from the replica to a target. The app shows maintenance during the run and serves the target afterwards.
2. Run it again on a fresh setup and choose rollback after `verify`. The app is back on the replica, and nothing was written there.

---

## Step 11: Rehearsal and the cutover runbook

**Goal:** a full rehearsal on a production-sized copy proves the window length, the verification and the rollback. The runbook is final.

**Inputs needed:**

- a production-sized staging copy of the legacy stores;
- the target environment at production size ([ADR 0033](docs/adr/0033-hosted-target-stores.md#the-volumes-2026-11-18); the size is in the private infrastructure notes). The rehearsal server is built at that size; the production server is resized before its first `copy` (one-way: the disk cannot shrink again);
- the SurveyJS team for the rehearsal;
- a date for the announcement, one to two weeks before the window.

**References**

- HS › Cutover; › Retirement (the site team's part); Steps 7–10.
- H24, H26, H28.

**Build**

- **The rehearsal:** pre-copy, a simulated day of changes, the window, verification, a rollback, and a second, successful window. Measured timings go into the runbook.
- **Fixes** found in the rehearsal, in this step's PR or follow-up PRs before the cutover.
- **`docs/operations/hosted-cutover-runbook.md`:**
  - announcements one to two weeks ahead, with templates for users and integrators. The integrator template says that access keys can no longer be viewed after the cutover. Both say the data moves to another provider, and the privacy statement is updated in the same release ([ADR 0033](docs/adr/0033-hosted-target-stores.md));
  - roles and the go/no-go criteria;
  - the window timeline, preceded by the production server's resize to production size and the pre-copy, with a full backup right after it;
  - rollback;
  - post-cutover checks;
  - the purge date of `deleted_responses`;
  - the **handover to the site team**:
    - removing the My Surveys code from surveyjs.io and `api.surveyjs.io`;
    - removing the access key from the manage account page in the cutover release;
    - the resource list for the team to remove legacy resources when it chooses.

**Tests**

- **Rehearsal:** the reports from `verify`, the compatibility suite and the Phase 1 user-story suites against the rehearsed target. They stay private (rule 6); the PR states pass or fail and the window time against the limit.

**Documentation:** the runbook (timings rounded), a rehearsal summary without production figures, `docs/demo/hosted-11.md`.

**Demo checklist**

1. The rehearsal report shows the window time under the agreed limit, `verify` green, and rollback tested.
2. The SurveyJS team signs off the runbook and sets a date.

**After this step: the cutover.** The SurveyJS team runs it from the runbook. Mode 1.3 is live when the post-cutover checks pass. Step 12 starts after the stabilisation period.

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
  - `pnpm demo:azurite`.
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

## Consistency check against spec-hosted.md

**User stories:** all 30 are assigned.

| Steps | Stories               |
| ----- | --------------------- |
| 1     | H16, H17              |
| 2     | H27                   |
| 3     | H12, H13, H14, H15    |
| 4     | H6                    |
| 5     | H5, H6, H7, H8, H30   |
| 6     | H9, H11               |
| 7     | H18, H19              |
| 8     | H25                   |
| 9     | H1, H2, H20, H21, H22 |
| 10    | H3, H4, H23, H26      |
| 11    | H24, H26, H28         |
| 12    | H29                   |

H10 (a clear `410` for a retired endpoint) no longer applies: under ADR 0035 nothing is retired.

**Decisions:**

- **D17:** Step 2 completes the switch to the user API.
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
  - the user API (Step 2);
  - logs and statistics (Step 1);
  - golden responses (Step 5);
  - the DNS change of `api.surveyjs.io` (Step 7);
  - **the largest survey** (before Step 9): one customer's survey holds about two thirds of all responses. The SurveyJS team talks to its owner before the cutover: the move to another provider, and whether all of its responses must move. (The site's demo results, checked 2026-11-18, are not an issue);
  - removing the access key from the manage account page (cutover);
  - the staging copy (Step 11);
  - removing the legacy code after the cutover.
- **The self-hosted track's SQL foundation** for Step 8: built (2026-11-08).
