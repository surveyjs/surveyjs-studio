# Spec: My Surveys, hosted migration track (deployment mode 1.3)

Status: draft for review · 2026-10-19 · open questions answered 2026-10-19
Inputs:

- `idea.md`: §3.0 deployment modes and decisions D1–D22, mainly D17, D18 and D19.
- `spec.md`: Phase 1, modes 1.1 and 1.2.
- `plan.md`: Steps 12 and 14.
- `docs/architecture/legacy-data-layout.md`.
- `contract/openapi.yaml`.

Plan: [plan-hosted.md](plan-hosted.md). The self-hosted track ([spec-self-hosted.md](spec-self-hosted.md)) runs at the same time and shares the SQL providers with this track.

## Problem Statement

After Phase 1 (modes 1.1 and 1.2), `studio.surveyjs.io` is the only My Surveys UI. It still runs on the legacy surveyjs.io data:

- **Survey, project and member records** live in the surveyjs.io site's SQL database, next to data the app does not own (users, licences, billing).
- **Definitions, history, results and files** live in Azure Tables, Blobs and file shares, in formats designed for the old .NET service. Every write must keep those formats readable by legacy code:
  - event rows;
  - lower-case columns;
  - one table per survey's results.
- **Reading results is expensive.** Azure Tables cannot page or aggregate by anything other than keys. For a large survey, listing, exporting and public results read every row key of a partition before the rows they show (plan Step 14 reduced the whole-partition scan to that).
- **Users are read straight from the site's SQL tables.** The site team cannot change its user schema without breaking the app.
- **`api.surveyjs.io` still serves legacy clients from the same data.** It is old code that the site team wants to remove:
  - Form Library v1.x with `surveyId`/`surveyPostId`;
  - Dashboard examples;
  - REST calls with an `accessKey` in the URL;
  - editor images embedded as `https://api.surveyjs.io/private/Surveys/files?name=…`.
- **Integrators have no supported way to use the new API programmatically.** API tokens are marked `x-phase: P1` in the contract.

## Solution

Move everything except users into the app's own stores, and retire the legacy code.

**What users see**

- Nothing changes after a short, announced maintenance window. During the window the app is read-only.
- Every survey, result, theme, history entry, file, saved layout, project and member is there, with the same IDs. That includes Survey, Post and Result IDs.
- Existing integrations keep working:
  - v1.x Form Library clients;
  - public-results dashboards;
  - images embedded in survey JSON;
  - the access-key endpoints that are still in use.

  `api.surveyjs.io`'s My Surveys paths are answered by a thin compatibility layer inside the app.

- Integrators get per-scope **API tokens** and **CORS** for the new API, and a migration guide from the legacy endpoints.

**What the SurveyJS team gets**

- **The app's own database and object storage**, chosen from a shortlist of non-Azure options. The recommended choice is PostgreSQL plus S3-compatible storage, the same providers the self-hosted image uses.
- **Users stay on surveyjs.io.** After the cutover the app learns about users only from **sign-in** (UserInfo) and erases data on the **account-deleted webhook** ([ADR 0022](docs/adr/0022-users-from-sign-in.md)). There is no user API. The app keeps no credentials for the site database.
- **No legacy code left.** After the cutover the site removes its My Surveys code and the old `api.surveyjs.io` implementation. After a stabilisation period, this repository removes the Azure legacy provider and the replica.

**How it is done**

1. **The compatibility layer goes live first, on the legacy stores.** It is built on the provider interfaces, so it runs on any provider. `api.surveyjs.io` traffic is routed to it path by path, and routing back is the rollback. When the data moves, the old service is already out of the way.
2. **A migration tool copies data over in two passes:**
   - before the window: a bulk **pre-copy** of all data;
   - inside the window: a **delta** copy of what changed since.

   It then verifies the result. The legacy stores are only read, so rolling back inside the window is a configuration switch.

## User Stories

Numbered H1–H30, to keep them apart from the Phase 1 stories (US 1–81) and the self-hosted stories (S1–S…).

### Users and respondents

