# Spec: My Surveys, Phase 1 (parity and replacement)

Status: ready for implementation · 2026-10-14
Inputs: `idea.md` (product brief and decisions D1–D15), `contract/openapi.yaml` (HTTP contract).

## Problem Statement

SurveyJS users build, publish and analyse surveys in the **My Surveys** section of surveyjs.io. That section has several problems:

- **It can't be separated from the website.** It is a set of server-rendered pages inside the surveyjs.io site, so it can't be deployed, scaled or open-sourced on its own.
- **It caps results and files.**
  - The dashboard shows only the first 1,000 responses.
  - A single response cannot exceed 64 KB, because uploaded files are stored inside it, so file-upload and signature questions fail as soon as the files get large.
  - Editor uploads are limited to 4 MB per survey.
- **Collaborators overwrite each other.** When two people edit the same survey, the last save silently wins.
- **History is thin.** It shows when a survey was edited, but not what changed.
- **Its API is unsafe and non-standard.** The private access key travels in URLs and page source, several actions that change data are plain links, and the endpoints follow no consistent convention.

For the SurveyJS team, the section also can't be the basis of the planned open-source product and free Docker image. Customers need to run it themselves, connect their own database and identity provider, and port the back-end to their own platform.

## Solution

A standalone application at **`my-surveys.surveyjs.io`** replaces the section. Existing users notice only the new address and the lifted limits.

**What users see**
- The app looks exactly like surveyjs.io and reproduces every current screen 1:1: survey list, editor, run page, results (Summary, Table, Details), history, and project management.
- Users sign in with their surveyjs.io account and find all their surveys, results and projects, because the app works directly on the existing Azure storage and site data. Nothing is migrated.
- Old links and bookmarks redirect to the new app, and existing integrations that use `api.surveyjs.io` keep working, because that service still reads the same data.

**What changes in Phase 1**
- **No result cap:** the dashboard loads every response.
- **Larger uploads:** respondent files are stored separately from the response, so the 64 KB response limit no longer applies, and the editor upload quota is raised and configurable.
- **No silent overwrites:** two people editing the same survey get a clear "changed by someone else" message.

**How it is built**
- A static React front-end and a Node.js back-end. The back-end follows a published OpenAPI contract with a portable conformance suite, so it can be re-implemented on another platform.
- Every external dependency sits behind a provider interface: storage, user directory, sign-in, look-and-feel shell. Phase 2 adds login/password sign-in and SQL databases (SQLite by default, PostgreSQL for production) without changing the front-end or the contract.

## User Stories

### Sign-in and shell

1. As an existing My Surveys user, I want to sign in with my surveyjs.io account, so that I don't need a new account or password.
2. As a signed-in surveyjs.io user, I want to be signed in to the app automatically when I already have a surveyjs.io session, so that switching from the website to the app is seamless.
3. As a user, I want to land back on the page I asked for after signing in, so that deep links and bookmarks work.
4. As a user, I want to sign out of the app and of surveyjs.io in one step, so that a shared computer is left signed out.
5. As a user, I want the same header, navigation, footer and cookie banner as surveyjs.io, so that the app feels like part of the website.
6. As a user, I want my name, avatar and account menu in the header (Settings, Help Desk, Billing, Sign Out), so that I can reach my surveyjs.io account from the app.
7. As a licence holder whose subscription expired or is about to expire, I want the same renewal notice as on surveyjs.io, so that I don't miss a renewal.
8. As an anonymous visitor opening a private page, I want to be sent to sign-in instead of seeing an error, so that I can reach the page in one step.

### Survey list

