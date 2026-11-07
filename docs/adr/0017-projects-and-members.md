# 17. Projects and members

Date: 2026-10-18

## Status

Accepted. On a self-hosted instance with local accounts, adding an email nobody has used creates a pending member
instead of answering `user-not-found` ([ADR 0029](0029-linking-identities-by-verified-email.md)); the hosted service
still answers as written here. The product owner has not confirmed R2 (the owner is the creator only, and `ownerId` can be `null`), R3 (the role change is written in place), R8
(the sole member cannot leave), R9 (moved surveys keep their creator, and archived surveys move too), R12 (blocked
users can be added), R14 (duplicate names), R22 (the new confirmation and error texts and the Leave Project link),
R23 (the navigation entries) and the hint that an address has no account (US 62); see "To confirm".

## Context

Step 11 builds the project and member operations that the contract already names (`createProject`,
`updateProject`, `deleteProject`, `listMembers`, `addMember`, `updateMember`, `removeMember`) and the
**Projects** page. The plan says what the page does, and leaves open who owns a project when legacy has no owner,
what a role change writes, what happens to the surveys of a deleted project, who may leave, and what the
survey list shows after each write. The current surveyjs.io page answers some of these in ways that do not fit
this application: a plain member cannot leave, every refusal is silent or a `500` page, the delete check ignores
archived surveys and orphans them, the role is any string, a role change deletes the member's row and inserts a
new one without a transaction, and the card of a refused delete is removed from the page anyway. The research
behind the legacy column is in the Step 11 notes; the stores are shared with the legacy site, which keeps
running during the transition ([ADR 0010](0010-writing-to-the-legacy-stores.md)).

Parity with the old site comes first (the project rule). Where a ruling departs from legacy, the tables say so
and the reason is below them.

## Decision

The rulings are numbered R2 to R27 and grouped by topic (R1 was the branch name, and R19 says that Step 11 adds no
dependency and no environment variable). "Keeps" means the legacy behaviour is reproduced; "departs" means it is
not.

### The owner and the receiver of the surveys (R2)

| #   | Question           | Ruling                                                                                                                                                                                                                                                                                  |
| --- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2  | Who owns a project | The **owner is the project's creator while the creator is still a member**. Azure: the user of the `OrganizationUsers` row whose `id` equals the project id. Memory: a stored `creatorId` that still has a membership. `Project.ownerId` is **nullable**: the creator's id, else `null` |

Legacy has no owner: no column, no UI concept; the creator is only the row whose `id` is the project id, until
that member's role changes on the old site. The old inference of `projectFromLegacy` ("else the earliest admin,
else the earliest member") was a guess and is **removed**: it named someone who never created the project, and
a delete would have given them the surveys. Now there is one rule for both providers, and it is the contract's:
deleting a project gives its surveys to `ownerId`, and when that is `null`, to the admin who deletes it
(`createdAt` keeps its rule).

- **A known effect.** A role change of the creator made **on surveyjs.io** replaces the creator's row, so `ownerId`
  becomes `null` and a later delete gives the surveys to the deleting admin. It is documented in the user guide
  and the demo.
- **The receiver guard** (an extension, decided during the plan and accepted): `surveyReceiver` takes the owner
  only when they are a **visible** member of the project. With the definition above this is always so, except for
  an Azure creator row whose user account no longer exists (an orphan, R11); without the guard those surveys would
  move to a deleted account. The observable `Project.ownerId` still names that creator.
- **The memory provider forgets the creator when they are removed** (`creatorId` becomes `null`), so a creator who
  is added again is not the owner again. On Azure the same holds: the re-added row has a new id.
- Making `ownerId` nullable changes the published contract shape. It is unreleased, so the cost is low.
- If this is wrong: the field goes back to an inferred value and the inference comes back.

### Legacy writes (R3 to R9)