- H1. As an existing user, I want to find all my surveys, results, themes, history, files, saved layouts and projects after the switch, unchanged and with the same IDs, so that the switch is invisible to me.
- H2. As an existing user, I want links and bookmarks to my surveys, results and public results to keep working after the switch, so that nothing I shared breaks.
- H3. As a user, I want a clear "saving is paused for maintenance" message during the window, rather than errors, so that I know my work is safe and when to come back.
- H4. As a respondent opening a survey during the window, I want a "temporarily unavailable, please try again shortly" page, rather than "not available", so that I come back instead of giving up.
- H5. As a survey author whose survey JSON contains legacy image URLs (`https://api.surveyjs.io/private/Surveys/files?name=…`), I want those images to keep showing, so that I don't have to re-upload them.
- H6. As a survey owner, I want responses collected through the legacy API (including partial saves) to appear in my results as before, so that my data stays complete.

### Integrators

- H7. As an integrator using Form Library v1.x with `surveyId` / `surveyPostId`, I want my integration to keep working without changes, so that the switch costs me nothing.
- H8. As an integrator calling the legacy public endpoints, I want the same responses as before, so that my parsing code keeps working. The endpoints are `getSurvey`, `getSurveyAndIsCompleted`, `post`, `post/page-number`, `upload`, `getResult`, `isCompleted` and `getSurveyPublicResults`.
- H9. As an integrator calling the legacy private endpoints with my access key, I want the endpoints that are still in use to keep working, so that I can migrate on my own schedule.
- H10. As an integrator calling a legacy endpoint that has been retired, I want a clear error that links to the migration guide, so that I know what to do.
- H11. As an integrator, I want a guide that maps each legacy endpoint to the new API, so that migrating is straightforward.
- H12. As an integrator, I want to create an API token for my Personal space or for a project I administer, and call the new API with `Authorization: Bearer`, so that my server can manage surveys and read results.
- H13. As an integrator, I want to see my tokens (name, scope, created, last used) and revoke them, so that a leaked token can be stopped.
- H14. As a front-end developer on my own site, I want to call the public endpoints and the token-authenticated API from my origin (CORS), so that I can build on the new API from the browser.
- H15. As a user whose access key leaked, I want to revoke it, so that nobody can use the legacy private API on my surveys.

### SurveyJS team: operations and migration

- H16. As an operator, I want a documented shortlist of target databases and file stores, with the criteria behind the choice, so that the decision is reviewable.
- H17. As an operator, I want measured traffic for every `api.surveyjs.io` My Surveys endpoint, so that the compatibility layer covers what is actually used and nothing more.
- H18. As an operator, I want to route `api.surveyjs.io` paths to the app one group at a time and route them back instantly, so that taking over legacy traffic is reversible.
- H19. As an operator, I want to replay sampled real legacy requests against both the old service and the app and see the differences, so that I trust the compatibility layer before routing.
- H20. As an operator, I want a migration tool that is **resumable, idempotent and verifiable**, with a dry run, so that an interrupted or repeated run never corrupts data.
- H21. As an operator, I want to pre-copy days before the window and copy only the changes during it, so that the window stays short.
- H22. As an operator, I want a verification report (counts, checksums, sample deep compares) before reopening writes, so that I can decide go or no-go on evidence.
- H23. As an operator, I want to roll back inside the window by switching configuration, with the legacy stores untouched, so that a failed cutover costs only time.
- H24. As an operator, I want a full rehearsal on a production-sized staging copy, with a measured window length, so that the real cutover has no surprises.
- H25. As an operator, I want documented and tested backup and restore for the new stores, so that we never depend on the legacy stores as a backup.
- H26. As the SurveyJS team, I want a complete list of the legacy Azure resources and site-database tables that the cutover leaves unused, so that I can remove them myself when I decide to.

### SurveyJS team: architecture

