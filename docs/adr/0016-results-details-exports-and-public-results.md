# 16. Results: Details, exports and public results

Date: 2026-10-18

## Status

Accepted. The product owner has not confirmed R1 (a per-survey list of private questions), R3 (CSV headers are
question names, and the formula guard), R9 (public results are served whatever the published and archived
flags say), R14 (deleting results asks for the survey name, then a browser confirm), leaving the legacy
`postdelete` table to Delete Results, and the choice to leave the list out of `listSurveys` items (see "To
confirm").

## Context

Step 10 finishes the results page. The contract already names the operations (`getResultStats`,
`exportResults`, `deleteResults`, `getPublicResults`, and `updateSurvey` with `settings`) and the plan names the
parts: the Details tab, the JSON and CSV downloads, the settings **Grant Access** and **Save Respondent IP**,
**Delete Results**, and a public results page. It does not say how the legacy "public" marks work now that Step 9
made layouts per user, what a CSV holds, what a streamed file does when the store fails half way, what a
delete removes, or which texts the Details tab uses. The current surveyjs.io page answers most of these in
ways that do not fit this application: the counts come from the first 1,000 rows, the CSV does not quote
fields, the JSON and the CSV disagree on order, the export link carries the user's access key in its address,
the public data call leaks the IP address and client id of a survey that has no old column list, the delete
confirmation compares with a text that no user can type, and deleting results drops whole Azure tables. Each
ruling below says what legacy does, what this application does, and why. The research behind the legacy column
is in the Step 10 notes; the stores are shared with the legacy site, which keeps running during the transition
([ADR 0010](0010-writing-to-the-legacy-stores.md)).

Parity with the old site comes first (the project rule). Where a ruling departs from legacy, the "Legacy" column
says so and the reason is below the table.

## Decision

The rulings are numbered R1 to R25 (R21 to R25 are about tests and process, and are not repeated here) and
grouped by topic. "Keeps" means the legacy behaviour is reproduced; "departs" means it is not.

### Public results and private questions (R1, R9)

| #   | Question                   | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Legacy                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Which questions are public | Each survey has **one list of private questions**, the setting `settings.privateResultQuestions` (names, default `[]`: every question is public), changed with `updateSurvey` like the two other settings (a merge patch replaces the array). The Azure provider **reuses the old blob** `surveyresultpermissions/{surveyId}` (`[{ name, isPublic }]`), read with the old defaults and written for private entries only. `getPublicResults` **strips the private questions' answers, comments and `valueName` keys on the server** and names them in `survey.privateQuestions`. The private Summary offers **Make private / Make public** to callers who may modify the survey. The list is not in `listSurveys` items | Keeps the list per survey, default public, saved from the owner's Summary. Departs: the old code hid the questions in the browser's state, filtered the rows on the server only when an old column list existed (without one every key, the address and the client id included, was returned), and kept the marks in the per-survey layout      |
| R9  | When the public page works | `getPublicResults` answers `404 survey-not-available` (the answer for an unknown survey, so nothing leaks) while `publicResults` is off, and serves the results **whatever `published` and `archived` say**. Items hold `submittedAt` and `data` only, never an id, a client id or an address. The operation is rate limited with the other public ones (`PUBLIC_RATE_LIMIT`), answers `Cache-Control: no-store`, and pages as `listResults` (`limit` 1 to 1000, the same cursor). The page is `/results/{surveyId}`                                                                                                                                                                                                   | Keeps: access closes at once when Grant Access is turned off, and the old code ignored the published and archived flags. Departs: the old URL was `/Results/Survey/{ResultId}` (Step 12 serves it), the old data call answered `400` and returned the first 1,000 rows, and `IPAddress` and `ClientId` leaked when there was no old column list |

Why R1: layouts are per user since Step 9, so the old "isPublic" marks in the survey's layout cannot say what
the public sees; spec › Data protection needs a rule that the server enforces. One list per survey, in the blob
the old site already uses, keeps parity (the old site reads the same file) and costs one setting. Stripping on
the server makes "private" real: a question that is only hidden in the page is still in the network
traffic. Stripping covers the comment of a question and the key of its `valueName`, beyond "answers": an "other"
text of a private question would otherwise leak. The list lives in the `ViewStore` and not in the survey
record, because on Azure it is a blob read, and putting it in the record would cost one blob read for each
survey of every list page. For the same reason it is left out of `listSurveys` items (the contract says so);
`getSurvey`, `updateSurvey`, `createSurvey` and `cloneSurvey` carry it. A save writes only the private entries
(the old readers treat a missing entry as public, so nothing changes for them) and no audit row (Step 9 R7
precedent).

The list **fails closed**. On Azure a save replaces the append blob: it creates an empty blob, then appends the
text, so a read in between (or after a failed append) finds an empty blob. A list blob that exists but is empty
or not a JSON array is read once more, and if it is still unreadable the read fails; only a missing blob means
"no private questions". `getPublicResults` then answers `500` and never serves answers without a readable
list. `getSurvey` and `updateSurvey` answer without `settings.privateResultQuestions` (the contract says the
field is absent when the list cannot be read right now) and log a warning with the survey id only; without the
field the private Summary does not offer **Make private / Make public**, so no list built from an unknown state
is saved. `updateSurvey` saves the list **after** the survey update succeeded, so a failed update leaves the old
list.

Saves are **change based**. The Summary reports only the questions whose mark the user flipped. Before each
`PATCH` the page reads the survey again, applies those names to the fresh list (made private: added; made
public: removed; every other name untouched) and sends the result. A Summary opened earlier, in another tab or
by another editor, therefore never undoes what someone else saved meanwhile. When that read fails or has no
list, nothing is sent and the page shows its privacy error.

Why R9: Grant Access is the owner's explicit choice. Tying it to **Publish** would make a survey that stopped
collecting unreadable, and the old site did not do that either. The answer for "off" and for "unknown" is the
same so that a visitor cannot probe for ids. The page cursor carries the last item's submission time and
response id, as the `listResults` cursor does: it is opaque to clients, response ids are random, and no public
operation takes one. The public rate limit protects the endpoint; a public page loads
one request for each 1,000 responses, so a survey of more than 60,000 responses cannot be read at once from one
address with the default limit.

### Exporting results (R2 to R6)

| #   | Question            | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Legacy                                                                                                                                                                                                                                                |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2  | Choosing the format | The contract's `format` enum stays: `json` or `csv`, anything else (`xlsx`) is `400`. `format` wins over `Accept`. `Accept` is read with q-values: `*/*` and `application/*` give JSON, `text/*` gives CSV, no `Accept` gives JSON, and an `Accept` that names neither gives `406`, decided before the survey is looked up. A range with `q=0` or an unreadable `q` is skipped, there is no specificity ranking                                                                                                                                                                          | Departs: any `format` other than `csv` gave JSON, and the link carried the user's access key. Keeps the two links                                                                                                                                     |
| R3  | The CSV             | UTF-8 with a byte order mark, commas, CRLF after every record, RFC 4180 quoting. The header always exists. Columns: `Submitted` (ISO 8601 UTC), `IPAddress` only while `storeRespondentIp` is on, one column per question **name** in definition order (a `<name>-Comment` column after a question with a comment or "other" area), `ClientId` last and always. Values: text as it is, numbers and booleans as text, arrays and objects as JSON text, empty for null. **Formula guard:** a text that starts with `=`, `+`, `-`, `@`, a tab or a CR gets a leading `'` (header names too) | Keeps the order (Submitted, IP while on, questions, client id). Departs: titles as headers, host-dependent line ends, culture dependent numbers and dates, fields that were not quoted, an empty file for no responses, and no guard against formulas |
| R4  | The JSON            | A bare array of `SurveyResponse` items (the items of `listResults`), with everything the owner may read (`clientId`, `respondentIp` where stored)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Departs: `{ "ResultCount", "Data" }`, merged rows and columns that depended on the old column blob                                                                                                                                                    |
| R5  | Order and streaming | Submission order, read page by page through the existing `listResponsePage` (1,000 rows a page) and written to the response as it goes. The first page is read **before** the headers are sent, so most failures are a clean `500`; a failure on a later page aborts the transfer (most clients report an incomplete or failed download). No new store method                                                                                                                                                                                                                            | Departs: the old code built the file in memory, JSON in storage order and CSV newest first                                                                                                                                                            |
| R6  | The file name       | `Content-Disposition: attachment` with the survey name and `.json` or `.csv` (`results` for a blank name), an ASCII fallback `filename` and an RFC 5987 `filename*`. `Cache-Control: no-store` and `nosniff`                                                                                                                                                                                                                                                                                                                                                                             | Keeps the name `<survey name>.json` and `.csv`. Departs: an unsanitised name                                                                                                                                                                          |

Why R3: a CSV that a spreadsheet opens must be a valid CSV. The byte order mark is what makes Excel read UTF-8,
and the old code wrote it too. **Headers are names, not titles**, because titles can repeat, be empty or be
translated, which would give two columns the same header or none; names are unique. A person who wants titles
can read the definition. The **formula guard** is the standard defence against CSV injection: a respondent can
type `=HYPERLINK(…)`, and the author opens the file in a spreadsheet. The cost is that the guard looks at
characters, not at meaning, so a **text answer such as `-5` or `+1 555 0100` gains a `'`** (a number question
is stored as a number and is not touched, and the JSON file never changes). The guard also applies to header
names. Other details: answers are read under the question's `valueName`; the comment suffix follows the
definition (`commentSuffix`, else `commentPrefix`, else `-Comment`); `ClientId` is always there, because a
streamed file cannot know in advance whether some row has one; a question named `Submitted`, `IPAddress` or
`ClientId` keeps its own column (the header repeats a name); `html` and `image` elements have no column; a
definition without `pages` is read as one page. A stored address is not in the CSV while the setting is off
(it stays in the JSON).

Why R5: reusing the paged reader is the smallest change, and the order matches the Table and `listResults`. On
Azure it inherits the cost of paging (each page scans the rows from its cursor on), which Step 14 measures. A
store failure after the first page cannot change the status: the server aborts the transfer, which most
clients report as an incomplete or failed download, and the guide says how a client checks a file it kept.

### Deleting all results (R7, R8)

| #   | Question                 | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Legacy                                                                                                                                                                                  |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7  | What is deleted, by whom | `deleteResults` is for whoever may modify the survey (the rule of `updateSurvey`). It deletes the response rows, the completion markers (so "already completed" resets) and the **respondent files** (`kind=response`). The survey, its `updatedAt`, the definition, the settings, the saved layouts, the private list and the editor's assets stay. `204`, also when there are no results. On Azure the rows are deleted in transactions of at most 100 and **the tables are kept**; a best-effort `SURVEY_DELETEALLRESULTS` row is written to the event log | Keeps: rows and markers go, layouts, permissions and flags stay, and a `SURVEY_DELETEALLRESULTS` row is written. Departs: the old code dropped both tables, and left the uploaded files |
| R8  | Interfaces               | `ResultStore.deleteAll(survey)` and `FileStore.deleteSurveyFiles(surveyId, kind?)`; the provider suite covers delete all on both providers                                                                                                                                                                                                                                                                                                                                                                                                                    | None                                                                                                                                                                                    |

Why R7: spec › Data protection says deleting results is permanent and includes files, and a file link that stays
alive after "delete all" would be a leak. The respondent files go first, then the rows and markers, so a
failure part-way can be repeated. The window between the two is narrow but real: a file uploaded after the
file delete and before the row delete is not deleted, and once its response row is gone nothing points to it
(an orphaned file). The tables are kept because Azure refuses to create a table that is still
being deleted for about 40 seconds (`TableBeingDeleted`), so a response sent right after the old delete
failed; deleting rows has no such window and costs a longer delete on a huge survey. A respondent's browser may
still hold the completion cookie of the Form Library; the server cannot clear it. The old `postdelete` audit
table is only for deleting one response and is not touched.

### Contract and tests (R10 to R12)

| #   | Question          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Legacy |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| R10 | Contract changes  | C1 `settings.privateResultQuestions`; C2 `PublicResultPage.survey.privateQuestions`; C3 `400` on `getPublicResults`; C4 `Content-Disposition` required on the export and `400` for `exportResults` (R2 makes `xlsx` a validation error); C5 the export and delete descriptions; C6 `PublicResultPage.survey.name` takes the same schema as `Survey.name`, so a legacy survey with an empty name has a conforming page. `Cache-Control: no-store` is asserted in server tests only | None   |
| R11 | The `501` example | The tests that need an operation that answers `501` use `passwordLogin`, the one operation left that answers `501` after Step 11 (`listMembers` was the example in Step 10, `exportResults` in Step 9)                                                                                                                                                                                                                                                                            | None   |
| R12 | The address       | Conformance checks that a response sent while `storeRespondentIp` is on shows `respondentIp` in `listResults` and the JSON export, and never in public results                                                                                                                                                                                                                                                                                                                    | None   |

### The web (R13 to R20)

| #   | Question            | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                | Legacy                                                                                                                                                |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| R13 | Texts and totals    | Every Details text, class and markup is copied from surveyjs.io (D14) and listed in `web/src/shell/surveyjs-site/assets/README.md`. The total is the true count from `getResultStats`. The two dates use the viewer's `toLocaleString()` and are hidden for a count of 0                                                                                                                                                                              | Keeps the texts and the browser format. Departs: the total and the dates came from the first 1,000 rows                                               |
| R14 | Delete confirmation | Two steps, as in legacy: the survey name typed into the box enables **Clear All Data**, then the browser's confirm. The comparison is exact and case-sensitive with the **real** name (a survey with no name enables the button at once)                                                                                                                                                                                                              | Keeps the two steps. Departs: the old comparison was with a template text that no user could type, which also locked the two Reset buttons            |
| R15 | Downloads           | Plain same-origin links (`…/results/export?format=json` and `csv`, with `download`) built by a pure function. The session cookie authenticates them                                                                                                                                                                                                                                                                                                   | Keeps two links. Departs: the old links held the user's access key                                                                                    |
| R16 | Toggles             | **Grant Access** and **Save Respondent IP** are not optimistic: the button waits while the `PATCH` runs, the survey refreshes, a failure shows an error. The toggles, **Delete Results** and **Make private** show only to callers who may modify the survey; the totals, the downloads and the Reset buttons show to everyone. The public link shows while Grant Access is on and is the old "Go to the results page" anchor                         | Keeps the texts. Departs: legacy showed the controls for private pages only and reloaded the page                                                     |
| R17 | After a delete      | The cached responses become empty and the statistics are read again, so the open Summary and Table show nothing without a reload. The IP toggle refetches nothing: it affects future responses                                                                                                                                                                                                                                                        | Departs: the old page reloaded                                                                                                                        |
| R18 | Reset buttons       | Built in Step 9 and unchanged; their end-to-end test is re-run                                                                                                                                                                                                                                                                                                                                                                                        | None                                                                                                                                                  |
| R19 | The public page     | `/results/$surveyId`, outside `_private`, no shell, its own frame, the survey name as the heading. **Summary** and **Table**, read only, with all rows (paged, no cap), the default layout, the private questions left out of both, no **Export As...** menu and no Details tab. A `404` is "These survey results are not available."; a `429` or a network failure is "Try again". The Dashboard loads on demand and the route is in the chunk check | Keeps: the tabs, the default look and the "not available" page without details. Departs: the Details tab, the 15-question limit and the 1,000-row cap |
| R20 | Files in the Table  | The library's file links already work; an end-to-end test proves it (upload on the run page, the Table link answers `200`, and `404` after **Delete Results**)                                                                                                                                                                                                                                                                                        | None                                                                                                                                                  |

Why R14: the old typed-name box was impossible to satisfy (it compared with a Razor expression that is never
rendered in a script file), so no one could delete the results from that page. The two steps stay because a
delete is permanent. Why R16: the controls that change data show only to callers the server would accept, and
the server checks the rule again. Why R19: the public page must not offer a way to change anything or to
download more than the page shows. The library cannot leave a column out of a Table that has its question, so
the public Table is built from a definition without the private questions. The "not available" text is the
application's own: the old page showed an "Unauthorized Access" page that asked the visitor to write to a
support address, which is not copied.

Confirmed by the product owner on 2026-10-20 ([ADR 0020](0020-visual-parity-baselines.md)): the public results page stays
without the surveyjs.io site header and footer. The visual comparison hides them on the live side as a `departure`.

## Consequences

- A private question is **private** only for the public page. The owner's Summary, Table and both downloads still
  hold it.
- The list of private questions has no history and no audit row. Each save reads the list again and changes only
  the names the user flipped, so users who change it from different pages keep each other's changes. Two saves
  at the very same moment can still race (the read and the write are separate requests), and then the later
  write wins.
- While the Azure list blob cannot be read (a save half way, or a damaged blob), the public page answers an
  error and the private Summary offers no toggle, until the next save or a retry finds it readable.
- A response with the setting `storeRespondentIp` on holds an address that the JSON export and the Table show, and
  that stays when the setting is turned off.
- The CSV guard changes text answers that start with `=`, `+`, `-` or `@`, so a program that reads the CSV and
  expects the text as typed must remove the `'`. The JSON is the unchanged source.
- A long export on Azure scans the survey once for each page, as `listResults` does (about N²/2,000 rows read for N
  responses), and a failure after the first page aborts the transfer. A client that needs a complete file checks
  the end of the JSON and the row count against `getResultStats`.
- Public results of a survey over 60,000 responses cannot be read at once from one address with the default
  `PUBLIC_RATE_LIMIT`; the page says "Try again".
- Delete all on a huge survey takes as many transactions as it has rows of 100, and holds the row keys in server
  memory (Step 14 scale).
- The legacy file-share files of the old site are not deleted by **Delete Results**, as before: only the new
  container's respondent files are.
- `passwordLogin` is the example of an operation that answers `501`; Step 11 moved the tests off `listMembers`
  ([ADR 0017](0017-projects-and-members.md)).

## To confirm

These rulings are decisions of the team, not of the product owner. Until the owner confirms them, they stand as
written.

- **R1: a per-survey list of private questions.** It is stored in the old blob, enforced on the server and
  edited from the private Summary by users who may modify the survey. The owner may prefer another rule (for
  example the public page showing the survey owner's saved layout), or that only admins change the list.
- **R3: CSV headers are question names, and the formula guard.** Titles read better but can repeat, be empty or
  be translated. The guard puts a `'` before a text answer that starts with `=`, `+`, `-` or `@`, so `-5` as a text
  answer reads `'-5`. The owner may want titles, or no guard.
- **R9: public results ignore `published` and `archived`.** Grant Access alone decides. The owner may want a
  survey that is unpublished or archived to close its public page.
- **R14: two-step delete confirmation.** The survey name, then the browser's confirm, as the old page intended.
- **The legacy `postdelete{postId}` table.** The old site copies each response it deletes one by one into this
  table. **Delete Results** leaves the table and its copies, so personal data of responses deleted on the old
  site stays there. US 55 asks to "remove personal data"; the owner may want Delete Results to empty that table
  too.
- **The setting `privateResultQuestions` is not in `listSurveys` items.** R1 calls it a setting like the two
  others, which are always present. Reading it for every row of a list would cost one blob read for each survey
  on Azure, so it is left out of lists. The owner may rule that lists carry it.

## Open

- **Per-response "Show in Survey" and "Delete Result".** The old Table has both. There is no operation to delete
  one response, and the public page has no "Show in Survey". Both are for a later step (contract change).
- **`dxsimage:` and `dxsfile:` texts and inline data URLs.** The old site stored files as such texts or as data
  URLs in the answers. This application stores respondent files as URLs (ADR 0005) and the Table shows the file
  links it is given. What the Table should do with the old texts is open.
- **The Table's "make public" column action.** The Summary's toggle is the only place to change the list; the
  library's column action stays hidden.
- **The old public URLs.** `/Results/Survey/{ResultId}` links of the old site do not work (Step 12). The new URL
  uses the survey id.
- **The legacy file-share files on delete.** The old site's `files` and `tempfiles` shares are not touched by
  **Delete Results**.
- **The private-list marks across tabs.** Saves no longer overwrite another tab's changes, but an open Summary
  does not redraw them: its marks show the list at mount plus its own changes until it mounts again.
- **The scan of large tables on Azure** (the cost of export and of public results, layout gap 8): measure on real
  volumes (Step 14).
- **A locale picker and a visual match** with the old results page: Steps 13 and later.
