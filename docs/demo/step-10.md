# Demo: Step 10, results: Details, downloads and public results

This page lets you check Step 10 without reading code. It takes about forty minutes (the Azurite part pulls
Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX shell); in
PowerShell the same commands work, except where a variable is set or a file is made.

What Step 10 delivers: the **Details** tab of the results page. It shows the number of responses and the dates
of the first and the last one, and it has two download buttons, **JSON** and **CSV**, that give every response
(also past 1,000). **Grant Access** opens the results to anyone with a link, in a page of its own at
`/results/<survey id>`; **Disable Access** closes it at once. **Make private** on the Summary hides a question from
that page. **Save Respondent IP in Results** stores the address of new respondents, and **Delete Results** removes
every response, the completion records and the uploaded files. Behind it are three API operations:
`exportResults`, `deleteResults` and `getPublicResults`, and a new survey setting, `privateResultQuestions`.
The description for users is [Downloading, sharing and deleting
results](../user-guide/downloading-sharing-and-deleting-results.md). The API side is [Exporting
results](../api/exporting-results.md) and [Public results](../api/public-endpoints.md#public-results), and the
reasons are in [ADR 0016](../adr/0016-results-details-exports-and-public-results.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 7 you also need Docker with Compose, and the
ports 10000, 10002, 14333 and 18080 on 127.0.0.1. For the checks on the command line you need `curl`, `jq` and
`wc` (Git Bash has them).

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of Azurite
mode you type the short name). This demo uses these:

| Name         | Type in the mock OIDC form | Why                                                                                              |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------------------ |
| Olivia Owner | `owner`                    | Owns "API created" (1,500 responses, for parts 1 and 2) and "Customer feedback" (public, part 3) |
| Adam Admin   | `admin`                    | Has no surveys of his own: for parts 3 to 5, on a survey you create, change and throw away       |

**Look at the fixture surveys, never change them.** The test suites read "API created" and "Customer feedback", so
do not delete their results, switch their settings or make their questions private. Everything that writes
(parts 3 to 5) is done on the survey you create as Adam. In memory mode a restart resets all data. On the replica
the changes stay until `pnpm legacy:load`.

**The results page shows a licence banner.** Without a SurveyJS licence key the charts and the table show the
library's own banner. That is expected ([Development](../development.md#the-results-page-in-both-modes)).

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Olivia Owner** on the "Sign in as…" page.

## 1. The Details tab shows the totals and the dates (checklist 1)

The first row of Olivia's list is **API created**. Open its "…" menu, click **View Results**, then open the
**Details** tab (the address is `/surveys/22222222-0000-4000-8000-a00000000008/results?tab=details`).

Expected, on the left of the tab:

- **Total responses:** `1500`. (The old page would have shown 1000.)
- **First response at:** `2026-05-01T08:00:00.000Z` in the format of your browser, for example `5/1/2026, 8:00:00 AM`
  in a US browser set to UTC, or the same moment in your own time zone.
- **Last response at:** `2026-05-01T20:30:00.000Z` in the same way (for example `5/1/2026, 8:30:00 PM`).
- The text "Download all results as:" with the buttons **JSON** and **CSV**.

On the right Olivia sees **Grant Access**, **Save Respondent IP in Results**, **Delete Results** (do not use it
here) and the two **Reset** buttons: she owns this survey. **Do not click Delete Results on this survey.**

## 2. Download JSON and CSV (checklist 2)

Click **JSON**. The browser saves **`API created.json`**. Click **CSV**: **`API created.csv`**. Check them in your
downloads folder:

```sh
jq length "API created.json"
```

Expected: `1500`. The file is one list with an entry for each response, oldest first.

```sh
wc -l "API created.csv"
head -n 2 "API created.csv"
```

Expected: `1501` lines (the header and 1,500 responses; every record ends with a line break, so `wc -l` shows 1501,
unlike the browser's own **Export As... CSV** of the Table). The header is
`Submitted,color,score,subscribe,channels,comment,ClientId`: the question **names**, not their titles. The first
line starts with a byte order mark that you cannot see (Excel needs it to read the file as UTF-8), and the second
line starts with `2026-05-01T08:00:00.000Z`.

Open the CSV in a spreadsheet program. Expected: seven columns, 1,500 rows of data, and the column
`channels` with text such as `["Search","Ad"]` (a checkbox with several answers is JSON text in one cell).

## 3. Grant Access, the public page and Disable Access (checklist 3)

Sign out (account menu) and sign in as **Adam Admin**. Click **Create a Survey**. In the editor, click
**Single-Line Input** in the toolbox (it adds `question1`) and click **Yes/No (Boolean)** (any other question type
works too). Wait for **All changes saved**. Go back to the list (**My Surveys** in the header), open the "…" menu
of your survey (the first row, **New Survey 1** on a fresh demo) and click **Publish**. Then open the "…" menu and
click **Run**.

In the run tab type an answer into `question1` and click **Complete**. Reload the tab and complete it again with
another answer, so the survey has **two responses**. Note the survey id from the address (`/s/<survey id>`).

Open the "…" menu again, **View Results**, and the **Details** tab. Expected: **Total responses:** `2`, with the two
dates.

1. Click **Grant Access**. Expected: the text becomes "Your Survey results can be accessible via direct Url.", the
   link **Go to the results page** appears, and the button says **Disable Access**.
2. Copy the address of the link, or click it: it is `http://localhost:5173/results/<survey id>`.
3. Open that address in a **private (incognito) window**, where you are not signed in. Expected: the page has no
   site header or menu; the heading is the survey name; two tabs, **Summary** and **Table**; the Summary shows a
   chart for each of the two questions; the Table shows two rows with the columns `question1`,
   `question2` and **Submitted**, with no **Export As...** menu. There is no Details tab and nothing to change.
4. Back in the signed-in window click **Disable Access**. The private window still shows the page. **Reload it**.
   Expected: **"These survey results are not available."** and nothing else.

The page does not depend on **Publish**. To see it, click **Grant Access** again, go to the list, open the "…" menu
of your survey and click **Unpublish**, and reload the private window: the results still show. (Click **Publish**
again for part 4, and **Disable Access** if you want the page closed.)

### A private question (optional, 5 minutes)

With Grant Access on (click **Grant Access** again if you disabled it), open the **Summary** tab of your survey. Each chart has **Make private**. Click it on
the chart of `question2`: the button becomes **Make public**. Reload the **private window**: the Summary has the
chart of `question1` only, and the Table has no `question2` column. In your own Summary and Table both
questions are still there, and so they are in your downloads. Click **Make public** to undo it.

**A fixture to look at.** "Customer feedback" (Olivia's) has Grant Access on and the question `receipt` private.
Open <http://localhost:5173/results/22222222-0000-4000-8000-a00000000001> in a private window: the Summary shows
the chart of `satisfaction` and no chart of `receipt`, and the Table has no `receipt` column.

## 4. Save Respondent IP (checklist 4)

In your survey's **Details** tab (as Adam), click **Save Respondent IP in Results**. Expected: the text becomes
"The IP addresses of your respondents are stored along with other answers. Toggle not to store." and the button
**Do not save Respondent IP in Results**.

Open the run link again (`http://localhost:5173/s/<survey id>`), type an answer and click **Complete**. Then open
**View Results**, the **Table** tab. Expected: the last column is **IPAddress**, and the new response has a value.
In a local demo the browser and the server run on the same machine, so the address is the **loopback**:
`127.0.0.1` or `::1`. The two earlier responses have an empty cell: they were sent while the setting was off,
and an address is stored on **new responses only**. The Details tab's CSV now has an `IPAddress` column (right
after `Submitted`) and the JSON has `respondentIp` on that response.

Click **Do not save Respondent IP in Results**: the address that is stored stays in the Table and in the JSON.

## 5. Delete Results (checklist 5)

On the **Details** tab of your survey, click **Delete Results**. A box opens with "Deletes all survey results
without the possibility to restore." The button **Clear All Data** is **disabled**. Type the survey name in the
box exactly (for example `New Survey 1`; a different case keeps it disabled), then click **Clear All Data**. Your
browser asks "Are you absolutely sure that you want to delete all results ?". Click **OK**.

Expected: "All results are deleted." and **Total responses:** `0`; the two dates and **Delete Results** are
gone. Open the **Summary** and the **Table** tab: both are empty, without a reload. The survey itself, its
settings and its layouts are still there.

Open the run link and complete the survey once more: it works, and after a reload of the results page **Total
responses:** is `1` again. (After a
delete, a respondent can answer again; with "Limit to one response" on, the completion records were deleted too.)

## 6. The API view

You need the value of your session cookie: in the browser's developer tools (F12), open **Application** (Chrome,
Edge) or **Storage** (Firefox), **Cookies**, `http://localhost:5173`, and copy the **Value** of `msid`. Signed in as
Olivia:

```sh
API=http://localhost:5173/api/v1
ID=22222222-0000-4000-8000-a00000000008
COOKIE="msid=<cookie value>"
curl -s -D - -o results.csv -b "$COOKIE" -H "Accept: text/csv" "$API/surveys/$ID/results/export"
```

Expected: the headers show `HTTP/1.1 200 OK`, `content-type: text/csv; charset=utf-8`,
`content-disposition: attachment; filename="API created.csv"; filename*=UTF-8''API%20created.csv`,
`cache-control: no-store`, and `results.csv` has 1,501 lines (`wc -l results.csv`). The same without `Accept` gives
JSON, and `?format=json` or `?format=csv` choose the format whatever `Accept` says:

```sh
curl -s -b "$COOKIE" "$API/surveys/$ID/results/export" | jq length
curl -s -b "$COOKIE" -H "Accept: text/csv" "$API/surveys/$ID/results/export?format=json" | jq length
```

Expected: `1500` twice. Now a format the export does not offer:

```sh
curl -i -b "$COOKIE" -H "Accept: application/xml" "$API/surveys/$ID/results/export"
curl -i -b "$COOKIE" "$API/surveys/$ID/results/export?format=xlsx"
```

Expected: the first answers **`406 Not Acceptable`** with `"code":"not-acceptable"` and the detail "Ask for
application/json or text/csv, or use format=json or format=csv."; the second answers `400 Bad Request`.

The public page's data needs no cookie:

```sh
curl -s "$API/public/surveys/22222222-0000-4000-8000-a00000000001/results" | jq '{privateQuestions: .survey.privateQuestions, items: (.items | length), first: .items[0]}'
curl -i "$API/public/surveys/22222222-0000-4000-8000-a00000000008/results"
```

Expected: the first shows `"privateQuestions": ["receipt"]`, five items, and an item that has only
`submittedAt` and `data` (with `satisfaction`, and no `receipt`, no `id`, no address). The second answers
**`404`** with `"code":"survey-not-available"`: "API created" has Grant Access off.

Finally the delete, on **your own survey** only (the CSRF value is the cookie `msid_csrf`, copied from the same
list of cookies; sign in as Adam in the browser and use his cookies):

```sh
CSRF=<value of msid_csrf>
curl -i -X DELETE -b "msid=<Adam's cookie value>; msid_csrf=$CSRF" -H "X-CSRF-Token: $CSRF" "$API/surveys/<your survey id>/results"
```

Expected: `204 No Content`, and the Details tab shows 0 after a reload. Without the `X-CSRF-Token` header the
answer is `403` with `"code":"csrf-token-invalid"`. Olivia's cookie on Adam's survey is `404` (she cannot see it),
and a user who can see a survey but not modify it gets `403` with `"code":"forbidden"`.

## 7. The same on the legacy replica (the Azurite checks)

Stop the memory demo (Ctrl+C), then:

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider. Open <http://localhost:5173/>, sign in as **owner** and then **admin** (type the short
name in the form) and repeat parts 1 to 6. Everything works as in memory mode. What you can see on the replica:

