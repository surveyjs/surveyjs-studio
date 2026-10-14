# Demo: Step 2, legacy storage spike and Azure provider base

This page lets you check Step 2 without reading code. It takes about fifteen minutes (the first
run pulls two Docker images). Commands are for Git Bash (or any POSIX shell); in PowerShell the
same commands work, except where a variable is set.

What Step 2 delivers: a study of how surveyjs.io stores My Surveys data today, domain types and
store interfaces, an in-memory provider, a **read-only** provider for the legacy stores, golden
fixtures in the legacy formats, a local replica of the legacy stores in Docker (Azurite and SQL
Server), a provider test suite, and an inspector command. There are still no survey screens.

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2),
and **Docker** with Compose, running. Run `pnpm install` once.

Ports 10000, 10002 and 14333 on 127.0.0.1 must be free.

## 1. Start the replica

```sh
pnpm demo:azurite:up
```

Expected: Docker creates two containers, `my-surveys-legacy-azurite-1` and
`my-surveys-legacy-legacy-sql-1`, and waits until both are `Healthy` (SQL Server takes up to a
minute). Then the fixture loader prints its summary:

```text
SQL: Users=5, Surveys=8, Organizations=2, OrganizationUsers=5
Tables: 6 tables, 22 entities
Blobs: 12 append blobs in 7 containers
Files: skipped 2 fixture files (Azure Files is not emulated by Azurite)
```

The `Files` line is expected: Azurite has no Azure Files service ([ADR 0006](../adr/0006-legacy-replica.md)).
Running the command again is safe.

## 2. Inspect the legacy stores

The inspector reads through the `azure-legacy` provider, which can only read.

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

Expected:

```text
User: 11111111-0000-4000-8000-a00000000001  owner@example.com  Olivia Owner  (provider: azure-legacy)

Personal
Id                                    Name               Published  Archived  Created                   Updated
22222222-0000-4000-8000-a00000000008  API created        no         no        2026-05-30T21:00:00.000Z  2026-06-01T07:45:10.000Z
22222222-0000-4000-8000-a00000000003  Old poll           no         yes       2025-12-10T12:00:00.000Z  2026-05-20T12:00:00.123Z
22222222-0000-4000-8000-a00000000001  Customer feedback  yes        no        2026-03-13T09:12:00.000Z  2026-04-14T15:30:00.000Z
22222222-0000-4000-8000-a00000000002  Draft idea         no         no        2026-02-01T08:00:00.000Z  2026-02-02T08:00:00.000Z

Project Engineering (55555555-0000-4000-8000-a00000000002, role user)
Id                                    Name               Published  Archived  Created                   Updated
22222222-0000-4000-8000-a00000000006  Engineering retro  no         no        2026-02-14T16:00:00.000Z  2026-07-01T16:45:30.000Z

Project Marketing (55555555-0000-4000-8000-a00000000001, role admin)
Id                                    Name               Published  Archived  Created                   Updated
22222222-0000-4000-8000-a00000000004  Campaign survey    yes        no        2026-01-15T13:00:00.000Z  2026-06-10T09:05:00.000Z
22222222-0000-4000-8000-a00000000005  Archived campaign  yes        yes       2025-12-20T10:00:00.000Z  2026-03-01T10:00:00.000Z
```

Check:

- the surveys of each list are ordered by **Updated**, newest first;
- the dates are the ones in the fixtures (`server/fixtures/legacy/sql/Surveys.json`, columns
  `createdat` and `timestamp`);
- the projects are ordered by name; the owner is `admin` in Marketing and `user` in Engineering.

The seed accounts (all in `server/fixtures/legacy/sql/Users.json`, all synthetic):

| Email                  | Name           | Use                                                    |
| ---------------------- | -------------- | ------------------------------------------------------ |
| `owner@example.com`    | Olivia Owner   | Personal surveys, admin of Marketing                   |
| `admin@example.com`    | Adam Admin     | Admin of Engineering (its creator) and Marketing       |
| `member@example.com`   | Mia Member     | Member of Marketing                                    |
| `outsider@example.com` | Oscar Outsider | One personal survey, in no project                     |
| `blocked@example.com`  | (none)         | Blocked user; the display name falls back to the email |

