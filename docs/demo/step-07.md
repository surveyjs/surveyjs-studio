# Demo: Step 7, editor uploads and file serving

This page lets you check Step 7 without reading code. It takes about twenty minutes (the Azurite part
pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX
shell); in PowerShell the same commands work, except where a variable is set or a file is made.

What Step 7 delivers: pictures and videos that you choose in the **survey editor** are uploaded to the
server and stored apart from the survey. The survey keeps only a link, `/api/v1/public/files/<id>`, which
anyone can open. A survey can store a limited amount of files (50 MB by default), and the editor shows a
clear message when a file does not fit. Deleting a survey deletes its files, and a copy of a survey gets
copies of them. Behind it are two API operations, `uploadSurveyAsset` and `downloadFile`. The description
for users is [Images and files in your survey](../user-guide/images-and-files.md). The API side is
[Uploads and files](../api/uploads.md), and the reasons are in
[ADR 0013](../adr/0013-editor-uploads-and-files.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 6 you also need Docker with Compose, and
the ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of
Azurite mode you type the short name). This demo uses one of them:

| Name       | Type in the mock OIDC form | Why                                                                        |
| ---------- | -------------------------- | -------------------------------------------------------------------------- |
| Adam Admin | `admin`                    | Has no surveys of his own, so everything you create is yours to throw away |