- **Part 1 and 2:** the 1,500 responses come from the survey's own results table, one page of 1,000 at a time;
  each page scans the rows from its cursor's time on ([Paging](../api/paging.md#results-oldest-first-one-survey)).
  1,500 rows are quick.
- **Part 3, a private question.** The list is stored in the old format, in the old container
  `surveyresultpermissions`. Read it (a script with the project's own packages; it only reads, from the
  repository root):

```sh
pnpm --filter @my-surveys/server exec node --env-file=../docker/azurite.env -e '
const { BlobServiceClient } = require("@azure/storage-blob");
const c = BlobServiceClient.fromConnectionString(process.env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING).getContainerClient("surveyresultpermissions");
(async () => { for await (const b of c.listBlobsFlat()) console.log(b.name, (await c.getBlobClient(b.name).downloadToBuffer()).toString("utf8")); })();
'
```

Expected: a line for "Customer feedback" (`22222222-0000-4000-8000-a00000000001`) with
`[{"name":"satisfaction","isPublic":true},{"name":"receipt","isPublic":false}]` and, after you made `question2`
private as Adam, a line for his survey with `[{"name":"question2","isPublic":false}]`: only the private entries are
written. After **Make public** the line is `[]`.

- **Part 5, Delete Results.** The rows are deleted in batches and the tables stay, so completing the survey right
  after works at once (the old code dropped the tables, and a response sent in the next 40 seconds failed).
  A `SURVEY_DELETEALLRESULTS` row is added to the survey's event log (the `surveys` table of the replica).

