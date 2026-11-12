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

| Step | Name                                                              | Status |
| ---- | ----------------------------------------------------------------- | ------ |
| 1    | Decisions and evidence: target stores, legacy traffic, mapping    | ☐      |
| 2    | Users from sign-in: profiles, invitations and licence notices     | ☐      |
| 3    | API tokens and CORS                                               | ☐      |
| 4    | Partial responses                                                 | ☐      |
| 5    | Compatibility layer: public endpoints and legacy files            | ☐      |
| 6    | Compatibility layer: access-key endpoints and the migration guide | ☐      |
| 7    | Taking over `api.surveyjs.io` traffic                             | ☐      |
| 8    | Target provider readiness                                         | ☐      |
| 9    | The migration tool                                                | ☐      |
| 10   | Maintenance states and the cutover kit                            | ☐      |
| 11   | Rehearsal and the cutover runbook                                 | ☐      |
| 12   | Retiring the legacy code in this repository                       | ☐      |

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
- **`docs/architecture/legacy-api-usage.md`:** the share of requests per endpoint and per client type (Form Library version, server-side caller), with the **scope decision** for the compatibility layer: kept, or `410`. Recorded in an ADR. Shares and orders of magnitude only; no counts, addresses or integrator names (rule 6).
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

## Step 3: API tokens and CORS

**Goal:** integrators can call the new API from their servers with a per-scope token, and from browsers through CORS. Tokens work before the cutover.

**References**

- HS › API tokens and CORS; idea §6.2 B7; contract `bearerAuth` (`x-phase: P1`).
- H12, H13, H14.

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
  - a bearer token resolves to the user and scope;
  - the permissions are those in the spec;
  - CSRF does not apply to bearer requests;
  - the last-used time is updated, at most once a minute.
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
  - provider suite: the TokenStore.
- **Front-end unit:** the tokens page's visibility rules; the one-time secret display.
- **Front-end e2e:** create a token, use it with `fetch` from a page on another origin, revoke it, and the next call fails.

**Documentation:** API guide "API tokens" and "Calling the API from a browser", the API reference (generated), user guide "API tokens", `docs/demo/hosted-03.md`.

**Demo checklist**

1. On the API tokens page, create a Personal token. `curl -H "Authorization: Bearer …" /api/v1/surveys` lists the personal surveys.
2. Create a project token as the project admin. It lists only that project's surveys.
3. Revoke it. The same `curl` gets `401`.
4. From a page served on another port, `fetch` the public survey endpoint. CORS allows it.

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

## Step 5: Compatibility layer: public endpoints and legacy files

**Goal:** the legacy public endpoints and the legacy file URLs are answered by the app, with legacy-exact responses, on any provider.

**Inputs needed:** golden responses recorded from the real `api.surveyjs.io` for a set of known test surveys on production, made by the SurveyJS team with a script from this step. The surveys belong to a test account and hold made-up answers; the recordings are reviewed in the private location (rule 6) before any is committed, and ids, emails and addresses that are not the test account's are replaced.

**References**

- HS › Compatibility layer; idea §2.8; `legacy-data-layout.md` §3.9, §7; the Step 1 usage ADR.
- H5, H6, H7, H8, H30.

**Build**

- **`server/src/legacy-api/`:**
  - mounted when `LEGACY_API=on`, on the paths `public/Survey`, `public/v1/Survey` and the unauthenticated `private/Surveys/files` and `getSurveyPublicResults/{id}`;
  - outside `/api/v1` and outside the OpenAPI document;
  - built on the provider interfaces only.
- **Endpoints:**
  - `getSurvey`, `getSurveyAndIsCompleted`, `post`, `post/page-number`, `upload` (the `dxsimage:`/`dxsfile:` answers), `getResult`, `isCompleted`, `image`, `file`;
  - `files?name=`, `getSurveyPublicResults/{id}`.
- **Kept and dropped quirks:** each legacy behaviour is either kept or deliberately dropped, and the ADR lists them (for example, `getSurvey` on an unpublished survey).
- **Legacy files:**
  - a `legacy_files` lookup (name → file ID), filled by the migration (Step 9);
  - before the cutover, the Azure legacy provider reads the `surveyfiles` and `files` shares directly. That needs `@azure/storage-file-share` and a stub in tests, because Azurite has no Files service.
