# My Surveys: product idea

Status: agreed, ready for the specification · Last updated: 2026-10-14

## 1. Summary

We will build a standalone web application, with a front-end and a back-end, that does everything the current **My Surveys** section of surveyjs.io does (`https://surveyjs.io/service/mysurveys`) and then goes further.

Rollout happens in three steps:

1. **Replace (parity).** Ship the application at `my-surveys.surveyjs.io` and retire the old section. In this phase the app:
   - looks exactly like surveyjs.io and reproduces the current UI 1:1;
   - signs users in with surveyjs.io authorization;
   - works directly on the databases and Azure storage that surveyjs.io already uses, so no data migration is needed.
2. **Improve (P1).** Prepare the product for customers: login/password authentication and a choice of popular databases. Add the product improvements listed in §6.2.
3. **Open up.** Publish the source code under the **MIT** licence. Customers can clone the repository and build on it; using the commercial SurveyJS components (Survey Creator, Dashboard, PDF Generator) requires a licence. We also publish a free, prebuilt Docker image that can be used with the commercial components included and carries "Powered by SurveyJS" branding wherever it fits.

The back-end starts on **Node.js**, but it must be easy to port to other server platforms such as .NET or PHP. In practice that means the HTTP API contract, not the Node code, is the source of truth (see §7). Detailed technical decisions belong to the next step, the specification.

## 2. Background: My Surveys today

My Surveys is the private workspace of the SurveyJS "Free Survey Tool" / All-in-One Demo. The inventory below was collected from the live site on 2026-10-13 while logged in, plus the public product page. **Phase 1 reproduces this UI 1:1.**

### 2.1 Survey list (`/service/mysurveys`)

- An **Active / Archived** switch.
- A **project selector**: "Personal Surveys" plus each project the user belongs to. The URL calls it an *organization* (`/Service/MySurveys/{orgId}`).
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

### 2.6 Projects (Settings → Manage MySurveys, `surveyjs.io/manage#manage-mysurveys`)

Projects are managed in the surveyjs.io account settings, not in My Surveys itself. The section text reads: *"Create multiple projects to group the web forms you have built with the Free Survey Tool. Add registered users to share the forms with them and edit your forms together."*

- Projects appear as a list of expandable cards, one per project, followed by a **Create a Project** card.
- Expanding a card shows its members (display name, plus an "Admin" label where it applies).
- Each project has two roles: **admin** and **user**.
- Admin-only actions:

  | Action | How it works |
  |---|---|
  | Rename project | Edit the name and press OK. |
  | Delete project | Asks for confirmation. |
  | Add member | By the email of an already registered surveyjs.io user; an error is shown otherwise. |
  | Remove member | Asks for confirmation. |
  | Change a member's role | Make admin / make user. |

- Creating a project adds the creator as its first member, as admin.
- Current endpoints (all on surveyjs.io):
  - `/api/ManageUser/writeOrganization` (create and rename)
  - `removeOrganization`
  - `addUserToOrganization`
  - `removeUserFromOrganization`
  - `changeUserRoleInOrganization`

Other Settings sections (License Manager, Details, Billing, Renewals, External Logins, Delete Account) belong to the surveyjs.io site and are **out of scope**. The exception is *Delete Account*, which must also delete the user's My Surveys data (§8).

### 2.7 Storage and limits

- Survey definitions and results are stored in Azure storage accounts. Users and projects are stored in the surveyjs.io site database. There is no limit on the number of submissions or the size of a survey JSON.
- Each **response is limited to 64 KB**. File-upload and signature answers are stored inside the response, so large uploads fail.
- The dashboard shows at most 1,000 responses.
- No service-level guarantee is offered for data in the free tool.

### 2.8 Current API (for reference)

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

**Private API** (`https://api.surveyjs.io/private/Surveys/`, authenticated by an `accessKey` query parameter):

- `changeName`
- `changeJson`
- `changeTheme`
- `publish` and `unpublish`
- `uploadFiles` and `files?name=`
- `getSurveyDemoResults?id=`
- The list, create, clone, archive, restore, delete and move actions, which the site calls as server routes: `/service/clonesurvey/{id}`, `archivesurvey`, `restoresurvey`, `deletesurvey` and `changeorganizationsurvey`.

Since **Form Library v2.0** the built-in service integration has been removed. Only v1.x clients and code that calls these endpoints directly still depend on them.

