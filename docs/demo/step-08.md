# Demo: Step 8, run page and response collection

This page lets you check Step 8 without reading code. It takes about twenty-five minutes (the Azurite part
pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX
shell); in PowerShell the same commands work, except where a variable is set or a file is made.

What Step 8 delivers: a published survey can be answered by anyone at `/s/<survey id>`, in its theme, with no
sign-in. The answers are stored once (a double click or a retry does not make two), a File Upload question sends
its file to the server and keeps only a link, an unpublished survey shows "This survey is not currently
available.", and the old `/published?id=` link of surveyjs.io lands on the same page. The public operations are
rate limited, and the respondent's IP address is stored only when the survey's setting is on. Behind it are
four API operations: `getPublishedSurvey`, `submitResponse`, `uploadResponseFile` and `getResultStats` (the
count; the results page arrives in Step 9). The description for users is [Publishing and collecting
responses](../user-guide/publishing-and-collecting-responses.md). The API side is [Public endpoints, rate limits
and idempotency](../api/public-endpoints.md), and the reasons are in
[ADR 0014](../adr/0014-run-page-and-response-collection.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 6 you also need Docker with Compose, and the
ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of Azurite
mode you type the short name). This demo uses one of them:

| Name       | Type in the mock OIDC form | Why                                                                        |
| ---------- | -------------------------- | -------------------------------------------------------------------------- |
| Adam Admin | `admin`                    | Has no surveys of his own, so everything you create is yours to throw away |

