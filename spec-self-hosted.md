# Spec: My Surveys, self-hosted track (deployment modes 2a, 2b and 3)

Status: draft for review · 2026-10-19 · open questions answered 2026-10-19 (the licence key is still to be discussed)
Inputs:

- `idea.md`: §3.0 deployment modes, §6.2 A (customer readiness), §8, and decisions D2, D14, D15, D16, D17, D20, D21 and D22.
- `spec.md`: Phase 1.
- `plan.md`: Step 12 (the account seam) and Step 14 (the production image).
- `contract/openapi.yaml`.

Plan: [plan-self-hosted.md](plan-self-hosted.md). The hosted-migration track ([spec-hosted.md](spec-hosted.md)) runs at the same time. This track builds the SQL providers and the file store that it needs.

## Problem Statement

After Phase 1 the app runs only as the hosted surveyjs.io service:

- **Storage** is the Azure legacy provider. The in-memory provider exists only for development.
- **Sign-in** goes through surveyjs.io. The dev sign-in page is refused in production.
- **The only shell** is a copy of the surveyjs.io site.

So nobody outside the SurveyJS team can use it:

- **Evaluators** must create a surveyjs.io account to try My Surveys, and their trial data lands in our production stores.
- **Teams that want their own survey service** have no image to run, no local accounts and no database of their own.
- **Customers who want to build on the code** have no documented way to:
  - plug in their own shell, database or sign-in;
  - learn what the commercial SurveyJS components need from them.

## Solution

Three deliverables, built from one codebase and one contract.

**2b: a free Docker image.**

- `docker run` gives a production-ready, single-organisation survey service. Users can keep their surveys personal or share them in projects.
- **Storage:** SQLite on a data volume by default, or PostgreSQL. Files go on the volume, or into S3-compatible storage.
- **Local accounts.** An **instance admin** creates users or invites them, and resets passwords. The admin hands over links by their own means, because there is no email.
- **The "Powered by SurveyJS" shell**, with the instance's name and logo set through configuration.
- **Licensing.** The image runs Survey Creator, Dashboard and PDF free of charge under a **branding-bound licence key**. A paid licence removes the branding (D20).
- **What can change:** configuration only, never code (D20).

**2a: a hosted sandbox at `studio.demo.surveyjs.io`.**

- The same front-end, built as a static site with a **separate mock back-end** that runs in the browser.
- Each visitor gets their own seeded copy of users, projects, surveys and results, kept in their browser. They sign in by picking a listed account, can try every feature, and can reset it all.
- The "Powered by SurveyJS" shell, with a demo banner (D21).

**3: a base for custom development.**

- Everything in 2b, plus **OAuth2 sign-in** with Google, GitHub, Facebook and surveyjs.io. It can be used alongside password accounts or instead of them.
- Documented extension points: shells, storage providers, identity providers, and porting the back-end.
- Licence requirements for the commercial components are spelled out (D2).

## User Stories

Numbered S1–S45, to keep them apart from the Phase 1 stories (US 1–81) and the hosted stories (H1–H30).

### Self-hosting admin (2b)

- S1. As a self-hosting admin, I want `docker run -p 8080:8080 -v surveyjs-studio:/data <image>` to give me a working service with a built-in database, so that trying it takes one command.
- S2. As a self-hosting admin, I want to point the service at my PostgreSQL with one connection setting, so that I can run it on my production database.
- S3. As a self-hosting admin, I want files stored on the data volume or in S3-compatible storage, so that I choose where uploads live.
- S4. As a self-hosting admin, I want the first instance admin created from configuration on an empty database, or from a one-time setup link printed in the log, and to be made to change that password at first sign-in, so that no default password survives.
- S5. As a self-hosting admin, I want to upgrade by pulling a newer image, with the database schema upgraded automatically, so that upgrades are routine.
- S6. As a self-hosting admin, I want a clear refusal when an older image starts on a newer database, so that a downgrade never damages data.
- S7. As a self-hosting admin, I want to set the instance name, logo, accent colour, public URL, Terms and Privacy links, and limits through environment variables, so that I can brand and tune the service without rebuilding.
- S8. As a self-hosting admin, I want documented, tested backup and restore for SQLite, PostgreSQL and the files, so that I can recover from a disaster.
- S9. As a self-hosting admin, I want liveness and readiness endpoints, so that Docker, Compose or Kubernetes can supervise the service.
- S10. As a self-hosting admin, I want to run the service behind my HTTPS reverse proxy, with secure cookies and the real client IP, so that it fits my infrastructure.
- S11. As a self-hosting admin, I want the service to make no outbound calls (no telemetry, no update checks, no CDN fonts), so that it runs in closed networks.