**Decision:** the new application gets a **new, more standard and convenient API**, described in full in the specification. It does not copy this one. Because the new app works on the same data stores during the parity phase, the existing `api.surveyjs.io` service keeps serving legacy clients unchanged (§9).

### 2.9 Known weaknesses of the current implementation

1. **History** shows timestamps only: there is no diff and no restore, and results are not linked to the survey version they were collected on.
2. **Publishing** is a single on/off switch. There is no schedule, response limit, password, single-use link, custom URL or QR code.
3. **Files** are stored inside responses, which causes the 64 KB response limit and the 4 MB editor limit.
4. **Analytics** stop at 1,000 responses, with no saved filters, crosstabs or text analysis, and nothing to share except the raw public-results toggle.
5. **Permissions** are a single flag (admin/user at project level), and there is no audit log.
6. **Integrations** do not exist: no webhooks, no email notifications and no Google Sheets or Slack.
7. **Security:** the private `accessKey` is passed in query strings and embedded in page source. Several actions are state-changing GET routes.
8. **Front-end:** the site is server-rendered and coupled to the surveyjs.io website, so it cannot be deployed or open-sourced separately.

## 3. Goals and desired result

### 3.1 Phase 1: parity and replacement

The goal is for `my-surveys.surveyjs.io` to replace the old section without users noticing anything except the new address and the lifted limits.

**Requirements**
- **Same look.**
  - Styled exactly like surveyjs.io: the same design system (the `v2-class---*` styles), fonts and icons, and the site header and footer with the user and cart menus.
  - Every screen in §2 is reproduced 1:1, including project management (§2.6).
- **Same authorization.** Users sign in with surveyjs.io authorization: the `auth.surveyjs.io` OAuth/OIDC server, which the site already uses with authorization code + PKCE. The app is registered as one more client of that server. Sign-out and the account links lead back to surveyjs.io.
- **Same data.**
  - The app connects **directly** to the **Azure storage accounts used by surveyjs.io**, which hold surveys, themes, results, files and history, with no intermediate API (D12).
  - Any related data held in the surveyjs.io site database, such as user profiles, projects and members, is accessed directly as well. The specification maps exactly which entity lives where.
  - No data migration is needed, and IDs stay as they are.
  - Old and new UIs can run side by side during the rollout.
- **Legacy coexistence.**
  - `api.surveyjs.io` (§2.8) keeps working against the same data.
  - Anything the new app writes must stay readable by the legacy service and the reverse, unless a lifted limit (below) deliberately changes a format.
- **Redirects.**

  | Old URL | New URL |
  |---|---|
  | `surveyjs.io/service/mysurveys*` | `my-surveys.surveyjs.io/...` |
  | `/Service/EditSurvey/{id}` | `/surveys/{id}/edit` |
  | `/Service/SurveyResults/{id}` | `/surveys/{id}/results` |
  | `/Service/History/{id}` | `/surveys/{id}/history` |
  | `/published?id={id}` | `/s/{id}` (the old URL keeps working) |

  The site's "My Surveys" and "All-in-One Demo" links point to the new app.

**Limits lifted right away.** This is a proposal; the final list is confirmed in the specification.

| Current limit | Phase 1 proposal | Notes |
|---|---|---|
| Dashboard shows the first 1,000 responses | Remove: load results with paging and aggregate on the server where needed | The UI changes only by dropping the banner. |
| 4,000 KB of editor uploads per survey | Raise and make configurable | Files go to Azure Blob storage. |
| 64 KB per response (inline files and signatures) | Lift by storing respondent files in Azure Blob storage; the response keeps only a reference | The specification checks how the legacy `getResult` and export endpoints handle references (D11). |

**Done when:**
- every item in §6.1 is implemented;
- the UI is checked 1:1 against the current site;
- the app runs on the production data stores in parallel with the old section;
- the old section is switched off.

### 3.2 Phase 2: P1, customer readiness and improvements

- **Customer readiness**, needed before the code reaches customers:
  - **login/password ("basic") authentication**;
  - a choice of databases: **SQLite** by default and **PostgreSQL** for production (D15);
  - pluggable file storage (§6.2 A).
- **Product improvements:** the features in §6.2 B, which close the weaknesses listed in §2.9 and the most common gaps compared with competitors (§10).

### 3.3 Phase 3: open source and self-hosting

