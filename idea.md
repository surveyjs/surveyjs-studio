# My Surveys: product idea

Status: draft for discussion · Last updated: 2026-10-13

## 1. Summary

We will build a standalone web application, with a front-end and a back-end, that does everything the current **My Surveys** section of surveyjs.io does (`https://surveyjs.io/service/mysurveys`) and then goes further.

Rollout happens in three steps:

1. **Replace.** Ship the application at `my-surveys.surveyjs.io` with full feature parity, migrate the existing data, and retire the old section.
2. **Improve.** Add the P1 features listed in §6.2.
3. **Open up.** Publish the source code as open source. Customers can clone the repository and build on it; using the commercial SurveyJS components (Survey Creator, Dashboard, PDF Generator) still requires a licence. We also publish a free, prebuilt Docker image for simple self-hosting, with "Powered by SurveyJS" branding wherever it fits.

The back-end starts on **Node.js**, but it must be easy to port to other server platforms such as .NET or PHP. In practice that means the HTTP API contract, not the Node code, is the source of truth (see §7).

## 2. Background: My Surveys today

My Surveys is the private workspace of the SurveyJS "Free Survey Tool" / All-in-One Demo. The inventory below was collected from the live site on 2026-10-13 while logged in, plus the public product page.

### 2.1 Survey list (`/service/mysurveys`)

- An **Active / Archived** switch.
- A **project selector**: "Personal Surveys" plus each project the user owns or belongs to. The URL calls it an *organization* (`/Service/MySurveys/{orgId}`).
- A **Create a Survey** button, which creates "New Survey N" and opens the editor.
- Each row shows the name (click the pencil to rename inline; Enter saves, Esc cancels), the created date, the updated date and a "…" menu. Clicking a row opens the editor.
- Each row carries `surveyId`, `postId`, `resultId`, `isPublished` and `canModifySurvey`.

**Row menu ("…")**

| Item | Behaviour |
|---|---|
| Run | Shown only when the survey is published. Opens `/published?id={surveyId}` in a new tab. |
| Edit | Opens the editor. |
| Clone | Duplicates the survey. |
| Publish / Unpublish | Toggles whether the survey accepts responses. |
| Survey IDs → Copy ID / Copy Result ID / Copy Post ID | Copies the ID to the clipboard, for API and Form Library integrations. |
| View Results | Opens the results page. |
| View History | Opens the edit history. |
| Move to Project | Moves the survey to Personal or to another project; asks for confirmation. |
| Archive | Moves the survey to Archived. The Archived list offers **Restore** and **Delete** instead (delete asks for confirmation and cannot be undone). |

Items that change a survey are hidden when the user has no modify permission.

### 2.2 Editor (`/Service/EditSurvey/{id}`)

- The full **SurveyJS Survey Creator** with the Designer, Preview, Themes, Logic, Translation and JSON tabs. An **Embed** tab generates integration code that references `surveyId`/`postId` and links to licensing.
- **Auto-save** with a visible save state. The survey JSON and the theme JSON are saved separately.
- The toolbar adds Undo, Redo, **Clear Survey**, Settings and a help/tool-guide button. The JSON export is obfuscated.
- Image and file uploads from the editor are stored by the service, up to **4,000 KB in total per survey**.
- The survey name can be edited from the editor footer.
- Predefined themes: Default, Contrast, Borderless, Flat, Plain, 3D, Soft and Monochrome, each in light and dark.

### 2.3 Run page (`/published?id={surveyId}`)

- The published survey is rendered with its theme, and results are posted to the service.
- The footer reads "Try and see how easy it is to create a survey" and links to the Terms of Use. This is the existing "powered by" placement.
- Survey-level options set in the Creator apply here, for example "Limit to one response".

### 2.4 Results (`/Service/SurveyResults/{id}`)

The page shows a banner: *"the dashboard displays only the first 1,000 responses; the full dataset is available for download in JSON and CSV in the Details tab."*

