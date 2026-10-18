# Demo: Step 11, projects and team members

This page lets you check Step 11 without reading code. It takes about thirty minutes (the Azurite part pulls
Docker images on the first run, see [Step 2](step-02.md)). Commands are for Git Bash (or any POSIX shell); in
PowerShell the same commands work, except where a variable is set.

What Step 11 delivers: the **Projects** page at `/projects`. You create a project, add registered users by
email, make them admins and take the rights away, remove them, leave a project, and delete a project. A deleted
project hands its surveys, archived ones too, to its owner. Behind it are the seven operations `createProject`,
`updateProject`, `deleteProject`, `listMembers`, `addMember`, `updateMember` and `removeMember`. With them every
operation of the contract is built except `passwordLogin`, the only one that still answers `501`. The
description for users is [Projects and team members](../user-guide/projects-and-team-members.md). The API side is
[the Step 11 section](../api/README.md#step-11-projects-and-members), and the reasons are in
[ADR 0017](../adr/0017-projects-and-members.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run
`pnpm install` once. Ports 3000 and 5173 must be free. For part 6 you also need Docker with Compose, and the
ports 10000, 10002, 14333 and 18080 on 127.0.0.1. For the checks on the command line you need `curl` and `jq`
(Git Bash has `curl`).

The seed accounts are those of [the Step 5 demo](step-05.md#before-you-start) (in the mock OIDC form of Azurite
mode you type the short name). This demo uses these:

| Name       | Type in the mock OIDC form | Why                                                                      |
| ---------- | -------------------------- | ------------------------------------------------------------------------ |
| Adam Admin | `admin`                    | Creates the project and owns it, creates the survey, removes the project |
| Mia Member | `member`                   | Is added to the project: `member@example.com`                            |

Olivia Owner and Oscar Outsider are not used. **Do not change Marketing or Engineering**: the test suites read
them and their members. Everything that writes is done in the project and the survey you create. In memory mode a
restart resets all data. On the replica the changes stay until `pnpm legacy:load`.

## Start the demo

```sh
pnpm demo
```

Open <http://localhost:5173/> and choose **Adam Admin** on the "Sign in as…" page.

## 1. Create a project (checklist 1)

Open the account menu (your name in the header) and click **Projects**. The page is at `/projects`. Adam belongs to
Marketing and Engineering, so two cards show. Click **Create a Project**, type `Demo project` in "Enter a project
name..." and click **Save**.

Expected: a new card, **Demo project**, first in the list (the cards are sorted by name). Click it to open it. The members are **Adam
Admin** with the badge **Admin**, and nothing else. The card has **Rename** and **Remove** in its header and the
button **Add a New Member**.

(Keep your hands off the cards of Marketing and Engineering: open them to look, never use their buttons.)

## 2. Add a member (checklist 2)

In the card of **Demo project** click **Add a New Member**, type `nobody@example.com` and click **Add**.

Expected: a red line in the card, "nobody@example.com is not a registered surveyjs.io user. Ask them to sign up
first.". Nobody was added.

Now type `member@example.com` and click **Add**. Expected: **Mia Member** appears in the list, without a badge
(a plain member), and the box closes. The same address again gives "member@example.com is already a member of this
project.".

## 3. Make an admin, remove admin rights, the last admin (checklist 3)

On Mia's row click **Make Admin**: the badge **Admin** appears. Click **Remove Admin Rights**: it goes.

Now click **Remove Admin Rights** on **Adam's** row. Expected: "A project must keep at least one admin. Make
another member an admin first." and Adam keeps the badge: the project has no other admin. (The "x" on Adam's own row, which
means leaving, gives the same answer.)

## 4. The surveys of a project and what a member sees (checklist 4)

A plain member sees the surveys of a project but modifies only the ones they created, and admins modify all of them
([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)). So make Mia an admin again first: click **Make
Admin** on her row.

Go to the survey list (**My Surveys** in the header). Click **Create a Survey** (it is in **Personal Surveys**, the
drop-down's first entry; the new survey is **New Survey 1** on a fresh demo). In the editor, click **Single-Line
Input** in the toolbox, wait for **All changes saved**, and go back to the list. Open the "…" menu of the survey and
click **Publish**, then **Run**: in the run tab type an answer and click **Complete**. Note the survey id from the
address (`/s/<survey id>`) if you like.

Back in the list, open the "…" menu, **Move to Project** and click **Demo project**. Confirm the question. The list
now shows the project's surveys, with your survey in it.

Sign out (account menu, **Sign Out**) and sign in as **Mia Member** (or use another browser profile). Expected: the
drop-down next to **Create a Survey** lists **Demo project** and **Marketing** (by name); choosing **Demo project** shows
**New Survey 1**. Because she is an admin, she can open it in the editor (**Edit** in the "…" menu) or use the
pencil to rename the survey to `Shared survey`. (Had she stayed a plain member, the survey would open and run, but
the pencil, **Publish** and the other items that change it would be missing.)

Sign out and sign in as **Adam Admin** again.

## 5. Remove the project, and the survey goes home (checklist 5)

Open **Projects** (account menu), open **Demo project** and click **Remove** in its header. The browser asks:
"Delete this project? Its surveys will move to the project owner's Personal Surveys, or to you if the owner has
left." Click **OK**.

Expected: the card is gone, and the drop-down no longer lists the project. Go to the survey list: **Personal
Surveys** now lists **Shared survey** (or **New Survey 1**), the survey from part 4, still published. Open its "…"
menu and click **View Results**: the Table shows the **one response** from part 4. Nothing was deleted, and the
survey kept its id and its results. (Adam was the owner of the project, so the surveys went to him. Had he left the
project before, they would go to whoever deleted it.)

Sign in as Mia again if you like: she no longer has **Demo project**.

## 6. The same on the legacy replica (the Azurite checks) (checklist 6)

Stop the memory demo (Ctrl+C), then:

```sh
pnpm demo:azurite:up
pnpm demo:azurite
```

The first command starts the replica and the mock sign-in server and loads the fixtures (see
[Step 2](step-02.md#1-start-the-replica) and [Step 3](step-03.md)). The second runs the server on the
`azure-legacy` provider. Open <http://localhost:5173/>, sign in as **admin** (type the short name in the form) and
repeat parts 1 to 5. Between the steps, look at what is stored (the inspector only reads):

```sh
pnpm inspect:legacy --user admin@example.com --env-file docker/azurite.env
pnpm inspect:legacy --user member@example.com --env-file docker/azurite.env
```

Expected:

- After part 1, Adam's report has a line `Project Demo project (<id>, role admin)` before Engineering and Marketing (the report is sorted by project name).
- After part 2, Mia's report has the same project line with `role user`.
- After **Make Admin**, Mia's line says `role admin`; after **Remove Admin Rights**, `role user` (the row is
  changed in place, with no new row).
- After part 4's move, the survey is listed under the project line of both reports, with the same id.
- After part 5's delete, the project line is gone from both reports, and the survey is under Adam's `Personal`,
  with the same id.

`pnpm legacy:load` resets the replica to the fixtures. Stop the demo with Ctrl+C.

## 7. The API view

You need the values of your session cookie and your CSRF cookie: in the browser's developer tools (F12), open
**Application** (Chrome, Edge) or **Storage** (Firefox), **Cookies**, `http://localhost:5173`, and copy the **Value** of
`msid` and of `msid_csrf`. Signed in as Adam:

```sh
API=http://localhost:5173/api/v1
AUTH=(-b "msid=<msid value>; msid_csrf=<csrf value>" -H "X-CSRF-Token: <csrf value>")
curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{"name":"API project"}' "$API/projects" | jq
```

Expected: `201` and a body with `"name": "API project"`, `"role": "admin"`, `"memberCount": 1` and `ownerId`, the id of
Adam (`11111111-0000-4000-8000-a00000000002`). Copy its `id` into `P`, then add a member and list the members:

```sh
P=<the id>
curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{"email":"member@example.com"}' "$API/projects/$P/members" | jq
curl -s -b "msid=<msid value>" "$API/projects/$P/members" | jq
```

Expected: the first answers `201` with Mia (`"role": "user"`); the second lists two members, **Adam Admin** and **Mia
Member**, in the order of their display names. Now the refusals:

```sh
curl -i -X DELETE "${AUTH[@]}" "$API/projects/$P/members/11111111-0000-4000-8000-a00000000002"
curl -i -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d '{"email":"nobody@example.com"}' "$API/projects/$P/members"
```

Expected: the first answers **`409`** with `"code":"last-admin"` (Adam is the only admin; he cannot remove himself);
the second **`404`** with `"code":"user-not-found"`. Without the `X-CSRF-Token` header a write answers `403` with
`"code":"csrf-token-invalid"`, and a user who is not a member of the project gets `404` (try Oscar's cookie). Finally delete your project:

```sh
curl -i -X DELETE "${AUTH[@]}" "$API/projects/$P"
```

Expected: `204 No Content`; the page's card is gone after a reload.

## 8. Tests

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
| 1   | Account menu **Projects**, **Create a Project**: a card "Demo project" that opens to Adam Admin with **Admin**                                                                  |        |
| 2   | **Add a New Member** `member@example.com` gives Mia Member; `nobody@example.com` gives "… is not a registered surveyjs.io user …"                                               |        |
| 3   | **Make Admin** and **Remove Admin Rights** on Mia work; **Remove Admin Rights** on Adam gives "A project must keep at least one admin …"                                        |        |
| 4   | A survey moved into the project shows in Mia's selector under it, and she (an admin) can open it in the editor and rename it                                                    |        |
| 5   | **Remove** and OK: the project is gone, the survey is in Adam's Personal Surveys, and **View Results** shows its one response                                                   |        |
| 6   | On the replica, `pnpm inspect:legacy` shows `Project Demo project (<id>, role admin\|user)`, the role changing, the line gone after the delete, and the survey under `Personal` |        |
| 7   | `curl`: create `201`, add a member `201`, list two members, the last admin `409 last-admin`, an unknown address `404 user-not-found`, delete `204`                              |        |
| 8   | `pnpm test:unit`, `pnpm test:conformance`, `pnpm e2e`, and with the replica `pnpm test:providers:azurite`, `pnpm test:conformance:azurite` and `pnpm e2e:azurite` are green     |        |

## Known differences

- **A role change edits the row in place** (the old site deletes the row and adds a new one). Both sites read the
  same role. In place, the creator's row keeps its id, which marks who created the project.
- **A project can lose its owner.** The owner is the creator while they are a member. If the creator's role is
  changed on the old site, which replaces the row, `ownerId` becomes `null`, and deleting the project then gives
  its surveys to the admin who deletes it.
- **The sole member cannot leave**, even when they are not an admin. They delete the project.
- **Blocked users can be added** to a project, as on the old site (it does not check).
- **The page asks before it removes**: the old site asked a bare "Are you sure?".

## Troubleshooting

- **"Create a Project" is missing.** The editor for a new name is open: save or cancel it first.
- **The drop-down has no "Manage Projects".** It shows only when you belong to a project. Use the account menu's
  **Projects**.
- **"Only project admins can do this."** You are a plain member of that project, or someone removed your admin
  rights. Sign in as Adam, who made the project.
- **A member card says "Could not load the members. Please try again."** The project was deleted or you left it in
  another tab. Reload the page.
- **`curl` answers `401`:** the cookie value is wrong or expired (a session lasts 12 hours). Copy `msid` again.
- **`curl -X POST` or `DELETE` answers `403`:** the `X-CSRF-Token` header must equal the `msid_csrf` cookie, and both
  must be sent.
- `pnpm e2e:azurite` fails with "port already in use": a demo is still running on 3000 or 5173.

## What is not in Step 11

- Inviting people who have no account, a project description, and transferring the ownership of a project.
- The old site's links such as `/manage#manage-mysurveys` (Step 12), and the old page's look (Step 13). The page has
  no sidebar of the old account page.
- Accessibility of the links inside a card's header, and a focus outline for the **Save** and **Add** buttons
  (Step 13).
- `passwordLogin` still answers `501`: it is planned for P1.