- **A public repository** whose own code is under the **MIT** licence. Customers can clone and extend it, and connect it to the database they already use. Survey Creator, Dashboard and PDF Generator remain commercial: building on them in a customer's own product requires a licence. The Form Library is MIT.
- **A free prebuilt Docker image**:
  - It includes the commercial SurveyJS components and may be used free of charge.
  - `docker run` gives a working single-organization survey service with login/password accounts and a bundled **SQLite** database by default, or a connection to the user's own database (**PostgreSQL** is recommended for production).
  - "Powered by SurveyJS" branding appears wherever it fits.
- **Developer documentation** covering:
  - architecture;
  - the API reference (OpenAPI);
  - how to add a database provider;
  - how to port the back-end to another platform;
  - how to customize the app.

### 3.4 Non-goals (for now)

- A visual redesign: Phase 1 is deliberately 1:1.
- The surveyjs.io account features (licences, billing, renewals, external logins).
- Payments, e-signatures, workflow automation or approval chains.
- Respondent panels or recruitment.
- Native mobile or offline data collection apps.
- Analytics and telemetry on the subdomain and in the Docker image. This is discussed after P1.

## 4. Users and roles

| Persona | Needs |
|---|---|
| **Evaluator / prospect** | A SurveyJS user trying the products: build a survey quickly, publish it, see results, copy IDs and embed code into a prototype. This is the biggest group today. |
| **Small-team survey owner** | Runs real surveys (feedback, HR, events, education) without writing code; wants sharing, results and exports. |
| **Developer / integrator** | Uses the service as a back-end for surveys embedded in their own app through the API; later self-hosts or forks the project. |
| **Project admin / member** | Manages a shared project and its members, or edits and analyses the project's surveys. |
| **Respondent** | Fills in a survey anonymously or through a link; expects speed, accessibility and progress saving. |
| **Customer developer** (Phase 3) | Clones the repository, connects their own database and identity, and extends the app. |
| **Self-hosting admin** (Phase 3) | Deploys the Docker image; manages users, the database, storage, backups and SMTP. |
| **SurveyJS operator** | Our team: monitoring, abuse handling, support look-ups, limits. |

Roles in a project:
- **Phase 1:** admin and user, exactly as today.
- **Phase 2:** extended to Owner, Editor, Analyst and Viewer.

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
2. Their application loads the survey and posts results through the API.

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
1. A user creates a project and becomes its admin.
2. The admin adds registered users by email and makes them admins or users.
3. Surveys are moved between Personal and projects, and members edit the project's surveys together.

**UC-8 Review history.**
- See when the survey was edited.
- Phase 2: see what changed, compare versions and restore one.

**UC-9 Seamless switch.**
1. An existing My Surveys user follows the old link or bookmark and lands on `my-surveys.surveyjs.io`.
2. They are signed in through surveyjs.io.
3. They see the same data and the same UI, and their existing embeds keep working.

**UC-10 Self-host.**
1. An admin runs the Docker image, connected to a bundled database or to their own, and configures SMTP and storage.
2. Users sign in with a login and password.
3. The team uses it as an internal survey service.

**UC-11 Extend.**
1. A customer clones the repository and connects their own database and identity provider.
2. They add custom question types or integrations.
3. They optionally re-implement the back-end on their own platform against the API contract.

## 6. Functionality

### 6.1 Phase 1: parity (MVP)

**F1 Authorization**
- Sign in through surveyjs.io authorization (`auth.surveyjs.io`), sign out, and keep a session.
- Show the user's name and avatar, and link to the surveyjs.io Settings, Help Desk and Billing.
- Show the licence-expiry notice exactly as the current site does.
- Implemented behind an authentication-provider interface, so that login/password and other providers can be added in P1 (§7).

**F2 Site look and feel**
- The surveyjs.io design system: the shared site header (navigation, GitHub stars, cart and account menus, the My Surveys button), the footer and the cookie-consent banner.
- The header, footer and styles are **copied** from surveyjs.io (D14).
- The shell is a **configuration option**: the default is the "surveyjs.io" shell, and a different one can be selected, such as the neutral "Powered by SurveyJS" shell for the open-source edition and Docker image, or a customer's own.

**F3 Survey list**
- Exactly as described in §2.1: the Active / Archived switch, the project selector, Create a Survey, rows, inline rename, the "…" menu, confirmations and the ID clipboard actions.