- **Summary tab.** A SurveyJS Dashboard with one chart per question; chart types include Pie and Bar, with a sort order. A question filter selects which charts are shown. Charts can be dragged to reorder and closed to hide. The layout is saved and can be reset.
- **Table tab.** A SurveyJS Dashboard Table with a column chooser, *Export As…* (CSV, Excel or PDF), page size and pagination. Its state is saved and can be reset.
- **Details tab:**
  - Total responses, plus the dates of the first and last response.
  - **Download all results** as JSON or CSV.
  - **Grant Access**: a toggle for a public link to the results, used through the public results API.
  - **Save Respondent IP in Results**: a toggle.
  - **Delete Results**.
  - **Reset Table State** and **Reset Summary State**.

### 2.5 History (`/Service/History/{id}`)

A list of timestamps when the survey was edited, titled "Survey editing history of '{name}'". It shows no content, no diff and has no restore.

### 2.6 Projects and collaboration

Surveys can be grouped into projects, and other registered SurveyJS users can be added so they edit a project's surveys together. Permissions are a single "can modify" flag.

*To verify:* the screens for managing projects and members. They live in the account Settings area and could not be captured automatically.

### 2.7 Storage and limits

- Survey definitions and results are stored in Azure storage. There is no limit on the number of submissions or the size of a survey JSON.
- Each **response is limited to 64 KB**. File-upload and signature answers are stored inside the response, so large uploads fail.
- The dashboard shows at most 1,000 responses.
- No service-level guarantee is offered for data in the free tool.

### 2.8 API

**Public API** (`https://api.surveyjs.io/public/v1/Survey`). These are the endpoints the Form Library v1.x `dxSurveyService` calls:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/getSurvey?surveyId=` | Return the survey JSON. |
| GET | `/getSurveyAndIsCompleted?surveyId=&clientId=` | Return the survey JSON and whether this client has already completed it. |
| POST | `/post/` `{ postId, surveyResult, clientId?, isPartialCompleted? }` | Submit a result, complete or partial. |
| POST | `/post/page-number/` `{ postId, lastActivePageIndex }` | Store the respondent's last page; shown in the v3 documentation examples. |
| POST | `/upload/` (multipart: `file`, `postId`) | Upload a file. |
| GET | `/getResult?resultId=&name=` | Return results grouped by question. |
| GET | `/isCompleted?resultId=&clientId=` | Return completion status. |
| GET | `getSurveyPublicResults/{id}` | Return results when Grant Access is on; used by the Dashboard examples. |

Since **Form Library v2.0** the built-in service integration has been removed, and `loadSurveyFromService` and `sendResult` now only log a warning. Only v1.x clients and code that calls the REST endpoints directly still depend on this API. That includes our own docs and demos.

**Private API** (`https://api.surveyjs.io/private/Surveys/`, authenticated by an `accessKey` query parameter):

- `changeName`
- `changeJson`
- `changeTheme`
- `publish` and `unpublish`
- `uploadFiles` and `files?name=`
- `getSurveyDemoResults?id=`
- Endpoints for listing active or archived surveys, creating, cloning, archiving, restoring, deleting and moving surveys. The site calls these as server routes: `/service/clonesurvey/{id}`, `archivesurvey`, `restoresurvey`, `deletesurvey` and `changeorganizationsurvey`.

### 2.9 Known weaknesses of the current implementation

1. **History** shows timestamps only: there is no diff and no restore, and results are not linked to the survey version they were collected on.
2. **Publishing** is a single on/off switch. There is no schedule, response limit, password, single-use link, custom URL or QR code.
3. **Files** are stored inside responses, which causes the 64 KB response limit and the 4 MB editor limit.
4. **Analytics** stop at 1,000 responses, with no saved filters, crosstabs or text analysis, and nothing to share except the raw public-results toggle.
5. **Permissions** are a single flag, and there is no audit log.
6. **Integrations** do not exist: no webhooks, no email notifications and no Google Sheets or Slack.
7. **Security:** the private `accessKey` is passed in query strings and embedded in page source. Several actions are state-changing GET routes.
8. **Front-end:** the site is server-rendered and coupled to the surveyjs.io website, so it cannot be deployed or open-sourced separately.

## 3. Goals and desired result

### 3.1 Phase 1: parity and replacement

