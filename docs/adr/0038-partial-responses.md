# ADR 0038: Partial responses

Status: Accepted (hosted Step 4, 2026-11-19). Implements spec-hosted › Partial responses (H6, H8). Changes
[ADR 0014](0014-run-page-and-response-collection.md) S6 and [ADR 0015](0015-results-summary-table-and-views.md) R1 for
partial saves.

## Context

A SurveyJS form can save progress: on every page it posts the whole answer set with a client ID and a "partial" flag,
then posts the complete answers at the end. The old service stored every post as a new row of the survey's results
table, with a partial flag set on the partial ones, and set the client's completion marker to `partial`
([legacy-data-layout.md](../architecture/legacy-data-layout.md) §3.6–3.7). Its results readers merged all rows that
share a client ID into the first one, later rows overwriting its keys.

Studio ignores the flag today (ADR 0014 S6): every post is stored as complete. It lists every row as its own response
and never merges by client (ADR 0015 R1), because one browser may really answer twice. Legacy partial rows already
show up as ordinary rows.

So one respondent who saves on five pages and then completes leaves six rows. Listed one per row, the Table shows six
responses for one person.

## Decision

**Store every post as the old service did; fold a client's partial saves into one response when reading.**

1. **Submitting** (`submitResponse`):
   - `partial: true` with a `clientId` appends a row marked partial, and writes the client's completion marker as
     partial. A later complete post writes it as complete, as today. `completed` on `getPublishedSurvey` is true only
     for a complete marker.
   - `partial: true` without a `clientId` is stored as a complete response, as the old service did.
   - `lastPageIndex` is accepted and checked (an integer, at least 0) but not stored: the old service kept no page
     number, and Studio's run page does not resume yet.
   - "Limit to one response" and `Idempotency-Key` work as today, for partial posts too: a client whose marker is
     complete gets `409 already-completed`.
   - Storage keeps the legacy format: on the Azure legacy provider the legacy partial flag, written on the row and the marker as the old service wrote it
     ([legacy-data-layout.md](../architecture/legacy-data-layout.md) §3.6–3.7); on
     SQL the existing `partial` columns (migration `0002`). Rows stay append-only, so the migration copies them one to
     one.
2. **Reading: a run of one client is one response.** Take one client's rows in submission order. A **run** is one or
   more partial rows followed by the next complete row, if there is one. A complete row with no partial row before it
   is a run of its own. Rows without a client ID are never folded. The run reads as one response:
   - `id` and `submittedAt` of its **first** row, as the old readers did. The response keeps its place in the list
     while saves arrive, so paging stays stable;
   - `data`: the rows' answers merged in order, later keys overwriting earlier ones, as the old readers did;
   - `respondentIp`: the last row that has one;
   - `partial: true` while the run has no complete row. `partial` is returned only when true.

   Two complete answers from one client stay two responses (ADR 0015 R1 holds for them).

3. **Where partial responses appear:**

   | Place                                    | Partial responses                                                                      |
   | ---------------------------------------- | -------------------------------------------------------------------------------------- |
   | `listResults`, the Table                 | included, marked; the Table shows a "Partial" column when any exists                   |
   | Exports (JSON and CSV)                   | included; JSON marks them `partial: true`, CSV gets a "Partial" column when any exists |
   | `getResultStats`, the survey list counts | left out: `count`, first and last times are of completed responses                     |
   | The Summary (Dashboard)                  | left out                                                                               |
   | Public results                           | left out: they are a Dashboard too                                                     |

4. **Every provider** implements the same fold behind `ResultStore`, and the conformance and provider suites check it
   on memory, Azure legacy and SQL. SQL adds an index for a client's rows by time; Azure reads each row's client ID and
   partial flag with the positions it already reads to place a page.

### Why not the alternatives

| Option                                                         | Why not                                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every row its own response, partial ones marked                | Six rows for one respondent in any survey that saves progress                                                                                      |
| Merge all rows of a client, as the old readers did             | Two real answers from one browser become one; ADR 0015 chose against it                                                                            |
| Overwrite the client's partial row on each save (one row each) | Changes the legacy storage format while the old service still writes beside us, and the migration would still have to fold the rows already stored |
| The run's place at its last row (completion time)              | The response moves down the list with every save, so paging can skip or repeat it                                                                  |

## Consequences

- **Differences from the old readers,** to be listed in the API guide: rows are folded only inside a run, not across
  complete answers; public results and the Summary leave partial responses out.
- **Reads cost more.** On the Azure legacy provider every page reads the positions of every row (a row after the
  cursor may continue a run that started before it), so walking all pages costs about twice the reads of before, until
  the cutover. SQL `stats` filters on `partial`, and SQL paging asks for the history of the clients on a page that have
  partial rows.
- **The contract** drops `x-phase: P1` from `ResponseSubmission.partial`, `lastPageIndex` and `SurveyResponse.partial`,
  and its descriptions say the above.
- **The bridge** (Steps 5–6) passes the old API's partial flag through `submitResponse`, and answers `isCompleted` and
  the old results reads from these responses.
- **Self-hosted installations** get partial saves through the API as well; Studio's own run page still sends complete
  responses only.
