# Demo: Step 5, survey actions (the "…" menu)

This page lets you check Step 5 without reading code. It takes about thirty minutes (the Azurite
part pulls Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or
any POSIX shell); in PowerShell the same commands work, except where a variable is set.

What Step 5 delivers: every action of the row menu on the My Surveys page. You can **rename** a
survey in place, **Run**, **Clone**, **Publish** and **Unpublish**, copy the three **IDs**, **Move to
Project** (and back to Personal Surveys), **Archive**, **Restore** and **Delete**. Items that change a
survey are hidden from a user who cannot modify it. Behind it are three API operations
(`updateSurvey`, `deleteSurvey`, `cloneSurvey`) and three legacy writes (update, clone and delete).
The pages that Edit, View Results, View History and Run open are placeholders. The full description for
users is [Managing a survey](../user-guide/managing-a-survey.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2).
Run `pnpm install` once. Ports 3000 and 5173 must be free. For part 8 you also need Docker with
Compose, and the ports 10000, 10002, 14333 and 18080 on 127.0.0.1.

The seed accounts are those of [the Step 4 demo](step-04.md#before-you-start) (in the mock OIDC form of
Azurite mode you type the short name). What matters in this demo is who **can modify** what:

| Name           | Type in the mock OIDC form | Can modify                                           | Cannot modify (sees it)                                  |
| -------------- | -------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Olivia Owner   | `owner`                    | Her Personal surveys; Marketing's (she is its admin) | **Engineering retro** (created by Adam; she is a member) |
| Adam Admin     | `admin`                    | Everything in Engineering and Marketing              | Nothing                                                  |
| Mia Member     | `member`                   | **Campaign survey** (she created it)                 | **Archived campaign** (created by Olivia)                |
| Oscar Outsider | `outsider`                 | His Personal survey                                  | Nothing                                                  |

Olivia's Personal surveys: API created, Customer feedback (published), Draft idea, and the archived
Old poll. Marketing has Campaign survey (published) and the archived Archived campaign. Engineering
has Engineering retro (not published).

**Try things on surveys you create.** Parts 1 to 6 act on a survey that you create with **Create a
Survey** (it is named **New Survey 1** on a fresh demo), so the fixture surveys stay as they are. In
memory mode a restart resets everything. On the replica the changes stay until `pnpm legacy:load`.

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/>, choose **Olivia Owner** on the "Sign in as…" page, and click **Create a
Survey**. On the editor page that opens, click **Back to My Surveys**. **New Survey 1** is at the top of
the list.

Each row has a pencil next to its name and three dots at its right end.

## 1. Rename (checklist 1)

Click the **pencil** next to **New Survey 1**. The name turns into a text box with the text selected,
with **Save** and **Cancel**.

- Type `Pilot` and press **Esc**. Expected: the box closes and the name is still **New Survey 1**.
- Click the pencil again, type `Pilot`, press **Enter**. Expected: the name is **Pilot** at once, and
  the row is still at the top.
- Reload the page. Expected: **Pilot** is still there.

Also check (they send nothing): open the box, clear the text and press Enter, or press Enter without
changing the name. Expected: the box closes and the name is unchanged.

## 2. Publish, Run and Unpublish (checklist 2)

Open the three dots of **Pilot**. Expected: **Edit**, **Clone**, a separator, **Publish**, a separator,
**Survey IDs**, **View Results**, **View History**, a separator, **Move to Project** and **Archive**.
There is no **Run**: the survey is not published.

Click **Publish**. Expected: the menu closes. Open it again: **Run** is the first item and **Publish**
has become **Unpublish**.

Click **Run**. Expected: a new tab opens at `http://localhost:5173/s/<survey id>` with the heading
**Survey** and the text "The survey run page arrives in a later version." (a placeholder until Step 8;
it needs no sign-in). Close the tab.

Open the menu and click **Unpublish**. Open it again: **Run** is gone.

## 3. Clone (checklist 3)

Click **Publish** once more (so the original is published), then open the menu and click **Clone**.

Expected: a new row **Copy of Pilot** appears at the top of the list, and the original **Pilot** is
below it. Open the menu of **Copy of Pilot**: there is no **Run**, so the copy is **not published**,
although the original is. (The copy has no definition because the original has none yet: a survey made
with Create a Survey is empty until the editor exists. The clone of **Customer feedback**, which has a
definition and a theme, carries both over; the provider tests check that.)