9. As a user, I want to see my personal surveys with name, created date and updated date, newest first, so that I find recent work quickly.
10. As a user, I want to switch between Active and Archived surveys, so that archived surveys don't clutter my list.
11. As a project member, I want to switch the list between Personal Surveys and each of my projects, so that I can work in the right context.
12. As a user, I want the selected project and Active/Archived choice to be part of the URL, so that refreshing, going back, or sharing the link keeps the same view.
13. As a user, I want to create a survey with one click and land in the editor, so that I can start building immediately.
14. As a user, I want new surveys to be named "New Survey N" automatically, so that I don't have to name a survey before creating it.
15. As a user, I want to rename a survey inline in the list (Enter saves, Esc cancels), so that renaming doesn't require opening the editor.
16. As a user, I want to open the editor by clicking a survey row, so that editing is one click away.
17. As a user, I want a "…" menu on each survey with Run, Edit, Clone, Publish/Unpublish, Copy IDs, View Results, View History, Move to Project and Archive, so that every action is in one place.
18. As a user, I want Run to appear only for published surveys, so that I don't share a link that doesn't work.
19. As a user, I want to clone a survey, so that I can reuse its design without its results.
20. As a user, I want to publish and unpublish a survey, so that I control when it accepts responses.
21. As a developer, I want to copy the Survey ID, Post ID and Result ID, so that I can use them in integrations.
22. As a user, I want to move a survey between Personal and my projects, after confirming, so that I can share or reclaim it.
23. As a user, I want to archive a survey and restore it from the Archived list, so that I can tidy up without losing data.
24. As a user, I want to delete an archived survey permanently after confirming, so that I can remove data I no longer need.
25. As a project member without modify rights, I want actions I can't perform to be hidden, so that I don't run into errors.
26. As a user with many surveys, I want the list to load page by page, so that it stays fast.

### Editor

27. As a user, I want the full Survey Creator (Designer, Preview, Themes, Logic, Translation, JSON, Embed), so that I have every design capability I have today.
28. As a user, I want my changes saved automatically, with a visible save state, so that I never lose work and know when it is safe to leave.
29. As a user, I want theme changes saved automatically and separately from the survey, so that styling and content can be edited independently.
30. As a collaborator, I want to be told when someone else changed the survey since I loaded it, rather than overwriting their work, so that edits are not lost silently.
31. As a user, I want to upload images and files into the survey from the editor, so that my survey can show logos and illustrations.
32. As a user, I want a clear message when an upload exceeds the quota, so that I know why it failed.
33. As a user, I want Clear Survey and a help button in the toolbar, as today, so that the editor works the way I'm used to.
34. As a user, I want to rename the survey from the editor, so that I can rename it while designing.
35. As a developer, I want the Embed tab to generate integration code for the new service URLs, so that I can embed the survey in my own app.
36. As a user without modify rights, I want the editor to be read-only for me, so that I can view a shared survey without changing it.

### Run page and respondents

37. As a respondent, I want to open a survey through its public link without signing in, so that answering is effortless.
38. As a respondent, I want the survey to look the way its author themed it, so that it feels branded and trustworthy.
39. As a respondent, I want my answers saved when I press Complete, and a double click or network retry not to submit twice, so that my submission counts exactly once.
40. As a respondent, I want to upload large files and signatures, so that file questions work no matter what I attach.
41. As a respondent, I want a clear "survey not available" page for unpublished or deleted surveys, so that I'm not confused by an error.
42. As a survey author, I want "Limit to one response" to work on the run page, so that each respondent answers once.
43. As a survey owner, I want respondents' IP addresses stored only when I turn that on, so that I collect personal data only when I need it.
44. As an existing respondent link holder, I want the old `/published?id=` link to keep working, so that links already shared are not broken.
45. As a SurveyJS operator, I want public endpoints to be rate-limited, so that the service can't be flooded.

### Results

46. As a user, I want a Summary tab with a chart per question, a question filter, drag-to-reorder and hide, so that I can explore results visually.
47. As a user, I want the Summary to include all responses, not just the first 1,000, so that my charts are accurate.
48. As a user, I want a Table tab with column chooser, paging and export to CSV, Excel or PDF, so that I can inspect and share raw data.
49. As a user, I want my Summary and Table layout remembered per survey, and resettable to the default, so that I don't rearrange it every time.
50. As a user, I want a Details tab showing total responses and the first and last response time, so that I see collection status at a glance.
51. As a user, I want to download all results as JSON or CSV, so that I can analyse them elsewhere.
52. As a user, I want to turn on public access to results with Grant Access, so that I can share results with people who don't have an account.
53. As a person with a public results link, I want to see the results dashboard without signing in, so that I can view shared results.
54. As a user, I want to turn on Save Respondent IP in Results, so that I can collect IPs when my use case needs them.
55. As a user, I want to delete all results of a survey after confirming, so that I can reset a survey or remove personal data.
56. As a user, I want files that respondents uploaded to open from the results, so that I can review attachments.