### Instance admin (2b, 3)

- S12. As an instance admin, I want to create a user by email and name and get a one-time "set your password" link to send them myself, so that I can onboard people without email.
- S13. As an instance admin, I want to reset a user's password by generating a new one-time link, which signs them out everywhere, so that a forgotten password is solved quickly.
- S14. As an instance admin, I want to disable and re-enable a user, with a disabled user losing access within a minute, so that leavers are cut off.
- S15. As an instance admin, I want to delete a user, with their personal surveys and results erased and their memberships removed as on surveyjs.io (plan Step 12), so that their data is gone.
- S16. As an instance admin, I want to make another user an instance admin, and be stopped from removing the last one, so that the instance always has an admin.
- S17. As an instance admin, I want to see every project and manage its members, so that a project whose admins left can still be managed.
- S18. As an instance admin, I want a list of users with their status (invited, active, disabled), role and last sign-in, so that I can review access.

### User (2b, 3)

- S19. As an invited user, I want to open my link, set my password and land signed in, so that joining is one step.
- S20. As a user, I want to sign in with email and password, and get a clear message after too many failed attempts, so that my account is protected from guessing.
- S21. As a user, I want to change my password, with my other sessions signed out, so that I control my account.
- S22. As a user, I want every Phase 1 feature (list, editor, run, results, history, projects) to work as on the hosted service, so that the self-hosted service is the full product.
- S23. As a respondent, I want the run page to show the instance's branding and "Powered by SurveyJS", so that I know whose survey it is.

### Licence and branding (2b, 3)

- S24. As the SurveyJS team, I want the official image to unlock Creator, Dashboard and PDF with a licence key that works only while the "Powered by SurveyJS" branding is shown, so that free use is tied to the branding (D20).
- S25. As a self-hosting admin with a paid SurveyJS licence, I want to enter my key and have the branding removed, so that I can white-label the service.
- S26. As a self-hosting admin, I want the Embed tab, the API docs and the API tokens page hidden in my instance, as they are outside the surveyjs.io shell, so that the UI shows only what applies (D21).

### Sandbox visitor (2a)

- S27. As a visitor, I want to open `studio.demo.surveyjs.io` and pick an account (owner, project admin, member, outsider) without a password, so that I'm trying the product within seconds.
- S28. As a visitor, I want a small set of seeded projects, surveys and results, so that every screen has something to show.
- S29. As a visitor, I want my changes kept in my browser across reloads, and invisible to other visitors, so that I can explore at my own pace.
- S30. As a visitor, I want to switch accounts and see shared projects from another member's side, so that I understand collaboration.
- S31. As a visitor, I want to publish a survey, run it in a new tab, submit, and see the response in the results, all in my browser, so that I see the full loop.
- S32. As a visitor, I want a "Reset demo data" button, so that I can start over.
- S33. As a visitor, I want a banner explaining that the data stays in my browser, with links to the Docker image and the source code, so that I know what this is and where to go next.

### Custom development (3)

