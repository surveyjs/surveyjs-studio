# My Surveys

My Surveys is the survey section of [surveyjs.io](https://surveyjs.io). You create surveys with
Survey Creator, publish them, collect responses and look at the results. This repository is the
SurveyJS team's rebuild of that section as a standalone application. It will run at
`studio.surveyjs.io` and replace the old section. After that it will be open-sourced, with a
free Docker image for running your own copy.

**Naming.** The repository is [`surveyjs/surveyjs-studio`](https://github.com/surveyjs/surveyjs-studio), and the
image, the packages (`@surveyjs-studio/*`) and the hosting address (`studio.surveyjs.io`) use that name. The app's
pages still say "My Surveys" until the interface is renamed. The app's Azure containers keep their names
(`my-surveys-files`, `my-surveys-views`), because they hold data.

The back end is described by one OpenAPI 3.1 file, [`contract/openapi.yaml`](contract/openapi.yaml).
The Node.js server in this repository is the reference implementation. A back end in another
language is accepted when it passes the conformance suite in this repository.

## Deployment modes

The same code is meant to run in several modes. Configuration chooses the storage, the user
directory, the sign-in methods and the look ([idea.md §3.0](idea.md#30-deployment-modes-2026-10-19)).

| Mode                                       | What it is                                                                                                                                   | State                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **1.1–1.2 Hosted on the surveyjs.io data** | `studio.surveyjs.io` on the current surveyjs.io databases and Azure storage, with surveyjs.io sign-in. The old section is removed afterwards | Phase 1, [plan.md](plan.md): built, ready to roll out                                  |
| **1.3 Hosted on its own data**             | Surveys, results and projects move off Azure. Users stay on surveyjs.io                                                                      | [spec-hosted.md](spec-hosted.md), [plan-hosted.md](plan-hosted.md)                     |
| **2a Sandbox**                             | `studio.demo.surveyjs.io`: a static site where anyone tries every feature on demo data kept in their browser                                 | [spec-self-hosted.md](spec-self-hosted.md), [plan-self-hosted.md](plan-self-hosted.md) |
| **2b Free Docker image**                   | A self-hosted service with its own database, password accounts and "Powered by SurveyJS" branding                                            | Same as 2a                                                                             |
| **3 Custom development**                   | Your own fork: your own shell, database and sign-in (Google, GitHub, Facebook, surveyjs.io). Needs SurveyJS licences                         | Same as 2a                                                                             |
| **4 Development**                          | Local modes for development and tests: in memory, on a replica of the legacy stores, or (product owner) on the real stores                   | Available now (see [Quick start](#quick-start))                                        |

## Status

**Phase 1 is done**: Steps 1–14 are merged, and the compatibility smoke test passed on production on 2026-10-23
([progress](plan.md#progress)). The app is not deployed yet: hosting is the next step. What works:

- **Every screen of the current My Surveys.**
  - **Survey list:**
    - personal surveys and projects; Active and Archived;
    - Create a Survey; inline rename;
    - the "…" menu: Run, Edit, Clone, Publish/Unpublish, the survey IDs, View Results, View History, Move to Project, Archive, Restore and Delete.
  - **Editor:**
    - Survey Creator with autosave of the survey and theme;
    - a "changed by someone else" notice instead of silent overwrites;
    - image and file uploads with a per-survey quota;
    - the Embed tab.
  - **Run page** at `/s/{id}`:
    - the survey's theme;
    - file questions, with files stored outside the response;
    - "Limit to one response";
    - respondent IP saved only when the owner turns it on;
    - submissions that count once even when repeated.
  - **Results:**
    - Summary, Table and Details over **all** responses, with no 1,000 cap;
    - per-user saved layouts;
    - downloads in JSON and CSV, and Table exports in CSV, Excel and PDF;
    - Delete Results;
    - Grant Access, with the public page at `/results/{id}`.
  - **History page**, and the **Projects page**: create, rename and delete projects; add, remove and change members; leave a project.
- **Every contract operation.** Only `passwordLogin` answers `501 Not Implemented`; password sign-in arrives with the self-hosted track.
- **Two storage providers:**
  - in memory, for development and tests;
  - `azure-legacy`, which reads and writes the current surveyjs.io stores in their own formats, so the old pages and `api.surveyjs.io` keep working on the same data.
- **Sign-in** through surveyjs.io (OAuth 2.0), or through a development sign-in page with seed users.
- **Accounts and data protection:**
  - users come from a user directory chosen by configuration: the surveyjs.io SQL `Users` table, or the surveyjs.io user API that [docs/integrations/surveyjs-user-api.md](docs/integrations/surveyjs-user-api.md) specifies;
  - a deleted surveyjs.io account erases its data: through a signed webhook, the `pnpm account:erase` command, or a reconciliation check;
  - security headers, and no respondent answers in the logs;
  - no legacy URLs in the app: the surveyjs.io site redirects old links using [docs/operations/surveyjs-redirects.md](docs/operations/surveyjs-redirects.md).
- **Production readiness (Step 14):**
  - one Docker image that serves the web app and the API from one origin, runs as non-root and has a health check;
  - `/readyz` names the dependency that fails; JSON logs with a start-up summary, request ids and the operation;
  - `READ_ONLY=true` for the first phase on production data;
  - `pnpm smoke:legacy`, which proves on production that `api.surveyjs.io` reads what the app writes.
- **The same look as surveyjs.io, proven by screenshots:** `pnpm e2e:visual` compares 18 screens with baselines captured from the live site, in Chromium, Firefox and WebKit ([docs/testing.md › Visual parity](docs/testing.md#visual-parity)).
- **Tests:**
  - unit tests;
  - the HTTP conformance suite;
  - the shared provider suite;
  - Playwright end-to-end tests in Chromium, Firefox and WebKit.

  They run in memory and on the legacy replica, in CI. The visual parity tests run locally on Windows, where the
  baselines were captured.

**Next:**

- Hosting (most likely Hetzner) as a separate step: the host, the https proxy, DNS, the image registry, the Azure
  network rules, and the inputs the [runbook](docs/operations.md#what-each-step-needs) lists for its step 1.
- Then the rollout: internal use read-only, a beta link, the redirects, and the removal of the old section.

After that, the hosted-migration and self-hosted tracks run at the same time ([After Phase 1](plan.md#after-phase-1)).

## Quick start

You need Node.js 24 (the version in [`.nvmrc`](.nvmrc)) and pnpm 12.11.2.

```sh
nvm use            # or any other way to get Node 24.21.0; nvm-windows: nvm use 24.21.0
corepack enable    # makes the pnpm version in package.json available
pnpm install
pnpm demo
```

Then open <http://localhost:5173>. The browser goes to a "Sign in as…" page: this is the development sign-in, with no password. Choose **Olivia Owner**. You land on **My Surveys**, inside the surveyjs.io header and footer, with Olivia's seeded surveys and projects.

From there you can:

- open a survey in the editor;
- publish it and run it;
- look at its results;
- manage projects through **Projects** in the account menu.

Other seed users show the same data from other roles: Adam Admin, Mia Member and Oscar Outsider. Data is kept in memory and is reset when the server restarts. The API reference is at <http://localhost:3000/api/docs>.

If `corepack enable` is not possible (on Windows it may need an administrator shell), use
`corepack pnpm <command>` instead of `pnpm <command>`, or install pnpm with
`npm install -g pnpm@12.11.2`. More detail is in [docs/development.md](docs/development.md).

### Azurite mode

To run against a local replica of the legacy stores you also need Docker:

```sh
pnpm demo:azurite:up     # starts Azurite, SQL Server and the mock OIDC server, loads the fixtures
pnpm demo:azurite        # the app on the replica; type owner on the mock OIDC server's sign-in page
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
pnpm demo:azurite:down   # stops them and deletes their data
```

See [Development](docs/development.md#azurite-mode) and the [demo scripts](docs/demo/).

### SQLite and PostgreSQL modes

The SQL providers of the self-hosted track (surveys only so far; the other stores stay in memory until its Step 2):

```sh
pnpm seed:sqlite && pnpm dev:sqlite       # surveys in server/.data/surveyjs-studio.db
pnpm seed:postgres && pnpm dev:postgres   # surveys in PostgreSQL in Docker (pnpm postgres:down deletes it)
```

See [Development](docs/development.md#sqlite-and-postgresql-modes).

### Every run mode

[Running the app](docs/running.md) lists every configuration that runs today (the memory and Azurite demos,
prod-like, and the two runs on production data), how to start and stop each one, and which file holds its settings.

## Running in production

One image serves every deployment mode; its settings choose the mode. Build it with `pnpm image:build`, try it with
`pnpm prod-like:up`, and run it behind an https reverse proxy. [Operations](docs/operations.md) has the details.

| Mode      | Settings                                                                                                               | Ready                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1.1       | `APP_EDITION=hosted`, `STORAGE_PROVIDER=azure-legacy` with the three `LEGACY_*` strings, sign-in at `auth.surveyjs.io` | Yes: from rollout step 1                 |
| 1.2       | As 1.1, plus `ACCOUNT_WEBHOOK_SECRET`                                                                                  | Yes: from rollout step 4                 |
| 1.3       | The hosted-migration track                                                                                             | Not yet                                  |
| 2a, 2b, 3 | The self-hosted track                                                                                                  | Not yet                                  |
| 4         | In memory or on the local replica, with the dev sign-in or the mock OIDC server                                        | Yes ([Running the app](docs/running.md)) |

- [Configuration by deployment mode](docs/operations.md#configuration-by-deployment-mode): every setting of each mode.
- [Deployment](docs/operations.md#deployment), [monitoring](docs/operations.md#monitoring) and
  [read-only mode](docs/operations.md#read-only-mode).
- [The rollout and rollback runbook](docs/operations.md#rollout-and-rollback-runbook), for the SurveyJS team and the
  surveyjs.io site team.

- [Updating studio.surveyjs.io](docs/operations/hetzner-server-setup.md#6-update-roll-back-status): deploying a
  published image tag, the status and the rollback.

## Repository layout

| Directory            | Package                              | Purpose                                                           |
| -------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `contract/`          | `@surveyjs-studio/contract`          | `openapi.yaml`, generated TypeScript types, API reference build   |
| `server/`            | `@surveyjs-studio/server`            | Fastify server; routes and validation are built from the contract |
| `web/`               | `@surveyjs-studio/web`               | React app built with Vite                                         |
| `conformance-tests/` | `@surveyjs-studio/conformance-tests` | HTTP suite that checks any server against the contract            |
| `e2e/`               | `@surveyjs-studio/e2e`               | Playwright browser tests (Chromium, Firefox, WebKit)              |
| `scripts/`           | (root)                               | Repository checks, for example `check:deps`                       |
| `docker/`            |                                      | The legacy replica, the mock OIDC server, and the prod-like setup |
| `docs/`              |                                      | Documentation                                                     |

## Scripts

Run from the repository root.

| Script                                                           | What it does                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo`                                                      | Builds the API reference, then starts the server (3000) and the web app (5173) with in-memory storage and the dev sign-in    |
| `pnpm demo:preview`                                              | Builds the app, then serves it with the security headers (the content-security policy); `pnpm demo` sends none               |
| `pnpm build`                                                     | Builds the API reference and the production web bundle                                                                       |
| `pnpm test`                                                      | `test:unit`, then `test:conformance`                                                                                         |
| `pnpm test:unit`                                                 | Vitest across contract, server, web and repository scripts                                                                   |
| `pnpm test:conformance`                                          | Conformance suite against a server it starts itself                                                                          |
| `pnpm demo:azurite:up`                                           | Starts the legacy replica (Azurite and SQL Server) and the mock OIDC server (needs Docker), and loads the golden fixtures    |
| `pnpm demo:azurite`                                              | Like `pnpm demo`, on the replica, with sign-in through the mock OIDC server (needs `demo:azurite:up`)                        |
| `pnpm demo:azurite:down`                                         | Stops the replica and deletes its data                                                                                       |
| `pnpm dev:sqlite`                                                | Like `pnpm demo`, with the surveys in a SQLite file (`server/.data/`)                                                        |
| `pnpm dev:postgres`                                              | Like `pnpm demo`, with the surveys in PostgreSQL in Docker (starts it)                                                       |
| `pnpm postgres:up`, `pnpm postgres:down`                         | Starts PostgreSQL in Docker; stops it and deletes its data                                                                   |
| `pnpm seed`, `pnpm seed:sqlite`, `pnpm seed:postgres`            | Migrates the database, then loads the golden fixtures (seed surveys are replaced, others kept)                               |
| `pnpm db:migrate`, `pnpm db:status`                              | Applies the pending migrations; lists the applied and pending ones                                                           |
| `pnpm dev:prod-data`                                             | The app on the **real** surveyjs.io stores, signing in through a local the site's sign-in service; settings in `server/.env` |
| `pnpm image:build`                                               | Builds the production image `surveyjs-studio:local` (needs Docker)                                                           |
| `pnpm prod-like:up`                                              | The image in the mode 1 configuration on the replica and the mock OIDC server, at <http://localhost:8080>                    |
| `pnpm prod-like:down`                                            | Stops the prod-like containers and deletes their data                                                                        |
| `pnpm image:prod-data`                                           | The image on the **real** stores in `server/.env`, at <http://localhost:3000>                                                |
| `pnpm legacy:load`                                               | Loads the golden fixtures into a running replica                                                                             |
| `pnpm inspect:legacy`                                            | Read-only inspector: lists one user's surveys from the configured store                                                      |
| `pnpm inspect:legacy-schema`                                     | Read-only schema check of the legacy `Surveys` table (theme, triggers, `ispublished`)                                        |
| `pnpm user-api:stub`                                             | A local stand-in for the surveyjs.io user API (port 4010)                                                                    |
| `pnpm account:erase`                                             | Erases one account's data (dry run without `--yes`; needs a persistent store)                                                |
| `pnpm smoke:legacy`                                              | Production check that `api.surveyjs.io` reads what the app writes ([how](docs/operations/smoke-test.md))                     |
| `pnpm account:reconcile`                                         | Lists, and with `--apply` erases, owners the user directory no longer knows                                                  |
| `pnpm webhook:account-deleted`                                   | Sends a signed account-deleted webhook to a running server (a demo tool)                                                     |
| `pnpm test:conformance:read-only`                                | Conformance suite with the server in `READ_ONLY=true`                                                                        |
| `pnpm test:conformance:user-api`                                 | Conformance suite with the server on the user-API stub                                                                       |
| `pnpm test:providers:azurite`                                    | Provider suite on the replica (needs `demo:azurite:up`)                                                                      |
| `pnpm test:conformance:azurite`                                  | Conformance suite on the `azure-legacy` provider and the replica                                                             |
| `pnpm test:providers:postgres`                                   | Provider and migrator suites on PostgreSQL (needs `postgres:up`)                                                             |
| `pnpm test:conformance:sqlite`, `pnpm test:conformance:postgres` | Conformance suite on the SQL providers, a new seeded database per run (`postgres` needs `postgres:up`)                       |
| `pnpm e2e`                                                       | Playwright tests in three browsers (starts server and web app)                                                               |
| `pnpm e2e:azurite`                                               | Playwright tests on the replica and the mock OIDC server (needs `demo:azurite:up`)                                           |
| `pnpm e2e:sqlite`                                                | Playwright survey list, editor and history tests on the `sqlite` provider (Chromium)                                         |
| `pnpm e2e:visual`                                                | Visual parity: the app against the surveyjs.io baselines (local only; see [Testing](docs/testing.md#visual-parity))          |
| `pnpm e2e:visual:report`                                         | Opens the visual parity report                                                                                               |
| `pnpm visual:capture`                                            | A person captures the baselines from surveyjs.io ([how](docs/testing.md#capturing-baselines))                                |
| `pnpm lint`                                                      | ESLint                                                                                                                       |
| `pnpm typecheck`                                                 | `tsc` in every package                                                                                                       |
| `pnpm format`                                                    | Prettier, write                                                                                                              |
| `pnpm format:check`                                              | Prettier, check only                                                                                                         |
| `pnpm lint:contract`                                             | Redocly lint of the contract, and a check that generated types are current                                                   |
| `pnpm check:deps`                                                | Dependency rules (exact versions, SurveyJS versions equal)                                                                   |

## Documentation

**Product and planning**

- [Product idea](idea.md): the brief, the deployment modes and every decision (D1–D22).
- Phase 1, modes 1.1, 1.2 and 4: [spec](spec.md) and [plan](plan.md).
- Hosted migration, mode 1.3: [spec](spec-hosted.md) and [plan](plan-hosted.md).
- Self-hosted, modes 2a, 2b and 3: [spec](spec-self-hosted.md) and [plan](plan-self-hosted.md).

**For developers**

- [Architecture](docs/architecture.md): packages, server and web modules, storage providers, the legacy mapping, request flow, identity and session.
- [Running the app](docs/running.md): every run mode, how to start and stop it, and where its settings live.
- [Development](docs/development.md): setup, demo modes, seed accounts, environment variables, scripts, dependency upgrades.
- [Testing](docs/testing.md): the test seams and how to run each suite. [Visual parity](docs/testing.md#visual-parity) compares the app with surveyjs.io, and [ADR 0020](docs/adr/0020-visual-parity-baselines.md) records why.
- [Architecture decision records](docs/adr/README.md).
- [Legacy data layout](docs/architecture/legacy-data-layout.md): how surveyjs.io stores My Surveys data today.
- [Operations](docs/operations.md): deployment, monitoring, read-only mode, the configuration by deployment mode, accounts, the erase and reconcile commands, the webhook secret, the header policy, and the rollout and rollback runbook.
- Accounts and security: [ADR 0018](docs/adr/0018-accounts-by-deployment-mode.md) (accounts by deployment mode) and [ADR 0019](docs/adr/0019-run-page-isolation-and-security-headers.md) (run page isolation and security headers).
- [Demo scripts](docs/demo/): how to check each step by hand, Steps 1–14.

**For users and integrators**

- [User guide](docs/user-guide/README.md):
  - [signing in](docs/user-guide/signing-in.md);
  - [your surveys](docs/user-guide/your-surveys.md) and [managing a survey](docs/user-guide/managing-a-survey.md);
  - [designing a survey](docs/user-guide/designing-a-survey.md) and [images and files](docs/user-guide/images-and-files.md);
  - [publishing and collecting responses](docs/user-guide/publishing-and-collecting-responses.md);
  - [viewing results](docs/user-guide/viewing-results.md) and [downloading, sharing and deleting results](docs/user-guide/downloading-sharing-and-deleting-results.md);
  - [survey history](docs/user-guide/survey-history.md);
  - [projects and team members](docs/user-guide/projects-and-team-members.md);
  - [moving from the old My Surveys](docs/user-guide/moving-from-the-old-my-surveys.md).
- [API](docs/api/README.md):
  - [conventions](docs/api/conventions.md) and [paging](docs/api/paging.md);
  - [authentication, sessions and CSRF](docs/api/authentication.md);
  - [concurrent editing](docs/api/concurrency.md) and [uploads](docs/api/uploads.md);
  - [public endpoints](docs/api/public-endpoints.md) and [exporting results](docs/api/exporting-results.md).
- For the surveyjs.io team: the [user API and the account-deleted webhook](docs/integrations/surveyjs-user-api.md) and the [redirect map for old My Surveys addresses](docs/operations/surveyjs-redirects.md).

## Licence

[MIT](LICENSE). Survey Creator, the Form Library and the Dashboard are separate SurveyJS products
with their own licences. The app takes a SurveyJS licence key from configuration
(`SURVEYJS_LICENSE_KEY`); no key is stored in the code.