- **Shared rules:** rate limits on the public paths, the response size limits, IP capture only when the setting is on, and idempotency where the legacy client sends a repeat.
- **`legacy-compat-tests`:**
  - a new package: HTTP only, with a base URL;
  - golden files for every kept endpoint;
  - a recording script for the SurveyJS team.

**Tests**

- **Back-end unit:** each response mapper (casing, `{ Data, ResultCount }`, `isCompleted` values, `getResult` aggregation).
- **Back-end e2e:** `legacy-compat-tests` on memory and Azure legacy, against golden files; Form Library v1.x (pinned in the test package) loading a survey with `surveyId` and posting with `surveyPostId` against the app.
- **Front-end:** none; no UI.

**Documentation:** `docs/api/legacy-compat.md` (what is served, kept and dropped quirks), the compatibility ADR, `docs/testing.md` (the fourth seam and recording golden files), `docs/demo/hosted-05.md`.

**Demo checklist**

1. With `LEGACY_API=on`, a small HTML page using Form Library v1.x and `surveyId` loads a seeded survey from the local app, and its result appears in the Table.
2. `curl …/public/v1/Survey/getResult?resultId=…&name=q1` matches the golden file.
3. A survey whose JSON holds a legacy `files?name=` image shows it, served by the app.

---

## Step 6: Compatibility layer: access-key endpoints and the migration guide

**Goal:**

- the access-key endpoints that are still in use keep working;
- every other legacy path answers a clear `410`;
- integrators have a migration guide;
- users can revoke their legacy access key.

**References**

- HS › Compatibility layer (access keys, scope); the Step 1 usage ADR.
- H9, H10, H11, H15.

**Build**

- **Access-key authentication:**
  - before the cutover, the key is looked up in the site database through the Azure legacy provider;
  - after it, the key is checked against `legacy_access_keys`, which store hashes.

  A revoked key gets the legacy-shaped `401`.

- **The kept private endpoints,** exactly as the Step 1 ADR lists them, with golden files.
- **`410 Gone`** for every other legacy My Surveys path: a JSON body with a message and the guide URL.
- **The legacy key on the API tokens page:**
  - shown as "Legacy access key, created …" with **Revoke**;
  - no new keys are issued;
  - the hash and the revoked flag are stored (TokenStore or the hosted-only table).
- **`docs/api/migrating-from-api-surveyjs-io.md`:** every legacy endpoint, its replacement in the new API, and examples.

**Tests**

- **Back-end unit:** key hashing; the `410` body.
- **Back-end e2e:**
  - `legacy-compat-tests`: each kept private endpoint against golden files, with a valid, wrong and revoked key; one `410` per retired group;
  - conformance: revoking the legacy key.
- **Front-end e2e:** the legacy key row appears and can be revoked.

**Documentation:** the migration guide, `docs/api/legacy-compat.md` (private endpoints), user guide "API tokens" (legacy keys), `docs/demo/hosted-06.md`.

**Demo checklist**

1. A kept private endpoint answers with a seeded user's access key, and matches the golden file.
2. A retired endpoint answers `410` with the guide link.
3. Revoke the key on the API tokens page. The kept endpoint now answers `401`.

---

## Step 7: Taking over `api.surveyjs.io` traffic

**Goal:** the My Surveys paths of `api.surveyjs.io` are served by the app while the data is still on the legacy stores. The old service is out of the request path before any data moves.

**Inputs needed:**

- the SurveyJS team's reverse proxy on `api.surveyjs.io`, or control of its DNS. The host serves only My Surveys, so the app takes the whole host;
- an access-log sample, kept private (rule 6);
- the staging environment. The production app runs on the Hetzner server in mode 1.1 ([Setting up a Hetzner server](docs/operations/hetzner-server-setup.md)); taking the host means `api.surveyjs.io` reaches that server too, which needs its Caddy site and certificate.

**References**

- HS › Routing `api.surveyjs.io`; plan.md Step 14 (the production image and staging).
- H18, H19.

**Build**

- **`pnpm legacy:replay`:**
  - reads an access-log sample;
  - replays read requests against both the old service and the app, compares the JSON, and writes an HTML report of differences;
  - with `--writes`, replays write requests only against staging.
- **Switching the host:**
  - with a proxy: the rule set for the groups (public reads, public writes, private endpoints), with the rollback rule next to each;
  - without one: the DNS switch of the whole host, with the time-to-live lowered days before so that switching back is fast.