- S34. As a customer developer, I want to turn on Google, GitHub, Facebook or surveyjs.io sign-in with a client ID and secret, alongside or instead of passwords, so that my users sign in the way they already do.
- S35. As an instance admin, I want to choose who may create an account by signing in with OAuth2 (invited emails, allowed email domains, or anyone), with anyone off by default, so that strangers cannot join unless I open the instance on purpose.
- S36. As a user with a password account, I want an OAuth2 sign-in with the same **verified** email to reach the same account, so that I don't end up with two.
- S37. As a project admin on such an instance, I want to add a member by an email that has not signed in yet, as a pending invitation that becomes a membership on their first sign-in, so that I can set up projects ahead of time.
- S38. As a customer developer, I want to add my own shell by registering a component and selecting it in configuration, so that the app fits my product.
- S39. As a customer developer, I want a guide and the provider suite to add a database provider, so that I can use the database I already run.
- S40. As a customer developer, I want a guide and the conformance suite to port the back-end, so that I can run it on .NET, PHP or another platform.
- S41. As a customer developer, I want to know which SurveyJS components need a commercial licence, and where to put my key, so that my product is licensed correctly.
- S42. As a customer developer, I want the logical data model documented, so that I can integrate reports or other tools with the database.

### Development and quality

- S43. As a developer, I want development modes for SQLite, PostgreSQL and S3 (MinIO) next to memory and Azurite, so that I can debug every provider locally.
- S44. As a developer, I want the sandbox mock checked against the contract and the main user-story suites, so that the sandbox does not drift from the real product.
- S45. As the SurveyJS team, I want the image built, scanned and published from a release tag, so that every release is reproducible.

## Implementation Decisions

### SQL providers (S1, S2, S42)

- **One implementation, two dialects.** The query builder is **Kysely**: type-safe, and it supports both SQLite and PostgreSQL. The SQLite driver is chosen in the step's ADR: Node's built-in `node:sqlite` if it is stable on the pinned Node.js LTS, otherwise better-sqlite3.
- **Migrations are plain SQL files**, one set per dialect (`server/sql/{sqlite,postgres}/NNNN-name.sql`), applied by a small migrator with a `schema_migrations` table and a lock (idea §7.5).
  - They run automatically at start-up.
  - A database newer than the image is refused with a clear message (S6).
- **The logical schema is documented** in `docs/architecture/data-model.md`:
  - users and identities;
  - projects, members and invitations;
  - surveys, definitions, themes, history;
  - responses, completion, files, views;
  - tokens, survey events.

  JSON documents are stored as `jsonb` in PostgreSQL and as JSON text in SQLite. Indexes serve the contract's paging, so result paging is a keyed seek, never a scan.

- **The hosted track adds optional hosted-only tables** ([spec-hosted.md](spec-hosted.md) › Data model) through the same migrations. They stay empty here.
- **Configuration:** `STORAGE_PROVIDER=sqlite|postgres`. `DATABASE_URL` is used for PostgreSQL. SQLite defaults to `/data/surveyjs-studio.db`.

### File storage (S3)

- **`FILE_STORE=local|s3`.**
  - `local` keeps files under `/data/files`.
  - `s3` uses the AWS SDK v3 S3 client with a configurable endpoint, so it works with AWS S3, MinIO, Cloudflare R2 and Backblaze B2.
- The Phase 1 rules are unchanged: unguessable IDs, quotas, serving rules, cascade deletes.

### Local accounts and the instance admin (S4, S12–S21)

- **The local `UserDirectory`** (the plan Step 12 seam) keeps users in the SQL database:
  - email, unique and lower-cased;
  - name;
  - instance role: `admin` or `user`;
  - status: `invited`, `active` or `disabled`;
  - password hash;
  - a must-change-password flag;
  - a session epoch;
  - last sign-in.
- **Passwords:**
  - **argon2id** (`@node-rs/argon2`, prebuilt binaries);
  - a minimum length of 12 and a check against a small bundled list of common passwords;
  - no other composition rules.
- **Set-password links** serve both invitations and resets:
  - 128 random bits, only the hash stored;
  - single use, expiring after 7 days;
  - shown once to the admin.

  There is no email (D17).

- **Lockout:**
  - per account: exponential back-off after 5 failures;
  - per IP: the sign-in rate limit from Phase 1;
  - the answer does not say whether the email exists.
