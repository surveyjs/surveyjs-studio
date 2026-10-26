# Demo: Step 9, results: Summary and Table

This page lets you check Step 9 without reading code. It takes about thirty minutes (the Azurite part pulls
Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX shell); in
PowerShell the same commands work, except where a variable is set or a file is made.

What Step 9 delivers: **View Results** in the survey list opens a page with three tabs. The **Summary** draws a
chart for every question and counts every response (the old page stopped at the first 1,000). The **Table**
shows one row for each response, with a column chooser, paging and **Export As...** to CSV, Excel and PDF, made
in the browser. What you change (hide a chart, move a chart, hide a column) is saved **for you and the survey**,
and the **Details** tab has the two buttons that reset a layout. Behind it are four API operations:
`listResults` (every response, oldest first, page by page) and `getResultsView`, `saveResultsView` and
`resetResultsView`. The description for users is [Viewing results: Summary and
Table](../user-guide/viewing-results.md). The API side is [Paging](../api/paging.md#results-oldest-first-one-survey)
and [Step 9: results and views](../api/README.md#step-9-results-and-views), and the reasons are in
[ADR 0015](../adr/0015-results-summary-table-and-views.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 6 you also need Docker with Compose, and the
ports 10000, 10002, 14333 and 18080 on 127.0.0.1. For the API checks you need `curl` and `jq`.

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of Azurite
mode you type the short name). This demo uses these:

| Name         | Type in the mock OIDC form | Why                                                                                  |
| ------------ | -------------------------- | ------------------------------------------------------------------------------------ |
| Olivia Owner | `owner`                    | Owns "API created", which holds 1,500 generated responses, and is admin of Marketing |
| Mia Member   | `member`                   | A member of Marketing: she can see its surveys, and has layouts of her own           |
| Adam Admin   | `admin`                    | Has no surveys of his own: for trying layouts on a survey you create and throw away  |

**The results page shows a licence banner.** The charts and the table are SurveyJS Dashboard components. Without
a SurveyJS licence key they show the library's own banner about a missing licence, and everything still works.
That is expected ([Development](../development.md#the-results-page-in-both-modes)).

**The demo changes your layouts, not the surveys.** A layout you save belongs to your user and does not change
the survey. In memory mode a restart forgets it; on the replica `pnpm legacy:load` clears it. Part 2 resets the
Summary layout of "API created" anyway.

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Olivia Owner** on the "Sign in as…" page.

## 1. Every response is counted (checklist 1)

The first row of Olivia's list is **API created**. Open its "…" menu and click **View Results**.

Expected: the address is `/surveys/22222222-0000-4000-8000-a00000000008/results`. The heading is **API
created**. After "Loading results…" the **Summary** tab shows five charts, one for each question: `Favourite
colour`, `How likely are you to recommend us?`, `Subscribe to the newsletter?`, `Where did you hear about us?`
and `Any comments?` (the last one as a list of answers: there is no word cloud). There is **no banner** about
the first 1,000 responses.

Check that all 1,500 responses are charted. On the **Favourite colour** chart, open the drop-down that says
"Bar" and choose **Table**. Expected: **Red 500**, **Green 500**, **Blue 500**, 1,500 in all (the generated data
holds each colour 500 times). Choose **Bar** again.

The page asked the API for the responses in two pages (1,000 and 500), because one page holds at most 1,000.
Open the browser's developer tools (F12), **Network**, reload the page and look at the `results?limit=1000`
requests: the first answers 1,000 items and a `nextCursor`, the second 500 items and `"nextCursor": null`.

## 2. Hide, drag, reload, reset (checklist 2)

On the Summary, click **Hide** on one chart (for example the first). Then drag another chart by its header to a
new place. Wait a second: the page saves your layout about half a second after the last change (one `PUT` to
`/api/v1/surveys/<id>/views/summary` in the Network tab, answered `204`).

**Reload the page.** Expected: the hidden chart is still hidden and the other chart is where you put it. The
**Choose question to show...** drop-down still lists the hidden question.

Now open the **Details** tab. Click **Reset Summary State**. Expected: your browser asks "Are you absolutely sure
that you want to remove summary state ?". Click **OK**: the page says "The summary layout is reset.". Go back to
the **Summary** tab: all five charts are there, in the survey's order, without a reload. The `DELETE` of the
layout answered `204`. Reload once more: the default layout stays.

### Layouts are per user

Sign out and sign in as **Mia Member**. Open the project **Marketing** in the survey list (the project selector
above the list), open the "…" menu of **Campaign survey** and click **View Results**: two charts, `How satisfied
are you?` and `Upload your receipt`. Hide one, and reload to see it hidden. Sign out, sign in as **Olivia Owner**
again, open Marketing and View Results of **Campaign survey**: Olivia sees **both** charts. Your layout is not
another user's layout. (Reset your layout in the Details tab afterwards, or leave it: `pnpm legacy:load` clears
it.)

## 3. The Table, paging and CSV (checklist 3)

Back on **API created**, open the **Table** tab (the address gains `?tab=table`). Expected: columns `Favourite
colour`, `How likely are you to recommend us?`, `Subscribe to the newsletter?`, `Where did you hear about us?`,
`Any comments?` and, last, **Submitted** (the time of the response, for example `2026-05-01T08:00:00.000Z`). There
is no IPAddress column, because none of these responses has an address. The table shows **5** rows a page.

- Hide a column: click the **Hide column** button in its header. Reload the page and open the Table again: the
  column is still hidden (the layout of the table was saved, `PUT .../views/table`).
- Page through: click **Next Page**, then **Last Page**. With 1,500 responses and 5 rows a page, the last page
  is **300**. The first **Submitted** value of page 1 is `2026-05-01T08:00:00.000Z`; the
  last of page 300 is `2026-05-01T20:30:00.000Z`.
- Open **Export As...** and choose **CSV**. A file `results.csv` is downloaded, with **every** response, not
  only the page you see, and without the column you hid.

Count its lines (the file is in your downloads folder):

```sh
wc -l results.csv
```

Expected: `1500` or `1501`. The file has one header line and 1,500 response lines, so 1,501 lines. When the last
line has no final newline, `wc -l` counts the newlines and shows **1,500**. To count lines either way:

```sh
grep -c '' results.csv
```

Expected: `1501`. (Excel and PDF work the same way: **Export As...**, **Excel** gives `results.xlsx`, **PDF** gives
`results.pdf`. The first one takes a moment longer, because their code loads on first use.)

Go to **Details** and click **Reset Table State**, then **OK**: "The table layout is reset.". The Table shows its
default columns again, and the hidden column is back.

## 4. The API view

You need the value of your session cookie: in the browser's developer tools (F12), open **Application** (Chrome,
Edge) or **Storage** (Firefox), **Cookies**, `http://localhost:5173`, and copy the **Value** of `msid`. Signed in as
Olivia:

```sh
curl -s "http://localhost:5173/api/v1/surveys/22222222-0000-4000-8000-a00000000008/results?limit=1000" -b "msid=<cookie value>" | jq '.items | length'
```

Expected: `1000`. The next page uses the `nextCursor` of the first one:

```sh
URL="http://localhost:5173/api/v1/surveys/22222222-0000-4000-8000-a00000000008/results"
COOKIE="msid=<cookie value>"
CURSOR=$(curl -s "$URL?limit=1000" -b "$COOKIE" | jq -r '.nextCursor')
curl -s "$URL?limit=1000&cursor=$CURSOR" -b "$COOKIE" | jq '{items: (.items | length), nextCursor}'
```

Expected: `{ "items": 500, "nextCursor": null }`. The first item of the first page is the oldest response
(`2026-05-01T08:00:00.000Z`); the order never changes. A cursor works for one survey only: using it with another
survey answers `400` "Invalid cursor.". The saved layouts are in the API too:

```sh
curl -s "http://localhost:5173/api/v1/surveys/22222222-0000-4000-8000-a00000000008/views/summary" -b "$COOKIE"
```

Expected after your reset in part 2: `404` with `"code":"view-not-found"` (the title is "View not found"). A
layout you saved shows as JSON (`{"elements":[...]}`).

## 5. The licence banner and what a failed save looks like

The banner of the missing licence is on both tabs (see above). To see the quiet message of a failed save, stop
the server (Ctrl+C in the terminal of `pnpm demo`), hide a chart, wait a second: the page says "Your layout could
not be saved. It is saved again with your next change." and the chart stays hidden. Start `pnpm demo` again and
the next change saves. (Your layouts were in memory, so a restart forgot them.)

## 6. The same on the legacy replica (the Azurite checks)

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). It writes the 1,500 responses in **batches**
(about 3 seconds). The second runs the server on the `azure-legacy` provider. Open <http://localhost:5173/>, sign
in as **owner** (type `owner` in the form) and repeat parts 1 to 3. Everything works as in memory mode. Two
differences you can see:

- The responses come from the survey's own results table in the replica, a page of 1,000 at a time; each page
  scans the rows from its cursor's time on ([Paging](../api/paging.md#results-oldest-first-one-survey)). 1,500 rows
  are quick.
- A saved layout is a blob in the container `my-surveys-views` of the replica. List it (a script with the
  project's own packages; it only reads, from the repository root):

```sh
pnpm --filter @surveyjs-studio/server exec node --env-file=../docker/azurite.env -e '
const { BlobServiceClient } = require("@azure/storage-blob");
const c = BlobServiceClient.fromConnectionString(process.env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING).getContainerClient("my-surveys-views");
(async () => { for await (const b of c.listBlobsFlat()) console.log(b.name, b.properties.contentLength); })();
'
```

Expected, after you hid a chart: a line `22222222-0000-4000-8000-a00000000008/<your user id>/summary` and its size in
bytes. After **Reset Summary State** the blob is still there with size **0**: a blob of zero bytes is the reset
marker, so that a reset also hides an old layout of the old site.

**An old layout.** Open **Customer feedback** (the second row of Olivia's list) and **View Results**. The
Summary shows two charts and the Table has an **IPAddress** column with `203.0.113.7`: these come from the layouts
the old site saved for this survey (they are read as they are stored, and never written). Change nothing, and no
layout is saved.

The replica keeps what you do. To go back to the fixtures, run `pnpm legacy:load` (it also clears every saved
layout), or `pnpm demo:azurite:down` and `pnpm demo:azurite:up`. Stop the demo with Ctrl+C.

## 7. Tests

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

| #   | Check                                                                                                                                                                           | Result |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **View Results** on "API created" shows five charts and no 1,000 banner; the `color` chart's Table view shows 500 for each colour (1,500 in all)                                |        |
| 2   | Hide a chart and drag another, reload: the layout is kept. Details, **Reset Summary State**: the default layout is back, also after a reload                                    |        |
| 3   | The Table tab: hide a column, go to page 300, **Export As... CSV**: the file has 1,501 lines (`wc -l` shows 1,500 when there is no final newline)                               |        |
| 4   | `curl .../results?limit=1000` answers 1000 items and a `nextCursor`; the second page answers 500 and `null`                                                                     |        |
| 5   | A layout is yours: Mia's hidden chart on "Campaign survey" is not hidden for Olivia                                                                                             |        |
| 6   | On the replica a saved layout is a blob in `my-surveys-views`, and a reset leaves it with 0 bytes; "Customer feedback" shows the old site's two charts and the IPAddress column |        |
| 7   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green     |        |

## Troubleshooting

- **The results page says "This survey is not available."** The survey is not yours (a user sees only their own
  surveys and projects), or the id is wrong.
- **"The results could not be loaded."** The server is not reachable. Use **Try again**.
- **The Summary still shows an old layout after Reset:** reload the page and look at the address: you may be on
  another survey. A reset applies to the tab you reset (Table and Summary are separate).
- **`curl` answers `401`:** the cookie value is wrong or expired (a session lasts 12 hours). Copy `msid` again.
- **`curl` answers `400` "Invalid cursor.":** you used a cursor with another survey, or changed it. Use the
  `nextCursor` of the same survey, unchanged.
- **A new response does not show:** the results are read once when the page opens. Reload the page.
- **`wc -l` shows 1500:** see part 3: the last line has no final newline.
- **The Excel or PDF export does nothing the first time:** wait a moment: the code loads on the first export. If
  the page says "The export could not be prepared. Please try again.", the file with the code could not be
  loaded: check the connection and try again.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 9

- The rest of the **Details** tab (the response count, the data download, public results, **Delete Results**) and
  the other exports: Step 10 ([demo](step-10.md)). The project operations came with Step 11 ([demo](step-11.md)); only `passwordLogin` still answers `501`.
- The old page's locale picker ("Choose locale...") and the table's row actions "Show in Survey" and "Delete
  Result". There is no operation to delete one response.
- A word cloud for text questions (the old page has none either) and the `isPublic` marks of public results.
- The old `#summary`, `#table` and `#info` links (Step 12) and the old page's look (Step 13).
- A place of its own for a question added after a layout was saved: it is shown at the end of that layout
  (Summary and Table), and you drag it where you want it. A removed question is dropped from the layout.
