# Demo: self-hosted Step 2, results, views and projects on SQL

This page lets you check self-hosted Step 2 without reading code. It takes about an hour, most of it the Phase 1 demos
of part 2. Commands are for Git Bash (or any POSIX shell), from the repository root.

What Step 2 delivers: **everything but the users and the uploaded files now lives in the database.** Next to the
surveys of [Step 1](self-hosted-01.md), PostgreSQL and SQLite keep the responses and completion markers, every user's
saved results layouts, the private-question lists, and the projects with their members. Deleting a project moves its
surveys in the same transaction, and erasing an account reaches the database. Users and files are still kept in memory
until Steps 3 and 4, and the server says so when it starts. The tables are in [the data model](../architecture/data-model.md).
Production (studio.surveyjs.io, `STORAGE_PROVIDER=azure-legacy`) is not affected.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists, including Docker. Ports 3000,
5173 and 15432 (on 127.0.0.1) must be free. The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start):
**Olivia Owner** (`owner`) owns "API created" with its 1,500 responses and is admin of Marketing; **Adam Admin**
(`admin`) is admin of Marketing and Engineering.

Start from a fresh database and load the seed:

```sh
pnpm postgres:down          # only if PostgreSQL ran before: it deletes its data
pnpm seed:postgres
```

It prints `Applied 2 migrations: 0001-surveys, 0002-results-views-projects` and `Seeded 9 surveys and 2 projects.`

Start the app with `pnpm dev:postgres` and open <http://localhost:5173>. In the server output, find the warning
`STORAGE_PROVIDER=postgres keeps users and uploaded files in memory: they are lost on restart (self-hosted track Steps
3 and 4)`.

## 1. What you do survives a restart

1. Sign in as **Olivia Owner**. In the list, open the "…" menu of **API created** and click **View Results**. On the
   **Summary**, click **Hide** on the first chart.
2. Back in the list, open the "…" menu of **API created** and click **Run**. Answer the survey and complete it.
3. Open the account menu (your name in the header) and click **Projects**. Click **Create a Project** and name it
   `Kept in PostgreSQL`. In its card, click **Add a New Member**, type `admin@example.com` and click **Add**.
4. Stop the app with Ctrl+C and start it again: `pnpm dev:postgres`. Sign in as **Olivia Owner** again.
   - **Check:** the Results of API created still hide that chart, and the **Details** tab counts 1,501 responses.
   - **Check:** on the Projects page, `Kept in PostgreSQL` is still there, with **Adam Admin** as a member.

## 2. The Phase 1 demos (checklist 1)

Run the demos of Steps 4 to 11 in `pnpm dev:postgres` instead of `pnpm demo`, with their seed accounts and their
checklists: [the survey list](step-04.md), [survey actions](step-05.md), [the editor](step-06.md),
[uploads](step-07.md), [the run page](step-08.md), [results](step-09.md), [details and public results](step-10.md)
and [projects](step-11.md). Skip their Azurite parts.

- **Check:** every item of those checklists holds. Two differences are expected: uploaded files, and anything a demo
  stores for a user that is not in the seed, are gone after a restart (they are still in memory).

## 3. 1,500 responses page with no visible delay (checklist 2)

1. Sign in as **Olivia Owner** and open the **Results** of **API created**, then the **Table** tab.
2. Click **Next Page** several times, then **Last Page**, then **First Page**.
   - **Check:** each page shows at once, with no spinner you notice. The last page holds the last of the 1,500
     responses.
3. On the **Summary** tab, open the **Favourite colour** chart's drop-down and choose **Table**.
   - **Check:** **Red 500**, **Green 500**, **Blue 500**: all 1,500 responses are counted.

## Clean up

Stop the app with Ctrl+C. `pnpm postgres:down` stops PostgreSQL and deletes its data.

## What the automated tests cover

- `pnpm test:unit`: the full provider suite on SQLite (every store, including 1,500-response paging, last-admin,
  project deletion moving surveys, and erasure), the concurrency suites, the migrator and the cursors.
- `pnpm test:providers:postgres` (after `pnpm postgres:up`): the same on PostgreSQL, with the row lock that keeps one
  admin when two are demoted together.
- `pnpm test:conformance:sqlite` and `pnpm test:conformance:postgres`: the whole HTTP conformance suite on each database.
- `pnpm e2e:postgres`: every functional browser test but the licence notices, on PostgreSQL; `pnpm e2e:sqlite`: the
  survey list, editor and history tests on SQLite.
