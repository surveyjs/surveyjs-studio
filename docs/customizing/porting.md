# Porting the back end to another platform

The back end is one HTTP contract, [`contract/openapi.yaml`](../../contract/openapi.yaml). A port in .NET, PHP, Java or
anything else serves that contract, and the web app cannot tell the difference. A port is accepted when the conformance
suite passes against it. This page says what a port must offer so the suite can test it, and how to run the suite.

## What the suite checks

The suite calls the server **only over HTTP**. For each operation it checks the documented status, the content type, the
required headers, the body schema and, for errors, the `code` of the Problem. It is a Vitest project, so you run it from
a checkout of this repository, whatever your port is written in. What it checks, and how it signs in, is in the
[conformance README](../../conformance-tests/README.md).

## What a port must offer to be tested

| What                | Why                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/readyz`           | The suite waits for it to answer `200` before it starts.                                                   |
| `/__dev/sign-in`    | A "Sign in as..." page that completes sign-in as a user of the fixtures, so the suite can sign in as them. |
| The legacy fixtures | The users, projects, surveys and results the tests read. Start the port with the same data.                |
| The settings below  | The limits and rate limits the tests expect, and the webhook secret.                                       |

**Without `/__dev/sign-in` the tests that need a signed-in user are skipped.** The run then looks green, but it has
checked only the sign-in redirect, the callback's `400`s and the anonymous `401`s. A skipped test is not a pass: a port
is accepted when nothing is skipped for this reason. The skip note names the redirect target the suite met instead. Offer
the page in your test setup only. The reference server refuses it in production.

The fixtures are in [`server/fixtures/legacy/`](../../server/fixtures/legacy/). The server must be a **fresh
instance**: the suite creates its own projects and surveys, but it counts on the fixtures being there and nothing else.

### The settings

These are the fixed settings of the reference server. They are copied by hand from
[`conformance-tests/src/reference-settings.ts`](../../conformance-tests/src/reference-settings.ts), the one source: if
you change that file, change this table. The names are the reference server's environment variables. A port may read the
values from anywhere, but it must behave as if it had them.

| Setting                            | Value                                                    | What the tests need it for                                          |
| ---------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `STORAGE_PROVIDER`                 | `memory`                                                 | Records held in memory, empty but for the fixtures.                 |
| `IDENTITY_PROVIDER`                | `dev`                                                    | The `/__dev/sign-in` page.                                          |
| `MEMORY_SEED`                      | `legacy-fixtures`                                        | The fixtures above.                                                 |
| `LOG_LEVEL`                        | `warn`                                                   | Quiet output.                                                       |
| `SIGN_IN_RATE_LIMIT`               | `100000`                                                 | The suite signs in many times from one address.                     |
| `TRUST_PROXY`                      | `127.0.0.1,::1`                                          | The rate-limit test sends its own `X-Forwarded-For` from loopback.  |
| `PUBLIC_RATE_LIMIT`                | `300`                                                    | The suite reads public surveys many times from one address.         |
| `PUBLIC_FILE_RATE_LIMIT`           | `10000`                                                  | The same for public files.                                          |
| `LIMIT_MAX_DOCUMENT_BYTES`         | `262144`                                                 | The `413` test reads the limit from `/config`, so it stays cheap.   |
| `LIMIT_MAX_ASSET_BYTES_PER_SURVEY` | `65536`                                                  | The quota tests read the limit from `/config`.                      |
| `LIMIT_MAX_FILE_BYTES`             | `65536`                                                  | The file `413` test reads the limit from `/config`.                 |
| `ACCOUNT_WEBHOOK_SECRET`           | `whsec_bXktc3VydmV5cy1jb25mb3JtYW5jZS13ZWJob29rLWtleQ==` | The account-deleted webhook tests sign with it (a synthetic value). |
| `HOST`, `PORT`, `PUBLIC_BASE_URL`  | `127.0.0.1`, your port, `http://127.0.0.1:<port>`        | Sign-in redirects point at the server under test.                   |

## Running the reference image

To see the suite pass before you run it on your port, run the reference server's production image with the same
settings. CI does exactly this (the `conformance-base` job). It needs Linux, because the container uses
`--network host`. Build the image first with `docker build -t surveyjs-studio:ci .`.

```sh
node --import tsx scripts/conformance/cli.ts reference-env --port 3000 --out ref.env
docker run -d --name reference --network host --env-file ref.env -e NODE_ENV=development surveyjs-studio:ci
```

`reference-env` writes the table above as `NAME=value` lines. `NODE_ENV=development` is needed because the image refuses
the dev sign-in in production. Wait until `http://127.0.0.1:3000/readyz` answers, then run the suite as
[below](#running-the-suite). Remove the container afterwards with `docker rm -f reference`.

On Windows and macOS, run the reference server from the checkout instead: `pnpm test:conformance` starts it, runs the
suite and stops it.

## Running the suite

Start your port, with the settings above and the fixtures, on a fresh instance. Then give the suite its **origin**,
without `/api/v1` (the suite adds it):

```sh
export CONFORMANCE_WEBHOOK_SECRET='whsec_bXktc3VydmV5cy1jb25mb3JtYW5jZS13ZWJob29rLWtleQ=='
pnpm test:conformance --base http://127.0.0.1:3000
```

`CONFORMANCE_WEBHOOK_SECRET` is the secret your port was started with. Without it the account-deleted webhook tests are
skipped, and the run is not complete. Other arguments go to Vitest: add `-t surveys` to run the tests with "surveys" in
their name.

A trailing slash is ignored. A `--base` with a path (such as `/api/v1`), without a value, or that is not an http or https
URL stops the run with exit code 2 and a usage message. `CONFORMANCE_BASE_URL` still works and has the same effect.

## Reading failures

A failure names the operation, such as `getSurvey`, and what differed from the contract.

| The message is about                      | Look at                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| An undocumented status                    | The port answers a status the operation does not list.                                     |
| A content type that is not documented     | Errors are `application/problem+json`. Other bodies use the media type the contract lists. |
| A missing required header                 | The response lacks a header the contract marks `required: true`.                           |
| A schema error with a path like `/id`     | The body has a wrong or missing property at that path, or one the schema does not allow.   |
| A Problem with a wrong `code` or `status` | The `code` is not in the Problem enum, or `status` differs from the HTTP status.           |
| A `429`, or a timeout, after some tests   | A rate limit is lower than the table says.                                                 |
| Skipped tests                             | The sign-in page is missing, or the webhook secret is not set (see above).                 |

The suite sees only HTTP. When a port misbehaves in a way the suite does not show, read the port's own log.

## See also

- [Conformance README](../../conformance-tests/README.md): the checks, the sign-in driver and the other run modes.
- [Testing](../testing.md#http-conformance): the suite among the other tests.
