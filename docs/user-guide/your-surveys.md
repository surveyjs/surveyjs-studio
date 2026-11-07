# Your surveys

The home page of My Surveys is the survey list. It looks like the "My Surveys" page of surveyjs.io.
You need to be [signed in](signing-in.md); the page address stays the same after sign-in.

## The list

Each row is one survey. It shows:

- the **name**;
- the **created** date, with the tooltip "Created on";
- the **updated** date, with the tooltip "Updated on".

Dates are written the US way (`4/14/2026`) in your browser's time zone, so a survey saved close to
midnight UTC can show the day before or after what the server stores.

"Newest first" means the **most recently updated** survey comes first. A survey that you created
long ago and changed today is above one that you created yesterday and have not touched. Surveys
updated at the same moment are ordered by their id.

If the list is empty, the page says "No surveys yet" and offers a **Create a Survey** button.

Clicking a row does nothing yet. Each row has a "…" menu and, when you can modify the survey, a pencil
for renaming. See [Managing a survey](managing-a-survey.md).

## Personal surveys and projects

The drop-down next to **Create a Survey** chooses whose surveys you see:

- **Personal Surveys**: your own surveys. Nobody else sees them.
- **A project**: the surveys of that project. Every member of the project sees them, whatever their
  role. Projects are listed by name.

The drop-down is shown only when you belong to at least one project. A project you are not a member
of cannot be opened: its address sends you back to Personal Surveys.

The drop-down ends with **Manage Projects**, which opens the Projects page. You create and manage projects
there, not in this list: see [Projects and team members](projects-and-team-members.md). The projects you see
are the ones you belong to, on this site and on surveyjs.io alike.

## Active and Archived

Archived surveys are kept out of the normal list. When the chosen list has archived surveys, a
switch **Active / Archived** appears above it. Switch to **Archived** to see only those. The
**Create a Survey** button is not shown in the toolbar there: you create surveys in the Active view.
(If you open an empty Archived view by its address, the empty-list message offers the button.)

The switch is not shown when the list has no archived surveys. Archive and restore surveys from the row
menu ([Managing a survey](managing-a-survey.md#archive-and-restore)).

## The address keeps the view

The view is part of the page address, so a reload, a bookmark or a link you send keeps it:

| View                         | Address                                |
| ---------------------------- | -------------------------------------- |
| Your active surveys          | `/?project=personal`                   |
| Your archived surveys        | `/?project=personal&archived=true`     |
| A project's active surveys   | `/?project=<project id>`               |
| A project's archived surveys | `/?project=<project id>&archived=true` |

The browser's Back button returns to the previous view.

My Surveys remembers the list you looked at last, Personal Surveys or a project, in this browser.
The address `/` (a bookmark, the **My Surveys** button in the header, signing in) opens that list,
and the address bar then shows the list's own address; `/?archived=true` opens its archived view.
Until you have looked at a list, or when the remembered project can no longer be opened (you left
it, or it was deleted), `/` opens Personal Surveys. Each user of a shared browser has their own
remembered list. surveyjs.io remembers the last project too, in a cookie that lasts a day; here it
stays until you look at another list.

## Create a Survey

Choose the list (Personal Surveys or a project) and click **Create a Survey**. The survey is created
in that list, with you as its creator, and the editor opens.

The name is **New Survey N**. N is one more than the highest number among the **active** surveys of
that list whose names are `New Survey` followed by a number:

- `New Survey 1` and `New Survey 3` give `New Survey 4`. Gaps are not filled.
- Names that do not match exactly are ignored: `new survey 9`, `My New Survey 5`, `New Survey 2a`.
- Archived surveys are ignored too, so a new name can repeat an archived one.
- If there is no such survey, the name is `New Survey 1`.

Names do not have to be unique. If two people create a survey at the same moment they can get the
same name. A name is at most 200 characters.

You can create a survey in a project when you are a member of it, whatever your role.

## The editor

After you create a survey, the editor opens at `/surveys/<survey id>/edit`
([Designing a survey](designing-a-survey.md)). To return to the list, use the browser's Back button or
the **My Surveys** item of the page header. The new survey is at the top of its list.

If the survey does not exist, or belongs to someone else, the page says "This survey is not
available." and has a **Back to My Surveys** link.

In the Active view a click on a row opens the editor too.

## Long lists

As on surveyjs.io, the page shows every survey of the list, so the browser's Find (Ctrl+F) finds any
of them. The list arrives 50 surveys at a time: the first 50 show at once and the rest follow by
themselves, with no click. If a part fails to load, the page says "Could not load more surveys.
Please try again." and shows a **Load more** button that tries again. Surveys you create while the page is open appear at the top at once and never shift the rows you
already see.