The replica keeps what you do. To go back to the fixtures, run `pnpm legacy:load`, or `pnpm demo:azurite:down` and
`pnpm demo:azurite:up`. Stop the demo with Ctrl+C.

## 8. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. With the replica running (`pnpm demo:azurite:up`):

```sh
pnpm test:providers:azurite
pnpm test:conformance:azurite
pnpm e2e:azurite
```

Expected: all pass. Then:

```sh
pnpm demo:azurite:down
```

## Checklist

| #   | Check                                                                                                                                                                                                | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Details of "API created": **Total responses:** 1500, the first and last response at `2026-05-01T08:00:00.000Z` and `2026-05-01T20:30:00.000Z` (in your browser's format)                             |        |
| 2   | **JSON** gives `API created.json` with 1,500 items (`jq length`), **CSV** gives `API created.csv` with 1,501 lines and the header `Submitted,color,score,subscribe,channels,comment,ClientId`        |        |
| 3   | **Grant Access** shows the link; the public page in a private window shows the Summary and the Table with no sign-in; **Disable Access** and a reload show "These survey results are not available." |        |
| 4   | **Save Respondent IP in Results**, then a submission on `/s/<id>`: the Table has an **IPAddress** column with the loopback address for the new response only                                         |        |
| 5   | **Delete Results** (survey name, then OK): **Total responses:** 0 and the Summary and Table are empty                                                                                                |        |
| 6   | `Accept: text/csv` gives the CSV; `Accept: application/xml` gives `406`; `?format=xlsx` gives `400`                                                                                                  |        |
| 7   | A private question is missing from the public Summary and Table ("Customer feedback": `receipt`), and in the replica the old blob holds only private entries                                         |        |
| 8   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green                          |        |