- H27. As the site team, I want the app to need nothing from the site's user tables after the cutover, only sign-in, the account-deleted webhook and a licence endpoint, so that we can change the site's database freely.
- H28. As the site team, I want to remove all My Surveys code from surveyjs.io and `api.surveyjs.io` after the cutover, so that we maintain only one implementation.
- H29. As a maintainer of this repository, I want the Azure legacy provider, the replica and the legacy-format rules removed after stabilisation, so that the code no longer carries the old formats.
- H30. As a back-end porter, I want the compatibility layer to stay outside the contract, so that a port does not have to implement legacy endpoints.

## Implementation Decisions

### Target stores (H16)

- **The hosting provider is most likely Hetzner**, in a European or a US region. The region is chosen in Step 1.
- **The track needs one SQL provider and one file store.** The shortlist and the choice are an ADR in Step 1 of the plan. The criteria are:
  - the data location and a GDPR data-processing agreement. For a US region the ADR also records the legal basis for transferring EU personal data;
  - backups with point-in-time restore;
  - cost, including egress;
  - closeness to where the app is hosted;
  - whether the provider already exists in this repository.
- **The recommendation is PostgreSQL** with **S3-compatible object storage** (Hetzner Object Storage where the region offers it). The self-hosted track builds both, under D15 and [spec-self-hosted.md](spec-self-hosted.md). If another database wins, this track adds that provider and it must pass the same provider suite.
- **If no managed PostgreSQL is available** next to the app (Step 1 checks Hetzner's current offer), we run PostgreSQL ourselves. Point-in-time restore then comes from continuous WAL archiving to the object storage (for example with pgBackRest or WAL-G), and the restore is tested.
- **Where the app runs after 1.3** is decided together with the stores, because the database should be close to the app. The production image from plan Step 14 runs unchanged; only configuration differs.

### Data model and mapping

- **One logical schema.** The schema is the self-hosted track's (`docs/architecture/data-model.md`). Hosted-only data is added as optional tables, which the self-hosted image leaves empty:
  - `legacy_files`: the legacy file name to file ID, for editor images and `dxsfile:`/`dxsimage:` uploads;
  - `legacy_access_keys`: a hash of the key, the user ID and a revoked flag;
  - `survey_events`: the legacy event log `surveys`. It is shaped as a general audit table, which the P1 audit log can reuse later;
  - `deleted_responses`: the legacy `postdelete{postId}` copies. They are purged **30 days after the cutover**, and the app never makes new copies (decided 2026-10-19).
- **IDs are kept.** That covers survey, Post, Result and response IDs, plus user IDs as references. Project and member IDs are kept too. Timestamps are kept exactly: `createdAt`, `updatedAt`, `submittedAt`, and history entry times.
- **The mapping document** (`docs/architecture/hosted-migration-mapping.md`, plan Step 1) maps every legacy entity in `legacy-data-layout.md` §3 to its target. It also names what is not migrated:
  - temporary files;
  - licence data, which stays on the site;
  - `surveypublishedjson` snapshots, unless `publishid` is set on a survey, in which case they are migrated as history entries.
- **Legacy data quirks** (null rows, boolean strings, BOM-prefixed JSON) are normalised on export. Each rule is listed in the mapping document.

### Users (H27)

The rules are [ADR 0022](docs/adr/0022-users-from-sign-in.md), which supersedes the user API of plan Step 12.

- **Until the cutover nothing changes:** `USER_DIRECTORY=surveyjs-sql` reads the site's `Users` table and licences.
- **After it, users come from sign-in.** A new user directory keeps app-owned profiles, written from UserInfo at every sign-in (id, email, display name, `blocked`). They serve history author names and adding members by email.
- **The migration seeds a profile** for every user the copied data names (survey owners, members, history authors), from the site's `Users` table.
- **Adding a member whose email has no profile** creates a pending invitation, which becomes a membership when someone signs in with that email. Admins can list and cancel invitations.
- **Blocked users** get no session, from UserInfo's `blocked` claim. The sign-in server re-reads the account on every authorization (built in the site's sign-in server, 2026-10-28).
- **Licence notices** come from a surveyjs.io site endpoint for the signed-in user, asked by the web app's shell, in the hosted edition only.
- **Deleted accounts:** the account-deleted webhook only. Reconciliation is not available with profiles, because "no profile" does not mean "deleted".
- `ProjectStore` and the other stores move with the data. Profiles and invitations are app-owned tables in the target.

