# Legacy smoke test

`pnpm smoke:legacy` proves on **production** that the old `api.surveyjs.io` reads what the new app writes. It
runs in rollout step 1, while the app is still read-only, before anyone writes through it
([runbook](../operations.md#step-1-internal-use-on-production-data-read-only-first)). It passed on production on
2026-10-23 (Step 14). The old site's pages are not
covered by the script: check them by hand with the [checklist](#manual-checklist-on-surveyjsio) below.

The script acts as one **test account**, which the product owner owns and which is used for nothing else. It
creates its own test survey and test project, writes them through the app's services (the same code the HTTP
handlers call), reads each write back through `api.surveyjs.io`, and deletes both at the end, also after a
failure. No other data is written. Field names and endpoints are in
[legacy-data-layout §7](../architecture/legacy-data-layout.md#7-how-apisurveyjsio-reads-results-and-inline-files).

## Before you run

| Variable                                   | Value                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `STORAGE_PROVIDER`                         | `azure-legacy`                                                                                          |
| `LEGACY_SQL_CONNECTION_STRING`             | The production database, with write access (the run creates and deletes rows)                           |
| `LEGACY_SURVEYS_STORAGE_CONNECTION_STRING` | The production surveys storage account, with write access                                               |
| `LEGACY_RESULTS_STORAGE_CONNECTION_STRING` | The production results storage account, with write access                                               |
| `USER_DIRECTORY` (and `USER_API_*`)        | As the app uses them: the account is looked up by email                                                 |
| `SMOKE_ACCESS_KEY`                         | The test account's access key for `api.surveyjs.io`. Never printed; the run never reads it from `Users` |
| `READ_ONLY`                                | Unset or `false`: with `true` the run refuses                                                           |

- Keep the env file **outside the repository** (or name it `.env.<something>`, which git ignores) and delete it when
  you are done. Set `SMOKE_ACCESS_KEY` in the shell or in that file; the shell wins.
- The test account must exist and must not be blocked.

**Getting the access key.**

1. Sign in on surveyjs.io as the test account and open **My Surveys**.
2. Open the browser's developer tools, the **Network** tab, and reload the page (or rename a survey).
3. Open any request to `api.surveyjs.io/private/…` and copy the value of its `accessKey` query parameter (32
   letters and digits).
4. Put it in `SMOKE_ACCESS_KEY`. Do not paste it into a ticket, a chat or a file in the repository.

Do not call `private/Surveys/generateAccessKey` unless you want to rotate the key: it makes a new key and the old one
stops working everywhere the account uses it.

**A wrong key** stops the run at the first step, `check key`, before anything is written. It shows as
`getActive answered HTTP 401`, as `the request failed (TypeError)` (the API may answer with a redirect, which the script
never follows, so the key cannot go to another address), or, for the key of another account that has surveys, as
`the access key does not belong to this account`. The key of another account without surveys passes `check key`; the
`create survey` check then stops the run with the same text, and the test survey is deleted.

## Run

```sh
pnpm smoke:legacy --account <test account email> --yes --env-file <path>
```

`--legacy-api <base URL>` changes the API address (default `https://api.surveyjs.io`). It must be `https`; `http` is
allowed only for `localhost`, `127.0.0.1` and `[::1]` (the tests' local stub). Without `--yes` nothing is done.

The script prints `Created test survey <id>` and `Created test project <id>` as soon as each exists.

| Exit code | Meaning                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `0`       | Every check passed (the `manual` row is for the checklist)                                                                    |
| `1`       | A check failed, an app write failed, or the cleanup failed                                                                    |
| `2`       | Usage error, or refused: no `--yes`, no `SMOKE_ACCESS_KEY`, no persistent store, `READ_ONLY=true`, unknown or blocked account |

The output is one table, then one line for each step that did not pass, then the cleanup:

```text
| step              | app                                       | legacy                                               | result |
|-------------------|-------------------------------------------|------------------------------------------------------|--------|
| check key         | none (reads only)                         | getActive: the account's surveys                     | pass   |
| create survey     | create in Personal (published flag empty) | getActive: Name, UserId, IsPublished null            | pass   |
| rename            | update name                               | getActive: Name                                      | pass   |
…
| delete project    | delete project                            | none: api.surveyjs.io has no project read            | manual |
```

## What each step checks

The survey is named `Smoke test <ISO time>`. Its response is posted before Publish and Unpublish, while its published
flag is still empty (empty means published, as on the old run page).

| Step              | App write                            | Legacy read                                                              |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| check key         | None                                 | `getActive`: if it lists surveys, one of them is the account's           |
| create survey     | New survey in Personal               | `getActive`: the name, the account as owner, `IsPublished` `null`        |
| rename            | New name                             | `getActive`: the new name                                                |
| save definition   | One-question definition              | `getSurvey`: the same JSON                                               |
| history point     | (the save's history point)           | `getHistoryPoint`: the same JSON                                         |
| save theme        | A theme                              | `getActive`: `Theme` is the same JSON                                    |
| submit response   | A response through the public submit | `getSurveyResults/{id}`: the row; `getResult`: one answer; `isCompleted` |
| public results    | Grant Access on                      | `getActive`: `AllowAccessResult`; `getSurveyPublicResults/{id}`: the row |
| publish           | Published flag 1                     | `getActive`: `IsPublished` `true`; `getSurvey` still answers             |
| unpublish         | Published flag 0                     | `getActive`: `IsPublished` `false`                                       |
| create project    | New project, the account its admin   | `getActive?ownerId=<project>`: empty (the account reads as a member)     |
| move into project | Survey moved into the project        | `getActive`: in the project's list, not in Personal                      |
| move to Personal  | Survey moved back                    | `getActive`: in Personal, not in the project's list                      |
| delete survey     | Archive, then delete                 | `getSurvey` answers 400; `getActive` does not list it                    |
| delete project    | Delete                               | None: `api.surveyjs.io` has no project read. Checked by hand             |

Results: `pass`; `FAIL`, the legacy read disagrees or fails (the line under the table says how); `error`, the app
write failed and the run stopped (the later steps show `skipped`); `manual`, see the checklist.

A failed `check key` or `create survey` check stops the run: without them the script cannot tell that the key belongs
to the account.

**When the cleanup fails**, a `Cleanup: could not delete …` line and the banner
`ACTION NEEDED: remove survey <id> / project <id> as the test account` name what is left. Sign in to the app as the
test account, archive and delete the survey, then delete the project.

**After an interrupt.** The first Ctrl+C (or `SIGTERM`) lets the current step finish, skips the rest, deletes the
test survey and project and prints the table with `Result: FAILED (interrupted).` Wait for it. A second Ctrl+C exits
at once and prints `ACTION NEEDED: remove …` with the ids still there: remove them by hand as above. If the process
was killed without a word, search the test account's Personal surveys and its projects in the app for names that start
with `Smoke test` (the `Created test …` lines name them) and delete them.

- **Stop it with Ctrl+C, not by closing the window.** Closing the terminal sends `SIGHUP`, which the script does not
  handle: it ends without the cleanup, as if it were killed.
- **Under pnpm on Windows the prompt may come back before the cleanup ends**, because pnpm exits on Ctrl+C while the
  script is still deleting. Keep the window open and wait for the `Result:` line.

## Manual checklist on surveyjs.io

The script deletes its survey, so for these checks make two by hand. A new survey is already published: its
published flag is empty, which the app (and the old run page) reads as published, so the app offers **Unpublish**, not
**Publish**.

In the **new app**, signed in as the test account:

1. Create survey **A** in Personal, save its definition two or three times, open its run page and submit one response.
2. Unpublish **A**, then Publish it again: its flag is now 1.
3. Create survey **B** in Personal, save a definition, and leave it as it is (its flag stays empty).

Then sign in to **surveyjs.io** as the test account and check:

- [ ] **My Surveys** lists **A** with the **Run** link.
- [ ] `https://surveyjs.io/published?id=<A's id>` runs it.
- [ ] **History** of **A** lists the app's saves, newest first, and each one opens.
- [ ] The **results** page of **A** shows the response.
- [ ] **My Surveys** lists **B** with **Publish** and no **Run** link (the expected difference below), and
      `https://surveyjs.io/published?id=<B's id>` still runs it.
- [ ] After `pnpm smoke:legacy`, its test project is not in the project list.

Then delete **A** and **B** in the app (archive, then delete).

**Expected difference (PO decision, Step 14).** A survey whose published flag is empty (never switched on the old
site, or new) is published in the app, which lists it with **Run** and **Unpublish**; the old My Surveys list shows
**Publish** and no **Run** for it, and the old run page still runs it. This is not a failure.
