# Demo: hosted Step 1, decisions and evidence

This page lets you check hosted Step 1 without reading code. It takes about fifteen minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root.

What Step 1 delivers: **the facts the hosted migration rests on.** A read-only command measures the legacy stores, and
these documents record the decisions and where the data goes:

- [ADR 0033](../adr/0033-hosted-target-stores.md): the target database and file store (accepted 2026-11-18, once the
  inputs below were in);
- [ADR 0035](../adr/0035-legacy-api-bridge.md): a bridge answers every action of the old API, through Studio's
  public API (it supersedes [ADR 0034](../adr/0034-legacy-api-scope.md), which kept or retired endpoints by usage);
- [ADR 0036](../adr/0036-history-snapshots-above-a-size-limit.md): history snapshots above a size limit go to the
  byte store, which keeps the hosted database small;
- [Legacy API usage](../architecture/legacy-api-usage.md): the legacy `api.surveyjs.io` endpoints, how their use is
  measured, and what the usage means for the bridge;
- [Hosted migration mapping](../architecture/hosted-migration-mapping.md): what the migration keeps on Studio's side.
  The entity-by-entity mapping is in the legacy documentation, in the private location.

Nothing changes for users: production (studio.surveyjs.io) is not affected.

**Inputs** from the SurveyJS team, all kept in the private location (plan-hosted.md, rule 6): the `api.surveyjs.io`
usage from the old service's monitoring and HTTP logs, the production volumes from the command below, and the
provider's offer. All are in (2026-11-18); the public documents hold orders of magnitude and shares only.

## Before you start

You need Docker and the local replica of the legacy stores: `pnpm demo:azurite:up`. It starts Azurite and SQL Server
and loads the fixtures; the last lines say `SQL: Users=6, Surveys=9, …` and `Tables: 7 tables, 1522 entities`.

## 1. Counts and sizes of the replica (checklist 1)

1. Run `pnpm inspect:legacy --stats --env-file docker/azurite.env`.
   - **Check:** the SQL block says `Surveys   9 (personal 6, project 3, archived 2)`, `Users     6 (…)` and
     `Projects  2 (memberships 5)`: the counts the loader printed.
   - **Check:** the responses line has `max 1500`: the generated survey "API created".
   - **Check:** every container line starts with `shared/`: the replica's two storage connection strings name one
     account, and it is read once.
   - **Check:** the last line says the file shares are not read.
2. Run it again with `--json --result-bytes`.
   - **Check:** JSON comes out, with `"resultBytesMeasured": true` and a `resultChars` total under `responses`.
3. Run `pnpm inspect:legacy --stats --user a@b.c`.
   - **Check:** exit code `2` and `Give --user or --stats, not both`.
4. Run `pnpm inspect:legacy --stats` without the env file, in a shell without the `LEGACY_*` variables.
   - **Check:** exit code `2`; the message names the three variables and `--env-file docker/azurite.env`.

The test `server/src/legacy/stats.azurite.test.ts` (`pnpm test:providers:azurite`) checks the same counts against the
fixtures exactly.

## 2. The documents (checklist 2)

1. Open [ADR 0033](../adr/0033-hosted-target-stores.md).
   - **Check:** the options, the criteria in order, the choice (self-run PostgreSQL and S3-compatible object storage, backups
     in another location; the infrastructure details are private), the volumes and the window estimate in orders of magnitude, and every input in.
2. Open the [mapping](../architecture/hosted-migration-mapping.md).
   - **Check:** it states what moves and what holds on Studio's side (ids, timestamps, profiles), and points to the
     legacy documentation for the entity-by-entity mapping. Reviewers with access to the private location check
     there that every entity of [legacy-data-layout.md §3](../architecture/legacy-data-layout.md#3-entities) has a
     section.
3. Open [Legacy API usage](../architecture/legacy-api-usage.md) and [ADR 0035](../adr/0035-legacy-api-bridge.md).
   - **Check:** every endpoint has the bridge step that builds it (5 or 6), or says it is forwarded to the old
     service; nothing answers `410`. The measured table holds shares and plain words only.
4. Open [ADR 0036](../adr/0036-history-snapshots-above-a-size-limit.md).
   - **Check:** the default (no limit) changes nothing for self-hosted installations; the write and delete orders and
     the backups are stated.

## 3. Nothing private (checklist 3)

1. Run `pnpm scan:secrets`.
   - **Check:** no leaks found.
2. Read the new documents once more for production data.
   - **Check:** no counts, sizes or timings from production beyond orders of magnitude and shares, no addresses, no
     survey or post ids, and no names of integrators or customers.