## Troubleshooting

- **The public page says "These survey results are not available."** Grant Access is off for that survey, or the id
  is wrong. Both give the same page.
- **The public page keeps showing the results after Disable Access.** The page reads the results once when it
  opens. Reload it.
- **No Details buttons on the right.** Your user cannot modify the survey. Only the totals, the downloads and the
  Reset buttons show then. Sign in as the owner (Olivia for her surveys, Adam for his).
- **Delete Results is missing.** The survey has no responses (the button shows only when there is at least one).
- **Clear All Data stays disabled.** The name must be the survey name exactly, with the same letters and case, and
  no extra space.
- **The CSV looks wrong in a spreadsheet.** Import it as UTF-8 with commas. A text answer that starts with `=`, `+`,
  `-` or `@` has a `'` before it on purpose (the formula guard). Numbers are not changed.
- **`wc -l` shows 1501 and the browser's CSV from the Table showed 1500.** The Details file ends every record with a
  line break; the Table's own export does not end its last line (see the [Step 9 demo](step-09.md#3-the-table-paging-and-csv-checklist-3)).
- **`curl` answers `401`:** the cookie value is wrong or expired (a session lasts 12 hours). Copy `msid` again.
- **`curl -X DELETE` answers `403`:** the `X-CSRF-Token` header must equal the `msid_csrf` cookie, and both must be
  sent.
- **The IPAddress column is empty for a response.** It was sent while the setting was off. An address is stored on
  new responses only.
- **`429` on the public page:** more than 60 public requests a minute from one address (the page uses one request
  for each 1,000 responses). Wait a minute or start the demo with `PUBLIC_RATE_LIMIT=300 pnpm demo`.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 10

- **Show in Survey** and **Delete Result** for one response in the Table, and the Table's "make public" column
  action. Use **Make private** on the Summary. There is no operation to delete one response.
- The old site's links `/Results/Survey/<result id>` and the `#summary`, `#table` and `#info` links (Step 12) and the
  old page's look (Step 13). The public page is `/results/<survey id>`.
- Excel and PDF files made by the server. The Table's **Export As...** makes Excel and PDF in the browser.
- A shareable link with a password or a token (phase 2).
- A response that arrives while a page is open shows after a reload. The private list in an open Summary does not
  follow a change made in another tab.
- Special handling of the old `dxsimage:` and `dxsfile:` texts and of data URLs in answers, and the old site's file
  share files on **Delete Results**.
- Project and member writes: Step 11 ([demo](step-11.md)). Only `passwordLogin` still answers `501`.