- `my-surveys.surveyjs.io` provides everything in §2, migrated to the new architecture (§7).
- Users sign in with their existing SurveyJS account through SSO with `auth.surveyjs.io`, and all of their surveys, results, projects and members are already there.
- Existing integrations keep working: survey, post and result IDs are preserved and the legacy public API stays compatible (§9).
- The links in the surveyjs.io header ("My Surveys", "All-in-One Demo") and the old `/service/*` URLs redirect to the new application.
- The old section can be switched off.

**Done when:** every item in §6.1 is implemented, the data migration has been rehearsed and verified, and legacy API contract tests pass against the new back-end.

### 3.2 Phase 2: P1 improvements

The features in §6.2 close the weaknesses listed in §2.9 and the most common gaps compared with competitors (§10).

### 3.3 Phase 3: open source and self-hosting

- **A public repository** that customers can clone and extend. Using it commercially requires licences for Survey Creator, Dashboard and PDF Generator; the Form Library is MIT.
- **A free prebuilt Docker image**:
  - `docker run` gives a working single-organization survey service with local accounts and an embedded or bundled database.
  - "Powered by SurveyJS" branding appears wherever it fits.
- **Developer documentation** covering:
  - architecture;
  - the API reference (OpenAPI);
  - how to port the back-end to another platform;
  - how to customize and white-label (white-labelling requires a licence).

### 3.4 Non-goals (for now)

- A visual redesign of the Creator or Dashboard: we use the products as they ship.
- Payments, e-signatures, workflow automation or approval chains (these are Jotform and form.io territory).
- Respondent panels or recruitment (SurveyMonkey Audience style).
- Native mobile or offline data collection apps.

## 4. Users and roles

| Persona | Needs |
|---|---|
| **Evaluator / prospect** | A SurveyJS user trying the products: build a survey quickly, publish it, see results, copy IDs and embed code into a prototype. This is the biggest group today. |
| **Small-team survey owner** | Runs real surveys (feedback, HR, events, education) without writing code; wants sharing, results and exports. |
| **Developer / integrator** | Uses the service as a back-end for surveys embedded in their own app through the API; later self-hosts or forks the project. |
| **Collaborator** | Edits or analyses surveys inside a shared project. |
| **Respondent** | Fills in a survey anonymously or through a link; expects speed, accessibility and progress saving. |
| **Self-hosting admin** (Phase 3) | Deploys the Docker image; manages users, storage, backups and SMTP. |
| **SurveyJS operator** | Our team: monitoring, abuse handling, support look-ups, limits. |

Roles inside a project: **Owner** and **Editor** in Phase 1, which matches today's single "can modify" flag; **Analyst** and **Viewer** are added in Phase 2.

## 5. Use cases

**UC-1 Create and design a survey.**
1. The user clicks Create a Survey in the current project.
2. They build the survey in the Creator: questions, logic, theme and translations.
3. Changes auto-save, and the name can be renamed inline.

**UC-2 Publish and collect responses.**
1. The user publishes the survey and opens Run, or shares the run link.
2. Respondents complete it, and the results are stored.
3. The user unpublishes the survey to stop collecting responses.

**UC-3 Embed in an own application.**
1. The developer copies the Survey, Post or Result ID, or the generated embed code.
2. Their application loads the survey and posts results through the public API.

**UC-4 Analyse results.**
1. The user opens Results.
2. They explore per-question charts (Summary) and raw rows (Table), and filter and arrange both.
3. Their layout is saved.

**UC-5 Export and share results.**
1. The user downloads all results as JSON or CSV, or exports the table as CSV, Excel or PDF.
2. Optionally they turn on public access to the results through a link.

**UC-6 Manage the survey lifecycle.**
- Rename, clone, archive and restore surveys, delete archived ones, and delete all results.
- Toggle storing respondent IP addresses.

**UC-7 Organise with projects.**
1. The user creates a project and invites registered users.
2. They move surveys between Personal and projects.
3. Members edit the project's surveys together.

**UC-8 Review history.**
- See when the survey was edited.
- Phase 2: see what changed, compare versions and restore one.

**UC-9 Migrate seamlessly.**
1. An existing My Surveys user signs in at the new URL.
2. They find all their data, and their existing embeds keep working.

**UC-10 Self-host.**
1. An admin runs the Docker image and configures SMTP, storage and authentication.
2. The team uses it as an internal survey service.