## 4. Copy the IDs (checklist 4)

Open the menu of **Pilot**, hover over **Survey IDs** (or click it), and click **Copy ID**. Open the
address `http://localhost:5173/api/v1/surveys/` in a new tab and paste the ID after the last slash.

Expected: the JSON of the survey (`"name":"Pilot"`, and the `id` you pasted). Keep it in view.

Go back, open **Survey IDs** again and click **Copy Result ID**; paste it somewhere you can read (the
address bar is fine) and compare it with `resultId` in the JSON. Do the same with **Copy Post ID** and
`postId`. Expected: each pasted value is equal to the one in the JSON, and the three are different.

## 5. Move to a project and back (checklist 5)

Open the menu of **Pilot** and hover over **Move to Project**. Expected: **Personal Surveys** (marked, it
is the current place) and, by name, **Engineering** and **Marketing**.

Click **Engineering**. Expected: the browser asks "Do you want to move this survey to another
organization? This operation can't be undone." Click **Cancel**: nothing changes. Do it again and click
**OK**.

Expected: the page opens the Engineering list (`/?project=55555555-0000-4000-8000-a00000000002`) and
**Pilot** is at its top, next to **Engineering retro**. The Personal list no longer has it.

In Engineering, open the menu of **Pilot**, hover over **Move to Project**: **Engineering** is now the
marked one. Click **Personal Surveys**, confirm with **OK**. Expected: the page opens
`http://localhost:5173/` and **Pilot** is back in Personal Surveys.

(After a move you are the survey's creator, so you could modify it in Engineering even though you are
not an admin there.)

## 6. Archive, Restore and Delete (checklist 6)

Open the menu of **Pilot** and click **Archive**. Expected: **Pilot** leaves the Active list. The
**Active / Archived** switch is there (it was already, because of **Old poll**). Switch to **Archived**:
**Pilot** is listed at the top, with **Old poll**, and has no pencil.

Open its menu. Expected, in this order: **Clone**, a separator, **View Results**, a separator,
**Delete**, **Restore**.

Click **Restore**. Expected: **Pilot** leaves Archived, and the Active list has it at the top. Archive it
again, switch to Archived and click **Delete**. Expected: the browser asks "Do you really want to delete
this survey? This operation can't be undone." Click **Cancel**: it stays. Click **Delete** again and
**OK**: **Pilot** is gone from the list for good. Reload to be sure.

The other survey, **Copy of Pilot**, is still in the Active list. Archive and delete it the same way if
you like.

## 7. A member without modify rights (checklist 7)

Sign out (account menu) and sign in as **Mia Member**. In the project selector choose **Marketing**.

- **Campaign survey** (she created it): the pencil shows, and the menu has **Run**, **Edit**, **Clone**,
  **Unpublish**, **Survey IDs**, **View Results**, **View History**, **Move to Project** and **Archive**.
- Switch to **Archived**. **Archived campaign** (created by Olivia) has no pencil, and its menu has
  **Clone** and **View Results** only: no **Restore**, no **Delete**.

Sign out and sign in as **Olivia Owner**. In the selector choose **Engineering**. **Engineering retro**
(created by Adam) has no pencil, and its menu has **Edit**, **Clone**, **Survey IDs**, **View Results**
and **View History**: no **Publish**, no **Move to Project**, no **Archive**.