### History

57. As a user, I want to see when the survey was edited and by whom, newest first, so that I can follow its evolution.
58. As a SurveyJS team member, I want a full snapshot of the survey stored with each new history entry, so that diff and restore can be built later without losing early history.

### Projects and members

59. As a user, I want to create a project and become its admin, so that I can share surveys with my team.
60. As a project admin, I want to rename a project, so that its name stays accurate.
61. As a project admin, I want to add a registered surveyjs.io user by email, so that they can edit the project's surveys with me.
62. As a project admin, I want a clear message when the email doesn't belong to a registered user, so that I know to ask them to sign up first.
63. As a project admin, I want to make members admins or users, so that I can share administration.
64. As a project admin, I want to be prevented from removing or demoting the last admin, so that a project always has an admin.
65. As a project admin, I want to remove members after confirming, so that people who leave lose access.
66. As a project member, I want to leave a project, so that I can remove myself from work I no longer do.
67. As a project admin, I want to delete a project after confirming, with its surveys moved to the project owner as personal surveys, so that no surveys or results are lost.
68. As a user, I want to manage projects both in the app and in surveyjs.io Settings → Manage MySurveys, with changes visible in both, so that I can use whichever I reach first.
69. As a project member, I want to see each project's members and who is an admin, so that I know who has access.

### Integrations and compatibility

70. As an integrator using `api.surveyjs.io`, I want my existing integration to keep working after the switch, so that I don't have to change anything.
71. As an existing user, I want old My Surveys URLs (list, editor, results, history, run) to redirect to the matching page in the app, so that bookmarks keep working.
72. As an existing user, I want my surveys, results, themes, history and projects to appear unchanged, so that the switch is invisible.
73. As a developer, I want the new API documented in OpenAPI with consistent errors, paging and conventions, so that integrating is predictable.
74. As a developer, I want every error to carry a stable machine-readable code, so that my code can react to specific failures.

### Porting, operations and future editions

75. As a back-end porter, I want a conformance suite that I can point at any server URL, so that I can prove a .NET or PHP port behaves exactly like the reference.
76. As a provider author, I want a storage provider test suite that I can run against my implementation, so that I can add a database with confidence.
77. As a SurveyJS operator, I want health checks and structured logs, so that I can monitor the service.
78. As a SurveyJS operator, I want all limits and connections set through environment configuration, so that the same build runs in every environment.
79. As a SurveyJS team member, I want the look-and-feel shell to be a configuration choice, so that the open-source edition can use a "Powered by SurveyJS" shell later.
80. As a SurveyJS team member, I want the SurveyJS licence key supplied at runtime, so that the hosted app and the free Docker image use different keys from the same build.
81. As a data subject, I want my data removed when my surveyjs.io account is deleted, so that my GDPR rights are respected.

## Implementation Decisions

### Technology

