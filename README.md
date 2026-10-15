# My Surveys

My Surveys is the survey section of [surveyjs.io](https://surveyjs.io): create surveys with
Survey Creator, publish them, collect responses and look at the results. This repository is a
rebuild of that section by the SurveyJS team. It is meant to be forked and run on your own
server.

The back end is described by one OpenAPI 3.1 file, [`contract/openapi.yaml`](contract/openapi.yaml).
The Node.js server in this repository is the reference implementation. A back end in another
language is accepted when it passes the conformance suite in this repository.

## Status

Phase 1, **Step 3: sign-in, session and the surveyjs.io shell**. Step 3 adds sign-in and sign-out,
a stateless session cookie with CSRF protection, private pages that send an anonymous visitor to
sign-in, `GET /api/v1/me` with account notices, and the surveyjs.io look (header with the account
menu, footer, cookie banner, licence dialogs). Step 2 added a read-only provider for the current
surveyjs.io stores, an offline replica of them (Azurite and SQL Server in Docker), golden fixtures,
a shared provider test suite and an inspector command. What works:

- The full API contract, with every operation served by the server. `getConfig`, `login`,
  `loginCallback`, `logout` and `getCurrentUser` do real work. Every other operation answers
  `401` without a session and `501 Not Implemented` (a Problem Details body) with one.
- A web app that signs you in and shows the surveyjs.io shell around a home page with your name,
  the edition and the shell name. There are no screens for surveys yet.
- Generated API reference at `/api/docs`, health checks, tests (unit, HTTP conformance, browser
  end-to-end, in memory and Azurite modes), and a CI workflow.

The survey screens arrive in later steps (see
[docs/architecture.md](docs/architecture.md#what-later-steps-add)).

## Quick start

You need Node.js 24 (the version in [`.nvmrc`](.nvmrc)) and pnpm 12.11.2.

```sh
nvm use            # or any other way to get Node 24.21.0; nvm-windows: nvm use 24.21.0
corepack enable    # makes the pnpm version in package.json available
pnpm install
pnpm demo
```

Then open <http://localhost:5173>. The browser goes to a "Sign in as…" page (development sign-in, no
password): choose **Olivia Owner**. The home page then shows `signed in as: Olivia Owner`,
`edition: self-hosted` and `shell: surveyjs-site`, inside the surveyjs.io header and footer. The API
reference is at <http://localhost:3000/api/docs>.

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

See [Development](docs/development.md#azurite-mode), the [Step 2 demo](docs/demo/step-02.md) and the
[Step 3 demo](docs/demo/step-03.md).

## Repository layout

| Directory            | Package                         | Purpose                                                           |
| -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `contract/`          | `@my-surveys/contract`          | `openapi.yaml`, generated TypeScript types, API reference build   |
| `server/`            | `@my-surveys/server`            | Fastify server; routes and validation are built from the contract |
| `web/`               | `@my-surveys/web`               | React app built with Vite                                         |
| `conformance-tests/` | `@my-surveys/conformance-tests` | HTTP suite that checks any server against the contract            |
| `e2e/`               | `@my-surveys/e2e`               | Playwright browser tests (Chromium, Firefox, WebKit)              |
| `scripts/`           | (root)                          | Repository checks, for example `check:deps`                       |
| `docs/`              |                                 | Documentation                                                     |

## Scripts

Run from the repository root.

| Script                          | What it does                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo`                     | Builds the API reference, then starts the server (3000) and the web app (5173) with in-memory storage and the dev sign-in |
| `pnpm build`                    | Builds the API reference and the production web bundle                                                                    |
| `pnpm test`                     | `test:unit`, then `test:conformance`                                                                                      |
| `pnpm test:unit`                | Vitest across contract, server, web and repository scripts                                                                |
| `pnpm test:conformance`         | Conformance suite against a server it starts itself                                                                       |
| `pnpm demo:azurite:up`          | Starts the legacy replica (Azurite and SQL Server) and the mock OIDC server (needs Docker), and loads the golden fixtures |
| `pnpm demo:azurite`             | Like `pnpm demo`, on the replica, with sign-in through the mock OIDC server (needs `demo:azurite:up`)                     |
| `pnpm demo:azurite:down`        | Stops the replica and deletes its data                                                                                    |
| `pnpm legacy:load`              | Loads the golden fixtures into a running replica                                                                          |
| `pnpm inspect:legacy`           | Read-only inspector: lists one user's surveys from the configured store                                                   |
| `pnpm test:providers:azurite`   | Provider suite on the replica (needs `demo:azurite:up`)                                                                   |
| `pnpm test:conformance:azurite` | Conformance suite on the `azure-legacy` provider and the replica                                                          |
| `pnpm e2e`                      | Playwright tests in three browsers (starts server and web app)                                                            |
| `pnpm e2e:azurite`              | Playwright sign-in spec on the replica and the mock OIDC server (needs `demo:azurite:up`)                                 |
| `pnpm lint`                     | ESLint                                                                                                                    |
| `pnpm typecheck`                | `tsc` in every package                                                                                                    |
| `pnpm format`                   | Prettier, write                                                                                                           |
| `pnpm format:check`             | Prettier, check only                                                                                                      |
| `pnpm lint:contract`            | Redocly lint of the contract, and a check that generated types are current                                                |
| `pnpm check:deps`               | Dependency rules (exact versions, SurveyJS versions equal)                                                                |

## Documentation

- [Architecture](docs/architecture.md): packages, server and web modules, storage providers, the legacy mapping, request flow, identity and session.
- [Development](docs/development.md): setup, environment variables, scripts, dependency upgrades.
- [Testing](docs/testing.md): the test seams and how to run each suite.
- [User guide](docs/user-guide/README.md): [signing in](docs/user-guide/signing-in.md), the account menu, licence notices and the cookie banner.
- [API](docs/api/README.md), [API conventions](docs/api/conventions.md) and
  [authentication, sessions and CSRF](docs/api/authentication.md).
- [Architecture decision records](docs/adr/README.md).
- [Legacy data layout](docs/architecture/legacy-data-layout.md): how surveyjs.io stores My Surveys data today.
- [Step 1 demo script](docs/demo/step-01.md): how to check that Step 1 works.
- [Step 2 demo script](docs/demo/step-02.md): how to check the legacy storage spike.
- [Step 3 demo script](docs/demo/step-03.md): how to check sign-in, the session and the shell.

## Licence

[MIT](LICENSE). Survey Creator, the Form Library and the Dashboard are separate SurveyJS products
with their own licences. The app takes a SurveyJS licence key from configuration
(`SURVEYJS_LICENSE_KEY`); no key is stored in the code.
