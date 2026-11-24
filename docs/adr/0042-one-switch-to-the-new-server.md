# ADR 0042: One switch to the new server, after a test migration

Status: Accepted (2026-11-24, the product owner's sequence). Changes [ADR 0041](0041-taking-over-the-legacy-api-host.md)
points 1, 2 and 7: there is no early switch of `api.surveyjs.io`. Keeps the rest of ADR 0041 (metrics, the caller log,
the replay, `smoke`, the upload deadline, the legacy-file cap).

## Context

ADR 0041 moved `api.surveyjs.io` to the bridge weeks before the cutover, with the bridge on the new server calling
today's Studio. The product owner chose another order (2026-11-24): build the new server, test it on a part of the real
data, and switch both host names once, after the final migration has been checked. Three facts shape it:

- **Today's Studio must stay fixable.** It runs `master` as of #39 on the legacy stores, and a fix may be needed before
  the cutover. Hosted Steps 3–7 change what it would do on production (site access keys accepted as bearer
  credentials, partial saves folded in the results, slower result pages on very large surveys), and none of it is
  needed there if the bridge never calls it.
- **The old service also serves the site's demos and housekeeping** on `api.surveyjs.io`
  ([ADR 0034](0034-legacy-api-scope.md) C6). Pausing them during the window is not acceptable.
- **There is no staging copy** of the data ([ADR 0041](0041-taking-over-the-legacy-api-host.md)), so the rehearsal
  cannot run on one.

## Decision

### 1. Two lines of code

- **`production`** is today's server: created from `master` at `15e30d8`, fixes only. CI publishes the hosted image
  for its commits, Actions › Deploy takes them, and each fix is merged into `master` too. The branch is deleted with
  today's server.
- **`master`** is the new server. Hosted Steps 1–7 merge into it, and every later step builds on it.

### 2. The new server

One server runs Studio, the bridge, PostgreSQL and Prometheus; files go to the provider's S3-compatible object
storage in the same location, and the database's backups to object storage in another location
([ADR 0033](0033-hosted-target-stores.md)). The bridge calls the Studio on the same server from the start; there is no
stage in which it calls today's Studio, so `setup.sh --trusted-proxies` is not needed for this track (the option stays;
it is harmless). The server has **test host names** for Studio and the API, which reach the same apps before and after
the switch. Its set-up stays private (plan-hosted rule 6).

### 3. The site's paths get their own host

The site team builds and deploys **`demoapi.surveyjs.io`** for the site's demos and housekeeping, before the test
migration. The bridge forwards the paths it does not own to that host (`BRIDGE_LEGACY_URL`), so pages that still call
them on `api.surveyjs.io` keep working after the switch, and the old service serves nothing that must stay up through
the window. Which paths move is in the private legacy documentation.

### 4. The test migration

- **About 10 % of the data, as whole accounts:** an account's surveys, results, history, files, projects and members
  move together, so nothing points at data that was not copied. The sample includes the test account and a few large
  surveys. The largest survey is included, or its load is covered by Step 8's scale check.
- **Checked through the test host names:** the compatibility, conformance and Phase 1 user-story suites;
  `pnpm legacy:replay` limited to the sample's surveys and keys and run right after a `delta`, so stale data does not
  read as a difference; `smoke` with the test account's key; a load test (k6) at the rates the usage measurement found,
  with targets from Step 8's scale ADR. Reports stay private (rule 6).
- **Then the target is wiped.** Test writes never reach the final data.

### 5. The final migration and the switch

1. **Announce** one to two weeks before (spec-hosted › Cutover).
2. **Pre-copy everything** while the old side runs, then `verify`. Run `delta` daily up to the window: it keeps the
   window's delta small and measures how long it takes.
3. **Lower the time-to-live** of both DNS records at least two days before.
4. **The window:**
   - the SurveyJS team stops the old service (its site paths already live on `demoapi.surveyjs.io`);
   - today's Studio turns on `READ_ONLY=true`: its banner on the list and the run page, and the read-only editor, exist
     since plan.md Step 14, so `production` needs no new code for the window;
   - `delta`, `reconcile`, `verify`, then the integrity checks through the test host names;
   - **go:** `studio.surveyjs.io` and `api.surveyjs.io` point at the new server; the certificates are issued over HTTP
     at the switch, at a quiet hour, as ADR 0041 point 2 describes for one host;
   - **no-go:** start the old service and turn `READ_ONLY` off. The legacy stores were only read; nothing is lost.
5. **After the switch** problems are fixed on the new server; there is no reverse sync (spec-hosted › Cutover).
   `LEGACY_KEY_REVOKE` is turned on once the switch has held for a day, as ADR 0041 planned.

### 6. After the cutover

A **checking period of one month**. The old service is not started again, and today's Studio server is removed at its
end. The legacy stores stay untouched until the SurveyJS team removes them (spec-hosted › Retirement). Hosted Step 12
starts after the same month.

## Why not the alternatives

| Option                                                                   | Why not                                                                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| ADR 0041's early switch, the bridge calling today's Studio for weeks     | The product owner's choice: test the whole new server first and switch once; Steps 3–7 would have to run on today's Studio |
| Merging Steps 1–7 into `master` and deploying `master` to today's server | Changes production behaviour that nothing there needs, and any urgent fix would ship all of it                             |
| Keeping the steps unmerged until the cutover                             | Every fix and every later step stacked on seven open branches                                                              |
| Pausing the site's demos and housekeeping during the window              | Not acceptable to the site team                                                                                            |
| A rehearsal on a staging copy                                            | There is none; the sample on the new server and the daily `delta` measure what the rehearsal was for                       |

## Consequences

- **Hosted Step 2** (users from sign-in) is needed before the test migration: the new server reads no site user table.
- **Step 7's operational part** (the replay gate, the switch, what to watch) moves into the cutover runbook (Step 11);
  [the takeover runbook](../operations/legacy-api-takeover.md) is kept for its Prometheus queries and checks.
- **Step 9** gains sample selection (whole accounts) and wiping the target; the replay gains a filter for the sample.
- **Step 10** shrinks: no new maintenance states for today's server; `pnpm cutover` runs the window's checks and
  records them; rollback by image tag on a database with migrations is still settled there.
- **Step 11** is the test migration and the load test, not a rehearsal on a staging copy.
- **The SurveyJS team** builds `demoapi.surveyjs.io`, stops the old service in the window, and switches both records.