**The editor shows a licence banner.** Without a SurveyJS licence key the Creator shows its own banner
about a missing licence. That is expected ([Development](../development.md#the-editor-in-both-modes)).

**You need two picture files.** Any PNG or JPEG you have will do for the first one. For the quota part you
need a PNG of more than 1 MB. If you have none, make both files (Git Bash; the first is a 1-pixel PNG, so
it is hard to see, but it is a real image):

```sh
echo iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg== | base64 -d > small.png
cp small.png big.png
head -c 1200000 /dev/zero >> big.png
ls -l small.png big.png
```

Expected: `small.png` is 70 bytes and `big.png` is about 1.2 MB. (Browsers ignore data after the end of a PNG,
and the server still sees a PNG.)

## Start the demo (with a small quota)

The quota is `LIMIT_MAX_ASSET_BYTES_PER_SURVEY`. To see the quota message without a 50 MB file, export a
limit of 1 MB (1,048,576 bytes) **before** `pnpm demo`. PowerShell: `$env:LIMIT_MAX_ASSET_BYTES_PER_SURVEY =
"1048576"`.

```sh
export LIMIT_MAX_ASSET_BYTES_PER_SURVEY=1048576
pnpm demo
```

Open <http://localhost:5173/>, choose **Adam Admin** on the "Sign in as…" page, and click **Create a
Survey**. The editor opens at `/surveys/<id>/edit` (the first open takes a moment). Note the survey id in
the address: you need it later.

## 1. Upload a picture (checklist 1)

On the **Designer** tab, click **Image** in the toolbox on the left. An Image question is added and
selected. Click the **Choose Image** button of the question, and pick `small.png` (or your own
picture).

Expected: the bar at the bottom shows **Saving…** and then **All changes saved**, and the picture shows
in the question. Open the **Preview** tab: the picture shows there too.

Now look at the link. Open the **JSON Editor** tab and find `imageLink`. Expected: it is
`http://localhost:5173/api/v1/public/files/<64 characters>`: 64 lower-case hexadecimal digits, the first
32 are the survey id without dashes. Copy the link, paste it into a new browser tab and press Enter.
Expected: the picture opens by itself in the tab, with no sign-in needed.

Reload the editor (F5). Expected: the picture is still there. The survey keeps the link, not the picture.

## 2. The download headers

Take the link from part 1 and check the answer of the server. Replace `<link>` with it.

```sh
curl -I "<link>"
```

Expected:

```text
HTTP/1.1 200 OK
content-type: image/png
content-length: 70
content-disposition: inline; filename="small.png"; filename*=UTF-8''small.png
cache-control: public, max-age=3600
x-content-type-options: nosniff
content-security-policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox
cross-origin-resource-policy: cross-origin
```

(The size and the file name are those of your file; the order of the lines can differ.) No cookie was sent,
so the file is public. `inline` means that the browser shows a picture in place; a video would say
`attachment`. The other headers keep a hostile file, for example an SVG with a script, from doing harm when
someone opens the link directly.

## 3. A file over the quota (checklist 2)

In the same editor, add another **Image** question (or select the first one) and choose `big.png`, which is
more than 1 MB.

Expected: a notification appears in the editor:

> A survey can store up to 1 MB of files in total. This file was not uploaded.

The picture does not change and nothing was sent (look at the Network tab of the browser's tools: no
`POST` to `/assets`). The check is made in the browser first, because this file is larger than the whole
quota.

Now fill the quota from the inside. The survey holds only a few bytes so far. Make a file of about
800 KB (`cp small.png mid.png; head -c 800000 /dev/zero >> mid.png`), add a new Image question and choose
`mid.png`. Expected: it is uploaded. Add one more Image question and choose `mid.png` again. Expected: the
same message appears. This time the browser did send the file (a `POST` that answers `413`), because only
about 200 KB were left. In the Network tab the `413` answer says `quota-exceeded` with "This survey can
store up to 1 MB of files."

Two more things to know. A file that is not an allowed type is refused too: choose any `.pdf` (or a text
file). Expected: "This file type
cannot be uploaded. Use a PNG, JPEG, GIF, WebP, AVIF, BMP or SVG image, or an MP4, WebM or Ogg video." And
**replacing an image does not give the space back**: the old file stays until the survey is deleted.

## 4. A copy has its own files

Go back to the list (the browser's Back button, or **My Surveys** in the header). Open the "…" menu of
your survey and click **Clone**. Open the copy (**Copy of New Survey 1**, or the name of your survey) in
the editor and open the **JSON Editor** tab.

Expected: the `imageLink` has the same shape as before, but the 64 digits are **different**, and the
first 32 are the id of the copy. Open the link: the same picture shows. The copy has copies of the files,
so deleting the original does not break it.

## 5. Delete the survey: its files go (checklist 3)

Copy the link of the **original** survey's picture (part 1). In the list, open the "…" menu of the
original survey and click **Archive**. Switch to the **Archived** view, open the menu of the survey and
click **Delete**, then confirm.

Check the link with `curl`, not in the browser (a browser may keep showing a picture it has already
loaded, for up to an hour, because downloads are cacheable):

```sh
curl -s -o /dev/null -w "%{http_code}\n" "<link of the original's picture>"
curl -s -o /dev/null -w "%{http_code}\n" "<link of the copy's picture>"
```

Expected: `404` for the original and `200` for the copy.

Stop the demo (Ctrl+C). The memory store is gone when the server stops: files too. After a restart the
links answer `404`.

## 6. The same on the legacy replica

```sh
pnpm demo:azurite:up
export LIMIT_MAX_ASSET_BYTES_PER_SURVEY=1048576
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider. Open <http://localhost:5173/> and sign in as **admin** (type `admin` in the
form). Repeat parts 1 to 5 with a new survey. Everything works as in memory mode.

Between part 1 and part 5, look at where the file is. Files go to a **new blob container**,
`my-surveys-files`, of the replica's surveys account, as `<survey id>/<file id>`. The container is created
by the first upload. The legacy file share `surveyfiles` is not used.

### How to see the blob and its metadata

A script with the project's own packages (Git Bash, from the repository root; it only reads). Put the
survey's id after the last quotation mark; the id is in the editor's address.

```sh
pnpm --filter @my-surveys/server exec node --env-file=../docker/azurite.env -e '
const { BlobServiceClient } = require("@azure/storage-blob");
const id = process.argv[1];
const c = BlobServiceClient.fromConnectionString(process.env.LEGACY_SURVEYS_STORAGE_CONNECTION_STRING).getContainerClient("my-surveys-files");
(async () => { for await (const b of c.listBlobsFlat({ prefix: id + "/", includeMetadata: true })) console.log(b.name, b.properties.contentType, b.properties.contentLength, JSON.stringify(b.metadata ?? {})); })();
' <the survey id>
```

Expected: one line for each uploaded file, for example `<survey id>/<file id> image/png 70
{"kind":"asset","name":"small.png","createdat":"2026-10-17T09:30:00.000Z"}`. The name of the blob is the
`<survey id>/<file id>` of the link. The type is the blob's own content type, found in the bytes.

**Azure Storage Explorer** shows the same. Choose "Attach to a resource", "Storage account or service",
"Connection string", and paste the value of `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` from
[`docker/azurite.env`](../../docker/azurite.env) (the local Azurite account; its key is Microsoft's public
development key). Open **Blob Containers**, then `my-surveys-files`, then the folder named like the
survey. Select the blob and open **Properties**.

Run the script again after part 5 (delete): it prints nothing for the deleted survey, because its blobs
are gone. The copy's folder still has its files until the copy is deleted.

The replica keeps what you do. To go back to the fixtures, run `pnpm legacy:load`, or `pnpm
demo:azurite:down` and `pnpm demo:azurite:up`. Stop the demo with Ctrl+C.

## 7. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. `pnpm e2e` runs the new `uploads.spec.ts` in three browsers: an image chosen in the
editor is uploaded, shown in the Designer and in Preview, saved as a link and served, and answers `404`
after the survey is deleted; and a file over the quota shows the message, before and after asking the
server. The e2e servers run with a quota of 1 MB.

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
| 1   | An Image question with an uploaded picture shows in the Designer and in Preview, and its `imageLink` is a `/api/v1/public/files/...` link that opens in a new tab           |        |
| 2   | A file larger than the quota shows "A survey can store up to 1 MB of files in total. This file was not uploaded."                                                           |        |
| 3   | After the survey is archived and deleted, its file link answers `404` (checked with `curl`)                                                                                 |        |
| 4   | `curl -I` of a file link shows `inline`, `nosniff`, the sandboxing `content-security-policy`, `cache-control: public, max-age=3600` and no session cookie needed            |        |
| 5   | A clone's `imageLink` has a different id, opens, and still answers `200` after the original is deleted                                                                      |        |
| 6   | On the replica the file is a blob `my-surveys-files/<survey id>/<file id>` with the metadata `kind`, `name` and `createdat`, and it is gone after the survey is deleted     |        |
| 7   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green |        |

## Troubleshooting

- The quota message says "50 MB" instead of "1 MB": the limit was not exported before `pnpm demo`. Stop
  the demo, export it, and start again.
- A picture that worked before shows a broken image: in memory mode a restart loses the files. Upload it
  again.
- **The file was not uploaded. Please try again.** with no other reason: the server did not answer as
  expected (for example it stopped). Check that it is running.
- **This file type cannot be uploaded.** for a picture you know is fine: the server looks inside the file.
  A renamed file of another type (a HEIC photo called `.png`) is refused.
- The picture of a deleted survey still shows in the browser: it is cached for up to an hour. Check with
  `curl`.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 7

- Respondent files (a file question in a survey that someone fills in) and the run page: Step 8
  ([demo](step-08.md)). Of the operations of later steps, `exportResults` still answers `501` (`listResults` came with Step 9).
- Deleting one file, or getting space back when an image is replaced: there is no API for it yet.
- Videos that need `Range` requests (Safari), and conditional downloads (`ETag`, `304`).
- A separate web address for uploaded files.
- Moving the pictures of surveys made on the old site (`api.surveyjs.io` links): they stay as they are and
  keep working while that site runs. They are not counted, copied or deleted.
- The editor's preview image of the old site: not built.