**UC-11 Extend.**
1. A customer clones the repository, adds custom question types or integrations, and swaps in their own database or identity provider.
2. They optionally re-implement the back-end on their own platform against the API contract.

## 6. Functionality

### 6.1 Phase 1: parity (MVP)

**F1 Authentication and account**
- OIDC sign-in through `auth.surveyjs.io`, sign-out, and a session.
- Show the user's name and avatar, and link to the surveyjs.io account settings and billing.
- Show the licence expiry notice as the current site does (hosted edition only).
- Behind an authentication abstraction, so that local accounts are possible for the self-hosted edition (§7).

**F2 Survey list**
- An Active / Archived switch and a project selector: Personal plus projects.
- Create a survey with the default name "New Survey N", then open the editor.
- Rows show the name, created and updated dates, and the "…" menu with exactly the items in §2.1.
- Inline rename.
- Confirmation dialogs for delete and move.
- Clipboard actions for the Survey, Post and Result IDs.

**F3 Editor**
- Survey Creator with the Designer, Preview, Themes, Logic, Translation, JSON and Embed tabs.
- Auto-save of the survey JSON and the theme JSON, with the save state shown.
- File and image uploads from the editor go to file storage. The current 4 MB limit stays configurable.
- The toolbar adds Clear Survey and Help.
- Rename from the editor.
- The Embed tab generates code for the new service URLs.

**F4 Run page**
- A public URL `/s/{surveyId}`, with `/published?id=` kept as an alias that renders the published survey and theme.
- Posts complete results.
- Supports the Creator settings that need the server: one response per client through `clientId`/cookie, and the "completed" state.
- Shows a not-available page when the survey is unpublished or deleted.
- Includes a "Powered by SurveyJS" footer.

**F5 Results**
- **Summary:** Dashboard with per-question visualizers, a question filter and drag/hide; the state is saved per user and survey.
- **Table:** Table view with columns, export to CSV, Excel or PDF, and pagination; the state is saved.
- **Details:** response count, first and last response dates, download all as JSON or CSV, the Grant Access public-results toggle, the Save IP toggle, Delete Results, and reset of the table and summary state.
- Show the 1,000-response dashboard limit notice; we keep the limit for parity and raise it in Phase 2.

**F6 History**
- Record a timestamp and the editing user whenever the survey is saved, and list them.
- Store full JSON snapshots from the start, so that Phase 2 diff and restore need no data migration.

**F7 Projects**
- Create, rename and delete projects.
- Add and remove members by SurveyJS account email.
- Move surveys between projects.
- Phase 1 has the Owner and Editor permission levels only.

**F8 API**
- A new versioned REST API (`/api/v1`) that the SPA uses. It is described in OpenAPI.
- A **legacy compatibility layer** reproducing the public endpoints in §2.8 and the private endpoints in use, so existing clients keep working (§9).

**F9 Data migration**
- Import from the current Azure store: users' surveys with their IDs, results, themes, history timestamps, projects and members, and the archived, published, public-results and IP flags.
- Built as a repeatable script with verification reports.

**F10 Operations**
- Health endpoint, structured logs, configuration through environment variables, and database migrations.
- Basic rate limiting and abuse protection on public endpoints.
- Backups.

### 6.2 Phase 2: P1 improvements

1. **Real versioning.**
   - A snapshot on every publish, a visual diff between versions, and one-click restore.
   - Each result is stamped with the survey version it was collected on, and the dashboard can filter by version.
2. **Distribution controls.**
   - Open and close by schedule; a response limit.
   - Password or PIN protection.
   - Single-use and personal invitation links.
   - Custom slug, QR code, and embed snippets (script tag and iframe).
   - "One response per person" enforced by cookie, login or token.
3. **Partial responses and resume later.** Store progress server-side (`isPartialCompleted`, last page) and let respondents continue through a link or on their device. On by default.
4. **File storage** in local disk, S3-compatible or Azure Blob, through an interface. Responses hold references instead of base64 data, which removes the 64 KB limit.
5. **Analytics without the 1,000 limit.**
   - Server-side aggregation and paging for large datasets.
   - Saved filters, crosstabs, NPS, and a completion and drop-off funnel.
   - **Shareable read-only reports**: a link with an optional password, replacing the raw Grant Access toggle.
