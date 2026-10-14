# Demo: Step 1, foundation and walking skeleton

This page lets you check Step 1 without reading code. It takes about ten minutes. Commands are
given for Git Bash (or any POSIX shell) and PowerShell where they differ.

What Step 1 delivers: the monorepo, the API contract, a server that builds its routes from the
contract (only `GET /api/v1/config` is implemented; everything else answers `501`), a web app that
shows the configuration, generated API docs, tests and CI.

## Before you start

You need Git, Node.js 24.21.0 (see `.nvmrc`) and pnpm 12.11.2.

- Switch Node: `nvm use` (nvm-windows: `nvm use 24.21.0`). Check with `node -v`.
- pnpm: run `corepack enable` (on Windows this may need an administrator shell). If you cannot,
  either install it with `npm install -g pnpm@12.11.2`, or type `corepack pnpm` wherever this page
  says `pnpm`.
- Check with `pnpm -v`: it must print `12.11.2`.

Ports 3000 and 5173 must be free.

## 1. Install and start

```sh
pnpm install
pnpm demo
```

Expected: the API reference is built ("bundled successfully ... reference.html"), then two
labelled streams appear: `[server]` and `[web]`. The web stream prints
`VITE v8.3.1 ready` and `Local: http://localhost:5173/`. Leave this terminal running and open a
second one for the next steps. (In the second terminal, make sure Node 24 and pnpm are available
as above.)

Quick health check:

```sh
curl http://localhost:3000/healthz
```

PowerShell: `curl.exe http://localhost:3000/healthz`. Use `curl.exe`, not `curl`: in Windows
PowerShell 5.1 `curl` is an alias for `Invoke-WebRequest`, and it fails on `4xx`/`5xx` answers.

Expected: `{"status":"ok"}`.

## 2. The home page

Open <http://localhost:5173>.

Expected, on the page:

- the heading **My Surveys**;
- `edition: self-hosted`;
- `shell: surveyjs-site`.

Those two values come from the server's configuration. To see them change, stop `pnpm demo`
(Ctrl+C) and start it again with other values.

Git Bash:

```sh
APP_EDITION=hosted APP_SHELL=demo pnpm demo
```

PowerShell:

```powershell
$env:APP_EDITION = "hosted"; $env:APP_SHELL = "demo"; pnpm demo
```

Expected: after a reload the page shows `edition: hosted` and `shell: demo`. Stop the demo again
and start it with plain `pnpm demo` for the next steps. (In PowerShell first run
`Remove-Item Env:APP_EDITION, Env:APP_SHELL`.)

The configuration itself is plain JSON:

```sh
curl http://localhost:3000/api/v1/config
```

Expected (defaults): `{"edition":"self-hosted","shell":"surveyjs-site","authMethods":["surveyjs"],"surveyjsLicenseKey":null,"limits":{"maxAssetBytesPerSurvey":52428800,"maxFileBytes":10485760,"maxResponseBytes":1048576}}`.
The same answer comes through the web app's proxy at `http://localhost:5173/api/v1/config`.

## 3. API reference

Open <http://localhost:3000/api/docs>.

Expected: the "My Surveys API" reference, grouped by tag (Session, Config,
Projects, Members, Surveys, Survey content, Files, History, Results, Views, Public) and every
operation listed in the left menu, including ones not implemented yet. It works offline.

## 4. Not-yet-implemented operations answer 501

```sh
curl -i http://localhost:3000/api/v1/surveys
```

PowerShell: `curl.exe -i http://localhost:3000/api/v1/surveys`.

Expected:

```text
HTTP/1.1 501 Not Implemented
content-type: application/problem+json; charset=utf-8
x-request-id: <a UUID>
...

{"type":"https://my-surveys.surveyjs.io/problems/not-implemented","title":"Not implemented","status":501,"code":"not-implemented","detail":"Operation listSurveys is not implemented yet."}
```

An unknown URL gives a `404` Problem (`code: not-found`):

```sh
curl -i http://localhost:3000/api/v1/nothing-here
```

Now stop the demo with Ctrl+C in the first terminal. Check that nothing is left listening: the
ports 3000 and 5173 should be free (`netstat -ano | findstr ":3000 :5173"` on Windows shows no
`LISTENING` lines).

## 5. Tests

```sh
pnpm test
```

Expected: the unit tests pass (`Test Files 14 passed`, `Tests 178 passed`), then the conformance
suite passes (`Test Files 2 passed`, `Tests 20 passed`). The numbers grow in later steps; what
matters is that all pass and nothing prints warnings.

Install the browsers once, then run the end-to-end tests:

```sh
pnpm --filter @my-surveys/e2e exec playwright install chromium firefox webkit
pnpm e2e
```

Expected: `3 passed`, one run each for chromium, firefox and webkit. The e2e run starts its own
server and web app, and stops them. It needs ports 3000 and 5173 free (or it reuses servers
you left running).

Optional, the other checks that CI runs: `pnpm lint:contract`, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`. Each should finish without errors.

## 6. Dependency rules

`pnpm check:deps` enforces the exact-version policy.

```sh
pnpm check:deps
```

Expected: `check:deps OK (6 manifests)`.

Now break it. Change the Fastify dependency in `server/package.json` to a range.

Git Bash:

```sh
sed -i 's/"fastify": "5.12.5"/"fastify": "^5.12.5"/' server/package.json
```

PowerShell:

```powershell
$p = (Resolve-Path server\package.json).Path
[IO.File]::WriteAllText($p, [IO.File]::ReadAllText($p).Replace('"fastify": "5.12.5"', '"fastify": "^5.12.5"'))
```

(Or edit the file by hand: put `^` in front of the Fastify version.)

```sh
pnpm check:deps
```

Expected: the command fails (exit code 1) with

```text
server/package.json: fastify@^5.12.5 violates core-dependency-must-be-exact
```

Restore the file, then check again:

```sh
git checkout server/package.json
pnpm check:deps
```

Expected: `check:deps OK (6 manifests)`, and `git status` shows no change to `server/package.json`
or `pnpm-lock.yaml`.

## Checklist

| #   | Check                                                                   | Result |
| --- | ----------------------------------------------------------------------- | ------ |
| 1   | `pnpm install && pnpm demo` starts the server and the web app           |        |
| 2   | Home page shows `edition: self-hosted` and `shell: surveyjs-site`       |        |
| 3   | `/api/docs` shows the reference with every operation                    |        |
| 4   | `GET /api/v1/surveys` returns `501` with a Problem Details body         |        |
| 5   | `pnpm test` and `pnpm e2e` are green                                    |        |
| 6   | `pnpm check:deps` passes, fails after a `^` range, passes after restore |        |

## Troubleshooting

- `Unsupported engine` on install: wrong Node version. Run `nvm use` and check `node -v`.
- `Port 5173 is already in use`: stop whatever holds the port; the port is fixed on purpose.
- `/api/docs` shows `404` and "Run pnpm build:docs": build the reference with
  `pnpm --filter @my-surveys/contract build:docs` (`pnpm demo` does it for you).
- The home page shows "Could not load the application configuration": the server is not
  running on port 3000.
- Server exits at start-up with `Invalid configuration:`: it lists every bad environment
  variable. See [Development](../development.md#environment-variables-server).