- **`docs/operations/legacy-api-takeover.md`:**
  - the order of the groups;
  - the replay gate for each: no unexplained differences;
  - what to watch: error rate, latency, the `410` count;
  - rollback.
- **Operating the layer:**
  - structured logs and metrics per legacy endpoint;
  - `410` responses counted per client, so remaining users can be contacted.

**Tests**

- **Back-end unit:** the JSON comparison rules (ordering, the date formats the legacy service emits).
- **Back-end e2e:** replay of a recorded fixture log against two local servers (the app and a golden-file stub) produces the expected report.
- **Staging:** the replay of the real sample, run manually. The report stays private; the PR states the result (no unexplained differences, or the list of explained ones in general terms).

**Documentation:** the takeover runbook, `docs/operations.md` (legacy API monitoring), `docs/demo/hosted-07.md`.

**Demo checklist**

1. The replay report for the staging sample shows no unexplained differences.
2. On staging, switch the public-read group (or the whole staging host) to the app, check that a v1.x page still works, and switch back. Both moves take effect without downtime.

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

- **A scale check** on a synthetic data set the size of production (from the Step 1 estimate; the generator takes the size as a parameter, so the real figures stay private):
  - list, page, export and statistics times on the largest surveys;
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
  - `delta`: since the high-water marks;
  - `reconcile`: key-set comparison and deletions;
  - `verify`: counts, checksums, sample deep compares through both providers' interfaces.
- **Safety:**
  - every run reads the source only;
  - a dry run into a scratch target is the default unless `--target` is given;
  - progress logs, and a machine-readable report; reports from production or a staging copy stay private (rule 6).
- **Files:** editor images and respondent files go into the target file store, with `legacy_files` filled for the legacy names. Blobs in `my-surveys-files` (Step 7 of Phase 1) are copied by ID.

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
- the target environment;
- the SurveyJS team for the rehearsal;
- a date for the announcement, one to two weeks before the window.

**References**

- HS › Cutover; › Retirement (the site team's part); Steps 7–10.
- H24, H26, H28.

**Build**

- **The rehearsal:** pre-copy, a simulated day of changes, the window, verification, a rollback, and a second, successful window. Measured timings go into the runbook.
- **Fixes** found in the rehearsal, in this step's PR or follow-up PRs before the cutover.
- **`docs/operations/hosted-cutover-runbook.md`:**
  - announcements one to two weeks ahead, with templates for users and integrators. The integrator template says that access keys can no longer be viewed after the cutover;
  - roles and the go/no-go criteria;
  - the window timeline;
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
  - the compatibility layer and its suite, which run on SQL;
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
| 3     | H12, H13, H14         |
| 4     | H6                    |
| 5     | H5, H6, H7, H8, H30   |
| 6     | H9, H10, H11, H15     |
| 7     | H18, H19              |
| 8     | H25                   |
| 9     | H1, H2, H20, H21, H22 |
| 10    | H3, H4, H23, H26      |
| 11    | H24, H26, H28         |
| 12    | H29                   |

**Decisions:**

- **D17:** Step 2 completes the switch to the user API.
- **D18:** Steps 1, 5–11 (migration, compatibility layer, tokens before the cutover, IDs kept). Step 12 removes the legacy code, and the documents stay.
- **D19:** nothing here; the site's redirects are in place since plan.md Step 14.
- **D10 (revised):** Step 1 chooses the stores.
- **D22:** planned to run beside the self-hosted track, which finished first; see [What the self-hosted track already built](#what-the-self-hosted-track-already-built).

**Contract:**

- `bearerAuth` (Step 3), and `partial`, `lastPageIndex` and `SurveyResponse.partial` (Step 4) lose `x-phase: P1`;
- the token operations are new (Step 3);
- the compatibility layer stays outside the contract.

## Open points this plan depends on

- The open questions of spec-hosted are answered (2026-10-19). Step 1 still needs the store choice; the app's Hetzner location is set by the production server.
- **A private location for production data** (rule 6), agreed with the SurveyJS team before Step 1 receives its inputs.
- **The surveyjs.io side:**
  - the user API (Step 2);
  - logs and statistics (Step 1);
  - golden responses (Step 5);
  - the proxy or DNS change (Step 7);
  - removing the access key from the manage account page (cutover);
  - the staging copy (Step 11);
  - removing the legacy code after the cutover.
- **The self-hosted track's SQL foundation** for Step 8: built (2026-11-08).
