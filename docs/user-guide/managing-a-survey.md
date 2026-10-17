# Managing a survey

Every row of the [survey list](your-surveys.md) has a **"…" menu** (three dots, at the right end of
the row) and, for surveys you can modify, a **pencil** next to the name. This page describes both.
They work like the "My Surveys" page of surveyjs.io.

## Who can do what

You can **modify** a survey when:

- it is one of your Personal surveys; or
- it belongs to a project and you are an **admin** of that project, or you created the survey.

A survey you cannot modify still shows in your list, and you can open it, clone it and look at it.
The items that change it are not shown: no pencil, no Publish or Unpublish, no Move to Project, no
Archive, no Restore and no Delete. Which items you see is listed below.

## Rename

Click the **pencil** next to the name (Active view only). The name becomes a text box with the text
selected, a **Save** button and a **Cancel** link.

- **Enter** or **Save** saves the new name. The list shows it at once.
- **Esc** or **Cancel** closes the box and keeps the old name.
- A name that is empty (or only spaces), or the same as before, sends nothing: the box just closes.
- The name is kept as you type it, up to 200 characters.

If saving fails, the old name comes back and the page says "Could not rename the survey. Please try
again.".

Keyboard: the pencil is a link. Shift+Tab from the "…" button of the row reaches it, and it shows
while it has focus.

## The "…" menu

Click the three dots (or focus them and press Enter or Space). Esc closes the menu and returns focus
to the dots, and so does a click anywhere else. Only one menu is open at a time. After an action the
menu closes and the list refreshes.

Items are shown in this order. "Modify" means you can modify the survey.

### Active view

| Item                  | Shown when                    | What it does                                                                                |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| **Run**               | The survey is published       | Opens `/s/<survey id>` in a new tab: the survey as respondents see it                       |
| **Edit**              | Always                        | Opens the editor, `/surveys/<survey id>/edit` ([Designing a survey](designing-a-survey.md)) |
| **Clone**             | Always                        | Makes a copy (see below)                                                                    |
| (separator)           | Modify                        |                                                                                             |
| **Publish**           | Modify, and not published     | Publishes the survey                                                                        |
| **Unpublish**         | Modify, and published         | Unpublishes it. **Run** disappears                                                          |
| (separator)           | Always                        |                                                                                             |
| **Survey IDs** >      | Always                        | A submenu: **Copy ID**, **Copy Result ID** and **Copy Post ID**                             |
| **View Results**      | Always                        | Opens `/surveys/<survey id>/results` (a placeholder page for now)                           |
| **View History**      | Always                        | Opens `/surveys/<survey id>/history` ([Survey history](survey-history.md))                  |
| (separator)           | Modify                        |                                                                                             |
| **Move to Project** > | Modify, and you have projects | A submenu: **Personal Surveys** and your projects. Asks first (see below)                   |
| **Archive**           | Modify                        | Moves the survey to the Archived view. Asks nothing                                         |

### Archived view

| Item             | Shown when | What it does                                        |
| ---------------- | ---------- | --------------------------------------------------- |
| **Clone**        | Always     | Makes a copy (see below)                            |
| (separator)      | Modify     |                                                     |
| **View Results** | Always     | Opens the results placeholder                       |
| (separator)      | Modify     |                                                     |
| **Delete**       | Modify     | Deletes the survey for good. Asks first (see below) |
| **Restore**      | Modify     | Moves the survey back to the Active view            |

There is no pencil in the Archived view.

### Run, Publish and Unpublish

**Publish** and **Unpublish** change the survey at once, without a question. **Run** is in the menu
only while the survey is published, and opens the survey's public address in a new tab. That address is
what you give to respondents. It needs no sign-in. What respondents see, how the survey collects
responses and how to stop it are in [Publishing and collecting
responses](publishing-and-collecting-responses.md).

Archiving a survey does not unpublish it, and an archived survey that is still published keeps
collecting responses. Unpublish it to stop.

