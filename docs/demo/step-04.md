# Demo: Step 4, the survey list and survey creation

This page lets you check Step 4 without reading code. It takes about twenty minutes (the Azurite
part pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or
any POSIX shell); in PowerShell the same commands work, except where a variable is set.

What Step 4 delivers: the **My Surveys list** at `/` in the surveyjs.io look: personal surveys and
project surveys, the Active/Archived switch, the project selector, rows with the name and the
created and updated dates, **Create a Survey** (which opens a placeholder editor page), and a Load
more button for long lists. Behind it are five API operations (`listSurveys`, `createSurvey`,
`getSurvey`, `listProjects`, `getProject`) and the first write to the legacy stores (survey
creation). Row actions, renaming and the real editor come in later steps.

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2).
Run `pnpm install` once. Ports 3000 and 5173 must be free. For part 5 you also need Docker with
Compose, and the ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts (synthetic; in memory mode they come from `MEMORY_SEED=legacy-fixtures`, in Azurite
mode from the replica). In the mock OIDC form of Azurite mode you type the short name.

| Name           | Email                  | Type in the mock OIDC form | Personal, active (newest first)            | Personal, archived | Projects (role)                        |
| -------------- | ---------------------- | -------------------------- | ------------------------------------------ | ------------------ | -------------------------------------- |
| Olivia Owner   | `owner@example.com`    | `owner`                    | API created, Customer feedback, Draft idea | Old poll           | Engineering (user), Marketing (admin)  |
| Adam Admin     | `admin@example.com`    | `admin`                    | none                                       | none               | Engineering (admin), Marketing (admin) |
| Mia Member     | `member@example.com`   | `member`                   | none                                       | none               | Marketing (user)                       |
| Oscar Outsider | `outsider@example.com` | `outsider`                 | Outsider quiz                              | none               | none                                   |
| Erin Erasable  | `erasable@example.com` | `erasable`                 | none (added in Step 12; erasure only)      | none               | none                                   |

Marketing has the active survey "Campaign survey" and the archived "Archived campaign". Engineering
has the active "Engineering retro".

Dates are shown in the US style (`4/14/2026`) in your browser's time zone. The fixture times are in
UTC, so with a time zone far from UTC a date near midnight can be one day off from the dates below.

## 1. The owner's list (checklist 1)

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Olivia Owner** on the "Sign in as…" page.

Expected:

- The page title is **My Surveys**, in the surveyjs.io shell. Below it, at the right, there are a drop-down that reads **Personal Surveys** and a **Create a Survey**
  button; at the left there is an **Active / Archived** switch.
- Three rows, newest updated first, each with the survey name and two dates:

  | Row | Name              | Created     | Updated     |
  | --- | ----------------- | ----------- | ----------- |
  | 1   | API created       | `5/30/2026` | `6/1/2026`  |
  | 2   | Customer feedback | `3/13/2026` | `4/14/2026` |
  | 3   | Draft idea        | `2/1/2026`  | `2/2/2026`  |

  (Hovering a date shows "Created on" or "Updated on".) "Old poll" is not here: it is archived.

- No "Load more" button: the list is short.

## 2. Archived (checklist 2)

Switch to **Archived**.

Expected:

- Only **Old poll** (created `12/10/2025`, updated `5/20/2026`).
- The address is `http://localhost:5173/?archived=true`.
- There is no **Create a Survey** button in the toolbar of this view.

Reload the page: the Archived view stays. Press the browser's Back button: you return to the Active
view at `http://localhost:5173/`.

Open <http://localhost:5173/?project=personal&archived=true> directly: the same Archived view (the
address you give is kept as you typed it).

## 3. Projects (checklist 3)

Switch to **Active** again, open the drop-down and choose **Marketing**.

Expected:

- The address is `http://localhost:5173/?project=55555555-0000-4000-8000-a00000000001`.
- The drop-down reads **Marketing**. One row: **Campaign survey** (created `1/15/2026`, updated
  `6/10/2026`).
- The switch is there: **Archived** shows **Archived campaign** (`12/20/2025`, `3/1/2026`).

The drop-down lists **Personal Surveys**, **Engineering** and **Marketing** (projects by name).
Choose **Engineering**: one row, **Engineering retro** (`2/14/2026`, `7/1/2026`).

Try an unknown project: open
<http://localhost:5173/?project=99999999-9999-4999-8999-999999999999>. Expected: you land on
`http://localhost:5173/`, the Personal Surveys list (the browser console shows one failed request,
the `404` of the unknown project; that is expected).

Sign out (account menu) and sign in as **Oscar Outsider**. Expected: one row, **Outsider quiz**
(`4/1/2026`, `4/2/2026`), and **neither** the project drop-down **nor** the Active/Archived switch:
he has no projects and no archived surveys. Mia Member sees only the personal drop-down entry and **Marketing**,
and her personal list is empty ("No surveys yet" and a Create a Survey button).

## 4. Create a Survey (checklist 4)

Sign in again as **Olivia Owner**. On the Personal Surveys list click **Create a Survey**.

