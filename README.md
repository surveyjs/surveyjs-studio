# SurveyJS Studio (formerly My Surveys)

SurveyJS Studio is the survey application of [surveyjs.io](https://surveyjs.io), known until now as its My Surveys
section. You create surveys with Survey Creator, publish them, collect responses and look at the results. This
repository is the SurveyJS team's rebuild of that section as a standalone application. It will run at
`studio.surveyjs.io` and replace the old section. The same code also runs as a free Docker image for your own copy
and as a public sandbox. The repository is ready to be open-sourced and is still private
([Going public](docs/operations/going-public.md)).

**Naming.** The repository is [`surveyjs/surveyjs-studio`](https://github.com/surveyjs/surveyjs-studio), and the
image, the packages (`@surveyjs-studio/*`) and the hosting address (`studio.surveyjs.io`) use that name. The app's
pages still say "My Surveys" until the interface is renamed. The app's Azure containers keep their names
(`my-surveys-files`, `my-surveys-views`), because they hold data.

The back end is described by one OpenAPI 3.1 file, [`contract/openapi.yaml`](contract/openapi.yaml).
The Node.js server in this repository is the reference implementation. A back end in another
language is accepted when it passes the conformance suite in this repository.

## Deployment modes

The same code runs in several modes. Configuration chooses the storage, the user directory, the sign-in methods and
the look ([idea.md §3.0](idea.md#30-deployment-modes-2026-10-19)). Pick yours:

### Hosted (modes 1.1 to 1.3)

`studio.surveyjs.io` on the current surveyjs.io databases and Azure storage, with surveyjs.io sign-in. It replaces the
old My Surveys section. **State:** Phase 1 is built and passed the compatibility smoke test on production on
2026-10-23; hosting and the rollout are next ([plan.md](plan.md#progress)). The server scripts for that are in
[`deploy/hetzner/`](deploy/hetzner/) ([Setting up a Hetzner server](docs/operations/hetzner-server-setup.md)).
Mode 1.3, on its own data, is [planned](plan-hosted.md). **Start:** [Running in production](#running-in-production)
and [Operations](docs/operations.md). What the app does is in the [user guide](docs/user-guide/README.md).

### Self-hosted image (mode 2b)

The official self-hosted Docker image packages SurveyJS Studio as a ready-to-run
application with its own database and local user accounts. It includes Survey
Creator for form design, Form Library for form rendering, and SurveyJS Dashboard
for results visualization. You can run the official image in production free
of charge under the [Docker Image Terms](DOCKER-IMAGE-TERMS.md).

**State:** built and tested, published as a private test package. Publishing it on Docker Hub waits for push access
there and the shipped licence key ([ADR 0028](docs/adr/0028-the-self-hosted-image.md)); the packages stay private
after the repository goes public. All 11 steps of the self-hosted track are done
([plan-self-hosted.md](plan-self-hosted.md#progress)). **Start:** [Run it](#run-it) and
[Self-hosting](docs/self-hosting.md). The image carries its [third-party notice](#licence).

### Sandbox (mode 2a)

A static site at <https://studio.demos.surveyjs.io> where anyone tries every feature on demo data kept in their
browser. **State:** built, with the Publish sandbox workflow ready; going live needs the product owner's one-time
setup ([Operations](docs/operations.md#the-sandbox-studiodemossurveyjsio)). **Start:** `pnpm dev:sandbox`
([the sandbox](#the-sandbox)).

### Custom development (mode 3)

Your own fork with your own shell, database and sign-in (Google, GitHub, Facebook, surveyjs.io). It needs SurveyJS
licences. **State:** documented, with an example shell that CI builds and tests. **Start:**
[Customizing](docs/customizing/overview.md).

### Development (mode 4)

Local modes for development and tests: in memory, on a replica of the legacy stores, on SQLite or PostgreSQL, or
(product owner) on the real stores. **State:** available now. **Start:** [Quick start](#quick-start) and
[Running the app](docs/running.md).

## Run it

The self-hosted image (mode 2b) runs with one command, with a built-in database on the volume `surveyjs-studio`:

```sh
docker run -d --name surveyjs-studio -p 8080:8080 -v surveyjs-studio:/data <image>
```

`docker logs surveyjs-studio` shows a one-time link that creates the first administrator; then open
<http://localhost:8080>. `<image>` is `surveyjs-studio:self-hosted` after `pnpm image:build:self-hosted`, or a release
of the private test package `ghcr.io/surveyjs/surveyjs-studio-selfhosted-test` until the image is published.
[Self-hosting](docs/self-hosting.md) covers the settings, an https proxy, PostgreSQL, S3, backups and upgrades.

## Quick start

You need Node.js 24 (the version in [`.nvmrc`](.nvmrc)) and pnpm 12.11.2.

```sh
nvm use            # or any other way to get Node 24.22.1; nvm-windows: nvm use 24.22.1
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

The SQL providers of the self-hosted track. Users stay in memory unless `USER_DIRECTORY=local` keeps them in the
database, with password sign-in ([Development](docs/development.md#password-sign-in)):

```sh
pnpm seed:sqlite && pnpm dev:sqlite       # data in server/.data/surveyjs-studio.db
pnpm seed:postgres && pnpm dev:postgres   # data in PostgreSQL in Docker (pnpm postgres:down deletes it)
pnpm seed:sqlite && pnpm dev:s3           # as dev:sqlite, files in RustFS, an S3-compatible server in Docker
```

See [Development](docs/development.md#sqlite-and-postgresql-modes).

### The sandbox

The web app with an in-browser back-end: the data stays in the browser's localStorage, and no server runs.

```sh
pnpm dev:sandbox   # http://localhost:5173, pick an account
```

See [Development](docs/development.md#the-sandbox-step-9) and [ADR 0030](docs/adr/0030-the-sandbox-mock-in-the-browser.md).

### Every run mode

[Running the app](docs/running.md) lists every configuration that runs today (the memory and Azurite demos,
prod-like, and the two runs on production data), how to start and stop each one, and which file holds its settings.

## Running in production

The hosted image serves modes 1 and 4; its settings choose the mode. Build it with `pnpm image:build`, try it with
`pnpm prod-like:up`, and run it behind an https reverse proxy. [Operations](docs/operations.md) has the details. The
self-hosted image (mode 2b) is a second target of the same `Dockerfile` ([Self-hosting](docs/self-hosting.md)).

| Mode | Settings                                                                                                               | Ready                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1.1  | `APP_EDITION=hosted`, `STORAGE_PROVIDER=azure-legacy` with the three `LEGACY_*` strings, sign-in at `auth.surveyjs.io` | Yes: from rollout step 1                 |
| 1.2  | As 1.1, plus `ACCOUNT_WEBHOOK_SECRET`                                                                                  | Yes: from rollout step 4                 |
| 1.3  | The hosted-migration track                                                                                             | Not yet                                  |
| 2a   | The sandbox, a static site on the demos server ([Operations](docs/operations.md#the-sandbox-studiodemossurveyjsio))    | Built; waits for the one-time setup      |
| 2b   | The self-hosted image ([Self-hosting](docs/self-hosting.md))                                                           | Built (a private test package)           |
| 3    | Your own fork ([Customizing](docs/customizing/overview.md))                                                            | Documented                               |
| 4    | In memory or on the local replica, with the dev sign-in or the mock OIDC server                                        | Yes ([Running the app](docs/running.md)) |

- [Configuration by deployment mode](docs/operations.md#configuration-by-deployment-mode): every setting of each mode.
- [Deployment](docs/operations.md#deployment), [monitoring](docs/operations.md#monitoring) and
  [read-only mode](docs/operations.md#read-only-mode).
- [The rollout and rollback runbook](docs/operations.md#rollout-and-rollback-runbook), for the SurveyJS team and the
  surveyjs.io site team.
- [Updating studio.surveyjs.io](docs/operations/hetzner-server-setup.md#6-update-roll-back-status): deploying a
  published image tag, the status and the rollback.

## Repository layout

| Directory            | Package                              | Purpose                                                            |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `contract/`          | `@surveyjs-studio/contract`          | `openapi.yaml`, generated TypeScript types, API reference build    |
| `server/`            | `@surveyjs-studio/server`            | Fastify server; routes and validation are built from the contract  |
| `web/`               | `@surveyjs-studio/web`               | React app built with Vite                                          |
| `conformance-tests/` | `@surveyjs-studio/conformance-tests` | HTTP suite that checks any server against the contract             |
| `e2e/`               | `@surveyjs-studio/e2e`               | Playwright browser tests (Chromium, Firefox, WebKit)               |
| `scripts/`           | (root)                               | Repository checks, for example `check:deps`                        |
| `docker/`            |                                      | The legacy replica, the mock OIDC server, and the prod-like setup  |
| `deploy/`            |                                      | The Hetzner server scripts, the Compose examples, the sandbox host |
| `docs/`              |                                      | Documentation                                                      |

## Scripts

Run from the repository root.

| Script                                                           | What it does                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo`                                                      | Builds the API reference, then starts the server (3000) and the web app (5173) with in-memory storage and the dev sign-in  |
| `pnpm demo:preview`                                              | Builds the app, then serves it with the security headers (the content-security policy); `pnpm demo` sends none             |
| `pnpm dev:sandbox`                                               | The sandbox: the web app (5173) with its mock back-end in the browser; no server                                           |
| `pnpm build`                                                     | Builds the API reference and the production web bundle                                                                     |
| `pnpm build:sandbox`                                             | Builds the sandbox into `web/dist-sandbox/`                                                                                |
| `pnpm test`                                                      | `test:unit`, then `test:conformance`                                                                                       |
| `pnpm test:unit`                                                 | Vitest across contract, server, web and repository scripts                                                                 |
| `pnpm test:conformance`                                          | Conformance suite against a server it starts itself                                                                        |
| `pnpm demo:azurite:up`                                           | Starts the legacy replica (Azurite and SQL Server) and the mock OIDC server (needs Docker), and loads the golden fixtures  |
| `pnpm demo:azurite`                                              | Like `pnpm demo`, on the replica, with sign-in through the mock OIDC server (needs `demo:azurite:up`)                      |
| `pnpm demo:azurite:down`                                         | Stops the replica and deletes its data                                                                                     |
| `pnpm dev:sqlite`                                                | Like `pnpm demo`, with the data and files under `server/.data/`; users stay in memory                                      |
| `pnpm dev:postgres`                                              | Like `pnpm demo`, with the data in PostgreSQL in Docker (starts it); users stay in memory                                  |
| `pnpm dev:s3`                                                    | Like `pnpm dev:sqlite`, with the files in RustFS (starts it)                                                               |
| `pnpm s3:up`, `pnpm s3:down`, `pnpm s3:bucket`                   | Starts RustFS and creates the dev bucket; stops it and deletes its data; creates or removes a bucket                       |
| `pnpm postgres:up`, `pnpm postgres:down`                         | Starts PostgreSQL in Docker; stops it and deletes its data                                                                 |
| `pnpm seed`, `pnpm seed:sqlite`, `pnpm seed:postgres`            | Migrates the database, then loads the golden fixtures (seed surveys are replaced, others kept)                             |
| `pnpm db:migrate`, `pnpm db:status`                              | Applies the pending migrations; lists the applied and pending ones                                                         |
| `pnpm dev:prod-data`                                             | The app on the **real** surveyjs.io stores, signing in through a local sign-in server; settings in `server/.env`           |
| `pnpm image:build`                                               | Builds the production image `surveyjs-studio:local` (needs Docker)                                                         |
| `pnpm image:build:self-hosted`                                   | Builds the self-hosted image `surveyjs-studio:self-hosted` ([Self-hosting](docs/self-hosting.md))                          |
| `pnpm image:checks`                                              | Checks a self-hosted image as an admin uses it: `--image <tag> [--previous <tag>] [--only <checks>]`                       |
| `pnpm backup`, `pnpm restore`                                    | `surveyjs-studio backup` and `restore` in the repository (SQLite and local files)                                          |
| `pnpm release:tags`                                              | The image tags of a release tag ref, or with `--previous <tag>` the release before it                                      |
| `pnpm prod-like:up`                                              | The image in the mode 1 configuration on the replica and the mock OIDC server, at <http://localhost:8080>                  |
| `pnpm prod-like:down`                                            | Stops the prod-like containers and deletes their data                                                                      |
| `pnpm image:prod-data`                                           | The image on the **real** stores in `server/.env`, at <http://localhost:3000>                                              |
| `pnpm legacy:load`                                               | Loads the golden fixtures into a running replica                                                                           |
| `pnpm inspect:legacy`                                            | Read-only inspector: lists one user's surveys from the configured store                                                    |
| `pnpm inspect:legacy-schema`                                     | Read-only schema check of the legacy `Surveys` table (theme, triggers, `ispublished`)                                      |
| `pnpm user-api:stub`                                             | A local stand-in for the surveyjs.io user API (port 4010)                                                                  |
| `pnpm account:erase`                                             | Erases one account's data (dry run without `--yes`; needs a persistent store)                                              |
| `pnpm smoke:legacy`                                              | Production check that `api.surveyjs.io` reads what the app writes ([how](docs/operations/smoke-test.md))                   |
| `pnpm account:reconcile`                                         | Lists, and with `--apply` erases, owners the user directory no longer knows                                                |
| `pnpm webhook:account-deleted`                                   | Sends a signed account-deleted webhook to a running server (a demo tool)                                                   |
| `pnpm test:conformance:read-only`                                | Conformance suite with the server in `READ_ONLY=true`                                                                      |
| `pnpm test:conformance:user-api`                                 | Conformance suite with the server on the user-API stub                                                                     |
| `pnpm test:providers:azurite`                                    | Provider suite on the replica (needs `demo:azurite:up`)                                                                    |
| `pnpm test:conformance:azurite`                                  | Conformance suite on the `azure-legacy` provider and the replica                                                           |
| `pnpm test:providers:postgres`                                   | Provider and migrator suites on PostgreSQL (needs `postgres:up`)                                                           |
| `pnpm test:providers:s3`                                         | Byte-store and provider suites with files in S3 (needs `s3:up`)                                                            |
| `pnpm test:conformance:sqlite`, `pnpm test:conformance:postgres` | Conformance suite on the SQL providers, a new seeded database per run (`postgres` needs `postgres:up`)                     |
| `pnpm test:conformance:s3`                                       | Conformance suite on `sqlite` with the files in a new S3 bucket (needs `s3:up`)                                            |
| `pnpm test:conformance:password`                                 | Conformance suite on `sqlite` with local accounts and password sign-in                                                     |
| `pnpm test:conformance:oauth`                                    | Conformance suite on `sqlite` with local accounts and Google, GitHub, Facebook and surveyjs.io against the stub            |
| `pnpm test:conformance:sandbox`                                  | The sandbox subset of the conformance suite against the mock handlers (`msw/node`, no server)                              |
| `pnpm e2e`                                                       | Playwright tests in three browsers (starts server and web app)                                                             |
| `pnpm e2e:azurite`                                               | Playwright tests on the replica and the mock OIDC server (needs `demo:azurite:up`)                                         |
| `pnpm e2e:sqlite`                                                | Playwright survey list, editor and history tests on the `sqlite` provider (Chromium)                                       |
| `pnpm oauth-stub`                                                | The local stand-in for Google, GitHub, Facebook and surveyjs.io sign-in (port 5180; development and tests only)            |
| `pnpm sandbox:seed`                                              | Writes `web/src/sandbox/seed.json` from the shared fixtures and `server/fixtures/sandbox.json`                             |
| `pnpm sandbox:serve`                                             | Serves `web/dist-sandbox/` with the sandbox's nginx configuration in a container, as the demos server does (`--stop`)      |
| `pnpm sandbox:wait`                                              | Waits until a sandbox host's `version.json` names a commit: `--url <url> --commit <sha>`                                   |
| `pnpm e2e:password`                                              | Playwright password sign-in tests: the first admin, the forced change, the back-off (Chromium)                             |
| `pnpm e2e:oauth`                                                 | Playwright OAuth sign-in tests: local accounts with GitHub and Google against the OAuth stub (Chromium)                    |
| `pnpm e2e:sandbox`                                               | Playwright `@sandbox` specs on the sandbox build (Chromium)                                                                |
| `pnpm e2e:sandbox:url`                                           | The same specs against a running sandbox host named by `E2E_SANDBOX_URL`; nothing is built or started                      |
| `pnpm e2e:self-hosted`                                           | Playwright branding tests in the self-hosted shell: sign-in, My Surveys, editor, results, run page (Chromium)              |
| `pnpm e2e:visual:self-hosted`                                    | Visual tests of the self-hosted shell against its own baselines (local only)                                               |
| `pnpm e2e:postgres`                                              | Playwright tests on the `postgres` provider, every functional spec but the licence notices (Chromium; needs `postgres:up`) |
| `pnpm e2e:visual`                                                | Visual parity: the app against the surveyjs.io baselines (local only; see [Testing](docs/testing.md#visual-parity))        |
| `pnpm e2e:visual:report`                                         | Opens the visual parity report                                                                                             |
| `pnpm visual:capture`                                            | A person captures the baselines from surveyjs.io ([how](docs/testing.md#capturing-baselines))                              |
| `pnpm lint`                                                      | ESLint                                                                                                                     |
| `pnpm typecheck`                                                 | `tsc` in every package                                                                                                     |
| `pnpm format`                                                    | Prettier, write                                                                                                            |
| `pnpm format:check`                                              | Prettier, check only                                                                                                       |
| `pnpm lint:contract`                                             | Redocly lint of the contract, and a check that generated types are current                                                 |
| `pnpm check:deps`                                                | Dependency rules (exact versions, SurveyJS versions equal)                                                                 |
| `pnpm check:docs-links`                                          | Checks the relative links and heading anchors of the public docs                                                           |
| `pnpm check:example-shell`                                       | Applies the example shell to a scratch copy of the repository, typechecks it and runs its test                             |
| `pnpm scan:secrets`                                              | Gitleaks secrets scan: `--staged` in the pre-commit hook, `--all-refs` before going public                                 |

## Documentation

**Product and planning**

- [Product idea](idea.md): the brief, the deployment modes and every decision (D1–D22).
- Phase 1, modes 1.1, 1.2 and 4: [spec](spec.md) and [plan](plan.md).
- Hosted migration, mode 1.3: [spec](spec-hosted.md) and [plan](plan-hosted.md).
- Self-hosted, modes 2a, 2b and 3: [spec](spec-self-hosted.md) and [plan](plan-self-hosted.md).

**For people who customize Studio (mode 3)**

- [Customizing Studio](docs/customizing/overview.md): what is configuration and what is code.
  - [shells](docs/customizing/shells.md), with an example that CI builds and tests (`pnpm check:example-shell`);
  - [providers](docs/customizing/providers.md) for a database or a file store;
  - [sign-in](docs/customizing/sign-in.md) and [branding](docs/customizing/branding.md);
  - [porting the back end](docs/customizing/porting.md), tested by `pnpm test:conformance --base <url>`;
  - [licensing](docs/customizing/licensing.md).

**Contributing and security**

- [Contributing](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md) and the
  [security policy](SECURITY.md); the [issue templates](.github/ISSUE_TEMPLATE) are in `.github/`.
- [Going public](docs/operations/going-public.md): the secrets scan (`pnpm scan:secrets`) and its record, the review
  before the switch to public, and the GitHub settings to turn on.

**For developers**

- [Architecture](docs/architecture.md): packages, server and web modules, storage providers, the legacy mapping, request flow, identity and session.
- [Running the app](docs/running.md): every run mode, how to start and stop it, and where its settings live.
- [Development](docs/development.md): setup, demo modes, seed accounts, environment variables, scripts, dependency upgrades.
- [Testing](docs/testing.md): the test seams and how to run each suite. [Visual parity](docs/testing.md#visual-parity) compares the app with surveyjs.io, and [ADR 0020](docs/adr/0020-visual-parity-baselines.md) records why.
- [Architecture decision records](docs/adr/README.md).
- [Legacy data layout](docs/architecture/legacy-data-layout.md): how surveyjs.io stores My Surveys data today.
- [Self-hosting](docs/self-hosting.md): running the free Docker image (mode 2b): settings, an https proxy, PostgreSQL, S3, backups, upgrades.
- [Operations](docs/operations.md): deployment, monitoring, read-only mode, the configuration by deployment mode, accounts, the erase and reconcile commands, the webhook secret, the header policy, and the rollout and rollback runbook.
- Accounts and security: [ADR 0018](docs/adr/0018-accounts-by-deployment-mode.md) (accounts by deployment mode) and [ADR 0019](docs/adr/0019-run-page-isolation-and-security-headers.md) (run page isolation and security headers).
- [Demo scripts](docs/demo/): how to check each step by hand, Steps 1–14 and the self-hosted Steps 1–11.

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

## License

The SurveyJS Studio application source code is licensed under the
[MIT License](LICENSE). Studio uses SurveyJS Form Library, which is also
MIT-licensed, and two separately licensed commercial libraries, SurveyJS Survey Creator
and SurveyJS Dashboard.

You can run the official self-hosted Docker image in production free of charge
under the [Docker Image Terms](DOCKER-IMAGE-TERMS.md). Its included license key
removes the commercial components' license warning. The **Powered by SurveyJS** attribution 
must remain visible under the free image terms.

If you deploy your own build, production use of SurveyJS Survey Creator or SurveyJS
Dashboard requires an applicable
[SurveyJS developer license](https://surveyjs.io/licensing).

See the [licensing guide](docs/customizing/licensing.md) for package-level
details. Both images (the self-hosted one and the hosted one) include dependency notices at `/app/THIRD_PARTY_NOTICES.md`.
It is generated when the image is built.