**F4 Editor**
- Exactly as described in §2.2: Survey Creator with all its tabs, auto-save of the survey and theme JSON, uploads, Clear Survey, Help, and rename from the footer.
- The Embed tab generates code for the new service URLs.

**F5 Run page**
- `/s/{surveyId}`, with `/published?id=` kept as an alias.
- Applies the survey's theme and posts complete results.
- Supports the survey settings that need the server ("Limit to one response", the completed state).
- Shows a not-available page when the survey is unpublished or deleted.
- Keeps today's footer.

**F6 Results**
- Exactly as described in §2.4: Summary, Table and Details, with the saved and resettable layout state, Grant Access, Save IP, Delete Results, and the JSON/CSV/Excel/PDF exports.
- No 1,000-response limit (§3.1).

**F7 History**
- Exactly as described in §2.5.
- Snapshots of the survey JSON are stored from now on, so that diff and restore in P1 work for new edits.

**F8 Projects**
- Exactly as described in §2.6: create, rename and delete projects; add members by registered email; remove members; switch members between admin and user; move surveys between projects.
- Built in the new app with the surveyjs.io look.
- Settings → Manage MySurveys on surveyjs.io also stays. Both work on the same data, so a change made in one is visible in the other (D13).

**F9 Data access to surveyjs.io stores**
- Repository implementations that connect **directly** to the surveyjs.io **Azure storage accounts** (surveys, themes, results, history, files) and to any related site-database data (users, projects, members), with no intermediate API.
- Data formats stay compatible with the legacy service and `api.surveyjs.io`.

**F10 New API**
- A new REST API (`/api/v1`) used by the front-end.
- Resource-oriented and documented in full in OpenAPI as part of the specification.
- Sessions for the front-end; tokens for programmatic access.
- No secrets in URLs, and no state-changing GET requests.

**F11 Operations**
- Health endpoint, structured logs and configuration through environment variables.
- Rate limiting and abuse protection on public endpoints.
- Deployment to the surveyjs.io hosting environment.

### 6.2 Phase 2: P1

**A. Customer readiness**
1. **Login/password ("basic") authentication.**
   - Sign-up and sign-in.
   - Password hashing with a modern algorithm, password reset by email, email verification and an admin-created users mode.
   - Lockout and rate limiting.
2. **A choice of databases**, through a thin, documented provider interface (D15):
   - **SQLite**, the default, bundled in the single-container image.
   - **PostgreSQL**, the recommended production database. Customers can point the app at a PostgreSQL server they already run.
   - More databases come after P1 (§6.3) and use the same interface and provider test suite.
3. **Pluggable file storage**: Azure Blob, S3-compatible or local disk.
4. **Schema setup and migrations** for every supported database.
5. **Survey-data migration between providers**, for example from the Azure-storage format to SQL. This depends on the decision about moving away from Azure (§9).

**B. Product improvements**
1. **Real versioning.**
   - A snapshot on every publish, a visual diff between versions, and one-click restore.
   - Each result is stamped with the survey version it was collected on, and the dashboard can filter by version.
2. **Distribution controls.**
   - Open and close by schedule; a response limit.
   - Password or PIN protection.
   - Single-use and personal invitation links.
   - Custom slug, QR code, and embed snippets (script tag and iframe).
   - "One response per person" enforced by cookie, login or token.
3. **Partial responses and resume later.** Store progress server-side and let respondents continue through a link or on their device.
4. **Analytics.**
   - Saved filters, crosstabs, NPS, and a completion and drop-off funnel.
   - **Shareable read-only reports**: a link with an optional password, replacing the raw Grant Access toggle.
5. **Roles and audit.**
   - Owner, Editor, Analyst (results only) and Viewer.
   - Invitations by email to people who don't have an account yet.
   - An audit log of survey, result and membership changes.
6. **Notifications and integrations.**
   - Email to owners on each response or as a digest.
   - Webhooks signed with HMAC, with retries.
   - Google Sheets and Slack integrations.
7. **API tokens**, scoped per project, sent in a header. Interactive API documentation.
8. **Templates gallery.** Start from SurveyJS demo templates by industry.
9. **Privacy tools** (§8): account-level data export, plus retention settings for results.

### 6.3 Backlog (after P1, for discussion)

- **AI:**
  - Generate a survey from a prompt.
  - Summarise and group themes in open-text answers.
  - Translate a survey.
  - The model provider is pluggable, so a self-hosted install can use a local LLM.