6. **Roles and audit.**
   - Owner, Editor, Analyst (results only) and Viewer.
   - Invitations by email to people who don't have an account yet.
   - An audit log of survey, result and membership changes.
7. **Notifications and integrations.**
   - Email to owners on each response or as a digest.
   - Webhooks signed with HMAC, with retries.
   - Google Sheets and Slack integrations.
8. **API tokens**, scoped per project, sent in a header and never in the URL. OpenAPI documentation and a "try it" page.
9. **Templates gallery.** Start from SurveyJS demo templates by industry: healthcare, HR, education, market research.

### 6.3 Backlog (P2 and later, for discussion)

- **AI:**
  - Generate a survey from a prompt.
  - Summarise and group themes in open-text answers.
  - Translate a survey.
  - The model provider is pluggable, so a self-hosted install can use a local LLM.
- **An MCP server** so AI agents can create surveys and query results. OpenForm, Formbricks and form.io already offer this.
- **Data protection:**
  - Retention policies and automatic deletion.
  - Respondent data export and erasure for GDPR.
  - CAPTCHA and spam protection.
- **Enterprise:**
  - SSO through any OIDC or SAML provider in the self-hosted edition.
  - Multiple organizations and tenants with white-labelling.
- **Research features:** quotas, contact lists with invitations and reminders, and SPSS/R export.
- **PDF:** export a filled response to PDF with the SurveyJS PDF Generator, and print forms.
- **Collaboration:** comments on questions and a review/approval step before publishing.

## 7. Architecture and portability principles

The aim is a back-end that any team can re-implement in .NET, PHP, Python or another platform without touching the front-end.

1. **The API comes first, and the contract is the product.**
   - An OpenAPI 3.1 specification is the single source of truth.
   - The front-end talks only to this API: no server-rendered pages and no back-end-specific calls.
2. **The front-end is a static single-page application.** It uses React, because Survey Creator, Form Library and Dashboard all ship React packages. It is built once and served from any web server or CDN, and reads runtime settings from `/config.json` (API URL, edition, branding, auth mode).
3. **The back-end is deliberately thin.**
   - Layers: HTTP handlers → services → repository and storage interfaces.
   - No back-end-specific features leak into the contract: plain JSON over HTTPS, and Server-Sent Events if live updates are needed rather than socket.io.
   - Long-running work, such as big exports, goes through a simple jobs table that any platform can poll.
4. **Portable data model.**
   - A relational schema that is documented, with migrations written as plain SQL so other platforms can reuse them.
   - Survey and theme JSON, results, and the saved dashboard and table state are stored as JSON columns.
   - PostgreSQL is the default; SQLite is used for the single-container Docker image. Repository interfaces leave the door open to MongoDB, SQL Server or MySQL.
5. **Pluggable infrastructure.** File storage (disk, S3 or Azure Blob), email (SMTP or provider) and authentication (SurveyJS OIDC, generic OIDC or local accounts) each sit behind an interface.
6. **Language-agnostic contract tests.**
   - An HTTP-level test suite for the new API and the legacy layer that can run against any back-end implementation.
   - This suite is what makes "port to .NET/PHP" a well-defined task.
7. **The reference implementation is Node.js.**
   - TypeScript, with a mainstream framework such as Fastify or Express (to decide).
   - Validation is generated from the OpenAPI schema.
8. **Security.**
   - Cookie session with CSRF protection for the SPA; bearer tokens for the API.
   - No secrets in URLs, and no state-changing GET requests.
   - Survey JSON and HTML content is sanitized when rendered: the current account has an "XSS in question name" test survey, so this is a real concern.

## 8. Editions, licensing and branding

| | Hosted (`my-surveys.surveyjs.io`) | Open-source repository | Free Docker image |
|---|---|---|---|
| Audience | SurveyJS users and prospects | Customers and developers who extend it | Teams wanting a simple self-hosted service |
| Authentication | SurveyJS account (OIDC) | Pluggable | Local accounts, with OIDC optional |
| Creator, Dashboard, PDF | Licensed by SurveyJS | Customer needs a commercial licence for commercial use | Bundled; terms to be defined (§11) |
| Branding | SurveyJS | Customizable; white-label needs a licence | "Powered by SurveyJS" on the run page, editor, results, emails and login |