### API tokens and CORS (H12–H14)

- The contract's `bearerAuth` loses its `x-phase: P1` marker.
- **A token belongs to a scope:** a user's Personal space or one project.
  - In a project scope it can do what an admin of that project can do. Managing members and deleting the project are not included.
  - In a Personal scope it can do what the user can do on their personal surveys.
- **Who manages tokens:** any user manages their Personal tokens; project admins manage that project's tokens.
- **Token storage:**
  - A token is shown once. Only a hash is stored, with a name, created and last-used time, and a scope.
  - New contract operations list, create and revoke tokens. Their exact paths and names are in Step 3 of the plan.
- **Tokens before the cutover.** Tokens ship before the cutover, so integrators can start migrating early. On the Azure legacy provider they live in a new app-owned table that legacy code never reads. The migration copies them.
- **CORS:**
  - `/public/*` answers any origin, without credentials;
  - bearer-authenticated requests answer any origin, without credentials;
  - cookie-authenticated requests stay same-origin only.

  An `OPTIONS` preflight is answered for both.

- **UI:** an "API tokens" page, shown in the surveyjs.io shell only. It sits next to the Embed tab and the API docs (D21).

### Partial responses (H6, H8)

- The contract's `partial` and `lastPageIndex` (`x-phase: P1`) are implemented. A submission with `partial: true` is stored as a partial response, and the completion state becomes `partial`. This matches the legacy `ispartialcompleted` behaviour (`legacy-data-layout.md` §3.6–3.7).
- **Results:**
  - lists and exports include partial responses, marked `partial: true`, as the legacy results page did;
  - statistics count completed responses only, unless the Dashboard asks otherwise.

  The plan step records any difference from the legacy readers in its ADR.

### Compatibility layer (H5, H7–H10, H15, H30)

- **A server module outside the contract** (`server/src/legacy-api/`). It is mounted only when `LEGACY_API=on` and served on the `api.surveyjs.io` host name. It is documented in `docs/api/legacy-compat.md` and is not part of the OpenAPI document or the conformance suite. A port of the back-end does not implement it.
- **It is built on the provider interfaces**, so it runs on the Azure legacy provider before the cutover and on the SQL provider after it.
- **Scope ("thin")** is set by the traffic measurement in Step 1:
  - **Always kept:**
    - the public endpoints under `public/Survey` and `public/v1/Survey`: `getSurvey`, `getSurveyAndIsCompleted`, `post`, `post/page-number`, `upload`, `getResult`, `isCompleted`, `image` and `file`;
    - the unauthenticated private endpoints `private/Surveys/files?name=` (editor images) and `getSurveyPublicResults/{id}`.
  - **Kept if measured traffic shows use:** the access-key endpoints, such as `getSurveyResults`, `changeJson`, `publish`, `exportSurveyResults` and the create/list routes.
  - **Everything else** answers `410 Gone` with a JSON body naming the migration guide.
- **Response shapes match the legacy service byte for byte where clients parse them:**
  - property names and casing (`{ Data, ResultCount }`, `HappendAt`);
  - `isCompleted` values `no` / `partial` / `completed`;
  - status codes, for example `400` on an empty survey.

  Golden responses recorded from the real service are the tests.

- **Legacy behaviours that are deliberately not kept** are listed in the ADR. One example: the legacy `getSurvey` returns unpublished surveys. Each kept or dropped quirk is an explicit decision.
- **Access keys:**
  - today users see their key on the surveyjs.io manage account page;
  - before the cutover they are read from the site database through the Azure legacy provider;
  - at the cutover they are imported, hashed, into `legacy_access_keys`. The site removes the key from its manage account page in the same release;
  - no new keys are issued. The API tokens page shows a user's legacy key as "legacy access key, created …", with **Revoke**;
  - the value cannot be shown after the cutover. The announcement tells integrators to copy their key from the manage account page beforehand if they need it.
- **The new API's rules still apply:** rate limits on the public paths, idempotent submission, the respondent-file and response size limits, and IP capture only when the survey's setting is on.