- **More databases:** MySQL/MariaDB, Microsoft SQL Server and MongoDB providers, through the same provider interface and test suite as SQLite and PostgreSQL (D15).
- **An MCP server** so AI agents can create surveys and query results. OpenForm, Formbricks and form.io already offer this.
- **Security and identity:** generic OIDC and SAML SSO for self-hosted installs, CAPTCHA and spam protection, and 2FA for login/password accounts.
- **Multi-organization / tenant mode** with white-labelling.
- **Research features:** quotas, contact lists with invitations and reminders, and SPSS/R export.
- **PDF:** export a filled response to PDF with the SurveyJS PDF Generator.
- **Collaboration:** comments on questions and a review/approval step before publishing.
- **Analytics and telemetry** for the hosted site and the image.

## 7. Architecture and portability principles

The aim is a back-end that any team can re-implement in .NET, PHP, Python or another platform without touching the front-end. Concrete technology choices are made in the next step, the specification.

1. **The API comes first, and the contract is the product.**
   - An OpenAPI specification is the single source of truth.
   - The front-end talks only to this API: no server-rendered pages and no back-end-specific calls.
2. **The front-end is a static React single-page application.** Survey Creator, Form Library and Dashboard all ship React packages. It is built once and served from any web server or CDN, and reads runtime settings from a config file (API URL, edition, branding, auth mode).
3. **The back-end is deliberately thin.**
   - Layers: HTTP handlers → services → provider interfaces.
   - Plain JSON over HTTPS, with nothing specific to one back-end platform in the contract.
   - Long-running work, such as big exports, goes through a simple, portable jobs mechanism.
4. **Everything external sits behind a provider interface.**

   | Area | Phase 1 | P1 and later |
   |---|---|---|
   | Data | **SurveyJS legacy provider**: the surveyjs.io site database plus Azure storage | P1: SQLite (default), PostgreSQL. Later: MySQL/MariaDB, SQL Server, MongoDB |
   | Files | Azure Blob | S3-compatible, local disk |
   | Authentication | surveyjs.io OIDC | Login/password, generic OIDC/SAML |
   | Email | — | SMTP, provider APIs |
   | Look and feel (shell) | The surveyjs.io shell, copied from the site; selected through configuration | A neutral "Powered by SurveyJS" shell, or a custom one |

5. **A portable data model.**
   - A documented logical schema: users, projects, members, surveys, versions, results, files and UI state.
   - Survey and theme JSON, results, and the saved dashboard and table state are kept as JSON documents in every provider.
   - SQL migrations are kept as plain SQL so other platforms can reuse them.
6. **Language-agnostic contract tests.**
   - An HTTP-level test suite for the API that runs against any back-end implementation.
   - A provider test suite that runs against every database adapter.
   - Together these make "port to .NET/PHP" or "add a database" a well-defined task.
7. **Security by default.**
   - Cookie session with CSRF protection for the SPA; bearer tokens for the API.
   - No secrets in URLs.
   - Survey JSON and HTML content is sanitized when rendered.
   - Least-privilege credentials for the surveyjs.io databases.

## 8. Editions, licensing, branding and data protection

| | Hosted (`my-surveys.surveyjs.io`) | Open-source repository | Free Docker image |
|---|---|---|---|
| Audience | SurveyJS users and prospects | Customers who extend it | Teams wanting a simple self-hosted service |
| Code licence | — | **MIT** | Free to use |
| Creator, Dashboard, PDF | Licensed by SurveyJS | Commercial licence required to build on them | **Included; free use allowed** |
| Authentication | surveyjs.io | Pluggable (login/password, OIDC, …) | Login/password; OIDC later |
| Database | surveyjs.io site database plus Azure storage | Any supported provider | Bundled SQLite by default, or the user's own PostgreSQL |
| Branding | surveyjs.io look (1:1) | Customizable | "Powered by SurveyJS" on the run page, editor, results, login and emails |

**Data protection (GDPR).** This is our proposal.
- **Roles.** For the hosted service, SurveyJS is the controller of account data and a processor of survey responses on behalf of the survey owner. For self-hosted installs, the operator is the controller, and the product supplies the tools they need.
- **Data minimization.**
  - Respondent IP addresses are stored only when the owner enables "Save Respondent IP"; it is off by default.
  - Respondent data never appears in application logs.
  - IPs in access logs are truncated, or kept for a limited time.