- **Revoking sessions:**
  - the session cookie stays stateless (spec › Back-end modules 2), but it now carries the user's session epoch;
  - each request checks the user's status and epoch through the user directory, with a cache of at most 60 seconds;
  - disabling a user, resetting their password or the user changing it increments the epoch (S13, S14, S21).
- **The first admin (S4):**
  - on an empty user table, `ADMIN_EMAIL` and `ADMIN_PASSWORD` create the first admin, who must change the password at first sign-in;
  - without those variables, the server logs a one-time setup link instead.
- **The instance admin** can manage every project (S17). Project roles (admin/user) are unchanged. Deleting a user uses the Step 12 erasure service (S15). The last-instance-admin rule mirrors the last-project-admin rule (S16).
- **Contract changes:**
  - `passwordLogin` loses `x-phase: P1`;
  - new operations to set a password with a link, and to change one's own password;
  - an admin user API under `/admin/users`: list, create (returns a set-password link), update (role, status), delete, create a reset link;
  - `CurrentUser.instanceRole`;
  - `GET /config` gains `authMethods` per provider and `branding`.

  Names are fixed in the plan steps. Every operation gets conformance tests.

- **UI:**
  - a sign-in page (email/password and provider buttons);
  - "set your password" and "change password" pages;
  - an **Users** admin page.

  They are built in the "Powered by SurveyJS" shell and are also available in the plain shell.

### OAuth2 sign-in (mode 3; S34–S37)

- **Identity providers:**
  - Google (OIDC);
  - GitHub (OAuth2, with the verified primary email from its API);
  - Facebook (OAuth2, email from the Graph API);
  - surveyjs.io (the Phase 1 provider).

  Each is configured with a client ID and secret. `AUTH_METHODS` lists the enabled ones, and `login` takes a `provider` parameter.

- **Users and identities:**
  - a user may have several identities, stored as (provider, subject) → user;
  - an email links an identity to an existing user only when the provider states it is verified (S36).
- **Who may join (S35, decided 2026-10-19).** A first OAuth2 sign-in creates a user when:
  - a pending invitation exists for that email; or
  - the email's domain is in `SIGN_UP_DOMAINS`; or
  - `OPEN_SIGN_UP=on`: anyone with an account at an enabled provider. It is **off by default**, and the instance admin turns it on deliberately.

  Otherwise it is refused with a clear page. Open sign-up applies to OAuth2 only; password accounts are still created by the instance admin.

- **Pending memberships (S37):** adding a member by an unknown email creates an invitation. It turns into a membership when that email first signs in by any method. The `Member` schema gains a `pending` state.

### Shell, branding and licence (S7, S23–S26, S38)

- **The `self-hosted` shell:**
  - a neutral header with the instance's name and logo, and the user menu;
  - a footer with "Powered by SurveyJS".

  The branding appears on the run page, editor, results, sign-in and set-password pages. Configuration: `BRAND_NAME`, `BRAND_LOGO_URL`, `BRAND_ACCENT_COLOR`, `TERMS_URL`, `PRIVACY_URL`.

