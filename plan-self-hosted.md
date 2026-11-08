# Implementation plan: self-hosted track (deployment modes 2a, 2b and 3)

Status: draft · 2026-10-19
Implements: [spec-self-hosted.md](spec-self-hosted.md), within [idea.md](idea.md) (§3.0, D15–D22) and the contract [contract/openapi.yaml](contract/openapi.yaml).
Starts after: Phase 1 ([plan.md](plan.md) Steps 1–14, done 2026-10-23). It runs at the same time as [plan-hosted.md](plan-hosted.md).

## How to use this plan

- Everything in [plan.md › How to use this plan](plan.md#how-to-use-this-plan) applies: one prompt per step, the steps in order, one branch and one PR per step, and the same reference notation.
- **Branches** are named `self-hosted/NN-short-name`. Demo scripts go in `docs/demo/self-hosted-NN.md`.
- **Additional reference notation:**
  - `SS › Local accounts` means spec-self-hosted.md, that heading;
  - `S12` is a user story in spec-self-hosted.md;
  - `HM Step 3` is a step of plan-hosted.md.

## Rules that apply to every step

[plan.md › Rules that apply to every step](plan.md#rules-that-apply-to-every-step) applies, with these changes:

1. **Development modes.**
   - "Both demo modes" means every development mode the step touches: memory, SQLite and PostgreSQL from Step 1, S3 (MinIO) from Step 3, and the sandbox from Step 9.
   - Azurite mode keeps working until the hosted track removes it (HM Step 12). This track never changes the Azure legacy provider except to keep its suites green.
2. **Providers under test.**
   - The provider and conformance suites run on memory, SQLite and PostgreSQL, plus Azure legacy while it exists.
   - The file-store suite runs on memory, local disk, Azure legacy and MinIO.
3. **The shared seed** (plan.md › Local demo modes › Seed data) is the single seed for every mode. The sandbox uses a small, tagged subset of it that fits in localStorage. A step that adds a feature with data adds that data to the seed, and tags it for the sandbox when it is small.
4. **Contract edits** are coordinated with the hosted track: small PRs, rebased often. A contract change never mixes both tracks' operations.
5. **Shell features.**
   - Any new UI is checked in both the `self-hosted` and `surveyjs-site` shells.
   - Features that D21 limits to the surveyjs-site shell are checked hidden elsewhere: the Embed tab, the API docs, the API tokens page.

## Cross-track dependencies

| This plan                              | Gives or needs                                                                                | Other side                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Steps 1–3 (SQL providers, file stores) | **Gives** the logical schema, the PostgreSQL provider and the S3 file store                   | HM Step 8 needs them if the hosted choice is PostgreSQL with S3-compatible storage |
| Step 2                                 | Tokens and partial responses on SQL                                                           | **The later of the two adds the SQL side** (HM Steps 3 and 4)                      |
| Step 4                                 | **Needs** the `UserDirectory` seam and the start-up rules for sign-in methods and directories | plan.md Step 12                                                                    |
| Step 7                                 | **Needs** the production image                                                                | plan.md Step 14                                                                    |

## Progress

| Step | Name                                                          | Status |
| ---- | ------------------------------------------------------------- | ------ |
| 1    | The logical data model, migrations and the SQL survey store   | ☐      |
| 2    | SQL providers: results, views, projects and erasure           | ☐      |
| 3    | File storage: local disk and S3-compatible                    | ☐      |
| 4    | Password sign-in and local accounts                           | ☐      |
| 5    | The instance admin                                            | ☐      |
| 6    | The "Powered by SurveyJS" shell, branding and the licence key | ☐      |
| 7    | The Docker image                                              | ☐      |
| 8    | OAuth2 sign-in and pending invitations                        | ☐      |
| 9    | The sandbox mock back-end                                     | ☐      |
| 10   | Publishing the sandbox                                        | ☐      |
| 11   | Developer documentation and open-source readiness             | ☐      |

**Step 8 note (D6, [ADR 0029](docs/adr/0029-linking-identities-by-verified-email.md)):** the tests use one stub on `node:http` for all four providers (`pnpm oauth-stub`) instead of mock-oauth2-server and Compose stubs. It needs no Docker. The Azurite mode keeps its mock-oauth2-server.

**Ordering:**

- Steps 1–3 come first, because the hosted track waits for them.
- Step 9 depends only on the front-end and the contract. It can run in parallel with Steps 4–8 if a second developer is available.
- In that case Step 9 is rebased after Steps 4–6 to pick up their screens.

---

## Step 1: The logical data model, migrations and the SQL survey store

**Goal:**

- a documented logical schema;
- a migrator for SQLite and PostgreSQL;
- SQLite and PostgreSQL development modes;
- the first store on SQL (surveys, definitions, themes, history) passing its part of the provider suite.

**References**

- SS › SQL providers; › Development modes; idea §7.5, D15; spec.md › Back-end modules 4 (provider interfaces).
- S2, S5, S6, S42, S43.

**Build**

- **`docs/architecture/data-model.md`:**
  - every table, column, key and index for the whole logical model, covering users and identities, projects, members, invitations, surveys, definitions, themes, history, responses, completion, files, views, tokens and survey events;
  - how each table maps to the provider interfaces;
  - the hosted-only tables, listed as optional.
- **The migrator:**
  - plain-SQL files per dialect (`server/sql/{sqlite,postgres}/NNNN-name.sql`);
  - a `schema_migrations` table and a lock;
  - runs at start-up;
  - refuses a database newer than the code (S6);
  - `pnpm db:migrate` and `pnpm db:status`.
- **Kysely** with the two dialects. **The SQLite driver** is chosen in an ADR: `node:sqlite` if stable on the pinned LTS, else better-sqlite3.
- **The SQL SurveyStore:** survey records, definitions and themes with version tokens, and history with snapshots.
- **Configuration:**
  - `STORAGE_PROVIDER=sqlite|postgres` and `DATABASE_URL`;
  - start-up rules: the SQL providers need a directory other than `surveyjs-sql`.
- **Development modes:**
  - `pnpm dev:sqlite`, with a file under `.data/`;
  - `pnpm dev:postgres`, with PostgreSQL in Docker Compose;
  - both load the shared seed with `pnpm seed`.
- **Until Step 2:** the other stores fall back to memory in the SQL modes, and a start-up warning says so. That keeps the modes usable while Step 2 lands.

**Tests**

- **Back-end unit:** the migrator (order, lock, refusing newer versions); the dialect helpers for JSON columns.
- **Back-end e2e:** the provider suite's SurveyStore section on SQLite and PostgreSQL; conformance for survey list, create, update, clone, definition, theme and history on both.
- **Front-end e2e:** the survey list and editor user stories in `dev:sqlite`.

**Documentation:** `data-model.md`, the SQLite driver ADR and an ADR for "Kysely and plain-SQL migrations", `docs/development.md` (the new modes), `docs/testing.md` (provider lists), `docs/demo/self-hosted-01.md`.

**Demo checklist**

1. `pnpm dev:sqlite`: sign in as the owner (dev sign-in), create and edit a survey, restart, and it is still there.
2. `pnpm dev:postgres`: the same.
3. `pnpm db:status` shows the applied migrations. Starting an older build on that database is refused with a clear message.

---

## Step 2: SQL providers: results, views, projects and erasure

**Goal:** every store has a SQL implementation, and the full provider and conformance suites pass on SQLite and PostgreSQL.

**References**

- SS › SQL providers; spec.md › Back-end modules 3–4; plan.md Step 12 (`ProjectStore`, erasure).
- S2, S22.

**Build**

- **ResultStore on SQL:**
  - append with an idempotency key;
  - paging by an index on (submitted, ID), so result lists never scan;
  - statistics, the completion state and delete-all.
- **ViewStore** and the private-question list.
- **ProjectStore on SQL:**
  - projects, members and roles;
  - the last-admin rule and project deletion moving surveys, both inside transactions.
- **Erasure** (plan.md Step 12) on SQL.
- **Tokens and partial responses on SQL,** if HM Steps 3 and 4 merged first.
- **The fallback warning from Step 1** is removed.

**Tests**

- **Back-end unit:** cursor encoding over the SQL keys.
- **Back-end e2e:** the full provider suite and the full conformance suite on SQLite and PostgreSQL, including 1,500-response paging, last-admin, deletion moves and erasure.
- **Front-end e2e:** the full Phase 1 user-story suites in `dev:postgres`.

**Documentation:** `docs/architecture.md` (the SQL providers), `data-model.md` (final for these tables), `docs/demo/self-hosted-02.md`.

**Demo checklist**

1. In `dev:postgres`, run the Phase 1 demos for Steps 4–11 (list, actions, editor, run, results, projects). All of them work.
2. The 1,500-response survey pages through results with no visible delay.

---

## Step 3: File storage: local disk and S3-compatible

**Goal:** files live on the data volume or in any S3-compatible store.

**References**

- SS › File storage; spec.md › Back-end modules 3 (_Files_); ADR 0013.
- S3, S43.

**Build**

- **`FILE_STORE=local`:** files under `/data/files`, by survey and file ID, with atomic writes.
- **`FILE_STORE=s3`:**
  - the AWS SDK v3 S3 client;
  - endpoint, region, bucket, path-style and credentials from configuration;
  - works with AWS S3, MinIO, R2 and B2.
- **The Phase 1 rules,** unchanged: usage per survey, copy on clone, delete with the survey and the results.
- **`pnpm dev:s3`:** MinIO in Docker Compose.

**Tests**

- **Back-end unit:** path building for local storage; the S3 key layout.
- **Back-end e2e:** the provider suite's file-store section on local storage and MinIO; conformance for uploads, quotas and serving in `dev:s3`.
- **Front-end e2e:** editor image upload and respondent file upload in `dev:s3`.

**Documentation:** `docs/architecture.md` (file stores), `docs/development.md` (`dev:s3`), `docs/demo/self-hosted-03.md`.

**Demo checklist**

1. `pnpm dev:s3`: upload an editor image. It appears in the MinIO console and in the survey.
2. Delete the survey. The objects are gone from MinIO.

---

## Step 4: Password sign-in and local accounts

**Goal:** users sign in with email and password against the local user directory, and sessions can be revoked. The first admin is created safely.

**References**

- SS › Local accounts and the instance admin; contract `passwordLogin` (`x-phase: P1`); plan.md Step 12 (the seam).
- S4, S14 (revocation), S20, S21.

**Build**

- **The local `UserDirectory`** on SQL and memory: email, name, instance role, status, argon2id hash, must-change flag, session epoch, last sign-in.
- **`passwordLogin`** loses `x-phase: P1`.
  - **Lockout:** back-off per account after 5 failures, plus the Phase 1 rate limit per IP.
  - **Answers** don't say whether an email exists.
  - **Change own password:** a new operation.
  - **Password rules:** a minimum length of 12 and a bundled list of common passwords.
- **Session epoch:**
  - stored in the sealed cookie;
  - checked on each request through the directory, with a cache of at most 60 seconds;
  - incremented on a password change, a reset or disabling the user.
- **The first admin:**
  - on an empty user table, `ADMIN_EMAIL` and `ADMIN_PASSWORD` create it with must-change set;
  - without them, a one-time setup link is written to the log.
- **UI:**
  - a sign-in page with email and password, plus provider buttons when configured;
  - "change password", including the forced change after the first sign-in.

  Both are built in the `self-hosted` and plain shells.

- **Configuration:** `AUTH_METHODS=password` with `USER_DIRECTORY=local`, under the Step 12 start-up rules.

**Tests**

- **Back-end unit:** hashing and verification; the lockout back-off; epoch comparison; bootstrap rules.
- **Back-end e2e:**
  - conformance:
    - sign in;
    - a wrong password gets `401`, the same as an unknown email;
    - lockout;
    - after a password change, the old session gets `401` within the cache window;
    - the forced change;
    - bootstrap on an empty database;
  - provider suite: the local `UserDirectory`.
- **Front-end unit:** the sign-in form states; the forced-change redirect.
- **Front-end e2e:** first sign-in as the bootstrap admin, the forced change, sign out, sign in again; lockout message.

**Documentation:**

- user guide "Signing in with a password";
- API guide "Password sign-in";
- `docs/architecture.md`: local accounts and the session epoch;
- an ADR for "Revoking stateless sessions with an epoch";
- `docs/demo/self-hosted-04.md`.

**Demo checklist**

1. Start `dev:sqlite` with `AUTH_METHODS=password`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Sign in, and you must change the password.
2. Sign in from two browsers and change the password in one. The other is signed out within a minute.
3. Try a wrong password six times. The lockout message appears.

---

## Step 5: The instance admin

**Goal:** an instance admin manages users and invitations without email, and can manage every project.

**References**

- SS › Local accounts and the instance admin; plan.md Step 12 (erasure); spec.md US 59–69 (project rules).
- S12–S19.

**Build**

- **Contract:** `/admin/users` operations:
  - list, with status, role and last sign-in;
  - create, which returns a set-password link;
  - update the role or status;
  - delete;
  - create a reset link.

  Plus "set password with a link", and `CurrentUser.instanceRole`.

- **Set-password links:**
  - 128 random bits, with only the hash stored;
  - single use, expiring after 7 days;
  - shown once.
- **Rules:**
  - the last instance admin cannot be demoted, disabled or deleted;
  - deleting a user runs the erasure service;
  - disabling a user increments their epoch.
- **Project oversight:** an instance admin sees every project on `/projects` and may use every admin action there.
- **UI:**
  - a **Users** page (`/admin/users`), reached from the account menu for instance admins: a table, a create dialog that shows the link with a copy button, row actions with confirmations;
  - a **Set your password** page for the links.
- **Seed:** an instance admin is added to the shared seed.

**Tests**

- **Back-end unit:** link generation and expiry; the last-instance-admin rule.
- **Back-end e2e:**
  - conformance:
    - each admin operation and error;
    - a non-admin gets `403`;
    - a used or expired link gets `410`;
    - erasure on delete;
    - the instance admin managing a project they don't belong to;
  - provider suite: invitations and links.
- **Front-end unit:** the Users page's visibility rules; the one-time link display.
- **Front-end e2e:**
  - create a user, open the link in another context and set a password, then sign in;
  - reset that user's password;
  - disable them and see the sign-out;
  - re-enable them;
  - delete them, and their personal surveys are gone.

**Documentation:** user guide "Managing users" (instance admins), API reference examples, `docs/demo/self-hosted-05.md`.

**Demo checklist**

1. As the instance admin, create a user, copy the link, open it in a private window, set a password, and land signed in.
2. Reset that user's password. The old session ends, and the new link works.
3. Try to demote yourself as the only instance admin. It is refused.
4. Open a project you are not a member of, and rename it.

---

## Step 6: The "Powered by SurveyJS" shell, branding and the licence key

**Goal:** the self-hosted look, with instance branding set by configuration, the licence-bound branding, and the surveyjs.io-only features hidden.

**Inputs needed:** the licence key discussion (spec-self-hosted open question 1), held before this step starts, and a test licence key of the agreed type.

**References**

- SS › Shell, branding and licence; idea D14, D20, D21; spec.md › Front-end modules 1 (the shell interface).
- S7, S23–S26.

**Build**

- **The `self-hosted` shell:**
  - a neutral header with `BRAND_NAME` and `BRAND_LOGO_URL`, the account menu, and a link to Users for instance admins;
  - `BRAND_ACCENT_COLOR` as a CSS custom property;
  - a footer with "Powered by SurveyJS" plus the Terms and Privacy links.
- **Branding on every page:** the run page footer, the editor, results, sign-in and set-password pages. The public results page also follows the shell.
- **`/config.branding`:**
  - `required`, or `removable` with a paid key;
  - `BRANDING=off` takes effect only when it is `removable`.
- **The licence key** is applied to Creator, Dashboard and PDF exactly as now. The branding-bound check itself belongs to the SurveyJS libraries; this step wires and tests the app's side with the test key.
- **Feature gating:**
  - outside `surveyjs-site`, the Embed tab, `/api/docs` and the API tokens page are hidden, and `/api/docs` answers `404`;
  - `/config` lists the enabled features.

**Tests**

- **Back-end unit:** the configuration rules (branding off without a removable key fails start-up); feature flags by shell.
- **Back-end e2e:** conformance for `/config` in each shell; `/api/docs` gated.
- **Front-end unit:** the shell's header and footer from configuration; feature gating.
- **Front-end e2e:**
  - the branding on run, editor, results and sign-in;
  - the Embed tab and API tokens page hidden in `self-hosted` and shown in `surveyjs-site`;
  - visual snapshots of the shell.

**Documentation:** `docs/customizing/branding.md` (configuration and licence), user guide note, an ADR for "Branding and the licence key", `docs/demo/self-hosted-06.md`.

**Demo checklist**

1. Start with `APP_SHELL=self-hosted`, a name, a logo and a colour. Every page shows them, plus "Powered by SurveyJS".
2. The editor has no Embed tab, and `/api/docs` is `404`. Switch to `surveyjs-site`, and both are back.
3. `BRANDING=off` with the test branding-bound key: start-up refuses with a clear message.

---

## Step 7: The Docker image

**Goal:** the official image of mode 2b: one command to run, safe upgrades, backups, no outbound calls, and a release pipeline.

**Inputs needed:** push access to `surveyjs/surveyjs-studio` on Docker Hub and `ghcr.io/surveyjs/surveyjs-studio`; the published licence key once open question 1 is resolved. Until then, the pipeline publishes to a private test repository only.

**References**

- SS › Docker image; plan.md Step 14 (the production image).
- S1, S5, S8–S11, S22, S45.

**Build**

- **Self-hosted defaults** on the Step 14 image: `APP_SHELL=self-hosted`, `STORAGE_PROVIDER=sqlite`, `FILE_STORE=local`, `AUTH_METHODS=password`, `USER_DIRECTORY=local`, port `8080` (the Step 14 image sets `PORT=3000` today), volume `/data`, non-root.
- **Images for `linux/amd64` and `linux/arm64`.**
- **Start-up:** migrations under a lock, the first-admin bootstrap, `/healthz` and `/readyz`, `TRUSTED_PROXIES`, secure cookies on HTTPS.
- **`surveyjs-studio backup` and `surveyjs-studio restore`** inside the image, for SQLite and local files. The documentation covers `pg_dump` and S3 versioning.
- **No outbound calls:** fonts and assets bundled, and the absence of other calls checked.
- **Compose examples:** `compose.sqlite.yml`, `compose.postgres.yml` (PostgreSQL and MinIO).
- **Release pipeline:**
  - on a `v*` tag: build, run the image checks, scan, generate an SBOM;
  - push `vX.Y.Z`, `vX.Y` and `latest`.

**Tests**

- **Image checks in CI:**
  - an empty volume, then bootstrap, then the user-story suite;
  - an upgrade from the previous release on a seeded volume;
  - backup, wipe, restore, and the data is back;
  - the suite with outbound network blocked;
  - non-root;
  - health endpoints;
  - the PostgreSQL Compose example starts.
- **Front-end e2e:** the Phase 1 user-story suites and Steps 4–6 against the image.

**Documentation:** `docs/self-hosting.md` (quick start, configuration reference for mode 2b, reverse proxy, PostgreSQL, S3, backups, upgrades), README (quick start), `docs/operations.md` (release process), `docs/demo/self-hosted-07.md`.

**Demo checklist**

1. `docker run -p 8080:8080 -v surveyjs-studio:/data -e ADMIN_EMAIL=… -e ADMIN_PASSWORD=… <image>`. Sign in, change the password, create and publish a survey, and submit a response.
2. Stop it, run a newer build on the same volume, and the data is there.
3. `docker compose -f compose.postgres.yml up`. The same flow works on PostgreSQL and MinIO.
4. Back up, delete the volume, restore, and the survey and response are back.

---

## Step 8: OAuth2 sign-in and pending invitations

**Goal:** mode 3's external sign-in (Google, GitHub, Facebook, surveyjs.io) works with local accounts, safely, and project admins can invite people who have not signed in yet.

**References**

- SS › OAuth2 sign-in; idea D17; plan.md Step 12 (the start-up rules for sign-in methods and directories).
- S34–S37.

**Build**

- **Identity providers:** Google (OIDC), GitHub (OAuth2, verified primary email from the API), Facebook (OAuth2, Graph API email) and surveyjs.io (the Phase 1 provider), each with a client ID and secret. `login` gets a `provider` parameter.
- **An `identities` table:** (provider, subject) → user. An email links to an existing user only when the provider says it is verified.
- **Who may join:** a first sign-in creates a user with a pending invitation, an allowed domain (`SIGN_UP_DOMAINS`), or when `OPEN_SIGN_UP=on`. That setting is off by default. Otherwise a refusal page is shown.
- **Pending memberships:**
  - `addMember` with an unknown email creates an invitation;
  - `Member` gets a `pending` state;
  - the invitation becomes a membership at the first sign-in with that email, by any method;
  - a pending member can be removed like any other.
- **Sign-in page:** a button per enabled provider.
- **Tests infrastructure:** `mock-oauth2-server` issuers for Google and surveyjs.io, and small stub servers for GitHub and Facebook in Docker Compose.

**Tests**

- **Back-end unit:** account linking rules (verified and unverified email); the join policy; turning invitations into memberships.
- **Back-end e2e:**
  - conformance:
    - each provider's flow against its mock;
    - refusal for an unknown, uninvited email;
    - an allowed domain creates a user;
    - with `OPEN_SIGN_UP=on`, any email creates a user, and it stays off when the setting is missing;
    - a verified email links to the password account;
    - an unverified one does not;
    - pending members.
- **Front-end unit:** the provider buttons from `/config`; the pending member row.
- **Front-end e2e:**
  - sign in with the mock GitHub, invited first;
  - a stranger refused;
  - add a pending member, they sign in, and they see the project.

**Documentation:** `docs/customizing/sign-in.md` (each provider's setup and the join policy), user guide "Projects" (pending members), an ADR for "Linking identities by verified email", `docs/demo/self-hosted-08.md`.

**Demo checklist**

1. With `AUTH_METHODS=password,github` and the stub, add `new@example.com` to a project. They sign in with GitHub and see the project.
2. An uninvited GitHub account is refused with the explanation page.
3. A password user signs in with the mock Google using the same verified email, and lands in the same account.

---

## Step 9: The sandbox mock back-end

**Goal:** the sandbox build of mode 2a: the same app with a separate in-browser mock, per-visitor data in localStorage, a small seed, listed accounts, and reset.

**References**

- SS › Sandbox; idea D21.
- S27–S33, S43, S44.

**Build**

- **`web/src/sandbox/`:**
  - Mock Service Worker handlers for every contract operation the UI uses, typed with openapi-msw;
  - a storage layer on localStorage (surveys, definitions, themes, history, responses, small files as data URLs, views, projects, members);
  - the **sandbox seed**, a small tagged subset of the shared seed, loaded on first visit;
  - **`sandbox.config.json`**, served next to `index.html` and read at start-up:
    - `maxUploadKb`, default 200: the per-file upload limit, answered with `413 quota-exceeded` as on the server;
    - `storageLimitKb`, default 4096: when sandbox data reaches it, or when localStorage refuses a write, the app shows "browser storage is full, reset to continue";
    - `seedBudgetKb`, default 1024: the largest allowed sandbox seed, checked in CI.

    A missing or invalid file falls back to the defaults, with a console warning.
- **Sign-in:**
  - `login` redirects to **Pick an account**, listing the seed users with their roles;
  - the "session" is the chosen user ID in the browser.
- **The sandbox UI:**
  - the demo banner: data stays in this browser, links to the image and to GitHub;
  - **Reset demo data**, with a confirmation;
  - the `self-hosted` shell, with the Embed tab, API docs and API tokens hidden.
- **Unsupported operations** answer `501`, and the UI hides what depends on them.
- **`pnpm build:sandbox` and `pnpm dev:sandbox`.**
- **Keeping it honest:**
  - the handlers run under `msw/node`, and a **sandbox subset** of the conformance suite runs against them;
  - Playwright tests tagged `@sandbox` run on the sandbox build.

**Tests**

- **Front-end unit:** the localStorage store (round trips, reset, the storage-full message at `storageLimitKb`); reading `sandbox.config.json` (each setting, a missing file, invalid values); the upload limit at `maxUploadKb`; the sandbox seed's size stays under `seedBudgetKb`; the account picker; the banner.
- **Sandbox conformance subset:** survey CRUD, definition and ETag, publish, run and submit, results paging, views, projects and members.
- **Front-end e2e (`@sandbox`):**
  - pick the owner, edit a survey, reload, and the change is kept;
  - switch to the member, and the shared project is visible;
  - publish, run in a new tab, submit, and the response appears in results;
  - reset, and the seed is back;
  - a second browser context does not see the first one's data.

**Documentation:** `docs/architecture.md` (the sandbox), `docs/development.md` (`dev:sandbox`, adding a handler when an operation is added), `docs/demo/self-hosted-09.md`.

**Demo checklist**

1. `pnpm dev:sandbox`: pick the owner and see the seeded surveys and their results.
2. Edit, reload, and the change is kept. Open a private window, and the change is not there.
3. Publish, run in a new tab, submit, and see the response.
4. Reset demo data. The seed is back.
5. Set `maxUploadKb` to 50 in `sandbox.config.json` and reload. Uploading a 100 KB image shows the quota message.

**Progress note (Step 9).** Built as planned, with the decisions of [ADR 0030](docs/adr/0030-the-sandbox-mock-in-the-browser.md). D9: the `@sandbox` browser tests are one dedicated spec (`e2e/tests/sandbox.spec.ts`) for now. The existing user-story specs create data through `page.request`, which bypasses the page's service worker, so running them on the sandbox build is a follow-up. The demo walk is [self-hosted-09](docs/demo/self-hosted-09.md).

---

## Step 10: Publishing the sandbox

**Goal:** the sandbox is live at `studio.demo.surveyjs.io`, deployed from CI.

**Inputs needed:** the static hosting or CDN, DNS for the subdomain, and a licence key for that domain.

**References**

- SS › Sandbox (hosting); idea D21.
- S45 (reproducible releases).

**Build**

- **A CI job:**
  - on a release tag, or by manual dispatch: `build:sandbox`, run the `@sandbox` suite against the build;
  - deploy the static files;
  - cache rules: immutable hashed assets, a short cache for `index.html` and the worker.
- **Static host headers:** CSP, HSTS and referrer policy, as in plan.md Step 12, adjusted for a static site with a service worker.
- **Licence key** for the sandbox domain, injected at build time.
- **`sandbox.config.json`** is deployed with the static files and can be changed by redeploying it alone, without a rebuild. `docs/operations.md` describes how.
- **A version mismatch guard:** a seed or schema version in localStorage. A newer release with an incompatible format offers "Reset to continue" instead of breaking.

**Tests**

- **Front-end e2e:** the `@sandbox` suite against the deployed URL after each deploy (smoke).
- **Front-end unit:** the version guard.

**Documentation:** `docs/operations.md` (sandbox deploy and rollback), `docs/demo/self-hosted-10.md`.

**Demo checklist**

1. Open `https://studio.demo.surveyjs.io`, pick an account and try the full loop.
2. Deploy a release with a changed seed version. Returning visitors are offered a reset.

---

## Step 11: Developer documentation and open-source readiness

**Goal:** mode 3 is documented, and the repository is ready to be public.

**References**

- SS › Shell, branding and licence (custom shells); › Further Notes; idea §3.3 (developer documentation), D2, D18 (documents without secrets), D20.
- S38–S42.

**Build**

- **`docs/customizing/`:**
  - `overview.md`: the deployment modes and what is configuration (free under D20) versus code (mode 3, needs licences);
  - `shells.md`: registering a shell, the shell interface, a minimal example;
  - `providers.md`: adding a database or file-store provider, with the provider suite;
  - `sign-in.md`: from Step 8;
  - `porting.md`: re-implementing the back-end against the contract with the conformance suite;
  - `licensing.md`: which components need a licence and where the key goes.
- **Repository hygiene:**
  - a secrets scan of the full history, with its result recorded;
  - `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and PR templates;
  - a third-party licence notice for the image;
  - legacy documents checked for anything that must not be public (D18).
- **README by mode:** hosted, self-hosted image, sandbox, custom development, development.

**Tests**

- **The example shell from `shells.md`** is built in CI, so the guide stays true.
- **`pnpm test:conformance --base <url>`** is documented and run against the image in CI, which proves the porting guide's command works.

**Documentation:** this step is documentation, plus `docs/demo/self-hosted-11.md`.

**Demo checklist**

1. Follow `shells.md` in a scratch branch. The example shell appears with `APP_SHELL=example`.
2. Follow `porting.md` to run the conformance suite against the running image. It passes.
3. The secrets scan report is clean, and the hygiene files are present.

---

## Consistency check against spec-self-hosted.md

**User stories:** all 45 are assigned.

| Steps | Stories                            |
| ----- | ---------------------------------- |
| 1     | S2, S5, S6, S42, S43               |
| 2     | S2, S22                            |
| 3     | S3, S43                            |
| 4     | S4, S14, S20, S21                  |
| 5     | S12–S19                            |
| 6     | S7, S23, S24, S25, S26             |
| 7     | S1, S5, S8, S9, S10, S11, S22, S45 |
| 8     | S34, S35, S36, S37                 |
| 9     | S27–S33, S43, S44                  |
| 10    | S45                                |
| 11    | S38, S39, S40, S41, S42            |

**Decisions:**

- **D15:** SQLite and PostgreSQL, Steps 1–2.
- **D17:** local accounts and the instance admin (Steps 4–5), OAuth2 (Step 8).
- **D20:** branding and the licence key (Step 6), configuration only (Steps 6, 7, 11).
- **D21:** the sandbox (Steps 9–10); the features hidden outside the surveyjs-site shell (Step 6).
- **D22:** the hosted track alongside; see Cross-track dependencies.

**Contract:**

- `passwordLogin` loses `x-phase: P1` (Step 4);
- new: change password (Step 4), the `/admin/users` operations and set-password links (Step 5), the `provider` login parameter and pending members (Step 8);
- new `/config` fields: branding and features (Step 6).

## Open points this plan depends on

- spec-self-hosted open question 1, the branding-bound licence key, is discussed before Step 6. It blocks publishing the image in Step 7, but no other development step. The other questions are decided.
- Registry accounts (Step 7), and hosting, DNS and the domain key for the sandbox (Step 10).
- plan.md Step 12 (the account seam) and Step 14 (the production image) must be merged first.