- **Erasure.**
  - Deleting results, a survey or a project removes the data and its files permanently. Backups age out within a stated period (proposed: 30 days).
  - **Deleting a surveyjs.io account** deletes the user's personal surveys, results and files, and removes them from projects. A project whose last admin is deleted passes to its next member, or is deleted if no members are left.
- **Access and portability.** Owners can already export results (JSON/CSV). P1 adds an account-level export of all surveys and results.
- **Retention.** P1 adds an optional per-survey policy that automatically deletes results after N days.
- **Transparency.** The run page links to the Terms of Use and Privacy Statement, which a self-hosted install can configure. Survey owners are responsible for informing their respondents.
- **Data location.** The hosted data stays in our current Azure regions. A self-hosted install keeps all data in the operator's environment and makes no outbound calls by default.

## 9. Rollout, legacy compatibility and storage roadmap

- **Phase 1 needs no data migration.**
  - The new app reads and writes the existing stores.
  - The old section and `api.surveyjs.io` keep working on the same data.
  - We switch traffic with redirects and can roll back by removing them.
- **Rollout steps:**
  1. Internal testing on production data, read-only first.
  2. Beta: an opt-in link from the old section.
  3. Default: redirects switched on.
  4. The old UI is removed.
- **Legacy API.** `api.surveyjs.io` remains the legacy service for v1.x and REST clients. The new app does not re-implement it. Its retirement is a separate decision.
- **Storage roadmap (decided after P1, D10).** Whether and when to move hosted data from Azure storage accounts to another store with compatible functionality, for example PostgreSQL with JSON columns plus Blob/S3 for files.
  - **Reasons to move:** querying and aggregating results (crosstabs, filters, version filtering), transactions, using the same provider as customers, and less format coupling with the legacy service.
  - **Reasons to wait:** the legacy `api.surveyjs.io` reads the same storage, so moving means either migrating the legacy service too or keeping the two in sync.
  - **Decision:** decide after P1, once the provider layer and the SQL providers exist. The migration then becomes "copy from the legacy provider to the SQL provider" plus switching the legacy API over.

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
- An MIT-licensed app with a free image that includes the commercial components.
- Roles, audit and versioning in the core product.
- A choice of databases.
- A portable back-end contract.

## 11. Decisions and open questions

**Decisions (2026-10-13; D15 added 2026-10-14)**

| # | Topic | Decision |
|---|---|---|
| D1 | Legacy API | The new API differs from `api.surveyjs.io`: more standard and convenient, and specified in detail in the specification. |
| D2 | Licensing | The repository's own code is MIT. The free Docker image may be used with the SurveyJS commercial products included. |
| D3 | Limits | Some limits are lifted right away in Phase 1 (proposal in §3.1). |
| D4 | Front-end | React. Exact technical choices are made in the next step, the specification. |
| D5 | Database | Parity phase: stay on the surveyjs.io databases and Azure storage. Afterwards, support several popular databases (order and default in D15). |
| D6 | GDPR | Handled per the proposal in §8. |
| D7 | UI | Phase 1 reproduces the current UI 1:1, including projects (§2.6), with surveyjs.io styling. |
| D8 | Analytics and telemetry | Discussed after P1. |
| D9 | Authentication | surveyjs.io authorization on our site; login/password for customers in P1. |
| D10 | Storage roadmap | Whether and when to move off Azure storage is decided after P1 (§9). |
| D11 | Limits | The Phase 1 proposal in §3.1 stands as written. The check of how legacy endpoints handle file references is done during the specification. |
| D12 | Access to stores | The app connects directly to Azure storage. There is no intermediate surveyjs.io API. |
| D13 | Project management | Both exist: the Projects screen in the new app, and Settings → Manage MySurveys on surveyjs.io. They work on the same data. |
| D14 | Site shell | Copy the header, footer and design-system styles from surveyjs.io. The shell is a configuration option, so a different shell can be used. |
| D15 | Databases after Phase 1 | Storage stays behind a thin provider interface. SQLite is the default and is bundled in the Docker image; PostgreSQL is the recommended production database. P1 ships these two. MySQL/MariaDB, SQL Server and MongoDB come after P1 through the same interface. |

**Open questions**

None at the moment. New questions will come up during the specification.
