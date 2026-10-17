# Demo: Step 6, the editor, autosave, conflicts and history

This page lets you check Step 6 without reading code. It takes about forty minutes (the Azurite part
pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX
shell); in PowerShell the same commands work, except where a variable is set.

What Step 6 delivers: a row click opens the **survey editor**, the SurveyJS Survey Creator set up as on
surveyjs.io. It **saves by itself** and shows the state in a bar at the bottom. If someone else changed
the survey, it says so and offers **Reload latest**. A user who cannot modify a survey gets a
**read-only** editor. **View History** lists every saved version with its time and user. Behind it are
five API operations (`getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`,
`saveSurveyTheme`, `listSurveyHistory`) with ETags and `If-Match`, and two legacy writes (definition and
theme saves). The full description for users is [Designing a survey](../user-guide/designing-a-survey.md)
and [Survey history](../user-guide/survey-history.md). The API side is
[Concurrent editing with ETags](../api/concurrency.md), and the reasons are in
[ADR 0012](../adr/0012-editor-content-and-history.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 8 you also need Docker with Compose, and
the ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of
Azurite mode you type the short name). This demo uses two of them:

| Name         | Type in the mock OIDC form | Why                                                                           |
| ------------ | -------------------------- | ----------------------------------------------------------------------------- |
| Olivia Owner | `owner`                    | Edits her own surveys. Cannot modify **Engineering retro** (read-only editor) |
| Adam Admin   | `admin`                    | Created Engineering retro, can modify everything in Engineering               |

