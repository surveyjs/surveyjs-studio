# Projects and team members

A **project** is a shared place for surveys. Every member of a project sees its surveys, and admins manage the
project and its members. You create and manage projects on the **Projects** page. It works like the project
section of surveyjs.io, with the differences listed on this page. The survey list and its drop-down are
described in [Your surveys](your-surveys.md).

## Open the page

The address is `/projects`. There are two ways in:

- the account menu (your name in the header): **Projects**, right after **Settings**. You always have it, also
  when you belong to no project yet;
- the drop-down next to **Create a Survey** in the survey list: **Manage Projects**, the last item. The
  drop-down shows only when you belong to at least one project.

The page has the heading **Projects**, a short text, a card for each project you belong to (by name, ignoring
case) and the button **Create a Project**. A card is closed at first. Click it to open it: its members load
then, with the text "Loading the members…" while they do.

## Create, rename and delete a project

Any signed-in user can create a project. Renaming and deleting are for the admins of the project.

| To               | Do                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a project | Click **Create a Project**, type a name in "Enter a project name...", click **Save** (or press Enter). **Cancel** closes the box. You become its first member and its admin                               |
| Rename a project | Click **Rename** in the card's header (admins only), change the name, **Save**                                                                                                                            |
| Delete a project | Click **Remove** in the card's header (admins only). The browser asks "Delete this project? Its surveys will move to the project owner's Personal Surveys, or to you if the owner has left." Click **OK** |

- A name must not be empty or only spaces: the page says "Enter a project name.". It has at most 128 characters.
  Two projects may have the same name.
- **The owner** of a project is the user who created it, as long as they are still a member.
- **Deleting a project does not delete its surveys.** All of them, **archived ones too**, move to the Personal
  Surveys of the **owner**, or to **yours** when the owner has left the project. They keep their ids, their
  published state, their settings, their results, their files and their history, and each survey keeps its
  creator. Nothing else is deleted. Everyone else in the project loses access to them.
- A project can be deleted while it has surveys and other members. The old site refused that (and left archived
  surveys behind); this page does not.

## Members

Open a card to see its members. Each row shows the display name, and an **Admin** badge for admins.

| Who you are                  | What you see and can do                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| An admin                     | **Rename** and **Remove** in the header, **Add a New Member**, and on every member row **Make Admin** or **Remove Admin Rights** and an "x" |
| A member who is not an admin | The members, read only, and the link **Leave Project** in the header                                                                        |

### Add a member

1. Click **Add a New Member** in the card.
2. Type the email address of the new member in "Enter the new member's email..." and click **Add** (or press
   Enter).

The person must **already be registered** at surveyjs.io. They join as a plain member, and the card shows them at
once. You cannot invite someone who has no account. The answers on the page:

- "{email} is not a registered surveyjs.io user. Ask them to sign up first." (the address is not known);
- "{email} is already a member of this project.".

The first message tells an admin that an address has no account. Only project admins can get it, but an admin
can try any address (the old site did the same).

### Make an admin, remove admin rights

Click **Make Admin** on a member's row to make them an admin (the badge appears). Click **Remove Admin Rights** to
make them a plain member again. Admins can do both for any member, themselves included, as long as the project
keeps an admin.

### Remove a member

Click the "x" on a member's row. The browser asks "Remove {name} from this project?". The person loses access to
the project's surveys. The surveys stay in the project, and each keeps the creator it had.

## Leave a project

- **A member who is not an admin** clicks **Leave Project** in the card's header. The browser asks "Leave this
  project? You will lose access to its surveys." The old site had no way for such a member to leave.
- **An admin** leaves with the "x" on their own row. The page asks the same question, and the card goes after.

**A project must keep at least one admin**, and it must keep a member. So these are refused with "A project must
keep at least one admin. Make another member an admin first.":

- removing or demoting the **last admin**, also when the admin does it to themselves;
- leaving, when you are the **only member** of the project.

To leave as the last admin, first make someone else an admin. If you are the only member, **delete the project**
instead (**Remove**).

Other answers: "Only project admins can do this." when you are not an admin any more (for example someone removed
your admin rights while the page was open), and "Could not …. Please try again." for a failure of any other kind.
When a project is gone, or you are no longer in it, the page reads the list again and the card disappears.

## What members can do with the surveys of a project

The rule is the one of [Managing a survey](managing-a-survey.md#who-can-do-what), which follows the old site
([ADR 0009](../adr/0009-survey-permissions-follow-legacy.md)):

| Member         | Sees every survey of the project | Modifies                    |
| -------------- | -------------------------------- | --------------------------- |
| A plain member | Yes                              | The surveys they created    |
| An admin       | Yes                              | Every survey of the project |

To put a survey into a project, use **Move to Project** in its "…" menu, or choose the project in the drop-down
before **Create a Survey**. A survey that someone else created in the project can be opened, cloned, run and its
results read by every member, but only its creator and the admins can change it.

## Shared with surveyjs.io

Projects and members are stored in the same place as on the old site, which keeps running. A project you create
here shows on the **Settings** page of surveyjs.io, and a project or a member added there shows on this page.
Changes show after a reload of the other page.

- **A role change** here edits the member's row in place. The old site replaces the row. Both read the same
  role.
- If the **creator of a project** has their role changed on surveyjs.io, the project loses its owner (the old
  site replaces the creator's row). From then on, deleting the project gives its surveys to the admin who deletes
  it.

## Differences from the old page

- A member who is not an admin can **Leave Project** (the old site gave no way).
- A project can be deleted with surveys and members, and the surveys move to the owner (the old site refused,
  or left archived surveys behind).
- Refusals have a message. The old site did nothing or showed "Are you sure?" and removed the card even when
  the server refused.
- Roles are checked: a member is an admin or not. A role change cannot lose a membership.
- Rename keeps the project's creation date.
- The page asks before each removal, leaving and deletion, with the texts above.
- The list of projects and members has a fixed order: by name ignoring case, then id (members by display name).
- Not built: inviting people who have no account, a project description, transferring the ownership.