The server refuses the same changes. With the cookie jar of a signed-in Olivia (see
[the Step 3 demo](step-03.md#3-sign-out); the CSRF header is described in
[Authentication](../api/authentication.md#csrf-the-double-submit-rule)):

```sh
CSRF=$(awk '$6=="msid_csrf"{print $7}' cookies.txt)
curl -i -b cookies.txt -X PATCH http://localhost:3000/api/v1/surveys/22222222-0000-4000-8000-a00000000006 \
  -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/merge-patch+json" -d '{"name":"x"}'
```

Expected: `HTTP/1.1 403 Forbidden` and `"code":"forbidden"`. The request changed nothing. More `curl`
examples (rename, publish, move, settings, clone, delete) are in
[API: Step 5](../api/README.md#step-5-survey-actions).

Stop the demo (Ctrl+C). The memory store is gone when the server stops.

## 8. The same on the legacy replica

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider with the mock OIDC server. Open <http://localhost:5173/> and sign in as
**owner** (type `owner` in the form).

Repeat parts 1, 2, 3, 5 and 6 with a **Create a Survey** survey. After each action, look at the stored
data in another terminal:

```sh
pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com
```

Expected, after each step:

| After                         | The inspector shows                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Rename to `Pilot`             | The row has the name `Pilot`, and the updated date is now                           |
| Publish                       | Published `yes` for `Pilot` (and `no` again after Unpublish)                        |
| Clone                         | A second row `Copy of Pilot`, Published `no`, created now                           |
| Move to Engineering           | `Pilot` is gone from the owner's personal table and is in the **Engineering** table |
| Move back to Personal Surveys | `Pilot` is in the personal table again                                              |
| Archive                       | Archived `yes` for `Pilot`; **Restore** gives `no` again                            |
| Delete                        | No row `Pilot` any more                                                             |

Clone a fixture survey too: **Copy of Customer feedback** is a new, unpublished row. The inspector does
not print definitions or themes; the provider tests check that the copy has the source's, byte for byte.

The replica keeps what you do, so the next run continues from there. To go back to the fixtures, run
`pnpm legacy:load` (it reloads the fixtures and removes everything else), or `pnpm demo:azurite:down`
and `pnpm demo:azurite:up`.

Stop the demo with Ctrl+C.

## 9. Tests

```sh
pnpm test:unit
pnpm test:conformance
pnpm e2e
```

Expected: all pass. `pnpm e2e` runs the survey actions spec in three browsers (one scenario for each
menu item, the inline rename, and the two views without modify rights).

With the replica running (`pnpm demo:azurite:up`; stop any demo first, the tests use ports 3000 and 5173):

```sh
pnpm test:providers:azurite
pnpm test:conformance:azurite
pnpm e2e:azurite
```

Expected: all pass. `pnpm e2e:azurite` runs the sign-in, survey list and survey actions specs on
Chromium. Then:

```sh
pnpm demo:azurite:down
```

## Checklist

| #   | Check                                                                                                                                                                       | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | The pencil renames a survey in place: Esc cancels, Enter saves, and the new name is there after a reload                                                                    |        |
| 2   | Publish adds **Run** to the menu, and Run opens `/s/<id>` in a new tab; Unpublish removes **Run**                                                                           |        |
| 3   | Clone adds **Copy of ...** at the top, unpublished                                                                                                                          |        |
| 4   | **Copy ID**, **Copy Result ID** and **Copy Post ID** paste the `id`, `resultId` and `postId` of the survey                                                                  |        |
| 5   | Move to Engineering (confirmed) opens the Engineering list with the survey; Move to Personal Surveys (confirmed) brings it back                                             |        |
| 6   | Archive moves the survey to Archived; Restore brings it back; archived again, Delete (confirmed) removes it for good                                                        |        |
| 7   | Mia on Archived campaign, and Olivia on Engineering retro, see no modifying items; the API answers `403` for a change                                                       |        |
| 8   | On the replica (`pnpm demo:azurite`) each action shows in `pnpm inspect:legacy --env-file docker/azurite.env --user owner@example.com`                                      |        |
| 9   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green |        |

## Troubleshooting

- The pencil or the modifying items are missing: you cannot modify that survey (see the table at the
  top), or you are in the Archived view (no pencil there).
- The menu does nothing on a click: click the three dots themselves. Esc closes a menu; one menu is open
  at a time.
- The last menu items are hidden under the cookie banner or the footer on a small window: make the
  window taller, or answer the cookie banner first. (Known; Step 13 settles it.)
- **Copy ID** does nothing: the browser blocked the clipboard. The page then says "Could not copy to the
  clipboard.". Use `localhost` (not an IP address) and allow clipboard access.
- **Delete** is not in the menu: it is only in the Archived view.
- In Azurite mode the owner has surveys from earlier runs: run `pnpm legacy:load`.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 5

- The real editor, and opening a survey from its row: Step 6. **Edit**, **View History**, **View
  Results** and **Run** open placeholders until Steps 6, 9 and 8.
- Changing the survey settings ("Grant Access", "Save Respondent IP") in the page: Step 10. The API
  supports them now (`PATCH` with `settings`).
- Deleting files with a survey: Step 7 (there is no file store yet).
- Creating projects and members: Step 11.
