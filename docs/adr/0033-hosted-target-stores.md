# ADR 0033: Hosted target stores

Status: Accepted (hosted Step 1, 2026-11-18); [readiness added 2026-11-25](#readiness-hosted-step-8-2026-11-25). Proposed on 2026-11-13 with the criteria and the method; accepted once
the inputs from the SurveyJS team were in (see [Inputs](#inputs)).

## Context

At the cutover ([spec-hosted.md](../../spec-hosted.md) › Cutover) `studio.surveyjs.io` moves off the legacy Azure
stores ([legacy-data-layout.md](../architecture/legacy-data-layout.md) §2) to another provider.

Two facts narrow the choice:

- **The app already runs outside Azure** in mode 1.1, on one production server. After the cutover the stores should be
  next to it, because every page makes several store calls.
- **The self-hosted track built PostgreSQL and S3-compatible storage**
  ([ADR 0024](0024-kysely-and-plain-sql-migrations.md), [ADR 0025](0025-file-storage-for-the-sql-providers.md)),
  with the provider and conformance suites on both. Any other choice means a new provider in hosted Step 8.

The infrastructure itself (the provider, the location, the server, its set-up and the offer the choice was weighed
against) is described in the private infrastructure notes (plan-hosted.md, rule 6), not here.

## Options

| Kind       | Options weighed                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database   | PostgreSQL managed by the provider; PostgreSQL self-run next to the app; managed PostgreSQL from another processor; MySQL as the contrast (no provider) |
| File store | The provider's S3-compatible object storage; another S3 service; a self-run S3-compatible server; local disk (`FILE_STORE=local`)                       |

## Criteria

In order of weight:

1. **Data location and a data-processing agreement.** The stores hold respondents' answers and files: each processor
   signs a GDPR Art. 28 agreement. Fewer processors is better.
2. **Point-in-time restore** of the database, and versioning or a scheduled copy of the files (H25).
3. **Closeness to the app:** the same location as the production server, so a page's store calls stay fast.
4. **Already in the repository:** PostgreSQL and S3-compatible storage carry their suites; anything else costs Step 8
   a provider.
5. **Cost,** including egress, at the volumes `pnpm inspect:legacy --stats` measures, plus room to grow.

## Decision

- **Database: PostgreSQL, self-run on the production server,** operated by the SurveyJS team. The provider offers no
  managed PostgreSQL with point-in-time restore, and a managed one elsewhere adds a processor and a network hop.
- **File store: the provider's S3-compatible object storage, in the production server's location,** versioned, with
  old versions kept 30 days (H25).
- **Backups:** WAL archiving and full and differential backups of the database to object storage in **another
  location**, so one location's outage does not take the backups too; a backup before each deploy, and a rollback
  that restores it when an older version refuses the migrated database. Hosted Step 8 tests one restore into a
  scratch instance.
- **History snapshots** above a size limit go to the object storage, not the database
  ([ADR 0036](0036-history-snapshots-above-a-size-limit.md)).
- **The location, the server type and the set-up** are in the private infrastructure notes.

It meets criteria 1–4 with what the repository already has.

## The volumes (2026-11-18)

Measured on production by the SurveyJS team. The figures stay private (plan-hosted.md, rule 6); in orders of
magnitude:

| Data                          | Order of magnitude                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Users, surveys, projects      | tens of thousands of users, hundreds of thousands of surveys: tens of megabytes    |
| Responses                     | tens of millions, about a kilobyte each; **one survey holds about two thirds**     |
| Survey events and completions | tens of millions of events, millions of completion markers                         |
| Current definitions           | gigabytes                                                                          |
| **Survey history**            | **in the order of a terabyte of JSON, over ten million entries:** the largest data |
| Files                         | in the order of a terabyte, over a million files                                   |

What follows from them:

- **History snapshots above a size limit go to object storage** (ADR 0036). With them in PostgreSQL the database would
  be several times its other data, and every backup would carry it.
- **The database is then in the order of tens of gigabytes:** the responses, the event log and the small history
  snapshots, in that order. The server is sized for that with room for the import, maintenance and growth (private
  infrastructure notes).
- **Object storage** holds the files and the larger history snapshots: in the order of two terabytes.
- **The scale check** (hosted Step 8) must cover a survey with millions of responses.

## Window estimate

The cutover window target is under one hour ([spec-hosted.md](../../spec-hosted.md) › Decisions on the open
questions). The estimate has two parts:

- **Pre-copy** (before the window, the app still live): the full copy. Its time is the volume divided by the copy
  rate, which Step 9 measures on the replica and Step 11 on a production-sized copy.
- **Delta** (inside the window, the app read-only): the changes since the pre-copy's high-water marks.

The calculation with the real figures stays private. In orders of magnitude (2026-11-18):

- **Pre-copy: about a day.** One to two terabytes in over ten million objects. The bytes take hours, and the round
  trip per object, even with many in parallel, takes hours as well. The app stays live meanwhile, so this is not the
  window. Egress charges for the volume are in the order of a hundred dollars.
- **Delta: fits the hour, if it is driven by the changed surveys.** The changes since the pre-copy are small, but
  finding them must not mean listing every stored object: the measurement's listings alone took hours. So `delta`
  reads only what belongs to surveys changed after the pre-copy, and only the responses added since (hosted Step 9).
- **Fits the one-hour target** on that condition.

## Inputs

All in by 2026-11-18:

1. **The move to another provider:** agreed by the SurveyJS team (2026-11-16). Their part before the cutover:
   - the privacy statement updated in the cutover release;
   - the new provider's data processing agreement (GDPR Art. 28) accepted;
   - Azure stays a processor until Step 12 removes the legacy stores.
2. **The provider's offer:** checked 2026-11-13 (private infrastructure notes); the prices are re-read before ordering.
3. **The operating model:** self-run, by the SurveyJS team.
4. **The volumes:** measured 2026-11-17/18 with `pnpm inspect:legacy --stats`
   ([Development › Counts and sizes](../development.md#counts-and-sizes)) and the storage accounts' capacity from the
   Azure portal. Kept in the private location.

## Consequences

- The choice is PostgreSQL and S3-compatible storage, so hosted Step 8 adds the hosted-only tables, the scale check
  and the backup set-up, and builds no provider.
- A self-run database makes the SurveyJS team the operator of backups, upgrades and monitoring: hosted Step 8
  documents them in [Operations](../operations.md).
- After the cutover the app has database migrations, so the server's rollback by image tag needs the rule of hosted
  Step 10.

## Readiness (hosted Step 8, 2026-11-25)

What hosted Step 8 builds and checks on these stores. The history volume above is replaced by at most 20 entries per
survey ([ADR 0036, changed 2026-11-25](0036-history-snapshots-above-a-size-limit.md)); the volumes and the window
estimate are re-measured with the new stats.

- **The archive tables** (migration `0011`): `survey_events` (survey id, type, time, payload) and `deleted_responses`
  (survey id, response id, deleted at, the response as JSON). Only the migration writes them; Studio reads neither.
  **`pnpm purge:deleted-responses --before <date>`** (a dry run unless `--apply`) empties the copies; the cutover runbook
  runs it 30 days after the cutover. No background job. (Legacy keys: [ADR 0037, changed 2026-11-25](0037-access-keys-and-api-tokens.md).)
- **Scale targets.** A generator builds a synthetic data set the size of production (its sizes are parameters, so the
  real figures stay out of the repository), with one survey of millions of responses; a check measures through the HTTP
  API, 95th percentile, a warm server:

  | Operation                                                         | Target                                                         |
  | ----------------------------------------------------------------- | -------------------------------------------------------------- |
  | The survey list (a user with many surveys)                        | under 0.5 s                                                    |
  | A page of the Table of the largest survey, with a filter and sort | under 2 s                                                      |
  | The Summary's data: the newest 25,000 responses                   | under 5 s                                                      |
  | Export of every response of the largest survey                    | the first rows within 1 s; every row fetched within 10 minutes |
  | A save of a survey with 20 history entries                        | under 0.5 s                                                    |

  Index changes are made, as migrations, until the targets hold (the Table's server operation is hosted Step 8b,
  [ADR 0015, changed 2026-11-25](0015-results-summary-table-and-views.md)).

- **Restore once into a scratch instance** (H25) on the new server: a point-in-time restore from the backups in the
  other location, and a file brought back from the bucket's old versions. The private deployment notes hold the
  commands; this repository gets the result and an outline in `docs/operations.md`.
- **The new server's profile** (`STORAGE_PROVIDER=postgres`, `FILE_STORE=s3`, `HISTORY_MAX_ENTRIES=20`, the hosted
  sign-in of [ADR 0043](0043-hosted-users-on-the-local-directory.md)) is documented beside today's in
  the deployment's example environment file, `docker/prod-like.sql.env` and `pnpm prod-like-sql:up`, and a
  `prod-like-sql` CI job (PostgreSQL and S3).
- **When:** the generator, the check and the commands are built in Step 8; the run on the new server, the production
  measurement and the restore happen once that server is built, and their figures are added here, rounded
  (plan-hosted rule 6).