### Routing `api.surveyjs.io` (H18, H19)

- **The `api.surveyjs.io` host serves only My Surveys** (confirmed 2026-10-19), so the app takes over the whole host name.
- **With a reverse proxy in front of the host,** paths move in groups:
  1. public reads;
  2. public writes;
  3. the private endpoints.

  Each group is reversible by restoring the rule.

- **Without a proxy,** the whole host switches at once through DNS. The DNS time-to-live is lowered days before, so switching back is fast.

- **A replay tool** (`pnpm legacy:replay`) takes a sample of real requests from the access logs. It sends each read request to both the old service and the app and reports differences in the JSON. Write requests are replayed only against a staging copy.

### Migration tool (H20–H23)

- **Commands:** `pnpm migrate:hosted plan | copy | delta | reconcile | verify`. Each runs on a configured source (the Azure legacy provider and the file shares) and target (the chosen SQL provider and file store).
- **Neutral record stream.** An exporter reads the legacy stores into a stream of typed NDJSON records plus file blobs. An importer writes them with **idempotent upserts keyed by ID**. The importer is a separate port, not the request-path interfaces, so IDs, timestamps and history are kept exactly. The same format can later serve provider-to-provider moves (idea §6.2 A5).
- **Checkpoints** per entity and per survey, so a run can be resumed after a crash. A repeated run changes nothing.
- **Pre-copy and delta:**
  - Pre-copy copies everything and records high-water marks. These are the SQL `timestamp` columns, blob `Last-Modified`, and the Azure Table `Timestamp` / `happendat`.
  - Delta copies only rows and blobs changed since then.
  - `reconcile` compares key sets (surveys, projects, members, response IDs per survey, files) and removes from the target what was deleted in the source since the pre-copy.
- **Verify** writes a report:
  - counts per entity and per survey;
  - checksums of definitions, themes and history snapshots;
  - for a random sample of surveys, the same reads through both providers' interfaces (list, definition, results pages, statistics, layouts, members), compared deeply.

  Any difference is a no-go.

- **Dry run.** `copy` into a scratch database reports volumes and duration without touching the real target.

### Cutover (H3, H4, H23, H24, H26)

1. **Announce** the window to users and integrators **one to two weeks** before.
2. **Pre-copy** a few days before, then run `verify` against the live data. Differences are expected only from recent changes.
3. **In the window:**
   - Turn on `READ_ONLY=true` (plan Step 14) for the app and the compatibility layer.
     - Respondents see the "temporarily unavailable" page.
     - Legacy `post` calls get a legacy-shaped error.
     - Signed-in users see the maintenance notice (H3, H4).
   - Run `delta`, `reconcile` and `verify`.
   - Switch the storage configuration and turn off `READ_ONLY`.
4. **Rollback inside the window:** switch the configuration back. The legacy stores were only read.

   After writes reopen, there is **no reverse sync**. Problems are fixed forward. The legacy stores are no longer written, and they stay as they are until the SurveyJS team removes them.
   - The runbook lists every resource to remove (`docs/operations/legacy-azure-resources.md`):
     - the storage accounts, tables, blob containers and file shares;
     - the My Surveys tables in the site database.
   - Removing them is the SurveyJS team's decision and action (decided 2026-10-19).

5. **Window length:** the rehearsal measures it. The target is under one hour.

### Retirement (H28, H29)

- **The site team:**
  - removes the My Surveys code from surveyjs.io;
  - removes the `api.surveyjs.io` My Surveys controllers, which the routing rule already bypasses;
  - removes the legacy Azure resources and site tables listed by the runbook, when it chooses;
  - removes the access key from the manage account page at the cutover.
- **This repository**, after a stabilisation period of one month without rollback-class incidents:
  - removes the Azure legacy provider;
  - removes the Azurite and SQL Server replica, the golden fixtures and the inspector;
  - removes the legacy-format rules and the legacy-format tests.

  It keeps `legacy-data-layout.md` and the mapping document as history, without secrets (D18). The development configuration (mode 4) becomes memory, SQLite and PostgreSQL.