| #   | Write         | Legacy                                                                                                                                                                                                                                                     | This application                                                                                                                                                                                                                                                               |
| --- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R3  | Change role   | Deletes the member's row and inserts a new one (a new id, `type` `ORGANIZATION_LEAVE`, `happendat` now), then reads and writes it again; no transaction. A failure between the steps removes the membership, and two demotions together can leave no admin | **Departs.** `UPDATE` of `role` and `timestamp` on the member's row(s), **in place**: `id`, `type`, `happendat` and `name` stay, so the creator marker and `createdAt` survive. One transaction with the last-admin check                                                      |
| R4  | Create        | Two upserts with no transaction (the second one repeats the first); a crash after the first leaves an empty project nobody can see                                                                                                                         | **Keeps the rows, departs on the transaction.** One transaction: `Organizations` (new GUID, `name`, `ORGANIZATION_CREATE`, `happendat` = `timestamp` = now UTC) and the creator's `OrganizationUsers` row (`id` = project id, role `admin`). No audit row (legacy writes none) |
| R5  | Rename        | Rewrites `name`, `type` (`ORGANIZATION_UPDATE`) and `happendat`, so the project's only own timestamp is lost                                                                                                                                               | **Departs.** `UPDATE` of `name` and `timestamp`; `type` and `happendat` stay, so the `createdAt` fallback does not move. The creator row's `name` is not rewritten (nobody reads it)                                                                                           |
| R6  | Add member    | Inserts a row (`ORGANIZATION_JOIN`, a new id, no `name`); the role is `admin` only when the body says exactly `admin`; the email is not trimmed on the server; no check of blocked users                                                                   | **Keeps the row.** One transaction: refuse when the user already has a row (`already-member`), else insert it with the role in lower case. `UPDLOCK, HOLDLOCK` on the project's rows, so two adds cannot both pass                                                             |
| R7  | Remove, leave | Deletes the row by id; a plain member cannot do it at all                                                                                                                                                                                                  | **Departs on who.** One transaction: refuse with `last-admin` (R8), else delete **every** row of the user in the project, duplicates included. Any member can remove themselves                                                                                                |
| R9  | Delete        | Allowed only for an admin, with no **non-archived** survey and the caller as the only member: deletes that row, then the `Organizations` row. A refusal answers `200 {}` with no message; archived surveys are left pointing at the deleted id (orphans)   | **Departs.** One transaction: move every survey of the project, archived ones too, to the receiver (`userid`, `timestamp`; `creatorid` unchanged), delete the member rows, delete the `Organizations` row; then a best-effort `SURVEY_TRANSFER` row for each moved survey      |

