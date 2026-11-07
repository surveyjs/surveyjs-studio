# Demo: self-hosted Step 3, file storage on local disk and S3

This page lets you check self-hosted Step 3 without reading code. It takes about twenty minutes (the first `pnpm s3:up`
pulls the RustFS image). Commands are for Git Bash (or any POSIX shell), from the repository root.

What Step 3 delivers: **the SQL providers keep uploaded files for good.** Editor images and respondents' files are no
longer kept in memory. Their names, types and sizes are in the database; their bytes are in a folder on the data
volume (`FILE_STORE=local`, the default) or in an S3-compatible bucket (`FILE_STORE=s3`: AWS S3, Cloudflare R2, Backblaze
B2, RustFS). Locally the S3 server is **RustFS**, in place of MinIO, whose images are no longer published. The reasons
are in [ADR 0025](../adr/0025-file-storage-for-the-sql-providers.md). Only the users are still kept in memory, until
Step 4. Production (studio.surveyjs.io, `STORAGE_PROVIDER=azure-legacy`) is not affected.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists, including Docker. Ports 3000,
5173, 19000 and 19001 (on 127.0.0.1) must be free. Make a small picture to upload:

```sh
echo iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg== | base64 -d > small.png
```

Start from a fresh database and load the seed: `rm -rf server/.data`, then `pnpm seed:sqlite`. It prints
`Applied 3 migrations: 0001-surveys, 0002-results-views-projects, 0003-files`.

## 1. Files on local disk survive a restart

1. Start `pnpm dev:sqlite` and open <http://localhost:5173>. Choose **Adam Admin** on the "Sign in as…" page and click
   **Create a Survey**.
2. On the **Designer** tab, click **Image** in the toolbox, then the question's **Choose Image** button, and pick
   `small.png`. Wait for **All changes saved**.
3. In a second terminal: `ls server/.data/files/*/`.
   - **Check:** one folder named after the survey id, holding one file with a 64-character name.
4. Stop the app with Ctrl+C and start it again with `pnpm dev:sqlite`. Sign in as **Adam Admin** and open the survey.
   - **Check:** the picture is still shown.

Stop the app with Ctrl+C.

## 2. Files in S3 (checklist 1)

1. Start `pnpm dev:s3`. It starts RustFS, creates the bucket `surveyjs-studio-files`, and runs the app as `dev:sqlite`
   does, with `FILE_STORE=s3`.
2. As in part 1, sign in as **Adam Admin**, create a survey, and add an **Image** with `small.png`. Wait for
   **All changes saved**.
   - **Check:** the picture shows in the question. Open the **JSON Editor** tab: `imageLink` is
     `http://localhost:5173/api/v1/public/files/<64 characters>`. Paste it into a new tab: the picture opens.
3. Open the RustFS console at <http://127.0.0.1:19001> and sign in with the keys in `docker/s3.env`
   (`local-s3-access`, `Local-S3-Secret-Key-1`). Open the bucket **surveyjs-studio-files**.
   - **Check:** a folder named after the survey id holds one object whose name is the 64 characters of the link.

## 3. Deleting the survey deletes its objects (checklist 2)

1. In My Surveys, open the "…" menu of the survey and click **Archive**. Switch to the **Archived** view, open the menu
   of the survey and click **Delete**, then confirm.
2. In the RustFS console, reload the bucket.
   - **Check:** the survey's folder and object are gone.
3. Open the copied `imageLink` again. **Check:** it answers `404`.

## 4. Readiness names the file store

1. With `pnpm dev:s3` still running, open <http://localhost:5173/readyz>. **Check:** `{"status":"ok"}`.
2. In a second terminal stop RustFS: `docker compose --env-file docker/s3.env -f docker/compose.s3.yaml stop`. Reload
   `/readyz` (the answer is kept for 5 seconds). **Check:** it answers `503` with
   `{"status":"unavailable","failing":["files"]}`.
3. Start it again: `docker compose --env-file docker/s3.env -f docker/compose.s3.yaml start`. Within a few seconds
   `/readyz` answers `{"status":"ok"}` again.

## Clean up

Stop the app with Ctrl+C. `pnpm s3:down` stops RustFS and deletes its data; `rm -rf server/.data` removes the local
database and files.

## What the automated tests cover

- `pnpm test:unit`: the byte-store suite on local disk (keys, atomic writes, copies, deletes), the full provider suite
  with the SQL file store on SQLite, and the settings.
- `pnpm test:providers:s3` (after `pnpm s3:up`): the byte-store suite and the full provider suite with files in S3, and
  the `s3:bucket` command.
- `pnpm test:conformance:s3`: the HTTP conformance suite (uploads, quotas, serving) with files in S3.
- `pnpm e2e:sqlite` (uploads and run specs on local disk) and `pnpm e2e:postgres` (every functional spec, files in S3).
