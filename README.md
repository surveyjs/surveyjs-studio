# My Surveys

My Surveys is the survey section of [surveyjs.io](https://surveyjs.io): create surveys with
Survey Creator, publish them, collect responses and look at the results. This repository is a
rebuild of that section by the SurveyJS team. It is meant to be forked and run on your own
server.

The back end is described by one OpenAPI 3.1 file, [`contract/openapi.yaml`](contract/openapi.yaml).
The Node.js server in this repository is the reference implementation. A back end in another
language is accepted when it passes the conformance suite in this repository.

## Status

Phase 1, **Step 1: foundation and walking skeleton**. What works today:

- The full API contract, with every operation served by the server. Only `GET /api/v1/config`
  does real work. Every other operation answers `501 Not Implemented` with a Problem Details body.
- A web app that loads the configuration and shows the edition and the shell name.
- Generated API reference at `/api/docs`, health checks, tests (unit, HTTP conformance, browser
  end-to-end), and a CI workflow.

There are no screens for surveys yet. They arrive in later steps (see
[docs/architecture.md](docs/architecture.md#what-later-steps-add)).

## Quick start

You need Node.js 24 (the version in [`.nvmrc`](.nvmrc)) and pnpm 12.11.2.

```sh
nvm use            # or any other way to get Node 24.21.0; nvm-windows: nvm use 24.21.0
corepack enable    # makes the pnpm version in package.json available
pnpm install
pnpm demo
```

Then open <http://localhost:5173>. The home page shows `edition: self-hosted` and
`shell: surveyjs-site`. The API reference is at <http://localhost:3000/api/docs>.

If `corepack enable` is not possible (on Windows it may need an administrator shell), use
`corepack pnpm <command>` instead of `pnpm <command>`, or install pnpm with
`npm install -g pnpm@12.11.2`. More detail is in [docs/development.md](docs/development.md).

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

| Script                  | What it does                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm demo`             | Builds the API reference, then starts the server (3000) and the web app (5173) with in-memory storage |
| `pnpm build`            | Builds the API reference and the production web bundle                                                |
| `pnpm test`             | `test:unit`, then `test:conformance`                                                                  |
| `pnpm test:unit`        | Vitest across contract, server, web and repository scripts                                            |
| `pnpm test:conformance` | Conformance suite against a server it starts itself                                                   |
| `pnpm e2e`              | Playwright tests in three browsers (starts server and web app)                                        |
| `pnpm lint`             | ESLint                                                                                                |
| `pnpm typecheck`        | `tsc` in every package                                                                                |
| `pnpm format`           | Prettier, write                                                                                       |
| `pnpm format:check`     | Prettier, check only                                                                                  |
| `pnpm lint:contract`    | Redocly lint of the contract, and a check that generated types are current                            |
| `pnpm check:deps`       | Dependency rules (exact versions, SurveyJS versions equal)                                            |

## Documentation

- [Architecture](docs/architecture.md): packages, server and web modules, request flow.
- [Development](docs/development.md): setup, environment variables, scripts, dependency upgrades.
- [Testing](docs/testing.md): the test seams and how to run each suite.
- [API](docs/api/README.md) and [API conventions](docs/api/conventions.md).
- [Architecture decision records](docs/adr/README.md).
- [Step 1 demo script](docs/demo/step-01.md): how to check that Step 1 works.

## Licence

[MIT](LICENSE). Survey Creator, the Form Library and the Dashboard are separate SurveyJS products
with their own licences. The app takes a SurveyJS licence key from configuration
(`SURVEYJS_LICENSE_KEY`); no key is stored in the code.
