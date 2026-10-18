# 15. Results: Summary, Table and saved layouts

Date: 2026-10-18

## Status

Accepted. The product owner has not confirmed R4 (layouts per user), R12 (every question is charted) and the
source of the `xlsx` package yet (see "To confirm").

## Context

Step 9 lets an author read the answers. The contract already names the operations (`listResults`,
`getResultsView`, `saveResultsView`, `resetResultsView`) and the plan names the page
(`/surveys/{id}/results`, the Summary and the Table, saved layouts, reset). It does not say what a page of
results holds, how a very large survey is read, whose layout a layout is, what happens to the layouts the old
site saved, who may save, how big a layout may be, or how the page loads its heavy libraries. The current
surveyjs.io page answers most of these in ways that do not fit this application: the server returns at most the
first 1,000 rows in storage order, merges the rows of one client, charts the first 15 questions, shows a static
banner about the 1,000 limit, saves one layout for the whole survey on every single event, and writes it with a
survey timestamp bump and an audit row. Each ruling below says what legacy does, what this application does,
and why. The research behind the legacy column is in the Step 9 notes; the stores are shared with the legacy
site, which keeps running during the transition ([ADR 0010](0010-writing-to-the-legacy-stores.md)).

Parity with the old site comes first (the project rule). Where a ruling departs from legacy, the "Legacy" column
says so and the reason is below the table.

## Decision

The rulings are numbered R1 to R25 (R21 to R24 are about tests and process, and are not repeated here) and
grouped by topic. "Keeps" means the legacy behaviour is reproduced; "departs" means it is not.

### Reading results (R1, R2, C8)