Why R3: the old site reads only `role`, so the in-place `UPDATE` shows the same to it, and the creator marker (the
row's id, the only trace of who created the project) and the project's creation time are not lost, as they are
on the old site after any role change of the creator. It also removes the lost-membership window of the
delete-then-insert. The cost if the old site reads more than `role`: one statement to change. This assumption is
one to confirm with the owner, as the known effect of R2 is.

Why R9: legacy's precondition (no surveys, the caller the only member) made deleting a project a clean-up of an
empty one, and the plan (spec, D13) wants a delete that works with surveys and members: the surveys do not go
with the project, they go home. Archived surveys move too, because the old check ignored them and orphaned them
(a bug, not copied). The creator of each moved survey is **not** changed: the contract says the surveys keep their
ids, published state and settings, a normal **Move** sets the mover as creator and the cascade does not, and a
creator keeps the right to modify their survey (ADR 0009). The audit row of a move names the receiver and the
unchanged creator, and leaves `creatorid` out when it is `NULL` (no legacy convention is known). The surveys and the
directory share one SQL database ([layout, 2.2](../architecture/legacy-data-layout.md)), so one transaction
covers the move, the member rows and the project row; the memory provider does the same in one synchronous step.
Cost if wrong: the creator semantics of moved surveys.

Why R4 to R7 as transactions: they are the first SQL transactions in the repository. The legacy writer has no
transaction at all, and one operation of three or four statements could stop half way. The details (lock order,
the retry of a deadlock victim, the order of a delete) are in
[ADR 0010, Step 11](0010-writing-to-the-legacy-stores.md#step-11-projects-and-members).

### Rules (R8, R11, R12)

| #   | Question       | Ruling                                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8  | The last admin | Counted over the project's admins **whose user exists** (the members `listMembers` shows), the role compared without regard to case. Refused with `409 last-admin`: demoting the only admin, removing them, or their leaving. **The sole member cannot leave** (`last-admin`): they delete the project. Setting the role a member already has is a `200` that writes nothing |
| R11 | Orphans        | A membership row whose user is missing is skipped by `listMembers`, still counted in `memberCount` (the Step 4 rule), and not counted as an admin. `updateMember` and `removeMember` on such a user are `404 not-found`: not visible, not addressable                                                                                                                        |
| R12 | Blocked users  | A blocked user can be added to a project. Legacy has no such check. Cost if wrong: one check                                                                                                                                                                                                                                                                                 |

R8 is a pure function in `server/src/projects/rules.ts` (`decideRoleChange`, `decideRemoval`), decided from the
member list and unit-tested, and **each store enforces it again, atomically** (`UPDLOCK, HOLDLOCK` in SQL; the
memory provider is synchronous): the service checks first for the answer, and the store decides for the write, so
two admins who demote each other at the same moment cannot leave the project without an admin. Legacy had the
rule only partly: it refused removing or demoting the only admin, with a case-sensitive role compare on one side
and a case-insensitive one on the other, and it left a sole admin no way out except deleting.

Two decisions go beyond the letter of R8 and were accepted during the work:

- **The sole member cannot be removed even when they are not an admin** (`decideRemoval`). R8 calls the sole member
  "necessarily the last admin", but legacy data can hold a project with no admin at all. Refusing keeps a
  project from losing its last member, and its surveys their last viewer. Cost if wrong: one condition and a test.
- **Duplicate membership rows.** A user is an admin when **any** of their rows is admin; a role change rewrites
  every row of the user; a role change is "unchanged" only when every row already has the role; a removal deletes
  every row.

### HTTP (R13 to R18)

| #   | Question          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R13 | Permissions       | An unknown project, or a caller who is not a member: `404 not-found` for **every** project and member operation (as `getProject`). A member who is not an admin: `403 forbidden` for rename, delete, add, change role and removing someone else. Any member may list the members and remove themselves. A target who is not a member: `404`. Creating a project: any signed-in user                                                                         |
| R14 | Names             | Validated like survey names: blank after trimming is `422` with the pointer `/name`; the length is the contract's 1 to 128. The name is stored as sent. **Duplicates are allowed**                                                                                                                                                                                                                                                                          |
| R15 | Add and create    | The email lookup is case-insensitive; `role` defaults to `user`; an unknown address is `404 user-not-found`; a member already in is `409 already-member`. `addMember` answers `201`, the `Member` and `Location: /api/v1/projects/{id}/members/{userId}`. `createProject` answers `201`, `Location: /api/v1/projects/{id}` and a project with `role: admin`, `memberCount: 1` and `ownerId` the creator                                                     |
| R16 | Members list      | Ordered by display name ignoring case, then user id, and paged in memory with a new cursor kind **bound to its project**: a project or a survey cursor is `400`. Ids are lower case                                                                                                                                                                                                                                                                         |
| R17 | Contract changes  | C1 `400` on the seven operations; C2 `Project.ownerId` nullable, with the owner rule; C3 the `listMembers` description (any member, the order, `404` for others); C4 `deleteProject` made precise (archived surveys too, the receiver, the creator unchanged); C5 `updateMember` and `removeMember` mention leaving and the sole member. All in one task, with their conformance tests and the generated types                                              |
| R18 | The `501` example | After Step 11 only `passwordLogin` (public, P1) answers `501`. The server test of an operation without a handler builds the routes with no handler at all instead of using a live unbuilt operation; the merge-patch test uses `updateProject`; conformance drops its authenticated-`501` test and keeps the one for `passwordLogin`. [ADR 0016](0016-results-details-exports-and-public-results.md) named `listMembers` as the example and now points here |

The service checks, in this order: a given name (`422`, before access, as survey names are); the caller's
membership (`404`); the admin right (`403`); then the data (the email lookup, the target, the last-admin rule).
Two consequences were chosen on purpose. **The admin check comes before the email lookup**, so only admins of a
project can learn whether an address is registered (the enumeration hint of US 62 is limited to them, not removed:
see "To confirm"). **The members cursor is decoded after the membership check**, so a non-member always gets `404`
and never learns whether a cursor was valid. A patch that has no `name` changes nothing and answers the project.
`updateMember` answers the `Member` after the change; its target is looked up with the Directory, so a missing
account is `404`.

The titles and details of the problems `forbidden`, `user-not-found`, `already-member` and `last-admin` are ours
(the contract names the codes); the UI does not show them, it maps the codes to its own texts (R22). The wording
of C2 to C5 is ours too; C2 also mentions "a role change made in another application", the known effect of R2,
without naming surveyjs.io.

The legacy `addUserToOrganization` echoed the email as typed and revealed whether an address is registered by a
message; the contract's `user-not-found` does the same, and D14 keeps the legacy text for the UI. It is
the enumeration hint of US 62, and the owner may want it hidden.

### The web (R20 to R24)

| #   | Question          | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R20 | Route and shell   | `/projects` under `_private`, rendered in the configured shell. The heading **Projects** (an `h1`, as the survey list's), then the legacy intro with its link to `/` in the app                                                                                                                                                                                                                                                                                             |
| R21 | Markup and styles | Copied from surveyjs.io (D14): `the site's page markup` (markup and class names), `projects.scss`, the icons `Add` and `Remove`, and the account-page SCSS the classes need. Recorded in `web/src/shell/surveyjs-site/assets/README.md`, with a "Step 11 added these copies" table. `C:\Work\surveyjs\` stays forbidden                                                                                                                                                     |
| R22 | Page behaviour    | `<details>` cards, closed at first, members read when a card opens. Admins: **Rename**, **Remove**, **Add a New Member** (email only, role `user`), **Make Admin** / **Remove Admin Rights** and the "x". Plain members: the members read only and a **new** **Leave Project** link. **Create a Project** card with **Save** / **Cancel**. Confirmations (`window.confirm`) and inline errors (`role="alert"` in the card) with **new texts**. Mutations are not optimistic |
| R23 | Navigation        | New: an in-app **Projects** item (a router link, not `siteUrl`) in the account menu of both shells, and **Manage Projects** at the end of the survey list's project drop-down                                                                                                                                                                                                                                                                                               |
| R24 | Refresh rules     | Project writes invalidate the project queries; deleting and leaving drop the project's survey queries; deleting refreshes the personal lists. Pure cache functions with unit tests                                                                                                                                                                                                                                                                                          |

The new texts (legacy shows a bare "Are you sure?", no message, or an `alert()`), all in `web/src/projects/messages.ts`:

| When              | Text                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Delete a project  | "Delete this project? Its surveys will move to the project owner's Personal Surveys, or to you if the owner has left." |
| Remove a member   | "Remove {name} from this project?"                                                                                     |
| Leave             | "Leave this project? You will lose access to its surveys."                                                             |
| `user-not-found`  | "{email} is not a registered surveyjs.io user. Ask them to sign up first." (the demo looks for "not a registered")     |
| `already-member`  | "{email} is already a member of this project."                                                                         |
| `last-admin`      | "A project must keep at least one admin. Make another member an admin first."                                          |
| `403`             | "Only project admins can do this."                                                                                     |
| `422` on a name   | "Enter a project name."                                                                                                |
| Any other failure | "Could not {verb}. Please try again."                                                                                  |

R24 in detail (the reading accepted during the work): **every project or member write invalidates `["projects"]`**,
not only the member's own queries, because the project list carries the viewer's `role` and the `memberCount`,
which member writes change: an admin who demotes themselves must lose their admin controls. `projectKeys.members`
sits under `["projects"]` for that reason. **Leaving and deleting read the list again before they drop the
project's queries**, so an open card never refetches its members into a `404`. A deletion also invalidates the
cached survey details, because their `projectId` changed. A `404 not-found` answer to any action also reads the list
again.

Details that R22 leaves open, decided in the work:

- A card is a controlled `<details>` that the summary click toggles (jsdom does not activate summaries); the links
  in the summary do not toggle it; an error opens its card. An admin's own "x" uses the leave confirmation and
  counts as leaving. **Create a Project** hides only while the create editor is open. **Rename**, **Remove** and
  **Leave Project** exist twice in the markup, as in the legacy page, for the mobile layout.
- New texts: "Loading the members…" and "Could not load the members. Please try again."; the `aria-label`s `Project
name`, `New member's email` and `Remove {name}`.
- **No client-side last-admin hint.** The pills and the "x" stay, and the `409` text shows: R22 says the page shows
  the server's answer, and the demo needs the refusal to be visible.
- `addMember` sends `role: "user"` explicitly, because `@default user` makes `role` required in the generated type.
- The shells get an optional `projectsLink` (`href` and `navigate`) instead of importing the router, so their unit
  tests keep rendering without one. **Projects** sits right after **Settings**; **Manage Projects** has no
  separator.
- The two copied account SCSS files come whole (the mixin, the footer, the mobile toggles, the add-assignment
  button), as earlier copies did, and add unused account-page rules, including a global
  `[data-details-edit-mode] { display: none }` that nothing in the app uses. The legacy styles have no rule that
  hides the member actions until hover, so the pills and the "x" are always visible.

### Tests and data (R25 to R27)

| #   | Question         | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R25 | Shared data      | Marketing, Engineering and every fixture membership are **read only** for Step 11 tests. Every project or member test creates its own uniquely named project as Adam Admin (or another fixture user when needed) and deletes it at the end, also when it fails. Only the five fixture users can be members on Azurite (a foreign key); Oscar Outsider is never added. Surveys that a deletion moves land in Adam's Personal scope. Assertions about the list of a fixture user are **membership based** (the fixture projects are present, in order), never exact |
| R26 | End-to-end       | Kept to a minimum (a user preference): only the e2e task runs Playwright, its new spec (`projects.spec.ts`) and any existing spec it had to change. The spec adds **Mia** only                                                                                                                                                                                                                                                                                                                                                                                    |
| R27 | `inspect:legacy` | Not changed. Run for each user it already shows a project's line with the role, a changed role, the moved surveys and the deleted project's absence. The demo uses it that way                                                                                                                                                                                                                                                                                                                                                                                    |

R25 was extended in the work to the provider suite and the null-rows Azurite test: their exact `listUserProjects`
expectations go through `fixtureProjectsOnly`, because a crashed run can leave test projects of the fixture users
on the replica. The conformance tests are split into `project-writes.test.ts` and `members.test.ts` (Vitest runs
files in parallel). Both delete tests make **Adam** the receiver (Mia deletes Adam's project; in the fallback Mia
creates it, adds Adam as admin, leaves, and Adam deletes it), so no survey lands in Olivia's fixture-only scope or in
Mia's. Task 6's scenarios carry the user-story labels US 59, 61, 62, 63 and 65 (create, add, promote, demote,
remove), US 64 (the last admin), US 66 (leave) and US 67 (delete); the plan's labels were off by one.

### Beyond the plan: the retry of a deadlock victim

The Azure transaction helper (`inTransaction` in `writes.ts`) **runs a transaction again when SQL Server chose it
as the deadlock victim** (error 1205): at most **3 tries** in all, after a short jittered wait, **never after a
failed commit** (its outcome is unknown) and **never for any other error**. The reason is a measurement: about 6 of
160 writes under parallel load were deadlock victims, between writes to **different** projects, because the
`OrganizationUsers` table of the replica is tiny and the engine scans it, so the locks of writes to different
projects can still collide, although the lock order within one project is fixed. The bodies of the transactions
have no effect outside the transaction, so a retry is safe. If this is wrong, it is a loop to remove. Details are in
[ADR 0010, Step 11](0010-writing-to-the-legacy-stores.md#step-11-projects-and-members).

Two smaller decisions of the plan: the plan's first task put a cast (`ownerId: project.ownerId as string`) in the
JSON mapping, because the domain became nullable before the contract change could (R17 keeps all the contract
changes in one task), and a later task removed it; and the store interface's names and string outcomes
(`listMembers`, `createProject`, `renameProject`, `deleteProject`, `addMember`, `setMemberRole`, `removeMember`;
`NewProject`, `ProjectMember`) are the plan writer's, as R10 left them open. `deleteProject` returns the moved
survey ids, sorted, because the order of an SQL `OUTPUT` is arbitrary.

## Consequences

- A project can be deleted at any time by an admin. Its surveys survive, with their results, files and history, and
  the receiver (the owner, or the deleting admin) finds them in their Personal Surveys at once.
- A user who is not an admin can leave a project, and a project cannot lose its last admin or its last member
  through this application, also under concurrent requests.
- A project can have **no owner**: after its creator leaves, or after the creator's role was changed on the old
  site. The receiver of its surveys is then whoever deletes it. `ownerId` can be `null`, and clients must handle it.
- The old site reads the same rows and sees the changes after a reload; a role changed here keeps its row id.
  The reverse holds too: a project or member created on the old site shows here.
- The write paths run the first SQL transactions of the repository, with a retry for a deadlock victim. A mistake
  in a body would leave a lock until the pool times out, so every failure path rolls back and the concurrency tests
  stay in the Azurite suite. If they turn out flaky, the locks are to be investigated, not weakened.
- `datetime` rounds the `createdAt` of a new project to about 3 ms on Azure. The service answers the value it
  reads back, so one answer is consistent, but the memory and Azure providers differ in the last digit.
- `Member.email` is `format: email`; a legacy user with a NULL email (mapped to `""`) would make `listMembers`
  non-conforming. No fixture has one.
- The admin check is the only protection against probing for registered addresses (see "To confirm").

## To confirm

These rulings are decisions of the team, not of the product owner. Until the owner confirms them, they stand as
written.

- **R2: a nullable owner that is the creator only.** The owner may prefer an inferred owner (the earliest admin), a
  stored one, or a transfer of ownership. Costs if changed: the contract field and its tests, and the receiver of a
  delete.
- **R8: the sole member cannot leave.** A project always keeps a member and an admin; the sole member deletes the
  project. The owner may prefer that a sole member can leave and the project be removed with them, or that a
  project may have no admin.
- **R9: moved surveys keep their creator, and archived surveys move too.** The owner may want the receiver to be the
  creator of each moved survey (as a normal **Move** does), or the archived surveys to be deleted.
- **R12: blocked users can be added.** Legacy has no check. The owner may want a refusal.
- **R14: duplicate project names are allowed.** Legacy allows them.
- **R22: new confirmation and error texts, and the Leave Project link.** The old page asks a bare "Are you sure?" and
  shows nothing on a refusal; a plain member had no way to leave.
- **R23: navigation entries.** The account-menu **Projects** item and the drop-down's **Manage Projects**, which the
  old site does not have (it reaches the section from the account page's sidebar, and My Surveys has no link to it).
- **The hint that an address has no account (US 62).** "… is not a registered surveyjs.io user …" tells an admin
  whether an address is registered. The legacy page does the same. The owner may want a neutral answer.
- **R3: the in-place role change.** It assumes that the old site reads only `role`. The owner (or the site team)
  may want to confirm that no legacy reader depends on the replaced row.

## Open

- **The receiver of a deleted project's surveys is chosen before the delete transaction takes its lock**
  (`server/src/projects/service.ts`: `listMembers` and `surveyReceiver`, then `deleteProject`). If the owner leaves
  in that window, the surveys go to a user who just left. A fix would pass the owner and the deleting user to the
  store and decide under the lock.
- **On Azure, a member whose only rows have a role other than `admin` or `user` (or NULL) is hidden by
  `listMembers`** but still counted by the rules (`visibleMembersOf`) for "sole member" and as a target of a role
  change or a removal. The memory provider cannot hold such rows. A fix would make visibility require a known role.
- **A survey created or moved into a project can race a delete of that project on Azure.** Under `READ COMMITTED` a
  survey inserted while the delete runs would keep the deleted project id and be orphaned. The memory provider
  does both in one step. Open: carried to the hosted-migration track, with the scan cost of the other large tables
  (to measure later).
- **Accessibility of the links inside `<summary>`** (Rename, Remove, Leave Project): a link inside a summary is
  awkward for keyboard and screen-reader users. Step 13.
- **The focus outline of Save and Add** is removed by the copied account styles (`account/index.scss`). A
  `:focus-visible` rule is to be added in Step 13. The card's summary has a focus outline of its own.
- **The desktop account drop-down stays open** after the in-app **Projects** click (the menu item's focus and hover
  handling). Step 13.
- **The `SURVEY_TRANSFER` rows are appended one after the other**, so a slow audit table stretches a delete. A
  batch, if it matters.
- **`projectKeys.members` lower-cases the project id, and the other keys do not**, so a mixed-case id could miss a
  removal. Ids come from the server in lower case.
- **Step 12:** account erasure may promote a member to admin and bypasses the last-admin refusal, because the
  erased user has to leave ([ADR 0018](0018-accounts-by-deployment-mode.md)).
- **Legacy `/manage#manage-mysurveys` links** do not reach the page: the surveyjs.io site links the section to
  `/projects` ([the redirect map](../operations/surveyjs-redirects.md)). A project **description**, invitations of
  unregistered users and a transfer of ownership are not built.
