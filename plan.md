# Implementation plan: My Surveys, Phase 1

Status: draft · 2026-10-13 · Steps 12 and 14 revised 2026-10-19 for the deployment modes (idea §3.0)
Implements: [spec.md](spec.md) (Phase 1, which is deployment modes 1.1 and 1.2), within the brief in [idea.md](idea.md) and the contract [contract/openapi.yaml](contract/openapi.yaml). The work after Phase 1 runs as two track plans; see [After Phase 1](#after-phase-1).

## How to use this plan

- **One prompt per step.** Run each step in a fresh session, for example: *"Execute Step 4 of plan.md"*. Each step is self-contained: it lists its references, what to build, its tests, its documentation and how a human checks it.
- **Order.** Run the steps in order. A step starts only when the previous one is merged and its demo checklist has passed.
- **Branch and PR per step.** Use a branch named `step/NN-short-name`, and open one PR per step. When the step is merged, tick it in the [Progress](#progress) table.
- **Reference notation.**
  - `idea §6.1 F3` means idea.md, section 6.1, item F3.
  - `spec › Implementation Decisions › Back-end modules 3` means spec.md, that heading, item 3.
  - `US 9–14` means spec.md user stories 9 to 14.
  - `D12` is a decision in idea §11.

## Rules that apply to every step

### Definition of done

A step is done only when all of these hold:

1. **The feature works locally in both demo modes** (see [Local demo modes](#local-demo-modes)), and the step's demo checklist passes when run by a human.
2. **Tests exist at every level the step touches, and all are green in CI:**

   | Level | Back-end | Front-end |
   |---|---|---|
   | Unit | Vitest, for pure logic in `server` and `contract` | Vitest + React Testing Library + openapi-msw, for logic in `web`: search parameter validation, query-layer cache refresh rules, formatters, hooks |
   | End-to-end | **HTTP conformance suite** (`conformance-tests`) for every new or changed operation, success and each documented error, run against **both** providers (in-memory, and Azure legacy on Azurite). **Provider suite** for every new store operation. | **Playwright** (`e2e`) scenarios for each user story the step implements, on Chromium, Firefox and WebKit |

   These follow spec › Testing Decisions. A test asserts behaviour seen through a seam, never implementation details.
3. **Documentation is updated in the same PR** (see [Documentation set](#documentation-set)): the user guide pages for the new screens, the API reference and guides for new operations, the architecture document for new modules or providers, and an ADR for any decision not already recorded in idea.md or spec.md.
4. **The contract stays the source of truth.** Every operation the step implements matches `contract/openapi.yaml`. If the contract must change, the change goes in the same PR, with its conformance tests, and the contract linter passes. Operations not implemented yet keep answering `501 not-implemented`.
5. **There is a demo script.** `docs/demo/step-NN.md` repeats the step's demo checklist with exact commands and seed accounts, so a human can verify the step without reading code.

### Local demo modes

Both modes work offline, without real surveyjs.io or Azure. They are introduced in Steps 1–3 and kept working by every later step.

These are the **development configuration** (deployment mode 4, idea §3.0). Don't confuse them with the hosted sandbox at `my-surveys.demo.surveyjs.io` (mode 2a), which the self-hosted track builds.

| Mode | Command (proposed) | Storage | Sign-in | Needs |
|---|---|---|---|---|
| **Memory** | `pnpm demo` | In-memory provider, loaded from a seed. Optionally saved to a local JSON file (`DEMO_PERSIST=1`) so data survives restarts. | **Dev identity provider**: a "Sign in as…" page listing the seed users. It is refused at start-up when `NODE_ENV=production` or the edition is hosted. | Node and pnpm only |
| **Azurite** | `pnpm demo:azurite` | Azure legacy provider on **Azurite**, seeded with the **legacy-format golden fixtures** (Step 2), plus a local site-database container if Step 2 finds one is needed. | **Mock OIDC server** container (`mock-oauth2-server`). The real OIDC code path runs against it. | Docker |

- **Seed data.** One shared seed:
  - users: an owner, a project admin, a project member and an outsider;
  - personal and project surveys, published and unpublished, active and archived;
  - results, including more than 1,000 responses on one survey;
  - themes, history and files.

  `pnpm seed` (re)loads it into either mode.
- **Seed accounts are listed** in `docs/development.md`.

### Documentation set

The documentation is created in Step 1 and grown by every step:

| Document | Audience | Contents |
|---|---|---|
| `README.md` | Everyone | What the project is, quick start, links. |
| `docs/user-guide/` | End users | One page per screen or task: survey list, editor, publishing and the run page, results, history, projects. Includes screenshots. |
| `docs/api/` | Integrators | A reference generated from the contract (Redocly HTML, also served by the dev server at `/api/docs`), plus guides: authentication and CSRF, errors, paging, concurrency (ETag), uploads, public endpoints. |
| `docs/architecture.md` | Developers and porters | Modules, provider interfaces, request flow, sign-in and session, configuration, the data model and its legacy mapping. |
| `docs/development.md` | Developers | Setup, demo modes, seed data, scripts, environment variables. |
| `docs/testing.md` | Developers and porters | The three seams, how to run each suite, how to run the conformance suite against another back-end, how to add a provider. |
| `docs/operations.md` | Operators (from Step 14) | Configuration reference, health checks, logs, deployment and rollout runbook. |
| `docs/adr/` | Developers | Architecture decision records, one per decision that is not already in idea.md or spec.md. |
| `docs/demo/step-NN.md` | The reviewer | The demo script for each step. |

## Progress

| Step | Name | Status |
|---|---|---|
| 1 | Foundation and walking skeleton | ☑ |
| 2 | Legacy storage spike and Azure provider base | ☑ |
| 3 | Sign-in, session and the surveyjs.io shell | ☑ |
| 4 | Survey list and survey creation | ☑ |
| 5 | Survey actions (the "…" menu) | ☑ |
| 6 | Editor: autosave, conflicts and history | ☑ |
| 7 | Editor uploads and file serving | ☑ |
| 8 | Run page and response collection | ☑ |
| 9 | Results: Summary and Table | ☑ |
| 10 | Results: Details, downloads and public results | ☑ |
| 11 | Projects and members | ☑ |
| 12 | Accounts by deployment mode, data protection and hardening | ☐ |
| 13 | Visual parity with surveyjs.io | ☐ |
| 14 | Production readiness and rollout kit | ☐ |

---

## Step 1: Foundation and walking skeleton

**Goal:** a running, tested, documented empty application that proves the architecture end to end: contract → server → generated client → front-end.

**References**
- idea §7 items 1–7 (architecture principles); idea §6.1 F10 (new API) and F11 (operations); idea §8 (licensing: MIT); D1, D2, D4.
- spec › Implementation Decisions › Technology; › Dependencies and upgrades; › The contract; › Back-end modules 1 (HTTP layer) and 6 (configuration); › Front-end modules 1 (shell, placeholder only) and 2 (routes skeleton and code splitting).
- spec › Testing Decisions › Seams 1–2 (scaffolding only); › CI and prior art.
- US 73, 74, 75, 77, 78, 80.

**Build**
- **pnpm workspace** with the packages `contract`, `server`, `web`, `conformance-tests` and `e2e`; TypeScript, ESLint, Prettier and an MIT `LICENSE`.
- **Dependency policy** (spec › Dependencies and upgrades):
  - exact versions for the core stack and a committed lockfile;
  - Node.js LTS pinned in `engines` and `.nvmrc`, and pnpm pinned in `packageManager`;
  - a Renovate configuration that groups patch and minor updates and keeps all `survey-*` packages in one group;
  - a `pnpm check:deps` script, run in CI, that fails on version ranges in core dependencies or on mismatched SurveyJS versions.
- **`contract`:** the existing `openapi.yaml`, the Redocly lint configuration, type generation with openapi-typescript, and a bundled reference build.
- **`server`:** Fastify.
  - Routes are wired from the contract by `operationId`, with Ajv validation.
  - Every operation answers `501 not-implemented` until a step implements it.
  - An error mapper produces Problem Details.
  - `GET /config` returns the edition, shell, auth methods, limits and `surveyjsLicenseKey` from environment configuration, validated at start-up.
  - `/healthz` (liveness) and `/readyz` (readiness).
  - Structured pino logs.
  - `/api/docs` serves the reference in development.
- **`web`:** Vite, React, TanStack Router and TanStack Query, plus an openapi-fetch client and openapi-react-query.
  - A placeholder shell and a home route that loads `/config` and shows the edition and shell names.
  - Routes are lazy-loaded from the start (TanStack Router lazy routes), so later steps add each screen as its own chunk.
  - The SurveyJS licence key is applied from `/config`.
- **Provider registry skeleton:** a configuration-selected provider set, with an empty in-memory provider. The memory demo mode command exists.
- **CI (GitHub Actions):** dependency check → contract lint → type-check → unit tests → conformance tests (in-memory) → e2e.

**Tests**
- **Back-end unit:** configuration validation (missing or invalid variables fail start-up); the error mapper; the dependency check (a range or a mismatched SurveyJS version fails it).
- **Back-end e2e (conformance):** the harness (base URL, response validation against the contract); `getConfig` matches its schema; an unimplemented operation answers `501` with a valid Problem; an unknown route answers `404` with a Problem.
- **Front-end unit:** the API client sends the base URL and credentials; the config loader.
- **Front-end e2e:** the app opens, shows the config values, and has no console errors.

**Documentation:** `README.md`, `docs/architecture.md` (skeleton with modules and request flow), `docs/development.md` (including "Dependencies and upgrades": how Renovate pull requests are handled and how a major upgrade is done, with its ADR), `docs/testing.md`, the `docs/api/` reference plus a conventions guide, `docs/adr/0001-record-architecture-decisions.md`, and `docs/demo/step-01.md`.

**Demo checklist**
1. `pnpm install && pnpm demo` starts the server and the web app.
2. The home page shows `edition: self-hosted` (or whatever is configured) and the shell name.
3. `/api/docs` shows the API reference with every operation.
4. `curl /api/v1/surveys` returns `501` with a Problem Details body.
5. `pnpm test` (unit and conformance) and `pnpm e2e` are green.
6. `pnpm check:deps` passes. Change a core dependency to a `^` range, and it fails.

---

## Step 2: Legacy storage spike and Azure provider base

**Goal:** know exactly how the current surveyjs.io data is stored, and have an offline replica of it that the Azure legacy provider can read.

**Inputs needed from the SurveyJS team (spec › Further Notes):**
- the legacy service source or storage documentation;
- read-only access to a storage copy (or exported samples);
- where users, projects and members live.

**If the inputs are not available yet:** do the parts that don't depend on them (the Azurite setup, the provider suite harness, the Directory interface), record the gap, and run Steps 3–11 on the memory provider only. Then add one catch-up step "Azure legacy provider for Steps 3–11" before Step 12.

**References**
- idea §2.7 (storage and limits); idea §2.8 (current API); idea §3.1 *Same data*, *Legacy coexistence*, and the limits table; idea §6.1 F9; idea §7 items 4–5; idea §9; D5, D11, D12.
- spec › Implementation Decisions › Back-end modules 4 (provider interfaces) and 5 (Azure legacy provider); › Further Notes (the first implementation task is the spike); › Testing Decisions › Seams 3 (provider suite and legacy-format tests).
- US 70, 72, 76.

**Build**
- **`docs/architecture/legacy-data-layout.md`:**
  - every table and container, with partition and row keys and JSON shapes;
  - how IDs (survey, post, result, instance) relate;
  - where users, projects and members live (D12);
  - how `api.surveyjs.io` reads results and inline files;
  - a verdict on D11: can respondent files be stored as URLs without breaking legacy readers?
- **Golden fixtures:** anonymised legacy records covering every entity, stored in the repository.
- **Azurite in Docker Compose**, a loader that writes the golden fixtures in legacy format, and a site-database container if the Directory data lives in SQL.
- **Azure legacy provider skeleton:** connection, configuration and a read path for survey records.
- **Read-only inspector CLI** (`pnpm inspect:legacy --user <id>`): lists a user's surveys from any configured store. It is safe to run against a production copy because it never writes.
- **Provider suite harness** that runs the same tests against the memory and Azure legacy providers.
- **The Directory interface**, which hides where users and projects are stored.

**Tests**
- **Back-end unit:** mapping legacy entities to domain objects (IDs, `HappendAt` → `submittedAt`, `InstanceId` → `id`).
- **Back-end e2e (provider suite):** reading survey records from the golden fixtures returns the expected domain objects on both providers.
- **Front-end:** none; no UI changes.

**Documentation:** `legacy-data-layout.md`; `docs/architecture.md` (the provider section and the legacy mapping); `docs/development.md` (Azurite mode, fixtures, inspector); an ADR recording the D11 verdict; `docs/demo/step-02.md`.

**Demo checklist**
1. `pnpm demo:azurite:up` starts Azurite (and the site-database container if needed) and loads the fixtures.
2. `pnpm inspect:legacy --user <seed-owner>` prints the owner's surveys with created and updated dates, matching the fixtures.
3. Reviewers read `legacy-data-layout.md` and agree with the D11 verdict.

---

## Step 3: Sign-in, session and the surveyjs.io shell

**Goal:** a user signs in, sees the surveyjs.io header and footer with their name and account menu, and signs out. Private pages require sign-in.

**References**
- idea §3.1 *Same look* and *Same authorization*; idea §6.1 F1 and F2; D7, D9, D14.
- spec › Implementation Decisions › Back-end modules 1 (authentication plugin, CSRF, rate limiting on sign-in) and 2 (session and sign-in); › Front-end modules 1 (shell) and 2 (redirecting private routes to sign-in).
- Contract: `login`, `loginCallback`, `logout`, `getCurrentUser`; `passwordLogin` stays `501` (P1).
- US 1–8, 79, 80.

**Build**
- **`IdentityProvider` interface** with three implementations:
  - **surveyjs.io OIDC** via openid-client (authorization code + PKCE). The **mock OIDC** container uses the same code.
  - **Dev identity provider** for memory mode ("Sign in as…" with the seed users). It is refused in production.
- **Session cookies:**
  - `msid` is stateless, encrypted and signed; `msid_csrf` is readable;
  - CSRF is enforced on requests that change data;
  - `returnTo` accepts only same-origin paths;
  - sign-in is rate-limited.
- **`GET /me`**, including `notices` from a new **AccountNotices** provider: surveyjs.io licence state in hosted mode, configurable in demo mode.
- **The surveyjs-site shell**, with header and footer copied from surveyjs.io (CSS, fonts, icons), the account menu linking to surveyjs.io, the cookie banner and the licence notice dialogs.
- **Shell selection** through `/config`, with a fallback "plain" shell for tests.
- **Protected routes** redirect to `/auth/login?returnTo=…`.

**Tests**
- **Back-end unit:** session encode, decode and expiry; CSRF comparison; `returnTo` validation; the dev provider is refused in production.
- **Back-end e2e (conformance):**
  - the sign-in flow against mock OIDC;
  - `getCurrentUser` with `401` and `200`;
  - logout returns the end-session URL and clears cookies;
  - a request that changes data without CSRF gets `403 csrf-token-invalid`;
  - `passwordLogin` answers `501`.
- **Front-end unit:** the route guard; the account menu; notice rendering.
- **Front-end e2e:**
  - sign in (both modes) and return to the deep link;
  - the header shows the user name;
  - sign out;
  - an anonymous user is redirected;
  - the expired-licence notice is shown.

**Documentation:** user guide "Signing in"; the API guide "Authentication, sessions and CSRF"; `docs/architecture.md` (the identity and session section); an ADR on the dev identity provider; `docs/demo/step-03.md`.

**Demo checklist**
1. In memory mode, open `/` and get redirected to "Sign in as…". Pick the owner, and the header shows the owner's name and the account menu.
2. Open a deep link while signed out, sign in, and land on the deep link.
3. Sign out, and private pages redirect to sign-in again.
4. In Azurite mode, sign-in goes through the mock OIDC server.
5. Set the notice to "licence expired" in the demo configuration, and the renewal dialog appears as on surveyjs.io.

---

## Step 4: Survey list and survey creation

**Goal:** the My Surveys list exactly as today. The user can view personal and project surveys, switch between Active and Archived, and create a survey.

**References**
- idea §2.1 (list, project selector, create, rows); idea §6.1 F3; idea §5 UC-1 (creating), UC-7 (switching projects).
- spec › Implementation Decisions › Back-end modules 3 (*Surveys*: create with "New Survey N", list; *Permissions*) and 4 (SurveyStore, Directory reads); › Front-end modules 2 (route `/` with `project` and `archived`) and 3 (query layer).
- Contract: `listSurveys`, `createSurvey`, `getSurvey`, `listProjects`, `getProject` (read only).
- US 9–14, 26. US 11 covers switching only; managing projects is Step 11.

**Build**
- **Store operations:** survey list, create and read in SurveyStore; project reads in Directory; in-memory and Azure legacy implementations.
- **Server:**
  - surveys service: list (paged, newest first, personal or project, archived flag); create with "New Survey N" naming and an optional definition;
  - permission checks;
  - projects read endpoints.
- **Front-end:**
  - the survey list page: the Active/Archived switch; a project selector driven by `listProjects`; "Create a Survey", which opens the editor route (a stub until Step 6);
  - rows with name, created and updated dates;
  - loading more pages;
  - a query module for surveys and projects.

**Tests**
- **Back-end unit:** "New Survey N" naming (gaps and existing names); cursor encoding.
- **Back-end e2e:**
  - conformance: list filters, ordering and paging; visibility of personal and project surveys (an outsider sees nothing); create defaults; `getSurvey` returns `404` for a stranger's survey;
  - provider suite: list ordering and cursor stability; create.
- **Front-end unit:** search parameter validation (`project`, `archived`); the cache refresh rule that adds a created survey to the list.
- **Front-end e2e:**
  - switch Active and Archived and projects, and the URL reflects the view;
  - refresh keeps the view;
  - create a survey, which opens the editor stub with the name "New Survey N".

**Documentation:** user guide "Your surveys" (the list, projects, archived); the API guide "Paging"; `docs/demo/step-04.md`.

**Demo checklist**
1. Signed in as the owner, the list shows the seeded personal surveys, newest first, with dates.
2. Switch to Archived: only archived surveys are shown, and the URL contains `archived=true`.
3. Switch to the seeded project in the selector, and the project's surveys are shown.
4. "Create a Survey" opens the editor placeholder. Back in the list, the new "New Survey N" is at the top.
5. Repeat in Azurite mode: the fixtures appear as in the inspector.

---

## Step 5: Survey actions (the "…" menu)

**Goal:** every row action from today's menu works: rename inline, Run, Clone, Publish/Unpublish, Copy IDs, Move to Project, Archive, Restore and Delete, with hiding by permission.

**References**
- idea §2.1 (row menu table, inline rename); idea §6.1 F3; idea §5 UC-2 (publish and unpublish), UC-6 (lifecycle), UC-7 (moving surveys).
- spec › Implementation Decisions › Back-end modules 3 (*Surveys*: rename, publish, archive and restore, move, clone, delete only when archived, settings; *Permissions*); › Front-end modules 3 (cache refresh rules).
- Contract: `updateSurvey` (merge patch, every field), `deleteSurvey`, `cloneSurvey`.
- US 15, 17–25.

**Build**
- **Store:** update, clone (definition and theme; no results or history) and cascading delete.
- **Server:** merge-patch handling; the move rules (the target project must be one the user belongs to); delete returns `409 survey-not-archived` unless archived; `canModify`.
- **Front-end:**
  - inline rename (Enter saves, Esc cancels);
  - the "…" menu, with items shown according to published state and permission;
  - confirmation dialogs;
  - clipboard copy of the IDs;
  - Run opens `/s/{id}` in a new tab (the page arrives in Step 8);
  - list refreshes after every action.

**Tests**
- **Back-end unit:** merge-patch application, including `projectId: null`.
- **Back-end e2e:**
  - conformance for every patch variant;
  - validation errors (empty name);
  - `403` without modify rights;
  - moving to a project the user doesn't belong to;
  - clone contents;
  - delete rules: `409`, then `204` after archiving, then `404`;
  - provider suite: update, clone and cascading delete.
- **Front-end unit:** menu item visibility (published, `canModify`); cache refresh rules per action.
- **Front-end e2e:** one scenario per menu item, plus inline rename; a member without modify rights sees no modifying items.

**Documentation:** user guide "Managing a survey" (each menu item); API reference examples for `updateSurvey`; `docs/demo/step-05.md`.

**Demo checklist**
1. Rename a survey inline. Esc cancels; Enter saves and the change survives a refresh.
2. Publish a survey. Run appears in its menu and opens a new tab (placeholder page until Step 8). Unpublish it, and Run disappears.
3. Clone a survey. The copy appears, unpublished.
4. Copy ID, Result ID and Post ID, and paste each to check the value.
5. Move a survey to the project and back to Personal, confirming each time.
6. Archive a survey. It moves to Archived. Restore it, then archive and delete it permanently.
7. Sign in as a member without modify rights: the modifying items are hidden.

---

## Step 6: Editor: autosave, conflicts and history

**Goal:** the editor works as today: the full Survey Creator with every tab, autosave of the survey and theme, Clear Survey, Help, renaming from the footer and the Embed tab. It also adds the conflict message, and the History page.

**References**
- idea §2.2 (editor); idea §2.5 (history); idea §6.1 F4 and F7; idea §5 UC-1, UC-8.
- spec › Implementation Decisions › Back-end modules 3 (*Content*: definition and theme with ETag and history recording) and 4 (SurveyStore version tokens, history snapshots); › Front-end modules 4 (Creator integration); › The contract (ETag, If-Match, `412`/`428`).
- Contract: `getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme`, `listSurveyHistory`.
- US 16, 27–30, 33–36, 57, 58.

**Build**
- **Store:**
  - the definition and theme with version tokens, written in the legacy-compatible format;
  - a history entry with a snapshot on every definition save;
  - legacy history entries are shown without a user.
- **Server:**
  - ETag and If-Match handling, `412 edit-conflict` and `428 if-match-required`;
  - saving updates `updatedAt`;
  - the payload limit.
- **Front-end:**
  - Survey Creator configured exactly as on surveyjs.io today (tabs, the Clear Survey and Help toolbar items, obfuscated JSON export, the footer name editor), loaded only by the lazy editor route;
  - autosave through the query layer with a visible save state;
  - on `412`, a notification with "Reload latest";
  - read-only mode without modify rights;
  - Embed tab code that uses the new service URLs.
- **History page** (`/surveys/$surveyId/history`): entries newest first, with the user's name when known.

**Tests**
- **Back-end unit:** ETag generation and comparison.
- **Back-end e2e:**
  - conformance: get, then save with a matching ETag (`204` and a new ETag); a stale ETag gets `412`; no If-Match gets `428`; `403` without modify rights; history grows by one per save; theme round trip;
  - provider suite: version tokens, history ordering, snapshots, and the legacy format (the saved definition is readable by a legacy reader against the golden fixtures).
- **Front-end unit:** the autosave adapter (save number, in-flight saves, error states); the conflict notification logic.
- **Front-end e2e:**
  - edit a survey, reload, and the changes are kept;
  - a theme change is kept;
  - two browser contexts edit the same survey, and the second sees the conflict message;
  - Clear Survey;
  - rename in the footer;
  - the Embed tab shows the new URLs;
  - the History page lists the saves;
  - the editor is read-only for a member without modify rights;
  - the survey list loads no Creator code; it is fetched only when the editor opens.

**Documentation:** user guide "Designing a survey" and "Survey history"; the API guide "Concurrent editing with ETags"; `docs/demo/step-06.md`.

**Demo checklist**
1. Open a survey from the list, which opens the editor. Add a question, and the save indicator shows "saved". Reload, and the question is still there.
2. Change the theme in the Themes tab. Reload, and the theme is kept.
3. Open the same survey in two windows and edit in both. The second window shows "changed by someone else" with a reload option.
4. Open View History. Each save is listed with time and user.
5. The Embed tab shows code using the new URLs.

---

## Step 7: Editor uploads and file serving

**Goal:** images and files uploaded from the editor are stored separately from the survey, served from `/public/files/{fileId}`, and limited by a configurable quota.

**References**
- idea §2.2 (4,000 KB editor upload limit); idea §2.7; idea §3.1 limits table (the editor upload row); idea §6.1 F4.
- spec › Implementation Decisions › Back-end modules 3 (*Files*: editor asset quota per survey, unguessable IDs, `Content-Disposition`), 4 (FileStore) and 6 (limit defaults); › Front-end modules 4 (uploads and quota notifications).
- Contract: `uploadSurveyAsset`, `downloadFile`.
- US 31, 32.

**Build**
- **FileStore:** in-memory or local disk for the memory mode, Azure Blob on Azurite.
- **File IDs** with at least 128 bits of randomness.
- **Usage per survey** for the quota (`413 quota-exceeded`), and a file type allow-list (`415`).
- **Serving files:** images are shown inline; anything else is a download. Caching headers.
- **Creator `onUploadFile`** wired to the upload endpoint, with notifications for quota and type errors.
- **Cleaning up:** deleting a survey deletes its files (extends Step 5).

**Tests**
- **Back-end unit:** content-type and disposition rules; quota arithmetic.
- **Back-end e2e:**
  - conformance: upload returns `201` with a URL that downloads the same bytes; quota exceeded gets `413`; a disallowed type gets `415`; an unknown file ID gets `404`; after the survey is deleted, its file gets `404`;
  - provider suite: put, get and delete, and usage accounting.
- **Front-end unit:** the upload adapter's error mapping.
- **Front-end e2e:** add an image question with an uploaded image, and it shows in Designer and Preview; an oversized upload shows the quota message.

**Documentation:** user guide "Images and files in your survey"; the API guide "Uploads and files"; `docs/architecture.md` (the file storage section); `docs/demo/step-07.md`.

**Demo checklist**
1. In the editor, add an Image question and upload a picture. It shows in the Designer and Preview, and its URL is a `/public/files/...` link that opens in a new tab.
2. Upload a file larger than the configured quota. A clear quota message appears.
3. Delete the survey (archive, then delete). Its file URL now returns 404.

---

## Step 8: Run page and response collection

**Goal:** published surveys can be taken at `/s/{id}`, and the old `/published?id=` link redirects there. Responses are stored exactly once, respondent files are stored separately, "Limit to one response" and IP capture work, and public endpoints are rate-limited.

**References**
- idea §2.3 (run page); idea §3.1 limits table (the 64 KB response row, subject to the Step 2 D11 verdict); idea §6.1 F5; idea §5 UC-2, UC-3; idea §8 *Data minimization*.
- spec › Implementation Decisions › Back-end modules 1 (rate limiting on `/public/*`) and 3 (*Results*: IP capture, one-response check, idempotent submission; *Files*: respondent uploads); › Front-end modules 2 (the `/s/$surveyId` and `/published` routes) and 6 (the run page); › Data protection.
- Contract: `getPublishedSurvey`, `submitResponse`, `uploadResponseFile`, `downloadFile`.
- US 37–45, 18 (Run now opens a working page).

**Build**
- **ResultStore:** append with an idempotency key; "has this client completed"; the legacy-compatible response format.
- **Public endpoints:**
  - unpublished and unknown surveys both give the same `404 survey-not-available`;
  - `409 already-completed`;
  - the IP address is stored only when the setting is on;
  - payload limits;
  - rate limiting with `429` and `Retry-After`.
- **Respondent uploads:**
  - stored as blobs, and the response holds the URL;
  - **if Step 2 found this breaks legacy readers, keep files inline**, as allowed by D11, and record that in an ADR.
- **The run page:**
  - the Form Library with the survey's theme, in a lazy route that loads no Creator or Dashboard code;
  - an idempotency key generated per completion attempt;
  - file questions upload through the endpoint;
  - a "not available" page;
  - today's footer.
- **The `/published?id=` route** redirects to `/s/{id}`. (Removed in Step 12: the surveyjs.io site makes this redirect, D19.)

**Tests**
- **Back-end unit:** idempotency key handling; the IP extraction rule (proxy headers).
- **Back-end e2e:**
  - conformance:
    - a published survey loads; an unpublished one gets `404`;
    - submitting returns `201`, and the same Idempotency-Key gives the same `id` and stores only once;
    - "Limit to one response" with a `clientId` gives `409`, and `completed: true` on load;
    - IP stored when the setting is on and not stored when off;
    - `413` and `429`;
    - `partial: true` is ignored (P1);
  - provider suite: append, idempotency, ordering and the completed check.
- **Front-end unit:** run-page state (loading, unavailable, completed); the submit adapter.
- **Front-end e2e:**
  - publish, open Run, complete the survey, and the thank-you page is shown;
  - a double click on Complete stores one response;
  - a file question upload works;
  - an unpublished survey shows "not available";
  - the old `/published?id=` link redirects;
  - the run page's network log contains no Creator or Dashboard chunks.

**Documentation:** user guide "Publishing and collecting responses"; the API guide "Public endpoints, rate limits and idempotency"; `docs/demo/step-08.md`.

**Demo checklist**
1. Publish a survey and click Run. The survey opens at `/s/{id}` with its theme.
2. Complete it. The thank-you page is shown, and the survey's statistics (via the API, or the inspector in Azurite mode) count one response.
3. Answer a File Upload question with a 5 MB file. Submission succeeds.
4. Unpublish the survey and reload the run page. "Not available" is shown.
5. The old `/published?id={id}` link lands on the same page.

---

## Step 9: Results: Summary and Table

**Goal:** the Results page with the Summary (charts) and Table tabs, showing **all** responses (no 1,000 cap). Layouts are saved per user and can be reset.

**References**
- idea §2.4 (the Summary and Table tabs); idea §3.1 limits table (the 1,000 dashboard row); idea §6.1 F6; idea §5 UC-4.
- spec › Implementation Decisions › Back-end modules 3 (*Results*: paging; *Views*); › Front-end modules 2 (the results route with `tab`) and 5 (results integration).
- Contract: `listResults`, `getResultsView`, `saveResultsView`, `resetResultsView`.
- US 46–49.

**Build**
- **ResultStore paging** in submission order, with a stable cursor.
- **ViewStore** per user and survey.
- **The results page** at `/surveys/$surveyId/results?tab=`, a lazy route; the Dashboard is loaded only here. The SurveyJS Dashboard summary panel and table are fed by loading every page. The table has a column chooser, paging, and exports to CSV, Excel and PDF in the browser.
- **Saving views:** state is saved with a debounce through the views endpoints; Reset deletes it.

**Tests**
- **Back-end unit:** the page-size rules.
- **Back-end e2e:**
  - conformance: paging through a seeded survey with 1,500 responses returns each exactly once; saving, reading and resetting a view, with `404 view-not-found` after reset; a stranger gets `404`;
  - provider suite: result paging stability; ViewStore round trip.
- **Front-end unit:** the all-pages loader; the debounced view saver; validation of the `tab` parameter.
- **Front-end e2e:**
  - the Summary shows a chart per question, and the counts reflect all 1,500 responses;
  - hide and reorder charts, reload, and the layout is kept; Reset restores it;
  - the table's column chooser, paging and CSV export (the downloaded file has 1,500 rows).

**Documentation:** user guide "Viewing results: Summary and Table"; `docs/demo/step-09.md`.

**Demo checklist**
1. Open View Results on the seeded large survey. The Summary charts count 1,500 responses, and there is no 1,000 banner.
2. Hide a chart and drag another one. Reload, and the layout is kept. Reset Summary State restores the default.
3. In the Table tab, choose columns and page through. Export CSV, and the file contains every response.

---

## Step 10: Results: Details, downloads and public results

**Goal:** the Details tab: statistics, download of all results as JSON or CSV, the Grant Access and Save Respondent IP toggles, Delete Results, and resetting the table and summary state. Also the public results page for Grant Access.

**References**
- idea §2.4 (the Details tab); idea §6.1 F6; idea §5 UC-5, UC-6 (deleting results, the IP setting); idea §8 (IP default off, erasure).
- spec › Implementation Decisions › Back-end modules 3 (*Results*: statistics, export streaming, delete all); › Front-end modules 2 (the `/results/$surveyId` public route) and 5 (Details downloads and settings).
- Contract: `getResultStats`, `exportResults`, `deleteResults`, `getPublicResults`, `updateSurvey` (`settings`).
- US 50–56.

**Build**
- **Statistics:** count, first and last submission.
- **Streaming export:** JSON and CSV chosen by `Accept` or `format`, sent as an attachment; `406` for anything else.
- **Delete all results**, including respondent files.
- **The settings toggles** through survey PATCH.
- **Public results:**
  - the endpoint works only while Grant Access is on;
  - the public page at `/results/$surveyId` shows the Dashboard read-only and without sign-in;
  - the Details tab shows the public link.
- **Opening respondent files** from the Table (links).

**Tests**
- **Back-end unit:** CSV serialization (nested answers, matrices, files, escaping, Unicode).
- **Back-end e2e:**
  - conformance: statistics on an empty and a seeded survey; export in JSON and CSV (headers, `Content-Disposition`, all rows); `406`; delete gives `204`, then zero statistics and file URLs answering `404`; public results answer `404` while off and `200` while on, with the definition included;
  - provider suite: statistics and delete all.
- **Front-end unit:** building download URLs; toggle state and its refresh rules.
- **Front-end e2e:**
  - the Details tab shows the correct totals and dates;
  - both downloads work;
  - Grant Access opens a working public page in a signed-out context, and turning it off returns "not available";
  - Save IP on, then submit, and the IP appears in the Table;
  - Delete Results empties the dashboard;
  - both reset buttons work.

**Documentation:** user guide "Downloading, sharing and deleting results"; the API guide "Exporting results"; `docs/demo/step-10.md`.

**Demo checklist**
1. The Details tab shows the total responses and the first and last dates of the seeded survey.
2. Download JSON and CSV. Both contain every response.
3. Turn on Grant Access and open the public link in a private window. The dashboard shows without sign-in. Turn it off, and the link shows "not available".
4. Turn on Save Respondent IP and submit a response from the run page. The IP shows in the Table.
5. Delete Results and confirm. The totals become 0.

---

## Step 11: Projects and members

**Goal:** a Projects screen in the app with the same features as Settings → Manage MySurveys: create, rename and delete projects; add, remove and change the role of members; leave a project. Deleting a project moves its surveys to the owner.

**References**
- idea §2.6 (projects); idea §6.1 F8; idea §5 UC-7; D13. The project deletion rule is recorded in the contract (`deleteProject`).
- spec › Implementation Decisions › Back-end modules 3 (*Projects*: create, rename, delete, members, last-admin rule) and 4 (Directory writes); › Front-end modules 2 (the `/projects` route).
- Contract: `createProject`, `updateProject`, `deleteProject`, `listMembers`, `addMember`, `updateMember`, `removeMember`; `Project.ownerId`.
- US 59–69.

**Build**
- **Directory writes**, in the legacy location found by Step 2, so the changes are visible in surveyjs.io Settings (D13).
- **Services:**
  - the creator becomes owner and admin;
  - an unregistered email gets `404 user-not-found`;
  - `409 already-member`;
  - `409 last-admin` on demoting or removing the last admin;
  - a member may leave;
  - deleting a project moves its surveys to the owner as personal surveys, or to the deleting admin if the owner has left;
  - rename and delete are admin-only.
- **The Projects page** (`/projects`), in the surveyjs-site shell: expandable project cards, admin controls, "Create a Project" and confirmations. The project selector in the list (Step 4) refreshes.

**Tests**
- **Back-end unit:** the last-admin rule; choosing who receives the surveys of a deleted project.
- **Back-end e2e:**
  - conformance: every operation and error code; deletion moves surveys (the owner's personal list then includes them, with IDs, published state and results unchanged); the fallback to the deleting admin; a non-admin gets `403`;
  - provider suite: Directory writes and the cascading move.
- **Front-end unit:** admin-control visibility; refresh rules (the project list, the personal survey list after a deletion).
- **Front-end e2e:** create a project, add a seed user, make them admin, demote them, remove them; leave a project as a member; the last-admin error is shown; deleting a project moves its surveys to the owner's personal list.

**Documentation:** user guide "Projects and team members"; API reference examples; `docs/demo/step-11.md`.

**Demo checklist**
1. On `/projects`, create a project. You are listed as Admin.
2. Add the seeded member by email. An unknown email shows "not a registered user".
3. Make the member an admin, then a user. Demoting yourself as the last admin is refused.
4. Move a survey into the project. Signed in as the member, you see and can edit it.
5. Delete the project. Its survey appears in the owner's personal list, with its results intact.
6. In Azurite mode, `pnpm inspect:legacy` shows the project change in the legacy store.

---

## Step 12: Accounts by deployment mode, data protection and hardening

**Goal:**
- **Accounts follow the deployment modes** (idea §3.0) through one seam: users come from an **external** directory (mode 1), from **local** accounts (mode 2b), or from both (mode 3).
- **Mode 1 is complete:**
  - surveyjs.io users are read through a user directory;
  - deleting a surveyjs.io account erases the user's data.
- **The app keeps no legacy URLs.** The surveyjs.io site redirects old links, using a map this step writes.
- **The spec's security behaviours are verified.**

**References**
- idea §3.0 (deployment modes); idea §8 *Erasure* and *Data minimization*; idea §2.9 item 7 (security); idea §9 (rollout); D13, D16–D19.
- spec › Implementation Decisions › Back-end modules 2 (sign-in) and 4 (provider interfaces: the user directory and the project store); › Rollout (the redirects belong to surveyjs.io); › Data protection (account deletion); › Front-end modules 7 (escaping and sanitizing); › Back-end modules 1 (rate limiting review).
- US 81, 45, 72. US 44 and 71 are delivered by the surveyjs.io redirects, using the map from this step.

**Build**
- **Accounts by mode, the seam** (an ADR, "Accounts by deployment mode"):
  - **Split `Directory`** into two interfaces, each with its own provider-suite section:
    - **`UserDirectory`:** users by ID and by email, the blocked flag, and the user to sign in from the identity claims.
    - **`ProjectStore`:** projects, members and roles: today's project operations of `Directory`.
    - In mode 1 the two come from different owners. Users stay on surveyjs.io, and projects move to the app's own stores at 1.3.
  - **Two kinds of user directory:**
    - **external:** the users belong to another system. That is surveyjs.io in mode 1, and a customer's OAuth2 provider in mode 3.
    - **local:** the app owns the users. They are created or invited by an instance admin, and the admin resets passwords; there is no email. This serves modes 2b and 3.
  - **How sign-in methods combine with directories:**
    - mode 1: `surveyjs` sign-in with the surveyjs.io directory;
    - mode 2b: `password` with the local directory;
    - mode 3: `password` plus OAuth2 providers (Google, GitHub, Facebook, surveyjs.io), with the local directory. A user is created on first OAuth2 sign-in.
    - A configuration that cannot work fails at start-up, naming the variable.
  - **Build now:** the interfaces, the configuration and the start-up rules.
  - **Built in the self-hosted track:** the local directory, password sign-in, the instance admin, and OAuth2 sign-in.
- **Mode 1 user directory:**
  - **The surveyjs.io user API, specified by us.** `docs/integrations/surveyjs-user-api.md` is written for the surveyjs.io team. It covers:
    - user by ID;
    - user by email;
    - licence state, for the account notices;
    - an **account-deleted webhook** signed with HMAC.
  - **Two user directories for mode 1:**
    - `surveyjs-sql`, the current direct read of the site's SQL `Users`, used until the API exists;
    - `surveyjs-api`, a client of the specified API, tested against a stub server.

    Configuration selects one. `AccountNotices` follows the same choice.
- **Account erasure:**
  - an `eraseAccount` service. It follows idea §8 *Erasure*: personal surveys, their results and files are deleted, and memberships are removed. A project whose last admin is deleted passes to its next member, or is deleted if no members are left.
  - **Triggers:**
    - the account-deleted webhook: a server-to-server endpoint with an HMAC check and a replay window. The ADR decides whether it belongs in the public contract.
    - an operator command, `pnpm account:erase --user`;
    - a periodic reconciliation that finds owners the user directory no longer knows and erases their data. This is the safety net when a webhook is lost.
  - In mode 2b the instance admin's "delete user" will call the same service (self-hosted track).
- **No legacy URLs in the app:**
  - remove the `/published` alias route (Step 8) with its tests and documentation mentions. Like `/service/*`, `/Service/*` and `/Results/*`, that path is now an ordinary unknown route.
  - write **`docs/operations/surveyjs-redirects.md`** for the surveyjs.io team. It maps each old URL to its new one, with the query parameters that must be carried over:

    | Old URL | New URL | Note |
    |---|---|---|
    | `/service/mysurveys` | `/` | |
    | `/Service/MySurveys/{orgId}` | `/?project={orgId}` | |
    | `/Service/EditSurvey/{id}` | `/surveys/{id}/edit` | |
    | `/Service/SurveyResults/{id}` | `/surveys/{id}/results` | |
    | `/Service/History/{id}` | `/surveys/{id}/history` | |
    | `/published?id={id}` | `/s/{id}` | other query members kept |
    | `/Results/Survey/{resultId}` | `/results/{surveyId}` | the site looks up the survey ID |
    | Settings → Manage MySurveys | `/projects` | the section is removed, D13 |

    The fragment `#manage-mysurveys` never reaches a server, so that last case needs a link or a client-side redirect.
- **Security headers:**
  - CSP that allows SurveyJS, frame-ancestors for embeds, HSTS and referrer policy.
  - Settle the Step 8 note: author HTML (HTML questions, the completed page) and URL-prefilled placeholders run on the same origin as the signed-in app. Decide in an ADR between CSP alone and isolating the run page.
  - The run page's Idempotency-Key must not depend on `crypto.randomUUID`, which is missing on plain HTTP.
- **A check that no respondent data reaches the logs.**
- **An e2e case for the "XSS in question name" survey.**

**Tests**
- **Back-end unit:**
  - the start-up rules for sign-in methods and directories;
  - the erasure plan: which entities are removed and which are reassigned;
  - the webhook signature and replay check;
  - mapping the user API's answers.
- **Back-end e2e:**
  - conformance:
    - after erasure, the personal surveys answer `404`, memberships are gone, and project surveys remain;
    - the webhook refuses a bad signature;
    - security headers are present;
    - `/published?id=…` and `/Service/EditSurvey/{id}` are not redirected.
  - provider suite:
    - the `UserDirectory` and `ProjectStore` sections, on memory, Azure legacy and `surveyjs-api` (against the stub);
    - erasure on every provider;
  - a log capture during a submission contains no answers.
- **Front-end unit:** run-page idempotency keys without `crypto.randomUUID`.
- **Front-end e2e:**
  - a survey with HTML or script in names and titles renders as text and runs no script;
  - sign-in still works in both dev modes after the split.

**Documentation:**
- the ADR "Accounts by deployment mode", plus the ADR on run-page isolation;
- `docs/integrations/surveyjs-user-api.md` and `docs/operations/surveyjs-redirects.md`;
- `docs/architecture.md`: the user directory and project store, and the security and data protection section;
- `docs/operations.md`, first version: the erasure command, the reconciliation job, the webhook secret;
- user guide "Moving from the old My Surveys";
- remove the `/published` alias from the Step 8 documentation, and record in ADR 0014 that it was superseded;
- `docs/demo/step-12.md`.

**Demo checklist**
1. Run `pnpm account:erase --user <seed-outsider>`. Signing in as that user shows an empty list, and the other users' data is unaffected.
2. Send a signed account-deleted webhook for a seed user (a script in the demo). Their personal surveys are gone. A wrongly signed call is refused.
3. Start the server with an impossible combination, such as `USER_DIRECTORY=surveyjs-sql` with `AUTH_METHODS=password`. Start-up fails and names the variable.
4. Run the conformance suite with `USER_DIRECTORY=surveyjs-api` against the stub. Sign-in, members by email and notices work.
5. Open `/published?id={id}` on the local app. It is an unknown page now. `docs/operations/surveyjs-redirects.md` lists the redirect the site makes instead.
6. Open the seeded "XSS in question name" survey in the list, editor and run page. No alert appears, and the names show as plain text.

---

## Step 13: Visual parity with surveyjs.io

**Goal:** every Phase 1 screen matches the current surveyjs.io pages 1:1, and this is proven by screenshot comparison.

**Inputs needed:** a SurveyJS team member runs the baseline capture script, which signs in with a headed browser, to capture the current pages in fixed states.

**References**
- idea §3.1 *Same look*; idea §2.1–2.6 (the screens); D7, D14.
- spec › Implementation Decisions › Front-end modules 1 (shell, pixel-matched); › Testing Decisions › Seams 2 (visual parity tests).
- US 5 and, for look and feel, every screen from US 9–69.

**Build**
- **A baseline capture script:** headed Playwright, run by a human who signs in. It captures the surveyjs.io list (active, archived, project), the "…" menu, editor, results tabs, history, Settings → Manage MySurveys and the run page, with dynamic content masked.
- **Matching seed states** in the app.
- **Visual tests** comparing each app screen with its baseline, at agreed thresholds, on all three browsers.
- **CSS and markup fixes** until every test passes.

**Tests**
- **Front-end e2e:** a visual comparison per screen and state. All earlier functional tests must still pass.
- **Back-end:** none new.

**Documentation:** `docs/testing.md` (how to recapture baselines, thresholds and masks); `docs/demo/step-13.md`.

**Demo checklist**
1. `pnpm e2e:visual` passes. The HTML report shows each app screen next to its surveyjs.io baseline, with no significant differences.
2. Compare the running app and surveyjs.io side by side for the list, menu, editor and results.

---

## Step 14: Production readiness and rollout kit

**Goal:**
- **Mode 1.1:** the app is ready to run on the production data, side by side with the old section.
- **Mode 1.2:** the runbook takes the SurveyJS team through removing My Surveys from surveyjs.io.
- One production image whose configuration is organised by **deployment mode**, so the track plans add modes 1.3, 2b and 3 as new configurations, not new builds.

**Inputs needed:**
- the target hosting environment;
- the OIDC client registration;
- least-privilege storage credentials;
- a staging copy of the data (spec › Further Notes);
- the account-deleted webhook secret.
- If surveyjs.io has shipped it by then: the user API endpoint and credentials (Step 12).

**References**
- idea §3.0 (deployment modes); idea §3.1 *Done when*; idea §6.1 F11; idea §9 (rollout steps, legacy API coexistence until 1.3); D13, D16–D19.
- spec › Implementation Decisions › Rollout; › Back-end modules 6 (configuration); › Further Notes (dependencies); › Testing Decisions › CI and prior art (the full pipeline).
- US 77, 78, 70.

**Build**
- **A production container image:**
  - the server serves the built front-end;
  - non-root, with health checks;
  - the base image uses the same pinned Node.js LTS version as `.nvmrc`, and `pnpm check:deps` covers it;
  - the same image serves every deployment mode, chosen by configuration.
- **The complete configuration reference**, with start-up validation, organised by deployment mode:
  - **Mode 1 (hosted):** storage, user directory (`surveyjs-sql` or `surveyjs-api`), `surveyjs` sign-in, the surveyjs-site shell, the webhook secret.
  - **Mode 4 (development):** memory with the dev sign-in, and Azurite with the mock OIDC server.
  - Modes 2b and 3 are listed as "coming with the self-hosted track", with the variables Step 12 already defines.
- **Structured logs** with request IDs.
- **Readiness** that checks storage and the user directory are reachable.
- **A staging profile:** read-only first (the inspector, plus a read-only flag that refuses writes), then read-write against a staging copy.
- **A compatibility smoke test:** after the new app writes (rename, save definition, submit a response, move a survey, change a project), the legacy `api.surveyjs.io` read paths still return correct data.
  - It runs against staging.
  - It protects modes 1.1 and 1.2 only. At 1.3 the hosted-migration track replaces `api.surveyjs.io` with the compatibility layer (D18).
- **Costs carried over from earlier steps:**
  - the Azure `listResults` scan reads a whole partition into memory (Step 9). Read keys first, then a time window.
  - `deleteAllRows` keeps every key in memory (Step 10).
  - verify the production `Surveys.theme` collation against the compare-and-set (ADR 0012).
  - conformance hygiene: suites that leave data on Azurite, cleanup helpers that fail silently, duplicated helpers (Step 11).
- **A rollout runbook**, written for the SurveyJS team and the surveyjs.io site team:
  1. Internal use on production data, read-only first.
  2. An opt-in beta link from the old section.
  3. The surveyjs.io site switches on the redirects in `docs/operations/surveyjs-redirects.md` (Step 12), and the site's "My Surveys" and "All-in-One Demo" links point to the app.
  4. The site removes My Surveys and **Settings → Manage MySurveys** (D13), and the account-deleted webhook is switched on.
  5. **Rollback** before step 4 means removing the redirects. After step 4, the old pages exist only in a previous site release, so rollback means redeploying that release.
  6. **Handover:** a checklist of what the hosted-migration track (1.3) starts from: data stays on the legacy stores, and `api.surveyjs.io` still serves legacy clients.

**Tests**
- **Back-end e2e:**
  - the full conformance and provider suites against the production image, in CI, on Azurite;
  - the read-only flag refuses writes with a clear Problem;
  - readiness fails while the user directory is unreachable.
- **Front-end e2e:** the full Playwright suite against the production image.
- **Staging:** the compatibility smoke test, run manually and documented.

**Documentation:**
- `docs/operations.md`: deployment, the configuration reference by mode, monitoring, and the rollout and rollback runbook;
- `README.md`: a production section, with the deployment modes table;
- `docs/demo/step-14.md`.

**Demo checklist**
1. `docker compose -f compose.prod-like.yml up` runs the production image with Azurite and the mock OIDC server, in the mode 1 configuration. The full demo from Steps 3–12 works on it.
2. With `READ_ONLY=1` the app browses data, and any save is refused with a clear message.
3. Stop the user directory (the stub, or the SQL container). `/readyz` reports not ready.
4. Review the runbook and the redirect map with the site team. The staging smoke test checklist is ready for the SurveyJS team.

---

## Consistency check against idea.md and spec.md

### Coverage

- **User stories:** all 81 in spec.md are assigned.

  | Steps | User stories |
  |---|---|
  | 1 | 73–75, 77, 78, 80 |
  | 2 | 70, 72, 76 |
  | 3 | 1–8, 79, 80 |
  | 4 | 9–14, 26 |
  | 5 | 15, 17–25 |
  | 6 | 16, 27–30, 33–36, 57, 58 |
  | 7 | 31, 32 |
  | 8 | 18, 37–45 |
  | 9 | 46–49 |
  | 10 | 50–56 |
  | 11 | 59–69 |
  | 12 | 45, 72, 81; 44 and 71 through the surveyjs.io redirect map |
  | 13 | 5 |
  | 14 | 70, 77, 78 |

- **idea §6.1, F1–F11:** every item is assigned.

  | Item | Steps | Item | Steps |
  |---|---|---|---|
  | F1 | 3 | F7 | 6 |
  | F2 | 3, 13 | F8 | 11 |
  | F3 | 4, 5 | F9 | 2, then every feature step |
  | F4 | 6, 7 | F10 | 1, then every step |
  | F5 | 8 | F11 | 1, 14 |
  | F6 | 9, 10 | | |

- **Contract operations:** all 39 are assigned. `passwordLogin` and the `x-phase: P1` properties stay `501` or ignored, as the contract requires.
- **Decisions D1–D15:**
  - D1 is honoured: `api.surveyjs.io` is not re-implemented, and the Step 14 smoke test protects it.
  - D11 is handled with the Step 2 verdict and the Step 8 fallback.
  - D13 (revised 2026-10-19): Step 11 writes to the legacy location, so both UIs agree while they run side by side. Step 14's runbook removes Manage MySurveys from surveyjs.io.
  - D16–D19 (deployment modes, accounts, the user API, legacy links): Steps 12 and 14.
  - D14: Steps 3 and 13.
  - D10, D8, D15 (the SQLite and PostgreSQL providers) and the P1 items are not planned, which matches spec › Out of Scope. Phase 1 keeps the storage seam that D15 builds on: the provider interfaces and the shared provider suite (Step 2).
- **spec › Dependencies and upgrades:** set up in Step 1 and enforced in CI from then on.
- **Code splitting (spec › Front-end modules 2):** the lazy-route pattern comes in Step 1. Steps 6, 8 and 9 add the editor, run and results routes as separate chunks, and Steps 6 and 8 test this.

### Additions the plan makes beyond spec.md (please confirm)

1. **Dev identity provider** for the memory demo mode. spec › Back-end modules 2 says Phase 1 implements surveyjs.io OIDC only. The plan adds a dev-only provider that start-up refuses in production. The mock OIDC server covers the real code path in Azurite mode and CI.
2. **Optional saving of the in-memory provider to a JSON file** (`DEMO_PERSIST`), so demos survive restarts. spec › Back-end modules 5 describes the in-memory provider only for tests and development.
3. **AccountNotices provider.** The spec requires the licence notice (US 7, `CurrentUser.notices`), but the provider interfaces in spec › Back-end modules 4 have no source for licence data. The plan adds this interface in Step 3.
4. **Documentation from Step 1.** idea §3.3 schedules developer documentation for Phase 3, and spec.md doesn't list documentation. The plan builds the user guide, API reference, architecture, development, testing and operations documents step by step.
5. **Read-only inspector CLI, read-only mode and an account erasure command.** Operational tools that come from spec › Further Notes and › Data protection, but that the spec doesn't name.
6. **Front-end unit tests in every step.** The user requirement asks for unit tests on both sides. spec › Testing Decisions says screen behaviour goes to e2e rather than component tests. The plan keeps that rule: front-end unit tests cover logic (the query layer, adapters, parameter validation), not markup.

### Open points the plan depends on

- **Step 2** needs the legacy storage documentation or source, and samples. A fallback is defined in Step 2.
- **Step 3:** the shell's header shows the **cart count** and **GitHub stars**, but the spec doesn't say where that data comes from. Proposal: show the cart link without a count, and show the star count as a static value from configuration, until decided.
- **Step 12:**
  - the surveyjs.io team must agree to build the user API and the account-deleted webhook that Step 12 specifies. Until then the app reads the site's SQL `Users` directly.
  - the site must build the redirects from the Step 12 map.
- **Step 13:** a team member must capture the visual baselines, because that needs a signed-in session.
- **Step 14:** the hosting environment, OIDC registration, credentials and staging data.
- **idea §3.1 *Done when*** includes "the old section is switched off". That is an operational action by the SurveyJS team after Step 14, outside this plan's code.

## After Phase 1

Phase 1 (Steps 1–14) delivers deployment modes 1.1 and 1.2 (idea §3.0). The rest of the work runs as **two track plans at the same time**. Each track has its own spec and plan.

| Track | Delivers | Starts with |
|---|---|---|
| **Hosted migration** ([spec](spec-hosted.md), [plan](plan-hosted.md)) | Mode 1.3: the surveyjs.io user API in use; survey, result, project and member data moved off Azure and the site database into the app's own stores, in a maintenance window, with Post and Result IDs kept; the thin `api.surveyjs.io` compatibility layer; API tokens and CORS before the cutover | Choosing the hosted database and file storage from the shortlist (D10). Its Step 8 waits for the self-hosted SQL foundation |
| **Self-hosted** ([spec](spec-self-hosted.md), [plan](plan-self-hosted.md)) | Mode 2b: the Docker image with SQL providers, local accounts, the instance admin, the "Powered by SurveyJS" shell and the branding licence key. Mode 2a: the static sandbox with its separate mock back-end and seeded listed accounts. Mode 3: OAuth2 sign-in (Google, GitHub, Facebook, surveyjs.io) and the developer documentation | The logical data model and the SQL providers, which the hosted track also needs |

Both tracks share the SQL providers and the provider suite. Each plan's "Cross-track dependencies" section says which track builds each shared piece.