### Clone

**Clone** copies the survey's definition and theme into a new survey in the **same list** (Personal
or the same project). The copy:

- is named **Copy of** and the original name (cut to 200 characters if that is longer);
- is **unpublished** and active, with every setting off, even when the original is published;
- has **you** as its creator, so you can modify it, even when you could not modify the original;
- gets new IDs;
- gets its own copies of the survey's uploaded files ([Images and files](images-and-files.md#copies-of-a-survey));
- does not get results or history.

You can clone any survey you can see, also from the Archived view. The copy is always created
**active**, so after cloning from the Archived view you find it in the Active view. It is the newest
survey, so it is at the top of the list. Cloning from the Archived view puts the active copy in the
Active list, so nothing new appears on the Archived list.

### Survey IDs

Each survey has three IDs, used with the API and in links:

| Item               | Copies        |
| ------------------ | ------------- |
| **Copy ID**        | The survey ID |
| **Copy Result ID** | The result ID |
| **Copy Post ID**   | The post ID   |

Open the submenu by hovering over **Survey IDs**, or click it, or focus it and press Enter. Click an
item to put the ID on the clipboard, then paste it where you need it. If your browser does not allow
it, the page says "Could not copy to the clipboard.".

### Move to Project

The submenu lists **Personal Surveys** first, then every project you belong to, by name. The one the
survey is in now is marked and does nothing. Choose another one, and the browser asks:

> Do you want to move this survey to another organization? This operation can't be undone.

("Organization" is the old word for a project.) On **OK** the survey moves, and the page opens the
**Active** list of the place you moved it to, where the survey is. **Cancel** leaves everything as it
was.

- You can move a survey only to Personal Surveys or to a project **you belong to**.
- **Personal Surveys** always means **your own** Personal surveys, whoever owned the survey before.
- After a move **you** are the survey's creator. Moved into a project, the survey can then be
  modified by you and by the project's admins. Keep this in mind before you move a survey that a
  colleague created.
- Moving a survey to the place it is already in changes nothing but its updated date.

### Archive and Restore

**Archive** takes the survey out of the Active view and shows it in **Archived**. The Active /
Archived switch appears as soon as a list has an archived survey. **Restore** (in the Archived view)
brings the survey back. Neither asks anything. An archived survey keeps its data and can be cloned.

### Delete

**Delete** is only in the **Archived** view: archive a survey first. The browser asks:

> Do you really want to delete this survey? This operation can't be undone.

On **OK** the survey is deleted **for good**, with its definition, theme, history, results and uploaded
files ([Images and files](images-and-files.md#when-you-delete-a-survey)). There
is no way to bring it back. **Cancel** keeps it.

## Updated dates

Every change (rename, publish, archive, move and so on) sets the survey's **updated** date to now,
even when the new value is the same as the old one. The survey then moves to the top of its list.

## When something goes wrong

A failed action shows one message above the list, such as "Could not archive the survey. Please try
again.". The next action clears it. The list stays as it was.

## The placeholder page

One address opens a page that is not built yet. It shows only a line of text:

| Address                 | Opened by    | Shows                                                           |
| ----------------------- | ------------ | --------------------------------------------------------------- |
| `/surveys/<id>/results` | View Results | The survey name and "Survey results arrive in a later version." |

The results page needs you to be signed in and has a **Back to My Surveys** link. It says "This survey
is not available." for a survey that does not exist or that you cannot see. The run page (**Run**) is
built: see [Publishing and collecting responses](publishing-and-collecting-responses.md).

The editor (**Edit**) and the history page (**View History**) are described in
[Designing a survey](designing-a-survey.md) and [Survey history](survey-history.md).

## Not here yet

- The survey settings "Grant Access" and "Save Respondent IP" can be changed through the API only;
  their switches arrive with the results page. "Save Respondent IP" is explained in [Publishing and
  collecting responses](publishing-and-collecting-responses.md#save-respondent-ip).
