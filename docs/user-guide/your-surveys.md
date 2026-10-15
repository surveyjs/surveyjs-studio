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

Clicking a row does nothing yet. The row menu, renaming in place and the other row actions arrive in
a later version.

## Personal surveys and projects

The drop-down next to **Create a Survey** chooses whose surveys you see:

- **Personal Surveys**: your own surveys. Nobody else sees them.
- **A project**: the surveys of that project. Every member of the project sees them, whatever their
  role. Projects are listed by name.

The drop-down is shown only when you belong to at least one project. A project you are not a member
of cannot be opened: its address sends you back to Personal Surveys.

You cannot create or manage projects here yet. The projects you see are the ones you already belong
to on surveyjs.io.

## Active and Archived

Archived surveys are kept out of the normal list. When the chosen list has archived surveys, a
switch **Active / Archived** appears above it. Switch to **Archived** to see only those. The
**Create a Survey** button is not shown in the toolbar there: you create surveys in the Active view.
(If you open an empty Archived view by its address, the empty-list message offers the button.)

The switch is not shown when the list has no archived surveys. Archiving and restoring surveys
arrive in a later version.

## The address keeps the view

The view is part of the page address, so a reload, a bookmark or a link you send keeps it:

| View                         | Address                                |
| ---------------------------- | -------------------------------------- |
| Your active surveys          | `/`                                    |
| Your archived surveys        | `/?archived=true`                      |
| A project's active surveys   | `/?project=<project id>`               |
| A project's archived surveys | `/?project=<project id>&archived=true` |

The browser's Back button returns to the previous view. My Surveys does not remember your last
project: with no `project` in the address you see Personal Surveys (surveyjs.io keeps the last
project in a cookie for a day; this app does not).

## Create a Survey

Choose the list (Personal Surveys or a project) and click **Create a Survey**. The survey is created
in that list, with you as its creator, and the editor page opens.

The name is **New Survey N**. N is one more than the highest number among the **active** surveys of
that list whose names are `New Survey` followed by a number:

- `New Survey 1` and `New Survey 3` give `New Survey 4`. Gaps are not filled.
- Names that do not match exactly are ignored: `new survey 9`, `My New Survey 5`, `New Survey 2a`.
- Archived surveys are ignored too, so a new name can repeat an archived one.
- If there is no such survey, the name is `New Survey 1`.

Names do not have to be unique. If two people create a survey at the same moment they can get the
same name. A name is at most 200 characters.

You can create a survey in a project when you are a member of it, whatever your role.

## The editor placeholder

After you create a survey, the page `/surveys/<survey id>/edit` opens. For now it shows only the
survey name, the line "The survey editor arrives in a later version." and a **Back to My Surveys**
link. The link returns to the list the survey belongs to, where the new survey is at the top.

If the survey does not exist, or belongs to someone else, the page says "This survey is not
available."

## Loading more

The list loads 50 surveys at a time. With 50 or fewer surveys the page looks like the one on
surveyjs.io. With more, a **Load more** button appears under the list. Click it until it goes away.
Surveys you create while the page is open appear at the top at once and never shift the rows you
already see.
