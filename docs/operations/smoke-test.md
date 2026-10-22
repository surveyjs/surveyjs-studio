# Legacy smoke test

`pnpm smoke:legacy` proves on **production** that the old `api.surveyjs.io` reads what the new app writes. The
product owner runs it once the app writes to the real stores (Step 14, checkpoint 4). The old site's pages are not
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

- The access key is the `accessKey` the site sends to the API for that account. `private/Surveys/generateAccessKey`
  makes a new one and invalidates the old one.
- Keep the env file **outside the repository** (or name it `.env.<something>`, which git ignores) and delete it when
  you are done. Set `SMOKE_ACCESS_KEY` in the shell or in that file; the shell wins.
- The test account must exist and must not be blocked.

## Run

```sh
pnpm smoke:legacy --account <test account email> --yes --env-file <path>
```

`--legacy-api <base URL>` changes the API address (default `https://api.surveyjs.io`; the tests use a local stub).
Without `--yes` nothing is done.

| Exit code | Meaning                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `0`       | Every check passed (the `manual` row is for the checklist)                                                                    |
| `1`       | A check failed, an app write failed, or the cleanup failed                                                                    |
| `2`       | Usage error, or refused: no `--yes`, no `SMOKE_ACCESS_KEY`, no persistent store, `READ_ONLY=true`, unknown or blocked account |

The output is one table, then one line for each step that did not pass, then the cleanup:

```text
| step              | app                                       | legacy                                               | result |
|-------------------|-------------------------------------------|------------------------------------------------------|--------|
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

**When the cleanup fails**, the `Cleanup:` line names the survey or project id. Archive and delete the survey, then
delete the project, in the app as the test account.

## Manual checklist on surveyjs.io

The script deletes its survey, so for these checks make one by hand. Sign in to the **new app** as the test account,
create a survey in Personal, save its definition two or three times, publish it, open its run page and submit one
response. Then sign in to **surveyjs.io** as the test account and check:

- [ ] **My Surveys** lists the survey with the **Run** link (it is published).
- [ ] `https://surveyjs.io/published?id=<survey id>` runs it.
- [ ] **History** lists the app's saves, newest first, and each one opens.
- [ ] The **results** page shows the response.
- [ ] After `pnpm smoke:legacy`, its test project is not in the project list.

Then delete the survey in the app (archive, then delete).

**Expected difference (PO decision, Step 14).** A survey that was never switched on the old site has an empty
published flag. The app lists it as published, with **Run** and **Unpublish**; the old My Surveys list showed
**Publish** for it. This is not a failure.