Try one more user, and a user that does not exist (the exit code is `1`):

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user member@example.com
pnpm inspect:legacy --env-file docker/azurite.env --user nobody@example.com
```

Expected for the second: `User not found in the azure-legacy store: nobody@example.com` on standard
error.

Without `--env-file` (and without `STORAGE_PROVIDER` in the environment) the inspector refuses
with exit code `2` instead of reading an empty in-memory store:

```sh
pnpm inspect:legacy --user owner@example.com
```

Expected on standard error:

```text
No store to inspect: STORAGE_PROVIDER is not set. Pass --env-file docker/azurite.env for the local replica, or set STORAGE_PROVIDER and the variables of that store.
```

## 3. The same list from memory

The in-memory provider can start from the same fixtures. The explicit variables win over the
`STORAGE_PROVIDER=azure-legacy` in the env file.

Git Bash:

```sh
STORAGE_PROVIDER=memory MEMORY_SEED=legacy-fixtures pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

PowerShell:

```powershell
$env:STORAGE_PROVIDER = "memory"; $env:MEMORY_SEED = "legacy-fixtures"; pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
Remove-Item Env:STORAGE_PROVIDER, Env:MEMORY_SEED
```

Expected: exactly the output of step 2, except that the first line ends with `(provider: memory)`.
Two providers, one fixture set, the same answers: that is what the provider suite checks.

## 4. Tests

```sh
pnpm test:unit
pnpm test:providers:azurite
pnpm test:conformance:azurite
```

Expected:

- `pnpm test:unit`: all pass (`Test Files 22 passed`, `Tests 339 passed`). It includes the
  provider suite on the in-memory provider and does not need Docker.
- `pnpm test:providers:azurite`: `Test Files 3 passed`, `Tests 42 passed`. The provider suite,
  the NULL-row tests and the fixture loader tests run against the replica. Needs the replica from step 1.
- `pnpm test:conformance:azurite`: `Test Files 2 passed`, `Tests 20 passed`. The conformance
  suite runs against a server that uses the `azure-legacy` provider.

The numbers grow in later steps; what matters is that all pass and nothing prints warnings.

## 5. Read the study and the verdict

Open [legacy-data-layout.md](../architecture/legacy-data-layout.md). Reviewers check:

- the stores and entities (sections 2 and 3) and the mapping to the domain (section 9);
- the **D11 verdict** (section 8): respondent files can be stored as URLs in place of inline
  content, **yes, with conditions**. The decision and its open checks are in
  [ADR 0005](../adr/0005-respondent-files-as-urls.md). Do you agree?
- the gaps that need the site team (section 11), and the points left open for later steps in
  [the architecture page](../architecture.md#open-for-later-steps).

## 6. Stop the replica

```sh
pnpm demo:azurite:down
```

Expected: both containers, the volumes and the network are removed. The replica's data is gone;
the next `pnpm demo:azurite:up` starts clean.

## Checklist

| #   | Check                                                                                                                                 | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `pnpm demo:azurite:up` starts Azurite and SQL Server and loads the fixtures (summary above)                                           |        |
| 2   | `pnpm inspect:legacy ... --user owner@example.com` prints the owner's surveys, with created and updated dates that match the fixtures |        |
| 3   | The same command on `memory` with `MEMORY_SEED=legacy-fixtures` prints the same list                                                  |        |
| 4   | `pnpm test:unit`, `pnpm test:providers:azurite` and `pnpm test:conformance:azurite` are green                                         |        |
| 5   | Reviewers read the layout document and agree with the D11 verdict ([ADR 0005](../adr/0005-respondent-files-as-urls.md))               |        |
| 6   | `pnpm demo:azurite:down` removes the containers and volumes                                                                           |        |

## Troubleshooting

- `docker: command not found`, or "Cannot connect to the Docker daemon": install and start Docker
  (Docker Desktop on Windows), then run `pnpm demo:azurite:up` again.
- A port is already in use (10000, 10002 or 14333): stop what holds it. The ports are fixed and
  bound to 127.0.0.1 only. A replica left over from an earlier run can be removed with
  `pnpm demo:azurite:down`.
- The first start is slow, or `up` waits a long time: Docker pulls two images (SQL Server is
  large), and SQL Server needs up to a minute to become healthy. Wait; the command returns when
  both are healthy.
- The loader prints a refusal and writes nothing: it only writes to local endpoints (127.0.0.1 or
  localhost). Check that the `LEGACY_*` variables in your shell do not point elsewhere; explicit
  variables win over `docker/azurite.env`.
- `Unsupported engine` or odd syntax errors: wrong Node version (20 instead of 24). Run
  `nvm use` and check `node -v`.
- The inspector cannot connect right after `up`: run `docker ps` and check that both containers
  are `healthy`.

## What is not in Step 2

- End-to-end tests on Azurite wait for Step 3 (they need the mock OIDC server).
- The test with more than 1,000 responses waits for Step 9.
- Writes to any store: the legacy provider is read-only by design.
- Azure Files: not emulated, so legacy file reads are not tested.