### Data protection

- **Data location:** the region chosen in Step 1 (Hetzner, Europe or USA), recorded with its GDPR basis.
- **Copies:**
  - the legacy stores remain until the SurveyJS team removes them; the resource list makes that complete;
  - `deleted_responses` is purged 30 days after the cutover;
  - backups of the new stores age out within 30 days (idea §8).
- **Account deletion** keeps working through the webhook and the reconciliation job (plan Step 12) on the new stores.

## Testing Decisions

The rules of `spec.md` › Testing Decisions apply: test through public seams, and never assert on internals. This track adds:

1. **The provider suite on the chosen SQL provider and file store,** including the hosted-only tables. The suite itself comes from the self-hosted track.
2. **The conformance suite** on the chosen provider, including the new token and partial-response operations, with tokens checked on every provider.
3. **A compatibility suite** (`legacy-compat-tests`, HTTP only, base URL configurable). It covers every kept legacy endpoint with **golden responses** recorded from the real `api.surveyjs.io` against known fixtures, plus a `410` for each retired one. It runs on memory, Azure legacy (Azurite) and the chosen SQL provider.
4. **Migration tests,** on Azurite and the SQL Server replica as the source and a containerised target:
   - fixtures copied, then `verify` passes;
   - a second run changes nothing;
   - a run killed halfway resumes;
   - changes after the pre-copy are carried by `delta`;
   - deletions are carried by `reconcile`;
   - the provider-level reads match between source and target.
5. **Replay** against staging, plus a **rehearsal** on a production-sized copy. Both are manual, with documented results.
6. **Playwright:**
   - the maintenance states (read-only notice, temporarily-unavailable run page);
   - the API tokens page;
   - after a migration of the fixtures, the Phase 1 user-story suites pass on the target provider.

## Out of Scope

- Changes to the surveyjs.io user model, sign-in (`auth.surveyjs.io`) or licences. Users stay where they are.
- Re-implementing `api.surveyjs.io` endpoints with no measured use.
- Reverse synchronisation after the cutover, and zero-downtime migration.
- The self-hosted track: the local accounts, Docker image, sandbox and OAuth2 sign-in.
- P1 product features other than API tokens, CORS and partial responses: versioning, distribution controls, analytics, roles, audit log UI, notifications, webhooks to customers and templates.

## Decisions on the open questions (2026-10-19)

1. **`api.surveyjs.io` serves only My Surveys.** The app takes over the whole host (see Routing).
2. **Access keys** are shown today on the surveyjs.io manage account page. After the cutover the app keeps hashes, the site stops showing keys, and the API tokens page offers **Revoke** only (see Compatibility layer).
3. **Legacy deleted-result copies** are migrated and purged 30 days after the cutover. No new copies are made.
4. **Hosting:** most likely Hetzner, in Europe or the USA. Step 1 chooses the region and the stores.
5. **Legacy resources** are not deleted by this project. The runbook lists them, and the SurveyJS team removes them.
6. **Notice:** one to two weeks. The window target stays under one hour, measured by the rehearsal.

## Further Notes

**Dependencies on the surveyjs.io side**

- the account-deleted webhook, built to `docs/integrations/surveyjs-user-api.md` (plan Step 12), and the licence endpoint ([ADR 0022](docs/adr/0022-users-from-sign-in.md));
- 30 days of `api.surveyjs.io` access logs, or per-endpoint statistics;
- the reverse-proxy rule, or the DNS change, for `api.surveyjs.io`;
- removing the access key from the manage account page at the cutover;
- read access to the Azure file shares `surveyfiles` and `files`, which Azurite does not emulate (ADR 0006);
- a production-sized staging copy for the rehearsal;
- removing the legacy code after the cutover.

**Shared with the self-hosted track**

- From the self-hosted track: the logical schema, the SQL providers and the S3-compatible file store.
- From this track: API tokens, CORS and partial responses.

A track that needs a shared piece before the other track delivers it waits, or builds it itself after agreeing with the other track. [plan-hosted.md](plan-hosted.md) lists the cross-track dependencies.