**The editor shows a licence banner.** Without a SurveyJS licence key the Creator shows its own banner
about a missing licence. That is expected and does not stop anything
([Development](../development.md#the-editor-in-both-modes)).

**Try things on surveys you create.** Parts 1 to 5 use a survey made with **Create a Survey**, so the
fixture surveys stay as they are. In memory mode a restart resets everything. On the replica the changes
stay until `pnpm legacy:load`.

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Olivia Owner** on the "Sign in as…" page, and click **Create a
Survey**. The editor opens (the first open takes a moment: the Creator is loaded then, and not before).
The address is `/surveys/<id>/edit`. The bottom bar shows the name (**New Survey 1** on a fresh demo) and,
at its left end, **All changes saved**.

## 1. Edit, autosave and reload (checklist 1)

On the **Designer** tab click **Add Question** (or drag a question type from the toolbox). Watch the left
end of the bottom bar.

Expected: **Saving…**, then, within about a second, **All changes saved**. There is no Save button. Add a
second question and change its title. Each change saves by itself.

Reload the page (F5). Expected: both questions are still there, and the bar shows **All changes
saved**.

Look at the toolbar while you are here. Besides the Creator's own buttons it has an eraser (**Clear
Survey**), a question mark (**Help**: "Read the tool guide") and **Run** ("Click here to run this
survey..."). Hover over each to see its title.

## 2. The Themes tab (checklist 2)

Open the **Themes** tab (it can be under **More** on a narrow window). In the **Theme** drop-down choose
another theme, for example **Contrast**. The bar shows **Saving…** and then **All changes saved**.

Reload and open the **Themes** tab again. Expected: the theme is still **Contrast**. (The theme and the
definition are saved separately, and each has its own save; the status shows the state of both.)

## 3. Two windows: "changed by someone else" (checklist 3)

Copy the address of the editor and open it in a **second browser window** (the same browser and the same
session are fine). Now you have window A and window B on the same survey.

1. In window A add a question. Wait for **All changes saved**.
2. In window B add a question, **without reloading first**.

Expected in window B: after a moment a notice appears above the editor:

> The survey was changed by someone else. Your latest changes are not saved.

with a **Reload latest** button, and the bar says **Changes are not saved**. Window B stops saving.

Click **Reload latest**. Expected: the notice goes, the designer shows the question window A added (and
not the one you made in window B: it was not saved), and the bar says **All changes saved**. Add another
question in window B: it saves. Reload window A: it shows the same questions as window B.

## 4. Clear Survey saves (an addition to legacy)

In window A (reload it first) click the eraser, **Clear Survey**. Expected: the browser asks "You are
going to delete all elements in this survey. Do you want to proceed?". Click **Cancel**: nothing changes.
Click it again and **OK**: the designer is empty, and the bar shows **Saving…** and **All changes
saved**.

Reload. Expected: the survey is still empty. (On surveyjs.io the clearing is saved only with the next
change, so a reload brings the old survey back. Here the empty survey is saved and the earlier version
stays in the history.)

Add a question again, so the history has something to show.

## 5. View History (checklist 4)

Open the list (the browser's Back button, or the **My Surveys** item of the page header), open the "…" menu of
your survey and click **View History**.

Expected: the heading **Survey editing history of the 'New Survey 1'**, and one row for each save,
**newest first**, with a clock, the date and time (with the time zone, for example `UTC`) and **by Olivia
Owner**. There are many rows: autosave saves after every pause. The first save of the clear is among
them.

Now open **View History** for the fixture **Customer feedback** (Personal Surveys, the "…" menu of its
row). Expected: two rows with a time and **no** "by": the old surveyjs.io editor recorded no user.

A survey that was never saved shows **No edits yet.**: create another survey, and open its history
before you edit it. (It has no entry: a survey created without a definition has none.)

## 6. The Embed tabs (checklist 5)

Open your survey in the editor and click the **Embed Survey** tab (under **More** on a narrow window).

Expected: a text "To add the survey to your application, use the code below. For detailed instructions,
refer to the **Get Started** tutorial.", the platforms **Angular**, **React** (selected) and
**VanillaJS**, the check box **Load Survey JSON from service** (off), and blocks of code with a **Copy
Code** button. With the box off, the code contains your survey's JSON (and the theme when you chose
one).

Tick **Load Survey JSON from service**. Expected: the code now loads the survey from
`http://localhost:5173/api/v1/public/surveys/<survey id>` and posts the answers to
`http://localhost:5173/api/v1/public/surveys/<survey id>/responses`: the new URLs, with the address of the
page you are on. Switch the platform: the install command and the files change.

Open **Embed Creator**. Expected: the same platforms, and a notice that Survey Creator needs a commercial
licence, with links. (The public endpoints themselves arrive with the run page in Step 8.)

## 7. The JSON tab: obfuscated download

Open the **JSON Editor** tab. Expected: a download button with a drop-down: **Download JSON** and
**Download obfuscated JSON**. Choose the second one. The file `survey.obf.json` downloads; open it:
the questions are named `q1`, `q2`... and their titles are scrambled letters of the same length.

## 8. Read-only mode

Sign out (account menu) and sign in as **Olivia Owner** again if you are not. In the project selector
choose **Engineering** and click the row **Engineering retro** (created by Adam, so Olivia cannot modify
it).

Expected: the editor opens, and the bar says **Read-only**. Nothing can be changed: no **Clear Survey**,
no **Add Question**, the name in the bottom bar has no pencil and a click on it does nothing. You can
still open **Preview**. Wait a few seconds: nothing is saved (look at the Network tab of the browser's
tools: no `PUT`).

Now check that the server refuses a save too. This block signs in as Olivia with `curl` (the same steps
as in [the Step 5 demo](step-05.md#7-a-member-without-modify-rights-checklist-7)), reads the definition of Engineering
retro and tries to save it:

```sh
JAR=$(mktemp)
LOC=$(curl -s -D - -o /dev/null -c "$JAR" "http://localhost:5173/api/v1/auth/login" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
STATE=${LOC##*state=}
curl -s -o /dev/null -b "$JAR" -c "$JAR" "http://localhost:5173/api/v1/auth/callback?code=11111111-0000-4000-8000-a00000000001&state=$STATE"
CSRF=$(awk '$6=="msid_csrf"{print $7}' "$JAR")
RETRO=22222222-0000-4000-8000-a00000000006
curl -s -D - -o /dev/null -b "$JAR" "http://localhost:5173/api/v1/surveys/$RETRO/definition" | tr -d '\r' | grep -i '^\(HTTP\|etag\)'
curl -i -b "$JAR" -X PUT "http://localhost:5173/api/v1/surveys/$RETRO/definition" \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -H "If-Match: *" -d '{}'
```

Expected: the read answers `HTTP/1.1 200 OK` with an `etag:` header (a quoted value). The `PUT` answers
`HTTP/1.1 403 Forbidden` and `"code":"forbidden"`, and changed nothing.

## 9. ETags with `curl`

This shows the rules of [Concurrent editing with ETags](../api/concurrency.md) on the survey you created.
Take its id from the address bar of the editor and use the cookie jar from part 8:

```sh
ID=<the survey id>
API=http://localhost:5173/api/v1
ETAG=$(curl -s -D - -o /dev/null -b "$JAR" "$API/surveys/$ID/definition" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')
echo "$ETAG"
curl -i -b "$JAR" -X PUT "$API/surveys/$ID/definition" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -d '{"title":"From curl"}'
curl -i -b "$JAR" -X PUT "$API/surveys/$ID/definition" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -H 'If-Match: "stale"' -d '{"title":"From curl"}'
curl -i -b "$JAR" -X PUT "$API/surveys/$ID/definition" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" -H "If-Match: $ETAG" -d '{"title":"From curl"}'
```

Expected, in order: the `ETag` value; `428 Precondition Required` (`"code":"if-match-required"`);
`412 Precondition Failed` (`"code":"edit-conflict"`); and `204 No Content` with a **new** `etag:` header.

Reload the editor of that survey: its title is **From curl**. Then run the last command again with the
**old** `$ETAG`: it answers `412`, because the survey changed.

Stop the demo (Ctrl+C). The memory store is gone when the server stops.

## 10. The same on the legacy replica

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider with the mock OIDC server. Open <http://localhost:5173/> and sign in as **owner**
(type `owner` in the form).

Repeat parts 1 to 5 with a **Create a Survey** survey (it is named **New Survey N**, not necessarily 1,
on a replica that earlier runs wrote to). Everything works as in memory mode.

### How to see the history blobs and their metadata

`pnpm inspect:legacy` lists surveys, not content: it does not print definitions, themes, history or blob
metadata. Two ways to see them:

**A script with the project's own packages** (Git Bash, from the repository root; it only reads). Put the
survey's id after the last quotation mark. The id is in the editor's address.

```sh
pnpm --filter @my-surveys/server exec node --env-file=../docker/azurite.env -e '
const { BlobServiceClient } = require("@azure/storage-blob");
const id = process.argv[1];
const c = BlobServiceClient.fromConnectionString(process.env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING).getContainerClient("surveyjsonhistory");
(async () => { for await (const b of c.listBlobsFlat({ prefix: id + "/", includeMetadata: true })) console.log(b.name, b.properties.lastModified.toISOString(), JSON.stringify(b.metadata ?? {})); })();
' <the survey id>
```

Expected: one line for each history entry. A name is `<survey id>/<point id>`. The metadata of a point
saved in the editor is `{"userid":"11111111-0000-4000-8000-a00000000001","savedat":"2026-10-16T08:15:02.411Z"}`
(Olivia's id and the save time). Run it for **Customer feedback**
(`22222222-0000-4000-8000-a00000000001`): its two legacy points show `{}`: no user.

**Azure Storage Explorer.** Choose "Attach to a resource", "Storage account or service", "Connection
string", and paste the value of `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` from
[`docker/azurite.env`](../../docker/azurite.env) (the local Azurite account; its key is Microsoft's
public development key). Open **Blob Containers**, then `surveyjsonhistory`, then the folder named like the
survey. Select a blob and open **Properties**: the metadata shows `userid` and `savedat`. The same account
has `surveyjson` and `surveytext`, with the survey's definition as the blob content (one JSON line).

Compare with the page: the rows of **View History** are these points, newest first, and "by Olivia Owner"
is the `userid`.

Also check the survey row after saving:

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

Expected: the survey's **updated** date is the time of your last save, and it is at the top of the
list.

The replica keeps what you do, so the next run continues from there. To go back to the fixtures, run
`pnpm legacy:load`, or `pnpm demo:azurite:down` and `pnpm demo:azurite:up`.

Stop the demo with Ctrl+C.

## 11. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. `pnpm e2e` runs the editor and history specs in three browsers: autosave and reload,
the theme, the two-window conflict, Clear Survey, the rename in the bottom bar, the Embed tab, read-only
mode, the history page, and a check that the survey list loads no Creator code.

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

| #   | Check                                                                                                                                                                       | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | A row click opens the editor; an added question shows **Saving…** then **All changes saved**; after a reload the question is still there                                    |        |
| 2   | A theme chosen in the Themes tab is saved and is still chosen after a reload                                                                                                |        |
| 3   | In two windows, the second save shows "The survey was changed by someone else..." and **Reload latest**; reloading brings the other window's change and saving works again  |        |
| 4   | **View History** lists each save, newest first, with the time and "by" the user; Customer feedback's two legacy entries have no user                                        |        |
| 5   | The Embed Survey tab shows code that uses `/api/v1/public/surveys/<id>` and `/responses` when **Load Survey JSON from service** is ticked                                   |        |
| 6   | Clear Survey asks, then saves the empty survey (still empty after a reload)                                                                                                 |        |
| 7   | Olivia on Engineering retro gets a read-only editor and the API answers `403` for a save                                                                                    |        |
| 8   | `curl`: a save without `If-Match` is `428`, with a stale one `412`, with the current one `204` and a new `ETag`                                                             |        |
| 9   | On the replica the history points have the metadata `userid` and `savedat` (script or Storage Explorer), and the legacy points of Customer feedback have none               |        |
| 10  | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green |        |

## Troubleshooting

- The first open of the editor is slow, or shows nothing for a few seconds: the Creator is a large
  script that is loaded only here. Wait; a second open is faster.
- A banner about a licence in the editor: expected without `SURVEYJS_LICENSE_KEY`.
- **Changes are not saved** with no notice: the last save failed (for example the server stopped). The
  next change tries again; check that the server is running.
- No **Add Question** on Engineering retro: it is read-only for Olivia (part 8). Sign in as Adam to edit it.
- **Reload latest** keeps showing the notice: the reload failed; the notice then says "Could not reload
  the survey. Please try again.". Click it again.
- In Azurite mode the owner has surveys from earlier runs: run `pnpm legacy:load`.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 6

- Uploading images and files from the editor, and the editor's file quota: Step 7 (done, see
  [the Step 7 demo](step-07.md)). Until then, use image links.
- Machine translation in the Translation tab: needs a service that is not part of the API.
- Opening, comparing or restoring one history entry: phase 2.
- The run page and the public endpoints that the embed code calls (`/s/<id>`, `/api/v1/public/...`): Step 8.
- Deleting the editor's preview image on a save, as the old editor does: not built in Step 7 either
  ([ADR 0013](../adr/0013-editor-uploads-and-files.md), R4).
- jQuery and the Pop-up display method in the Embed tabs, and pixel parity of those tabs: see
  [ADR 0012](../adr/0012-editor-content-and-history.md#the-page-r21-to-r26).
