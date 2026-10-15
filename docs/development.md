# Development

## Setup

1. **Node.js 24.** `.nvmrc` holds `24.21.0` and `engines.node` is `>=24.21.0 <25`. With nvm:
   `nvm use` (nvm-windows: `nvm use 24.21.0`). `.npmrc` sets `engine-strict=true`, so install
   fails on another major.
2. **pnpm 12.11.2.** Pinned in `packageManager`. Pick one:
   - `corepack enable`, then use `pnpm`. On Windows this may need an administrator shell;
   - leave corepack off and put `corepack pnpm` in front of every command, for example
     `corepack pnpm install`;
   - `npm install -g pnpm@12.11.2`.
3. `pnpm install`. For the e2e suite, install the browsers once:
   `pnpm --filter @my-surveys/e2e exec playwright install chromium firefox webkit`
   (on Linux add `--with-deps`, as CI does).

## Demo modes

| Mode   | Command     | Storage                            |
| ------ | ----------- | ---------------------------------- |
| memory | `pnpm demo` | In memory; data is lost on restart |

`pnpm demo` builds the API reference (`contract/dist/reference.html`), then starts two processes:
the server on <http://127.0.0.1:3000> (`tsx watch`, restarts on change) and the web app on
<http://localhost:5173> (Vite dev server, proxies `/api`, `/healthz` and `/readyz` to port 3000).
Stop both with Ctrl+C. Ports are fixed; if 5173 is taken, Vite stops instead of choosing another.

A second mode with Azurite (the Azure Storage emulator) arrives with the Azure providers
(Step 2 and 3). Until then only `STORAGE_PROVIDER=memory` is valid.

To run one part alone: `pnpm --filter @my-surveys/server dev` (watch mode),
`pnpm --filter @my-surveys/server start` (no watching), `pnpm --filter @my-surveys/web dev`, or
`pnpm --filter @my-surveys/web preview` (serves the production build; run
`pnpm --filter @my-surveys/web build` first).

## Environment variables (server)

Read at start-up. Every problem is reported at once and the process exits with code 1.

| Variable                           | Values                                                       | Default                                             |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------------------------- |
| `NODE_ENV`                         | `development`, `test`, `production`                          | `development`                                       |
| `HOST`                             | host name or address                                         | `127.0.0.1`                                         |
| `PORT`                             | integer 0-65535 (0 = any free port)                          | `3000`                                              |
| `LOG_LEVEL`                        | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | `info`                                              |
| `APP_EDITION`                      | `hosted`, `self-hosted`                                      | `self-hosted`                                       |
| `APP_SHELL`                        | non-empty string                                             | `surveyjs-site`                                     |
| `AUTH_METHODS`                     | comma list of `surveyjs`, `password`, `oidc` (at least one)  | `surveyjs`                                          |
| `SURVEYJS_LICENSE_KEY`             | string                                                       | unset (`null` in `/config`)                         |
| `STORAGE_PROVIDER`                 | `memory` (the only value in Step 1)                          | `memory`                                            |
| `PUBLIC_BASE_URL`                  | absolute http(s) URL                                         | `http://localhost:3000`; **required in production** |
| `LIMIT_MAX_ASSET_BYTES_PER_SURVEY` | positive integer                                             | `52428800` (50 MB)                                  |
| `LIMIT_MAX_FILE_BYTES`             | positive integer                                             | `10485760` (10 MB)                                  |
| `LIMIT_MAX_RESPONSE_BYTES`         | positive integer                                             | `1048576` (1 MB); also the request body limit       |
| `API_DOCS`                         | `true`, `false`                                              | `true`, but `false` when `NODE_ENV=production`      |

"Required in production" means `NODE_ENV=production`. An empty or whitespace-only value counts as unset
(the default applies). Integer variables accept decimal digits only (`1e3`, `0x10`, `-1` and `1.5` are rejected). The values for edition, shell, auth
methods, licence key and limits are returned by `GET /api/v1/config`.

Set them in the shell that starts the server.

Git Bash:

```sh
APP_EDITION=hosted APP_SHELL=demo pnpm --filter @my-surveys/server start
```

PowerShell (the variables stay set for the whole session; remove one with `Remove-Item Env:APP_EDITION`):