**The editor shows a licence banner.** Without a SurveyJS licence key the Creator shows its own banner about a
missing licence. That is expected ([Development](../development.md#the-editor-in-both-modes)).

**The brand footer's logo is a missing image offline.** The footer block at the bottom of the survey loads its
logo from `surveyjs.io`. That is expected.

**You need a 5 MB file** for part 3. Make one (Git Bash; in PowerShell use `fsutil file createnew five-mb.bin
5242880`):

```sh
head -c 5242880 /dev/urandom > five-mb.bin
ls -l five-mb.bin
```

Expected: `five-mb.bin` is 5242880 bytes. A random file has no known type, so the server stores it as
`application/octet-stream`.

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Adam Admin** on the "Sign in as…" page.

## 1. Publish a survey and run it (checklist 1)

Click **Create a Survey**. The editor opens at `/surveys/<id>/edit`. Note the survey id in the address.

On the **Designer** tab, click **Single-Line Input** in the toolbox (or any other question; it adds a text
question named `question1`). Open the
**Themes** tab and choose a theme with a colour you can recognise (for example pick another theme from the
list and change the **Accent color**). The status bar shows **Saving…** and then **All changes saved**.

Go back to the list (**My Surveys** in the header). Open the "…" menu of your survey and click **Publish**.
Open the menu again and click **Run**.

Expected: a new tab opens at `http://localhost:5173/s/<survey id>`. It shows the survey in the theme you chose,
with no site header or footer. At the bottom is the Form Library's own block: "Try and see how easy it is to
create a survey" and "Terms of Use & Privacy Statement". The tab's title is the survey's name. You did not have
to sign in to see it: copy the address into a private window to check.

## 2. Complete it and count the response (checklist 2)

In the run tab, type an answer and click **Complete**. Expected: "Thank you for completing the survey".

Now count the responses. The results page arrives in Step 9, so ask the API. You need the value of your session
cookie: in the browser's developer tools (F12), open **Application** (Chrome, Edge) or **Storage** (Firefox),
**Cookies**, `http://localhost:5173`, and copy the **Value** of `msid`. Then:

```sh
curl -s http://localhost:5173/api/v1/surveys/<id>/results/stats -b "msid=<cookie value from the browser's developer tools>"
```

(Or open the same address in the browser where you are signed in.) Expected, with your own times:

```json
{
  "count": 1,
  "firstSubmittedAt": "2026-10-17T09:12:41.208Z",
  "lastSubmittedAt": "2026-10-17T09:12:41.208Z"
}
```

Two checks of the "stored once" rule. Reload the run tab and complete the survey again: the count is now 2 (a
new visit is a new response, because "Limit to one response" is off). Then double-click **Complete** on a fresh
visit and look at the count again: it went up by one, not two. (The page sends one request with one
`Idempotency-Key`; a second click while it is saving does nothing.)

## 3. A File Upload question with a 5 MB file (checklist 3)

Go back to the editor of the same survey (**Edit** in the "…" menu). Click **File Upload** in the toolbox, and
wait for **All changes saved**. Open the run tab again and reload it (the survey is the same, so reloading
loads the new question).

In the File Upload question, click its choose button (**Select File**) and pick `five-mb.bin`. Expected: the file shows as chosen,
with its name and a size of 5 MB. Click **Complete**. Expected: "Thank you for completing the survey". The
submission succeeded with a 5 MB file, although a response body may be only 1 MB: the file went to the server
on its own, and the response holds only a link.

Count again with the `curl` of part 2. Expected: `"count":4`. Part 2 left three responses (the first
completion, the one after the reload, and the double-click one), and this upload adds a fourth.

To see the link, look at the answer. Open the **Network** tab of the browser's tools before you complete, and
find the `POST` to `/api/v1/public/surveys/<id>/responses`: its payload holds
`{"data":{"question2":[{"name":"five-mb.bin","type":"application/octet-stream","content":"http://localhost:5173/api/v1/public/files/<64 characters>"}]}}`.
(The question's name may differ.) Open the link: the browser downloads the file, and it asks for no sign-in.

Optional, a file that is too large: the limit is `LIMIT_MAX_FILE_BYTES` (10 MB). To see the message without a
huge file, stop the demo (Ctrl+C), export `LIMIT_MAX_FILE_BYTES=1048576` (PowerShell: `$env:LIMIT_MAX_FILE_BYTES =
"1048576"`), run `pnpm demo` again, sign in, and make a new published survey with a File Upload question (the
memory store was emptied by the restart). Choose `five-mb.bin`. Expected: the question shows "This file is too
large. A file can be up to 1 MB." and no request is sent for the file. Unset the variable and restart before
the next part.

## 4. Unpublish and reload (checklist 4)

In the list, open the "…" menu of the survey and click **Unpublish**. **Run** disappears from the menu.

Reload the run tab (or open `http://localhost:5173/s/<survey id>` again). Expected: a centred red line, **This
survey is not currently available.**

A survey that does not exist shows the same page, and so does a survey that is not published: a stranger cannot
tell them apart. Check the API too:

```sh
curl -s -w "\n%{http_code}\n" http://localhost:5173/api/v1/public/surveys/<id>
curl -s -w "\n%{http_code}\n" http://localhost:5173/api/v1/public/surveys/99999999-0000-4000-8000-a00000000099
```

Expected: both answer `404` with `"code":"survey-not-available"` and the same title, "This survey is not
available". An answer sent to the unpublished survey is refused as well, and stores nothing:

```sh
curl -s -w "\n%{http_code}\n" -X POST http://localhost:5173/api/v1/public/surveys/<id>/responses -H "Content-Type: application/json" -d '{"data":{}}'
```

Expected: `404`. Publish the survey again for part 5.

## 5. The old link (checklist 5)

Open this address, with your survey id (and a question name for the prefill; `question1` is the name of the
first question if you did not rename it):

```text
http://localhost:5173/published?id=<survey id>&question1=Ann
```

Expected: the address in the bar changes to `http://localhost:5173/s/<survey id>?question1=Ann`, the same run
page opens, and the first question already holds `Ann`. A link with no `id` (`/published`) shows "This survey is
not currently available.".

## 6. Optional: the rate limit

The public operations are limited to 60 requests a minute for each address and operation. To see a `429`
quickly, stop the demo and start it with a low limit (Git Bash; PowerShell: `$env:PUBLIC_RATE_LIMIT = "5"`):

```sh
export PUBLIC_RATE_LIMIT=5
pnpm demo
```

Sign in, publish a survey (as in part 1, with a new survey; the memory store was emptied), then:

```sh
for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/v1/public/surveys/<id>; done
```

Expected: `200` five times, then `429`. Look at the refusal:

```sh
curl -i http://localhost:5173/api/v1/public/surveys/<id>
```

Expected: `429 Too Many Requests`, a `retry-after` header (seconds), `x-ratelimit-limit: 5`, and the body
`{"type":"https://my-surveys.surveyjs.io/problems/rate-limited","title":"Too many requests","status":429,"code":"rate-limited","detail":"Too many requests. Try again in ..."}`.
Wait for a minute and it works again. (Other operations have their own counters: a `POST` of a response is
not limited by the `GET`s.) Unset the variable and restart before the next part.

## 7. The same on the legacy replica (the Azurite checks)

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider. Open <http://localhost:5173/> and sign in as **admin** (type `admin` in the form).
Repeat parts 1 to 5 with a new survey. Everything works as in memory mode. Two differences you can see:

- A response is a **row in the survey's own table** in the replica. The table is named `post` plus the survey's
  **Post ID without dashes** (copy it with **Survey IDs**, **Copy Post ID** in the "…" menu).
- A file is a blob `my-surveys-files/<survey id>/<file id>` with the metadata `kind` set to `response`.

### How to see the row

A script with the project's own packages (Git Bash, from the repository root; it only reads). Put the survey's
Post ID after the last quotation mark.

```sh
pnpm --filter @my-surveys/server exec node --env-file=../docker/azurite.env -e '
const { TableClient } = require("@azure/data-tables");
const name = "post" + process.argv[1].replaceAll("-", "").toLowerCase();
const t = TableClient.fromConnectionString(process.env.LEGACY_RESULTS_STORAGE_CONNECTION_STRING, name, { allowInsecureConnection: true });
(async () => { for await (const r of t.listEntities()) console.log(r.rowKey, r.type, r.happendat, (r.result ?? "").slice(0, 100)); })();
' <the post id>
```

Expected: one line for each response, for example `b0f1c3a8-52de-4a41-8c97-3e6d9f2b7a10 SURVEY_POSTRESUTL
2026-10-17T09:12:41.208Z {"question1":"Ann"}`. The row key is the response's id. The row has the properties
the old site reads (layout, 3.6). The file answer's `result` holds the link, not the file.

**Azure Storage Explorer** shows the same tables and blobs. Choose "Attach to a resource", "Storage account or
service", "Connection string", and paste the value of `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` from
[`docker/azurite.env`](../../docker/azurite.env) (the local Azurite account; its key is Microsoft's public
development key). Open **Tables**, then `post...`.

The replica keeps what you do. To go back to the fixtures, run `pnpm legacy:load`, or `pnpm demo:azurite:down`
and `pnpm demo:azurite:up`. Result tables and files of surveys you create stay until you delete the survey (the
loader does not empty them). Stop the demo with Ctrl+C.

## 8. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. `pnpm e2e` runs the new `run.spec.ts` in three browsers: a survey published from the list
runs in a new tab with its theme and stores one response, a double click on **Complete** stores one, a file
answer is uploaded and the response keeps its link, an unpublished survey shows the not-available page, the old
`/published?id=` link redirects with the answer prefilled, and a signed-out respondent loads the Form Library
and no Creator or Dashboard code. The e2e servers run with the public rate limits raised to 100000, because all
browsers share one address.

With the replica running (`pnpm demo:azurite:up`; stop any demo first, the tests use ports 3000 and 5173):

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

| #   | Check                                                                                                                                                                         | Result |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | A published survey opens from **Run** at `/s/<survey id>` in its theme, with no sign-in and no site header, and the brand footer at the bottom                                |        |
| 2   | Completing it shows "Thank you for completing the survey", and `getResultStats` answers `"count":1`; a double click on **Complete** adds only one                             |        |
| 3   | A File Upload question accepts a 5 MB file, the submission succeeds, `"count"` goes up by one, and the answer holds a `/api/v1/public/files/...` link that downloads the file |        |
| 4   | After **Unpublish**, reloading the run page shows "This survey is not currently available.", and the API answers `404 survey-not-available` for it and for an unknown id      |        |
| 5   | `/published?id=<id>` lands on `/s/<id>` with the other query parameters kept and prefilled                                                                                    |        |
| 6   | (Optional) With `PUBLIC_RATE_LIMIT=5`, the sixth request in a minute answers `429` with `retry-after`                                                                         |        |
| 7   | On the replica a response is a row in `post<post id>` with the response's id as its row key, and the file is a blob with the kind `response`                                  |        |
| 8   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green   |        |

## Troubleshooting

- **The run page says "This survey is not currently available."** for your survey: it is not published (open
  the "…" menu: **Run** is there only for a published survey), or the memory store was emptied by a restart.
- **The counts are 0 or 404 after a restart:** in memory mode a restart loses surveys, responses and files.
  Make a new survey.
- **`curl` answers `401`:** the cookie value is wrong or expired (a session lasts 12 hours). Copy `msid` again.
- **`curl` answers `404` for the count:** the survey is not yours (a user sees only their own surveys and
  projects), or the id is wrong.
- **A file of 5 MB is refused:** the server was started with a smaller `LIMIT_MAX_FILE_BYTES`. Unset it and
  restart.
- **The logo at the bottom is a missing image:** you are offline (the logo is loaded from `surveyjs.io`).
- **A prefilled answer does not show:** the name in the link is not the name of a question. Open the editor's
  **JSON Editor** tab and read the `name` of the question.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 8

- The results page, the list of responses, and statistics beyond the count: Steps 9 and 10. `listResults` still
  answers `501`.
- Partial responses and "continue later": `partial` and `lastPageIndex` are ignored (stored as complete).
- The "Disclaimer of liability" banner of the old run page: Step 13.
- A quota for respondent files, expiring file links, and a shared rate-limit store for several servers.
- Telling "Limit to one response" apart from a respondent who changes browser: the limit is a courtesy.
