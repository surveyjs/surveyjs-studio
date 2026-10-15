# Testing

Tests check behaviour through a **seam**: HTTP, the browser, or the inputs and outputs of a pure
function. They do not call internals or read private state. Test output must be clean: no
warnings.

## The three seams

| Seam               | Question it answers                             | Where                | Status                   |
| ------------------ | ----------------------------------------------- | -------------------- | ------------------------ |
| HTTP conformance   | Does a server follow the contract?              | `conformance-tests/` | Built (Step 1)           |
| Browser end-to-end | Does the whole app work in a real browser?      | `e2e/`               | Built (Step 1), one spec |
| Provider suite     | Does a storage provider behave like the others? | (not yet)            | Arrives with Step 2      |

Unit tests sit next to the code (`*.test.ts`, `*.test.tsx`).

## Run everything

| Command                 | Runs                                                    |
| ----------------------- | ------------------------------------------------------- |
| `pnpm test`             | `pnpm test:unit`, then `pnpm test:conformance`          |
| `pnpm test:unit`        | Vitest projects: `scripts`, `contract`, `server`, `web` |
| `pnpm test:conformance` | The conformance suite against a server it starts itself |
| `pnpm e2e`              | Playwright on Chromium, Firefox and WebKit              |

CI runs all of them (see [Development](development.md#ci)).

## Unit tests

Run with Vitest from the root. Scope:

- `scripts/`: the `check:deps` rules.
- `contract/`: the package exports.
- `server/`: configuration (`loadConfig`), the error mapper, the contract loader, and the app
  through Fastify's `inject` (HTTP in, HTTP out).
- `web/`: the API client and config loader (with `msw` and `openapi-msw` mocks typed by the
  contract), the licence loader, and the app rendered with React Testing Library.

Run one project: `pnpm vitest run --project server`. Run one file: `pnpm vitest run server/src/config.test.ts`.

## HTTP conformance

The suite calls a server **only over HTTP** and validates each response against
`contract/openapi.yaml`: documented status, content type, required headers, body schema, and for
errors a `code` from the Problem enum with a `status` equal to the HTTP status. A `501` Problem is
accepted from any operation. Details: [`conformance-tests/README.md`](../conformance-tests/README.md).

Against the reference server (it starts the server on a free port with `NODE_ENV=test`, with every app
variable from your shell removed so only explicit values reach it, waits for
`/readyz`, and stops it afterwards):

```sh
pnpm test:conformance
```

Against another back end, start it first, then give the suite its origin without `/api/v1`.
The server must be a fresh, empty instance.

Git Bash:

```sh
CONFORMANCE_BASE_URL=http://127.0.0.1:3000 pnpm test:conformance
```

PowerShell:

```powershell
$env:CONFORMANCE_BASE_URL = "http://127.0.0.1:3000"; pnpm test:conformance
Remove-Item Env:CONFORMANCE_BASE_URL
```

A port is accepted when this suite passes against it. The suite also tests its own validator
against a small fixture contract (`conformance-tests/src/fixtures/things.yaml`), so a broken
validator cannot give false passes.

## Browser end-to-end

Install the browsers once (see [Development](development.md#setup)), then:

```sh
pnpm e2e
```

Playwright starts both servers itself (server on 3000 with `NODE_ENV=test`; the production web
build served by `vite preview` on 5173) and opens the app in three browsers. Rules:

- The config strips the developer's app variables (`APP_*`, `PORT`, `VITE_*`, and the other
  server variables) from the environment before starting the servers. Results do not depend on
  what you have exported.
- Locally it reuses servers already running on 3000 and 5173 (for example `pnpm demo`). Those servers must use the default configuration, or the home page spec fails. With `CI` set it does not
  reuse them, and fails if the ports are busy.
- Each spec fails on any browser console error or page error.
- Traces are kept for failures; CI uploads `e2e/playwright-report/`.

Run one browser: `pnpm e2e --project=chromium`.

## Provider suite (Step 2)

One shared suite will run against every storage provider (in-memory, and Azure with Azurite) to
prove they behave the same. It does not exist yet.