```powershell
$env:APP_EDITION = "hosted"; $env:APP_SHELL = "demo"; pnpm --filter @my-surveys/server start
```

The web app has one optional build-time variable: `VITE_API_BASE_URL` (default `/api/v1`).

## Scripts

Root scripts are listed in the [README](../README.md#scripts). Package scripts:

| Package             | Script                                         | Purpose                                                                                                                                                 |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`            | `dev`, `start`, `typecheck`                    | Watch mode, plain start, type check                                                                                                                     |
| `web`               | `dev`, `build`, `preview`, `test`, `typecheck` | Vite dev server, build (type check first), preview, unit tests                                                                                          |
| `contract`          | `generate`                                     | Regenerate `generated/openapi.d.ts` after editing `openapi.yaml`                                                                                        |
| `contract`          | `lint`, `check:generated`                      | Redocly lint (telemetry off, update notice suppressed; known exceptions in `contract/.redocly.lint-ignore.yaml`); fail if the committed types are stale |
| `contract`          | `build:docs`                                   | Write the self-contained `contract/dist/reference.html`                                                                                                 |
| `conformance-tests` | `test`                                         | See [testing](testing.md)                                                                                                                               |
| `e2e`               | `test`                                         | Playwright                                                                                                                                              |

Run a package script with `pnpm --filter <package name> <script>`, for example
`pnpm --filter @my-surveys/contract generate`.

## Changing the contract

1. Edit `contract/openapi.yaml` (hand-formatted; Prettier ignores it).
2. `pnpm --filter @my-surveys/contract generate`, and commit the changed `generated/openapi.d.ts`.
3. `pnpm lint:contract`.
4. Implement the change and add conformance tests **in the same pull request**.

An operation without a handler answers `501` by itself, so adding an operation to the contract
needs no server change until you implement it.

## Dependencies and upgrades

- **Exact versions.** Every dependency in every `package.json` is an exact version, with no `^`
  or `~` (`save-exact=true` in `.npmrc`). The only exception is `workspace:*` for packages in this
  repository. `pnpm-lock.yaml` is committed, and CI installs with `--frozen-lockfile`.
- **`pnpm check:deps`** fails when:
  - a core dependency is not an exact version. Core means `typescript`, `react`, `react-dom`,
    `vite`, `fastify`, `openapi-typescript`, `openapi-fetch`, `openapi-react-query`, `openapi-msw`,
    and every package whose name starts with `@vitejs/`, `@tanstack/`, `@fastify/`, `@redocly/`
    or `survey-`;
  - `survey-*` packages are used with different versions (they must move together).
- **Renovate** (`renovate.json`) pins versions, waits 14 days after a release, and refreshes the
  lockfile on Mondays before 5:00. Its pull requests:
  - one group for all minor and patch updates except SurveyJS: merge when CI is green;
  - one group "SurveyJS" for every `survey-*` package, majors included: review it as a whole
    (Creator, Form Library and Dashboard must still work together);
  - Node.js updates stay below version 25.
- **Major upgrades** (a core dependency, Node.js, pnpm) get their own pull request, never mixed
  with feature work. The pull request adds an ADR in `docs/adr/` that records what changed and how
  it was verified (for the shape, see [ADR 0002](adr/0002-node-24-lts.md)).
- **Node.js** is pinned in `.nvmrc` and `engines.node`. Keep both, and the Docker base image once
  it exists, on the same major.

To see the rule fail and recover, follow [the Step 1 demo](demo/step-01.md#6-dependency-rules).

## CI

`.github/workflows/ci.yml` runs on pushes to `master` and `step/**` and on pull requests. It runs,
in this order: `pnpm install --frozen-lockfile`, `check:deps`, `lint:contract`, `typecheck`,
`lint`, `format:check`, `test:unit`, `test:conformance`, the browser install, and `e2e`. On
failure it uploads the Playwright report. Run the same commands locally before you push.

## Conventions

- TypeScript is strict and ESM. Server, contract and conformance tests use `NodeNext`; web uses `Bundler`.
- ESLint (flat config) and Prettier. `pnpm format` fixes formatting.
- Commit messages are conventional: `feat(server): ...`, `fix(web): ...`, `docs: ...`, `chore: ...`.