Expected:

- The page changes to `/surveys/<id>/edit`. (Step 4 showed a placeholder here. Since Step 6 it is the
  survey editor, with the name in its bottom bar. On a fresh demo the owner has no active survey named
  `New Survey ...`, so the name is **New Survey 1**.)
- The browser's Back button returns to `/`. **New Survey 1** is at the top of the list, with today's
  date as created and updated.

Click **Create a Survey** again: **New Survey 2** is at the top. Names count only the **active**
surveys of the list: "one more than the highest number". The rule in full is in
[Your surveys](../user-guide/your-surveys.md#create-a-survey).

Create one in a project: choose **Engineering**, click **Create a Survey**. Expected: **New Survey 1**
in Engineering (the numbering is per list), and the browser's Back button returns to the Engineering list.

Check the API answer (with the cookie jar of a signed-in session, see
[Authentication](../api/authentication.md#csrf-the-double-submit-rule); the header is needed because
this request changes data):

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
curl -i -b cookies.txt -X POST -H "X-CSRF-Token: $CSRF" http://localhost:3000/api/v1/surveys
```

Expected: `HTTP/1.1 201 Created`, a `Location: /api/v1/surveys/<id>` header and the survey as JSON
(`"name":"New Survey 3"` after the two you created above, `"projectId":null`, `"published":false`, `"archived":false`,
`"permissions":{"canModify":true}`).

Stop the demo (Ctrl+C). The memory store is gone when the server stops.

## 5. The same on the legacy replica (checklist 5)

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider with the mock OIDC server. Open <http://localhost:5173/> and sign in as
**owner** (type `owner` in the form).

Expected: the same three Active rows and dates as in part 1, the same Archived row, and the same
Marketing and Engineering lists as in part 3. Compare with the inspector in another terminal:

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

Expected: the owner's surveys as in [Step 2](step-02.md#2-inspect-the-legacy-stores), including the
created and updated dates (`2026-05-30T21:00:00.000Z` and so on); the Archived row is the one with
Archived `yes`. The list page shows exactly these, split into Active and Archived.

Click **Create a Survey**. Expected: **New Survey 1** on a fresh replica. This time the survey is
really stored: run the inspector again and the owner's list has a **New Survey 1** row, created just
now. Reload the list page: it is still there. Create another one: **New Survey 2**.

The replica keeps what you create, so the next run of the demo continues the numbering. To go back to the
fixtures, run `pnpm legacy:load` (it reloads the fixtures and removes everything else), or
`pnpm demo:azurite:down` and `pnpm demo:azurite:up`.

Stop the demo with Ctrl+C.

## 6. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. `pnpm e2e` runs the survey list specs in three browsers, including the paging spec
(it creates more than 50 surveys in Engineering and checks that the list loads them all).

With the replica running (`pnpm demo:azurite:up`; stop any demo first, the tests use ports 3000 and 5173):

```sh
pnpm test:providers:azurite
pnpm test:conformance:azurite
pnpm e2e:azurite
```

Expected: all pass. `pnpm e2e:azurite` runs the sign-in and the survey list specs on Chromium. Then:

```sh
pnpm demo:azurite:down
```

## Checklist

| #   | Check                                                                                                                                                                                    | Result |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Signed in as the owner, the list shows API created, Customer feedback and Draft idea, newest updated first, with dates like `4/14/2026`                                                  |        |
| 2   | **Archived** shows only Old poll and the address has `archived=true`; reload and Back keep the view                                                                                      |        |
| 3   | The drop-down switches to Marketing and Engineering and shows their surveys; the address has `project=<id>`                                                                              |        |
| 4   | **Create a Survey** opens the editor named **New Survey 1** (fresh demo; a placeholder in Step 4, the real editor since Step 6); Back shows it at the top of the list                    |        |
| 5   | On the replica (`pnpm demo:azurite`) the lists equal what `pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com` prints; a created survey appears in the inspector |        |
| 6   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green              |        |

## Troubleshooting

- The list says "No surveys yet" for the owner: the server runs without the fixtures. Use
  `pnpm demo` (it sets `MEMORY_SEED=legacy-fixtures`) or `pnpm demo:azurite`.
- In Azurite mode the owner already has New Survey rows, or `e2e` found extra rows: earlier runs left
  data in the replica. Run `pnpm legacy:load`.
- A project address shows Personal Surveys instead: the id is not one of your projects.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 4

- The "…" menu, renaming in the list, Run, Clone, Publish, Archive, Restore and Delete, and hiding by
  permission (`canModify` is returned but not used yet): Step 5.
- Opening a survey from its row, and the real survey editor, definition and theme: Step 6 (a row
  does nothing yet; the editor is a placeholder).
- Creating projects and managing members (the `/projects` page): Step 11, done (see [the Step 11 demo](step-11.md)).
- The legacy `/service/mysurveys` addresses and pixel-level parity: Steps 12 and 13.
- Reading a survey definition over HTTP (`getSurveyDefinition` still answers `501`).