- **Shown only in the surveyjs-site shell:** the Embed tab, the API docs (`/api/docs`) and the API tokens page (D21). `GET /config` reports which features are on, and the server does not serve `/api/docs` in other shells.
- **Licence key:**
  - `SURVEYJS_LICENSE_KEY` holds either the branding-bound key built into the official image (D20) or a customer's paid key.
  - `/config.branding` is `required` with the branding-bound key and `removable` with a paid key that allows it. The shell hides the branding only when it is `removable` and `BRANDING=off`.
  - The check itself, that a branding-bound key is valid only while the branding is shown, is a **SurveyJS library feature**. Its mechanism is agreed with the SurveyJS library team, outside this repository. Until it exists, development uses a test key, and the image is **not published** (see [Open questions](#open-questions)).
- **Custom shells (S38):**
  - shells are registered in `web/src/shell/registry.tsx` and chosen by `APP_SHELL`;
  - the guide shows how to add one in a fork, with a minimal example shell in the documentation.

  A custom shell is a code change, so it is mode 3 and needs licences (D20).

### Docker image (S1, S5, S8–S11, S45)

The packaging is our choice (2026-10-19):

- **One image**, published as `surveyjs/surveyjs-studio` on Docker Hub and mirrored as `ghcr.io/surveyjs/surveyjs-studio` (approved 2026-10-19):
  - for `linux/amd64` and `linux/arm64`;
  - running as non-root;
  - with port `8080`;
  - with the volume `/data`, which holds the SQLite database and local files.
  - **The container keeps no state.** All data (users, personal surveys, projects, results, files) lives in the mounted volume, or in the external PostgreSQL and S3 storage when configured. Replacing the container loses nothing.

  It is the Step 14 production image with the self-hosted defaults: `APP_SHELL=self-hosted`, `STORAGE_PROVIDER=sqlite`, `FILE_STORE=local`, `AUTH_METHODS=password`, `USER_DIRECTORY=local`.

- **Tags:** semantic-version tags plus `latest`. Each release is built from a git tag in CI, with an SBOM and an image vulnerability scan.
- **Upgrades:**
  - schema migrations run at start-up under a lock;
  - CI starts the previous release on a seeded volume, then the new one, and runs the user-story suite (S5);
  - a downgrade is refused (S6).
- **Backups (S8):**
  - `surveyjs-studio backup` makes an online SQLite backup plus a copy of the files;
  - PostgreSQL is backed up with `pg_dump`;
  - restore is documented and tested in CI.
- **Behind a proxy (S10):** `TRUST_PROXY` (built in Phase 1) sets which proxies are trusted for the client IP and the protocol. Cookies are `Secure` when `PUBLIC_BASE_URL` is HTTPS.
- **No outbound calls (S11):**
  - fonts and assets are bundled;
  - an e2e run with outbound network blocked must pass;
  - the OAuth2 providers are the only outbound calls, and only when the admin enables them.
- **Compose examples:**
  - `compose.sqlite.yml`, a single service;
  - `compose.postgres.yml`, with PostgreSQL and MinIO.

### Sandbox (2a; S27–S33, S44)

- **A separate mock back-end (D21).** The same React app, built with `pnpm build:sandbox`, registers a **Mock Service Worker** that answers every contract operation the UI uses. The handlers are typed by the contract through openapi-typescript and openapi-msw, which the unit tests already use.
- **Storage:** **localStorage**, per browser profile (decided 2026-10-19). localStorage holds about 5 MB, so the sandbox is deliberately small:
  - a **small sandbox seed**: the seed users, one or two projects, a handful of surveys, a few dozen responses and small images. It is a tagged subset of the shared development seed, without the large-results survey;
  - uploads in the sandbox are limited to a small size per file;
  - **the limits are settings** in `sandbox.config.json`, served next to `index.html`, so they change on redeploy without a rebuild (decided 2026-10-19):

    | Setting          | Default | What it does                                                                                                                                              |
    | ---------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | `maxUploadKb`    | 200     | Largest file a visitor can upload. Larger files get the usual quota message (`413 quota-exceeded`)                                                        |
    | `storageLimitKb` | 4096    | How much sandbox data may be kept before the app shows "browser storage is full" and offers a reset. It stays below the browser's own limit of about 5 MB |
    | `seedBudgetKb`   | 1024    | Largest allowed size of the sandbox seed. CI checks the seed against it                                                                                   |

    A missing or invalid file falls back to the defaults.

  - when the browser refuses to store more, the app says so and offers **Reset demo data**.

  The seed is loaded on first visit and on **Reset**.

- **Sign-in:** the mock's `login` redirects to a "Pick an account" page listing the seed users. There are no passwords and no cookies beyond what the mock needs.
- **What it does not do:**
  - links work only in the same browser (D21);
  - no rate limits, no CSRF, no file-type detection beyond the extension, no real IP capture.

  The demo banner states the browser-only nature.

- **Shell:** `self-hosted`, with a demo banner and links to the image and the source code. The Embed tab, the API docs and the API tokens page are hidden.
- **Hosting:** static files on a CDN at `studio.demo.surveyjs.io`, with the licence key issued for that domain.
- **Keeping it honest (S44):**
  - the handlers also run in Node through `msw/node`, and a **sandbox subset** of the conformance suite runs against them;
  - the Playwright user-story suites tagged `@sandbox` run against the sandbox build.

  An operation the mock does not support answers `501`, and the UI hides what depends on it.

### Development modes (S43)

The plan's development modes (mode 4) gain:

- `pnpm dev:sqlite`: a file under `.data/`;
- `pnpm dev:postgres`: PostgreSQL in Docker;
- `pnpm dev:s3`: MinIO in Docker;
- `pnpm dev:sandbox`: the sandbox build, served locally.

Each uses the shared seed. Password and OAuth2 sign-in are tested against a mock OAuth2 server, plus small stub servers for GitHub and Facebook.

## Testing Decisions

The rules of `spec.md` › Testing Decisions apply. This track adds:

1. **The provider suite** on SQLite and PostgreSQL (all stores, including the local user directory and invitations), and the file-store suite on local disk and MinIO.
2. **The conformance suite** on SQLite and PostgreSQL, including:
   - the new account, admin and OAuth2 operations;
   - lockout;
   - session revocation within the cache window;
   - the last-instance-admin rule;
   - the features hidden outside the surveyjs-site shell.
3. **Playwright user-story suites** on the image with SQLite:
   - sign-in and set-password;
   - the Users admin page;
   - the branding;
   - OAuth2 against the mock providers;
   - the full Phase 1 suites.

   The `@sandbox` subset also runs on the sandbox build.

4. **Image checks in CI:**
   - start on an empty volume, then bootstrap the first admin;
   - upgrade from the previous release;
   - backup and restore;
   - run with outbound network blocked;
   - start as non-root;
   - check the health endpoints.

## Out of Scope

- **Email** of any kind: SMTP, verification, invitations by email.
- **Open sign-up for password accounts.** OAuth2 open sign-up exists only as the opt-in `OPEN_SIGN_UP` setting.
- **SAML**, SCIM, 2FA.
- **Multi-organisation or tenant mode** (idea §6.3).
- **More databases:** MySQL/MariaDB, SQL Server, MongoDB. They come later through the same provider suite (D15).
- **P1 product features:** versioning, distribution controls, analytics, extended roles, audit log UI, notifications, webhooks and templates. API tokens, CORS and partial responses come from the hosted track and work here without extra work.
- **A Helm chart** or other orchestrator packages beyond the Compose examples.
- **A visual redesign** of the app screens. The `self-hosted` shell changes the frame and branding, and gives the screens a neutral look of its own (same markup), not a new design.

## Open questions

1. **The branding-bound licence key:** decided on 2026-10-29 in [ADR 0027](docs/adr/0027-branding-and-the-licence-key.md); the image is published to a private test package until the shipped key exists.

**Decided on 2026-10-19:**

- **Registry names:** `surveyjs/surveyjs-studio` on Docker Hub, mirrored as `ghcr.io/surveyjs/surveyjs-studio`.
- **OAuth2 sign-up:** invited emails and allowed domains, plus open sign-up as an opt-in setting that is off by default.
- **Sandbox storage:** localStorage, with a small sandbox seed and small uploads.
- **The instance admin manages every project** (S17), not only the projects they belong to.
- **Data in the image:** personal surveys and projects both stay. All data lives in the mounted database and storage volumes, or in the external database and storage; the container keeps nothing.

## Further Notes

- **Shared with the hosted track:**
  - this track delivers the logical schema, the SQL providers and the S3 file store;
  - the hosted track delivers API tokens, CORS and partial responses.

  [plan-self-hosted.md](plan-self-hosted.md) lists the cross-track dependencies.

- **Licensing (D2):**
  - the repository's code is MIT;
  - building on Survey Creator, Dashboard or PDF in a modified product needs a licence;
  - the official image is free under D20.
- **Documentation for mode 3** goes into `docs/customizing/`: shells, configuration, providers, identity providers, porting and licensing. It is listed in the plan.