| Area | Choice | Reason |
|---|---|---|
| Front-end | **React + TypeScript**, built with **Vite** | React is decided (D4), and SurveyJS ships React packages. Vite produces a static build that any server or CDN can host. |
| Routing | **TanStack Router** | Search parameters are validated and typed (project, archived, results tab); routes are type-checked; route loaders work with TanStack Query. |
| Server state | **TanStack Query** | Caching, autosave mutations, retries and cache refreshes. |
| API client | **openapi-typescript** (types), **openapi-fetch** (calls), **openapi-react-query** (query options and hooks) | Only types are generated; calls read like the contract; the same generated types also type the server. Orval was considered and rejected: much more generated code, and no help on the server. |
| Look and feel | The **surveyjs.io design-system CSS, copied** into a "surveyjs-site" shell; **CSS Modules** for app components; **CSS custom properties** for shared values. No utility framework. | 1:1 parity with the site's class-based CSS (D7, D14); SurveyJS themes also use CSS variables. |
| SurveyJS | Form Library, Survey Creator, Dashboard (summary panel and table, with Excel and PDF export), all pinned to one exact version (see [Dependencies and upgrades](#dependencies-and-upgrades)) | The products the current section uses. |
| Back-end | **Node.js LTS + TypeScript + Fastify** | Fastify validates with JSON Schema, which is language-neutral and comes straight from the contract. Its plugin model fits the providers. |
| Contract wiring | Routes and validation are generated from the OpenAPI document by `operationId` (for example with fastify-openapi-glue and Ajv). | The server cannot drift from the contract. |
| Sign-in | **openid-client** against `auth.surveyjs.io` (authorization code flow with PKCE) | The site already uses this provider (D9). |
| Azure | **@azure/data-tables** and **@azure/storage-blob** | Direct access to the existing storage (D12). |
| Unit tests | **Vitest**; on the front-end **React Testing Library** and **openapi-msw** (type-checked mocks of network calls) | |
| End-to-end tests | **Playwright** (Chromium, Firefox, WebKit), including screenshot comparisons | |
| Test infrastructure | **Azurite** (Azure Storage emulator) and a **mock OIDC server** container, run in Docker Compose; tests sign in through its login form | |
| Repository | **pnpm workspaces**: `contract`, `server`, `web`, `conformance-tests`, `e2e` | |

### Dependencies and upgrades

People will fork the repository, so it must always build from a known set of versions, and the SurveyJS packages must stay in step with each other.

- **Exact versions.** The core stack is pinned to exact versions in `package.json`, with no `^` or `~`: React, Vite, TanStack Router and Query, Fastify, the openapi-* tooling, and SurveyJS. The pnpm lockfile is committed.
- **SurveyJS moves as one.** All `survey-*` packages (Form Library, Creator, Dashboard and their export add-ons) use the same version and are upgraded together in one pull request.
- **Runtime.** One Node.js LTS major, pinned in `engines`, `.nvmrc` and the Docker base image. The `packageManager` field pins pnpm.
- **Routine updates.** Renovate opens grouped pull requests for patch and minor updates. They merge when CI is green.
- **Major upgrades are deliberate.** A major upgrade of a core dependency or of Node.js gets its own pull request, never mixed with feature work, and an ADR that records what changed and how it was verified.
- **Enforced in CI.** A repository check fails the build if a core dependency uses a version range or if the SurveyJS packages have different versions.

### The contract

- **The OpenAPI 3.1 document is the source of truth (D1).** Conventions:
  - RFC 9457 Problem Details with a fixed list of `code` values.
  - JSON Merge Patch for updates.
  - ETag and If-Match on the survey definition and theme.
  - Cursor paging.
  - The `Accept` header, or a `format` alias, for downloads.
  - Cookie session with a CSRF header (double-submit).
  - An `Idempotency-Key` header on submissions.
  - `/public/*` endpoints without authentication.
- **Phasing.** Operations and properties marked `x-phase: P1` (API tokens, password login, partial responses) answer `501` or are ignored in Phase 1.
- **Contract changes.** A change to the contract goes into the same pull request as its implementation and its conformance tests. The contract is linted in CI.
- **Legacy `api.surveyjs.io` is not re-implemented.** It keeps serving v1.x clients from the same data. The new app must keep that data readable by it.

### Back-end modules

1. **HTTP layer.** Routes are built from the contract. It contains:
   - an authentication plugin that resolves the session and enforces CSRF on requests that change data;
   - an error mapper that turns domain errors into Problem Details;
   - rate limiting on `/public/*` and on sign-in.

   The only routes outside `/api/v1` are health checks and legacy-URL redirects.
2. **Session and sign-in.**
   - The server is a confidential OAuth 2.0 client of `auth.surveyjs.io` (OIDC when the provider supports it; see [ADR 0008](docs/adr/0008-surveyjs-auth-oauth2-userinfo.md)), registered as a new client.
   - After the callback it issues a **stateless, encrypted, signed session cookie** (`msid`) containing the user ID, display data and expiry, plus a readable `msid_csrf` cookie. There is no server-side session store, which keeps ports simple.
   - Provider tokens are not kept after sign-in.
   - Sign-out returns the provider's end-session URL.
   - Sign-in is a provider interface (`IdentityProvider`); Phase 1 implements the surveyjs.io OAuth 2.0 client only (OIDC when the provider supports it; see ADR 0008).
3. **Application services.** These modules hold all business rules and are tested through the HTTP layer:
   - **Surveys:** create with "New Survey N" naming, list, rename, publish, archive and restore, move, clone, delete only when archived, settings.
   - **Content:** definition and theme with ETag, plus history recording.
   - **Results:** paging, statistics, export streaming, delete all, IP capture rule, one-response check, idempotent submission.
   - **Projects:**
     - Create, with the creator recorded as admin and owner.
     - Rename.
     - Delete: surveys move to the owner as personal surveys; if the owner is no longer a member, they go to the admin who deletes the project.
     - Members: add by registered email, change role, remove or leave, and the last-admin rule.
   - **Files:**
     - Editor asset quota per survey.
     - Respondent uploads.
     - Unguessable file IDs (at least 128 bits of randomness).
     - Serving with `Content-Disposition`; anything that isn't an image is served as a download.
   - **Views:** dashboard and table state saved per user and survey.
   - **Permissions:**
     - Personal surveys: only the owner.
     - Project surveys: project members; any member may modify, as today (`canModify`).
     - Project administration: admins only.
4. **Provider interfaces.** This is the seam for storage and data sources. Each interface is small and document-oriented, and every operation receives the scope it needs:
   - **SurveyStore:** survey records, definition and theme with a version token, history entries with snapshots.
   - **ResultStore:** append (respecting an idempotency key), page in submission order, statistics, delete all, "has this client completed".
   - **Directory:** users (by ID and email), projects, members and roles. It hides whether the data lives in the surveyjs.io site database or in Azure storage (D12); that mapping is settled in the first implementation task.
   - **ViewStore:** saved layouts.
   - **FileStore:** put, get, delete, usage per survey.
   - **Clock** and **IdGenerator**, so behaviour is deterministic in tests.
5. **Providers implemented in Phase 1.**
   - **Azure legacy provider:**
     - Reads and writes the existing surveyjs.io tables, blobs and site data in their **current formats**. IDs are preserved: survey, post and result IDs, and the legacy `InstanceId`/`HappendAt` fields map to `id`/`submittedAt`.
     - New concepts (history snapshots, ETags, views, file references) are added without breaking the legacy readers.
     - Respondent files go to a blob container, and the response stores the file URL in place of inline content.
   - **In-memory provider:** for fast tests and front-end development without Azure.
6. **Configuration.**
   - Everything comes from environment variables, validated at start-up: provider selection, connection strings, OIDC client, cookie secrets, limits, shell, licence key and public base URL.
   - Proposed limit defaults: editor assets 50 MB per survey; respondent file 10 MB; response body without files 1 MB.

### Front-end modules

1. **Shell.**
   - A configurable layout chosen by `GET /config`.
   - Phase 1 ships only the **surveyjs-site** shell: the copied header (navigation, GitHub stars, cart, account menu, My Surveys button), footer, cookie banner and licence notices, pixel-matched to surveyjs.io.
   - The shell is a replaceable component with a narrow interface: user, notices, links and children.
2. **Routes** (TanStack Router; search parameters are validated):

   | Route | Search parameters | Screen |
   |---|---|---|
   | `/` | `project` (`personal` or a project ID), `archived` | Survey list |
   | `/surveys/$surveyId/edit` | | Editor |
   | `/surveys/$surveyId/results` | `tab` (`summary`, `table`, `details`) | Results |
   | `/surveys/$surveyId/history` | | History |
   | `/projects` | | Project management |
   | `/s/$surveyId` | | Run page, without the site chrome other than today's footer |
   | `/published` | `id` | Alias that redirects to `/s/$surveyId` |
   | `/results/$surveyId` | | Public results view |

   Unauthenticated access to a private route redirects to the server's sign-in with `returnTo`.

   **Code splitting.** Each screen is a lazy-loaded route (TanStack Router lazy routes), so each SurveyJS package is downloaded only on the screens that use it:
   - Survey Creator only on the editor;
   - the Dashboard only on the results pages, private and public;
   - the Form Library on the run page.

   The public run page never downloads Creator or Dashboard code.
3. **Query layer.**
   - One hand-written module per resource (surveys, projects and members, content, results, views, files) built on openapi-react-query.
   - It owns query keys and **cache refresh rules**. For example, a survey PATCH refreshes that survey's record and the list it is in; deleting a project refreshes the project list and the personal survey list.
   - Route loaders call these modules.
4. **Creator integration.**
   - Survey Creator is configured exactly as on surveyjs.io today: all tabs on, the extra Clear Survey and Help toolbar items, obfuscated JSON export, the footer name editor.
   - Auto-save is wired to the definition and theme endpoints with If-Match. On `412` the app shows a notification offering to reload the latest version.
   - Uploads go to the assets endpoint, and quota errors are shown as notifications.
   - The licence key is applied from configuration.
5. **Results integration.**
   - The Dashboard summary panel and table are fed by loading every page of results.
   - Their state is saved through the views endpoints, with a debounce, and Reset deletes it.
   - The table's export runs in the browser.
   - The Details tab downloads through the export endpoint with `format`, and toggles settings with survey PATCH.
6. **Run page.**
   - Form Library with the survey's theme.
   - Submissions go through `submitResponse` with an idempotency key generated once per completion attempt.
   - File questions upload through `uploadResponseFile` and store the returned URL.
   - "Limit to one response" uses the survey's own client-side setting, plus `completed` when a `clientId` is supplied.
7. **Escaping and sanitizing.** All user-supplied names and labels are rendered as text. Survey content HTML is rendered only through the Form Library's own mechanisms. The current account's "XSS in question name" test survey becomes an e2e case.

### Rollout

- The new app runs on the production data side by side with the old section.
- Steps:
  1. Internal use.
  2. An opt-in beta link.
  3. Redirects from surveyjs.io switched on (a change to the surveyjs.io site, coordinated with this project).
  4. The old section removed.
- Rolling back means removing the redirects.
- The app also handles legacy-shaped paths on its own domain (`/service/mysurveys`, `/Service/EditSurvey/{id}`, `/Service/SurveyResults/{id}`, `/Service/History/{id}`) with permanent redirects.

### Data protection (`idea.md` §8)

- IP capture is off by default.
- No respondent data in logs.
- Deleting a survey, its results or a project is permanent and includes files. Deleting a project keeps its surveys, which move to the owner.
- Deleting a surveyjs.io account must delete the user's personal surveys and results and remove their memberships. This needs a hook from surveyjs.io account deletion into the app, or a periodic clean-up of orphaned data.

## Testing Decisions

**What makes a good test.** A test exercises behaviour through a public seam and asserts only on what an outside observer sees: HTTP status, headers and bodies; what a user sees and can do in the browser; values that come back out of a provider. Tests never assert on internal calls, module structure or private state. Each test sets up its own data through the same seam, or through test fixtures for the stores, and can run in any order.

### Seams

The highest seams were chosen, so there are only three:

1. **The HTTP API (primary).** The `conformance-tests` package is a Vitest suite that talks to a server **only over HTTP**, at a configurable base URL.
   - It checks every response against the OpenAPI document: status, headers, schema and problem `code`.
   - It signs in by running the OIDC flow against the mock OIDC server.
   - Coverage includes:
     - every operation's success path and each documented error;
     - CSRF enforcement;
     - ETag, If-Match and `412`/`428`;
     - cursor paging over large data sets with no 1,000 cap;
     - idempotent submissions;
     - the one-response rule;
     - IP capture on and off;
     - permissions for personal, member and admin;
     - the last-admin rule;
     - project deletion moving surveys to the owner, or to the deleting admin when the owner has left;
     - delete only when archived;
     - quotas and file serving;
     - public results on and off;
     - `x-phase: P1` operations answering `501`.

   It runs against the Node server with the in-memory provider (fast, on every change) and with the Azure legacy provider on Azurite (in CI). A future .NET or PHP port is accepted when this suite passes against it.
2. **The browser (front-end).** The `e2e` package is a Playwright suite running the built front-end against the real server, Azurite and the mock OIDC server.
   - It follows the user stories above: sign-in and redirect back, list and project switching, the menu actions, editor autosave and the conflict message, theme save, uploads, run and submit, file questions, results tabs, saved and reset views, downloads, project management and the legacy redirects.
   - **Visual parity tests** compare each screen with baseline screenshots of the current surveyjs.io pages, captured once from the live site in fixed states with dynamic content masked. This is how the 1:1 requirement is checked.
   - **Bundle checks** confirm the code splitting: the run page and the survey list load no Creator or Dashboard code.
   - It runs on Chromium, Firefox and WebKit.
3. **The storage provider interface.** A provider test suite, shared by every implementation and run against each one: in-memory, and Azure legacy on Azurite.
   - It covers ordering, paging and cursor stability, version tokens and conflicts, idempotency keys, statistics, cascading deletes, the project-deletion move, and file usage accounting.
   - For the Azure legacy provider it adds **legacy-format tests**: golden fixtures copied from the current storage, which must read correctly, and records written by the new provider must match the legacy format the old service reads.
   - Every later provider must pass the same suite: SQLite and PostgreSQL in P1, and MySQL/MariaDB, SQL Server and MongoDB after it (D15).

### Unit tests

Unit tests (Vitest) are written only for pure logic, which is clearer to test directly:
- "New Survey N" naming;
- cursor encoding and decoding;
- JSON Merge Patch application;
- the mapping from errors to Problem Details;
- CSV serialization of results;
- validation of search parameters.

On the front-end, the query layer's cache refresh rules are tested with React Testing Library and openapi-msw. Screen behaviour is covered by e2e instead of component tests.

### CI and prior art

- **CI order:** dependency check → contract lint → type-check → unit tests → conformance tests (in-memory) → provider suite → conformance and e2e tests against Azurite and the mock OIDC server.
- **Prior art:** none. The repository is new, so these three suites become the pattern for everything that follows. The surveyjs.io pages captured during discovery are the reference for the visual baselines.

## Out of Scope

- **P1 work.** These items need their own spec:
  - Customer readiness: login/password sign-in; the SQLite (default) and PostgreSQL providers (D15); S3 and local-disk file storage.
  - Product features: version diff and restore, distribution controls (schedule, limits, passwords, single-use links, QR codes), partial responses and resume, server-side analytics, roles beyond admin/user, audit log, notifications, webhooks, API tokens, templates.

  The contract and interfaces leave room for all of them.
- **Phase 3:** open-source packaging, documentation, the neutral "Powered by SurveyJS" shell, and the free Docker image.
- **Changes to `api.surveyjs.io`**, and retiring it.
- **Moving hosted data off Azure storage.** Decided after P1 (D10).
- **The surveyjs.io site:**
  - Account features: licences, billing, renewals, external logins.
  - The Settings → Manage MySurveys section, which stays as it is (D13).
  - The redirect switch on surveyjs.io (only coordinated here).
- **Product changes:** a visual redesign, UI localization beyond English, analytics and telemetry (D8), payments, e-signatures, workflows, panels, offline or native apps, and AI features.

## Further Notes

- **Dependencies on the surveyjs.io side:**
  - an OIDC client registration for `my-surveys.surveyjs.io`, including post-logout redirect URIs;
  - least-privilege credentials for the Azure storage accounts and any site data the Directory needs;
  - documentation or source of the legacy storage layout and of how `api.surveyjs.io` reads results;
  - the redirect change on surveyjs.io;
  - a hook or clean-up for account deletion;
  - the current design-system assets (CSS, fonts, icons) to copy.
- **The first implementation task is a technical spike that maps the legacy data layout:**
  - tables, partition and row keys, blob containers and JSON shapes;
  - where users, projects and members live (D12);
  - how the legacy service reads file content in responses.

  This confirms that storing file URLs in place of inline content is safe for `api.surveyjs.io` readers (D11). If it isn't, respondent files stay inline until the storage roadmap is decided, and only the dashboard cap and editor quota are lifted.
- **The contract** (`contract/openapi.yaml`) is versioned with the code. Breaking changes after release need a new major path (`/api/v2`).
- **Licensing.** The repository's own code is MIT (D2). The SurveyJS licence key is supplied at runtime through `/config` and is never hard-coded.
- **Decisions this spec relies on:** `idea.md` §11, D1–D15. The rule for deleting a project, where the owner receives the surveys and the deleting admin receives them if the owner has left, was decided after `idea.md` and is recorded in the contract.