## 9. Migration and legacy compatibility

- **Keep the IDs.** Survey, post and result IDs (GUIDs) are migrated unchanged.
- **Legacy public API.** Either point `api.surveyjs.io/public/v1/Survey` at the new back-end's compatibility layer, or keep the old service running in read/write sync until traffic falls to zero. This is to decide; see §11. Contract tests cover every endpoint in §2.8.
- **Legacy private API.** Support the `accessKey` endpoints for a deprecation period, then retire them in favour of API tokens.
- **URL redirects.**

  | Old URL | New URL |
  |---|---|
  | `surveyjs.io/service/mysurveys*` | `my-surveys.surveyjs.io/...` |
  | `/Service/EditSurvey/{id}` | `/surveys/{id}/edit` |
  | `/Service/SurveyResults/{id}` | `/surveys/{id}/results` |
  | `/Service/History/{id}` | `/surveys/{id}/history` |
  | `/published?id={id}` | `/s/{id}` |

- **Cut-over.** Run the migration in a dry run, verify counts and checksums, run a final delta migration, switch the redirects, and keep the old section read-only for a grace period.

## 10. Competitive landscape (summary)

| Product | Model | What we learn from it |
|---|---|---|
| **form.io** | Open-source core server (OSL-3.0, Node and MongoDB, Docker) plus paid self-hosted modules (PDF, reporting, multi-tenancy, enterprise builder). Priced per project or server, not per submission. | The closest match to our open-core plan. Its selling points: form revisions where each submission renders against its own version, field-level audit, multi-tenant sub-projects, development and production stages, and an MCP server. |
| **Formbricks** | AGPL core plus an Enterprise folder. | Self-hosting is a strong draw, but users dislike SSO, roles, audit logs and quotas being Enterprise-only. |
| **OpnForm, HeyForm** | AGPL, Typeform-style. | Unlimited forms and responses when self-hosted; OpnForm offers an MCP server. |
| **LimeSurvey** | GPL, research-oriented. | Quotas, invitation tokens and SPSS export; criticised for a dated UX. |
| **Tally, Fillout** | SaaS with generous free tiers. | A low-friction UX; partial submissions and version history only on paid plans. |
| **Typeform, SurveyMonkey, Jotform, Qualtrics** | Commercial SaaS. | Response caps and paywalls are the most common complaints; AI summaries are becoming standard. |
| **Google Forms, Microsoft Forms** | Free, bundled with their office suites. | No password protection, no custom branding, no save-and-resume for anonymous respondents. |

**Features every product has:**
- Builder, logic and themes.
- Link, embed and QR sharing.
- Closing by date or response limit.
- Email on submit.
- Auto-generated charts.
- CSV/Excel export.
- Webhooks, Zapier and Google Sheets.
- Duplicate and archive.
- Shared workspaces.

**Where we can stand out:**
- The most capable open form engine on the market (SurveyJS).
- No response caps.
- Roles, audit and versioning in the core product.
- One-command self-hosting.
- A portable back-end contract.

## 11. Open questions

1. **Legacy API.** Should the new back-end take over `api.surveyjs.io` through the compatibility layer, or do we run both systems during the transition? How many active v1.x and REST clients are there? We need traffic data.
2. **Docker image licence terms.** May the free image be used commercially with Creator and Dashboard included, as long as it stays unmodified and branded? Which licence covers the repository's own code (MIT or another)?
3. **Hosted limits.** Do we keep the 64 KB, 4 MB and 1,000 limits in Phase 1 for exact parity, or lift some right away?
4. **Front-end framework.** React is assumed, as above; the alternatives are Angular, Vue or vanilla JS.
5. **Database.** PostgreSQL in hosted, or stay on Azure storage or Cosmos? The answer affects the migration effort.
6. **Account deletion and data retention policy** for the hosted service, for GDPR.
7. **Project management screens.** Capture the current UI from surveyjs.io Settings to confirm Phase 1 scope.
8. **Analytics and telemetry.** The current site runs GTM and ad pixels. What do we want on the new subdomain, and what is allowed in the self-hosted image (probably nothing)?