| #   | Question                 | Ruling                                                                                                                                                                                                                                                                    | Legacy                                                                                                               |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| R1  | Rows of one client       | `listResults` returns every stored row as one response, in submission order. `getResultStats.count` stays the number of rows. `partial` is not returned                                                                                                                   | Departs: the JSON readers merge the rows that share a `clientid` into the first one, later rows overwriting its keys |
| R2  | Page size and the cursor | `limit` 1 to 1000, default 500 (the contract's numbers). A bad cursor, one of another survey or list, or a bad `limit` is `400 bad-request`. The cursor is `{"v":1,"k":"results","s":<survey>,"u":<submittedAt>,"i":<id>}`, canonical base64url JSON, bound to one survey | Departs: one request with no paging, no cursor, and a hard cap of 1,000 rows                                         |
| C8  | `clientId` in the answer | `SurveyResponse.clientId` is a plain string returned **as stored**. The input schema `ClientId` and its pattern stay for `submitResponse` and `getPublishedSurvey`                                                                                                        | Keeps: legacy rows may hold any client id; the API must not return a value its own schema forbids                    |

Why: the new application never writes partial rows, and one client may legitimately send several responses
(a survey that is answered twice from one browser), so merging would hide data. A legacy survey with partial
rows now shows them as extra rows; adding a merge later is local to the read path. The old cap was taken
before the merge and the date filter, so it was neither the first 1,000 responses nor the first 1,000
respondents, and the page said so with a banner that always showed. A cursor that works for one survey only
cannot be used to read another survey's rows by accident.

### Paging on the old site's stores (R3)

| #   | Question     | Ruling                                                                                                                                                                                                                                                                                            | Legacy                                                             |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R3  | Azure paging | Each page lists the survey's table with a filter `happendat ge <cursor time>` (no filter for the first page), sorts the rows in memory by `(submittedAt, id)`, drops those not after the position and takes the first `limit`. The same pattern as `listHistory`. The per-page cost is documented | Departs: legacy returns the rows in storage order, which is random |

Why: the row keys of a result table are random GUIDs, so Azure cannot return submission order, and its
continuation tokens cannot be turned into a position in that order. The cost is that a page reads every row from
the cursor's time on: a walk over a very large survey reads a rising number of rows per page, and the first
page reads them all. The numbers on real volumes are unknown ([layout, gap 8](../architecture/legacy-data-layout.md#11-gaps-and-open-questions)).
An index behind `ResultStore` can replace the scan later without a contract change. The memory provider keeps
its rows sorted and has no such cost.

### Views and the legacy fallback (R4, R5)

| #   | Question                          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Legacy                                                                                          |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R4  | Whose layout, and the old layouts | A layout belongs to a **user and a survey** (`ViewStore` keys: survey, user, view). A user with no layout of their own and no reset gets the survey's legacy blob (`surveyresultsummarystate/{id}` or `surveyresulttablestate/{id}`) **as stored**: no conversion from `surveyresultcolumns`, no `isPublic` overlay. A reset deletes the user's layout and leaves a per-user marker, so `getResultsView` answers `404 view-not-found` even where a legacy blob exists, until the next save. The memory provider behaves the same | Departs: one layout for the survey, shared by every user who can open it, written by every save |
| R5  | Who may read, save and reset      | Anyone who can see the survey (`canSee`, [ADR 0009](0009-survey-permissions-follow-legacy.md)): their own layout. An unknown or invisible survey is `404 not-found`; a visible survey with no layout is `404 view-not-found` (title "View not found"). `403` is only `csrf-token-invalid`                                                                                                                                                                                                                                        | Keeps: any member of the project may save; there is no read-only mode on the page               |

Why: Phase 1 is parity, so users keep the layouts they made on the old site at cut-over (layout 9.1 already
decided to seed from the survey's blob), and a layout of one user does not rearrange the page of another (the
contract and the spec say "per user"). A save changes nothing that others see, so it needs no `canModify`. The
marker is needed because a reset has to survive the fallback: without it, a user could never get back to the
default on a survey that has an old layout. The legacy blobs are never written or deleted by views, so the old
site keeps working. The cost is extra code (the fallback and the marker); dropping them later is local to the
`ViewStore`.

### Size and side effects (R6, R7)

| #   | Question         | Ruling                                                                                                                                                                                      | Legacy                                                                                                                   |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R6  | Size of a layout | No limit of its own: the global body limit (`LIMIT_MAX_RESPONSE_BYTES`, `413 payload-too-large`) applies. The body must be a JSON object (`422` otherwise). **No new environment variable** | Keeps: no size check at all (legacy has none)                                                                            |
| R7  | A save's effects | A save or reset does **not** bump `Surveys.timestamp`, writes no audit row and no history entry. Layouts are deleted with the survey and are not copied by a clone                          | Departs: the legacy save goes through the survey event, writes the layout into the audit row and bumps the survey's date |

Why: a survey that moves to the top of the list on every chart drag would surprise users, and an audit row that
holds a layout is noise. A fourth place to keep one setting in step (`config.ts`, the conformance setup and
`e2e/app-variables.mjs`) is not worth a limit that the global one already gives; the worst case is a 1 MB
layout for each user and survey.

### The results page (R11 to R14, R18 to R20, R25)

| #   | Question          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Legacy                                                                                                                                         |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R11 | The libraries     | The `Dashboard` (3.x API) of `survey-analytics` for the Summary, `Tabulator` from `survey-analytics/survey.analytics.tabulator` for the Table. One survey-core `Model` for each widget. A widget is built in `useEffect` on a ref and destroyed in the cleanup (Strict Mode safe; the table is destroyed only after it rendered). Every page is loaded before a widget is built, because the table has no `updateData`. The licence key is applied before the widget is built | Keeps the same libraries (an unpinned dev build in legacy, a pinned release here)                                                              |
| R12 | Which questions   | **Every question is charted**, with the library's question chooser. No 1,000 banner. `allowMakeQuestionsPrivate` is off (Step 10 decides)                                                                                                                                                                                                                                                                                                                                     | Departs: `getAllQuestions().slice(0, 15)`, and the banner always shows                                                                         |
| R13 | Table columns     | The answers, plus the table-only columns **Submitted** (`submittedAt`, data name `HappendAt`) and **IPAddress** (`respondentIp`, data name `IPAddress`, present only when a response has an address). They are added through the table's column API, not as hidden questions, so they stay out of the Summary. A question with one of those names keeps its answer and the extra column is skipped. `clientId` and the response id are not shown                              | Keeps the columns and titles (legacy adds hidden questions, which can also show up as charts of a small survey); departs in how they are added |
| R14 | Table defaults    | The library's defaults: page size 5, the selector 1, 5, 10, 25, 50 and 100, file name `results`. CSV always; Excel and PDF are enabled by passing the libraries. A saved table state is reconciled as legacy does: elements whose question is gone are dropped, new questions are appended, `displayname` becomes `displayName`. The Summary's saved state is reconciled the same way, new questions included, before `render`                                                | Keeps                                                                                                                                          |
| R18 | Route and tabs    | `/surveys/$surveyId/results?tab=summary\|table\|details`. A missing or invalid `tab` is `summary`; links omit the default. Labels and order as legacy: Summary, Table, Details. The legacy `#info` hash mapping is Step 12                                                                                                                                                                                                                                                    | Departs: legacy keeps the tab in the URL hash (`#summary`, `#table`, `#info`)                                                                  |
| R19 | Details in Step 9 | `tab=details` shows only the two legacy buttons, **Reset Table State** and **Reset Summary State**, with their texts, markup and a confirm dialog. Step 10 adds the rest                                                                                                                                                                                                                                                                                                      | Keeps (the texts and markup are copied on purpose, D14); departs in not reloading the page after a reset                                       |
| R20 | The loader        | One query whose `queryFn` walks the cursors at `limit=1000`; key `["results", <survey id in lower case>]`; read once for each visit to the page, never refetched under the user. A loading state; a failure shows our own message with a **Try again** button                                                                                                                                                                                                                 | Departs: legacy has one request and no error handler, so a failure leaves the loading overlay up for ever                                      |
| R25 | No word cloud     | Text questions do not get the WordCloud visualizer. `VisualizationManager.unregisterVisualizer(undefined, WordCloud)` runs once as the Summary module loads: it applies to every registered type, so text, comment and multiple-text questions get the library's `Text` visualizer, a list of the answers                                                                                                                                                                     | Keeps: legacy unregisters the WordCloud for all types                                                                                          |

Why: all questions are charted because the 15 limit is an undocumented cap like the 1,000 one, and the idea
promises "a chart per question" (idea 2.4); the question chooser lets an author hide what they do not want. The
extra columns are not hidden questions because a hidden question is a chart of the Summary of a survey with
fewer than 15 questions. The library defaults for the Table keep the old look and need no new decisions. The
page reads everything once because the widgets cannot take rows later, and because a refetch under a user who
is hiding charts would be worse than a stale count (a reload shows new responses). The licence key is applied
before the widget is built because the library checks the licence when it constructs.

**A question added after a layout was saved is shown at its end.** The Dashboard's state setter keeps only the
elements it is given, so a saved Summary state set as stored would neither draw nor offer a later question.
Both tabs therefore reconcile the saved state against the widget's default state before `render`
(`reconcileElementsState`): saved elements whose question still exists keep their order and settings, new
questions follow in default order, removed ones are dropped. Legacy per-survey layouts get the same treatment.

### Dependencies (R15)

All are exact versions in `web/package.json` `dependencies`, with the lockfile, and `pnpm check:deps` passes.

| Package            | Version                                                              | Why                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `survey-analytics` | `3.1.2`                                                              | The Dashboard and the Table (US 46 to 49). Must equal `survey-core` (3.1.2); `check:deps` enforces that `survey-*` packages move together                                             |
| `tabulator-tables` | `6.6.1`                                                              | The table's engine. A direct dependency for its CSS, at the version `survey-analytics` resolves (one copy in the lockfile)                                                            |
| `jspdf`            | `4.2.1`                                                              | The PDF export of the table (US 48)                                                                                                                                                   |
| `jspdf-autotable`  | `5.0.8`                                                              | The table layout in the PDF. Not `5.0.9`: it was three days old when chosen (the 14-day rule of Renovate)                                                                             |
| `xlsx`             | `0.20.3`, from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | The Excel export (US 48). **A deliberate exception**: the npm package stops at `0.18.5`, which has two High advisories, and SheetJS publishes newer versions only through its own CDN |

Cost: the tarball is not an npm registry release, so a tool that updates registry versions does not see it, and
its integrity is the one in the lockfile; an update is made by hand. If jsPDF 4 or AutoTable 5 had not worked with Tabulator 6.6.1's PDF
downloader, the plan was to report it, not to swap versions; they work (a valid PDF was made). `@types/tabulator-tables`
was not added: `survey-analytics` already brings it as a peer type.

### Chunks and loading (R16)

Three chunk groups, each with priority 3 and no recursive dependencies (`web/vite.config.ts`):
**`survey-dashboard`** (the Dashboard, Chart.js and the CSS), **`survey-dashboard-table`** (Tabulator, the table
entry and the CSS) and **`survey-dashboard-export`** (jsPDF, AutoTable, SheetJS and what they pull in, with
`@babel/runtime`). The Summary sits behind a `lazy()` inside the page, so hovering **View Results** does not
preload it; the table code loads when the Table tab opens; the export libraries load on the first PDF or Excel
export. `exportLibraries.ts` registers `window.jspdf` and `window.XLSX` before Tabulator looks them up (it finds
them in the globals when the download starts). The run page still loads no Creator or Dashboard code, and the
build checks it, and the results route too (static closure free of Dashboard code, one chunk of each group in the
full closure, no static import of the export chunk from the table chunk).

Legacy loads the same libraries from a CDN as an unpinned dev build, all on the first page load. Gzipped sizes of
the groups are about 174 kB, 366 kB and 300 kB. `@babel/runtime` is in the export group because jsPDF imports
its helpers statically; without it, a small facade chunk and the export chunk imported each other. The deferred
download after the `await` was not blocked in Chromium, Firefox or WebKit, so there is no static fallback.

### Saving layouts (R17)

| #   | Question     | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Legacy                                                                                                                                                 |
| --- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R17 | When and how | A change is sent **500 ms** after the last one, with one request in flight and a latest-wins pending slot. A waiting change is sent at once on a tab switch, on unmount and on `pagehide` (with `keepalive` for a body under 60,000 **bytes**, counted in UTF-8). The saved state is applied **before** the listeners attach (the table: before `render`, under `lockStateChanged()`), so loading never echoes a save. A failed save shows a quiet, non-blocking line; the next change tries again. Reset: confirm, `DELETE`, then the widget shows its default layout, with no page reload | Departs: a save on every event, no debounce, failures ignored, a summary listener that may save the loaded state back, and a page reload after a reset |

Why: a drag fires many events, and a request for each is noise and can arrive out of order. The `pagehide` flush
is what keeps the last change when a tab closes; it does not wait for a save in flight, which would usually end
after the page is gone (the newest state is sent beside it and, if the page lives on, once more after it), and
`keepalive` is what keeps that request alive (browsers cap such a body at 64 KB, so the page counts bytes, not
characters). The quiet line follows the editor's rule that a failure never blocks work.

### The large fixture survey (R9, R10)

"API created" (`22222222-0000-4000-8000-a00000000008`, Olivia Owner's Personal survey, never published) holds
**1,500 generated responses** in both modes, and gets a definition with five chartable questions (`color`,
`score`, `subscribe`, `channels`, `comment`). A deterministic generator (`large-survey.ts`: fixed ids, times and
answers, no 1 MB JSON file) is shared by the memory seed and the Azurite loader, and the loader writes the rows
in batches. The survey was chosen because it needs the fewest changed expectations: `…a06` already has a
definition that an editor test counts, `…a03` is archived and `…a07` is the stranger's. The tests read it and
never write to it. A project member's read of results (R10) uses Mia on "Campaign survey", and a stranger gets
`404` on `listResults` and on all three view operations.

### Contract changes (R8)

The contract gains: `400` on `listResults` and the three view operations; `415` and `422` on `saveResultsView`;
the `413` sentence (`limits.maxResponseBytes`); the `not-found` / `view-not-found` split; "a cursor belongs to
one survey"; "every stored response, no merging"; who may save; "views are deleted with the survey and not
cloned"; the legacy fallback and the reset rule; and C8 (above). The two "unimplemented operation" tests moved
from `listResults` to `exportResults`.

## Consequences

- A survey's results are read in full on every visit to the page: a survey with 100,000 responses means 100
  requests of 1,000 and a Dashboard over 100,000 rows. The size where this hurts has not been measured. A
  Summary computed on the server would need a contract change.
- On the old site's stores each page of a very large survey scans the rows from the cursor's time on (R3).
- A legacy survey with partial rows (the same client twice) shows extra rows (R1), and the Summary counts them.
- A user who has never saved sees the survey's old layout, and a user who resets does not (R4). The old site
  keeps showing its own layout, and a layout saved here never reaches it.
- A layout saved on the old site after the cut-over is seen only by users who have no layout of their own.
- A save never moves the survey in the list and leaves no trace in the history (R7).
- The page needs the libraries' licence: without `SURVEYJS_LICENSE_KEY` the Summary and the Table show the
  library's own banner and stay usable.
- `xlsx` comes from a tarball (R15) that no tool updates for us.
- Public results (`getPublicResults`, "Grant Access") need their own rule for which columns are public: the
  legacy `isPublic` marks lived in the per-survey layout, which Step 9 only reads (Step 10).

## To confirm

These rulings are decisions of the team, not of the product owner. Until the owner confirms them, they stand as
written.

- **R4: layouts are per user and survey.** User story 49 reads "per survey"; plan.md, the spec's module list
  and the contract say "per user", and so does this step. The old layout is the fallback until a user saves or
  resets.
- **R12: every question is charted.** The old page charts the first 15. The owner may want the old limit, or a
  higher one.
- **The source of `xlsx`.** The SheetJS CDN tarball (R15) instead of the npm package.
- **F2: a per-survey client id.** `listResults` returns `clientId` (C8), so the run page now sends an id derived
  from its browser id and the survey id ([ADR 0014](0014-run-page-and-response-collection.md), "Step 9 change")
  instead of one id for the whole browser. The owner may prefer to omit `clientId` from `listResults`, which
  would let the run page send one id again.

## Open

- **The locale picker.** The old page shows "Choose locale..." when the survey has more than one locale and
  sets the locale of the table and the Dashboard. It is not built. A later step.
- **The table's row actions.** "Show in Survey" (the response in a read-only survey) and "Delete Result" are
  not built. There is no operation to delete one response in the contract.
- **The per-survey client id.** The Step 8 open point (should a survey author see the client ids of the
  respondents?) is answered for now by F2 (see "To confirm"): `listResults` returns `clientId` as stored (C8),
  and the run page sends a different id for each survey, so an author reads an id that means nothing outside
  that survey. The Table does not show `clientId`.
- **Public results and layouts** (Step 10): see above.
- **The scan of large tables on Azure** (R3, layout gap 8): measure on real volumes.
