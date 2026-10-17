# Designing a survey

The survey editor is the SurveyJS Survey Creator, set up as on surveyjs.io, with automatic saving.
This page describes how to open it and what it adds to the Creator. For the Creator's own tools, use
the **Help** button in the toolbar: it opens the Creator guide.

## Open the editor

- Click a **row** in the Active view of the [survey list](your-surveys.md), outside the pencil and the
  "…" menu. A click on the name opens it too.
- Or open the "…" menu of the row and click **Edit**.
- **Create a Survey** opens the editor on the new survey.

The address is `/surveys/<survey id>/edit`. In the Archived view a click on a row does nothing, and
the menu has no **Edit**: restore the survey first.

The editor reads the survey from the server each time you open it, so it always starts from the latest
saved version. If the survey does not exist, or belongs to someone else, the page says "This survey is
not available."

## The tabs

| Tab               | What it is for                                                               |
| ----------------- | ---------------------------------------------------------------------------- |
| **Designer**      | Build the survey: add and edit pages, panels and questions                   |
| **Preview**       | Try the survey as a respondent sees it                                       |
| **Logic**         | Conditions for showing, skipping and completing                              |
| **Themes**        | Choose and adjust the look of the survey                                     |
| **Translation**   | Texts of the survey in other languages                                       |
| **JSON Editor**   | The survey definition as text, with a download button                        |
| **Embed Survey**  | Code that puts the survey in your own application (see [below](#embed-tabs)) |
| **Embed Creator** | Code that puts Survey Creator in your own application                        |

On a narrow window some tabs move into a **More** menu.

The automatic translation button of the Translation tab is not available.

## Autosave

There is no Save button. A change is saved about half a second after you stop. The survey definition
and the theme are saved separately: a change in the Designer saves the definition, and a change in the
Themes tab saves the theme.

The bar at the bottom of the page shows the state at its left end:

| Text                      | Meaning                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| **Saving…**               | A save is on its way                                                      |
| **All changes saved**     | Everything you did is stored                                              |
| **Changes are not saved** | The last save failed, or saving stopped because of a conflict (see below) |
| **Read-only**             | You cannot modify this survey (see [Read-only mode](#read-only-mode))     |

One save is sent at a time for each part. If you keep changing the survey meanwhile, the newest state
is sent next, so nothing is lost and an old state never overwrites a new one.

When a save fails for another reason (for example the network), the editor stays open and keeps your
changes. The next change tries again.

Every saved change of the definition adds an entry to the [history](survey-history.md) and moves the
survey's **updated** date. A saved theme moves the date too, but adds no history entry.

## When someone else changed the survey

If you open the same survey in two windows (or two people do) and both change it, the second save is
refused, because it would replace the other change. The editor then:

- stops saving, and does not send your latest changes;
- shows a notice above the editor: "The survey was changed by someone else. Your latest changes are not
  saved." with a **Reload latest** button;
- shows **Changes are not saved** in the bottom bar.

Click **Reload latest**. The editor loads the latest saved definition and theme, drops your unsaved
changes, hides the notice and saves again from then on. If reloading fails, the notice stays and says
"Could not reload the survey. Please try again."; click the button again.

Copy anything you want to keep (for example from the JSON Editor tab) before you reload.

The same happens when the old surveyjs.io editor saves the survey at the same time, because both write
to the same data.

## The toolbar

Besides the Creator's own buttons the toolbar has:

| Button                                  | What it does                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Clear Survey** (eraser, Designer tab) | Deletes every page, panel and question. It asks first, see below                                       |
| **Help** (question mark)                | "Read the tool guide": opens the Survey Creator guide in a new tab                                     |
| **Run**                                 | "Click here to run this survey...": opens `/s/<survey id>` in a new tab. Off while the survey is empty |

### Clear Survey

The button asks: "You are going to delete all elements in this survey. Do you want to proceed?". On
**OK** the survey is emptied **and the empty survey is saved** (after the usual half second). On
surveyjs.io the clearing is saved only with your next change, so a reload brings the old survey back.
Here a reload shows the empty survey. The earlier version stays in the [history](survey-history.md).

**Cancel** changes nothing. The button is not there in read-only mode, and it is off while the survey is
empty.

### Download JSON and obfuscated JSON

On the **JSON Editor** tab the download button is a drop-down with two items:

- **Download JSON**: the definition as it is.
- **Download obfuscated JSON**: a copy you can share, for example in a support request. The names of
  the questions and panels become `q1`, `q2`... and `panel1`..., and the texts are replaced by scrambled
  letters of the same length (in every language), so the structure stays and the content does not. The
  file is `survey.obf.json`.

If the JSON on the tab has errors, the second item shows "Please fix error(s)" and downloads nothing.

## The Themes tab

The Themes tab works as in the Creator: pick a theme and change its colours, fonts and sizes. The result
is the survey's **theme**, and it is saved on its own. The Creator's own look (light or dark, and its
colours) is a setting of your browser and is not part of the survey.

## The bottom bar: rename

The survey's name is in the middle of the bottom bar, with a pencil. Click it to rename the survey
without leaving the editor (not shown on a small screen).

- **Enter**, the **Save** button or a click elsewhere saves.
- **Esc** or **Cancel** keeps the old name.
- An empty or unchanged name sends nothing.

The new name shows at once. If saving fails, the old name returns and the page says "Could not rename the
survey. Please try again.". The rules for names are those of [Rename](managing-a-survey.md#rename).

## Images and files

Choose a picture or a video in an Image question, an image choice, the survey logo or a theme background
and it is uploaded to the server. The allowed types, the limit per survey and what happens to the files
when you clone or delete a survey are on [Images and files in your survey](images-and-files.md).

## Embed tabs

**Embed Survey** and **Embed Creator** show code for your own application. Choose the platform
(Angular, React or VanillaJS; the default is React). Each tab shows the install command and the files
to create, with a **Copy Code** button for each block.

**Embed Survey** also has the check box **Load Survey JSON from service** (off by default):

- Off: the survey (and its theme, when it has one) is written into the code, and a finished survey is
  logged to the browser console.
- On: the code loads the survey from this application (`/api/v1/public/surveys/<survey id>`) and sends
  each answer back to it (`/api/v1/public/surveys/<survey id>/responses`). The address in the code is
  the one you are using now. Those public endpoints arrive with the run page, so until then this code
  shows what the calls will look like.

**Embed Creator** says that Survey Creator needs a commercial licence when you use it in your own
application, with links to the licence and the FAQ.

## Read-only mode

When you can see a survey but not modify it ([Who can do what](managing-a-survey.md#who-can-do-what)),
the editor opens read-only: the Creator cannot be changed, Clear Survey is not there, the name in the
bottom bar has no pencil, and the bar says **Read-only**. Nothing is sent to the server. You can still
use Preview, **Run** and the Embed tabs, and download the JSON.

## The licence banner

Survey Creator is a commercial SurveyJS product. When the server has no SurveyJS licence key, the
Creator shows its own banner about the missing licence, and the survey stays editable. The key is set
with `SURVEYJS_LICENSE_KEY` (see [Development](../development.md#environment-variables-server)).

## Limits

- A survey definition or a theme can be up to about 30 MB (the server setting
  `LIMIT_MAX_DOCUMENT_BYTES`). A larger one is refused, and the bar says **Changes are not saved**.
  Large images inside a survey are the usual cause: use image links.
- Images, logos and videos you choose in the editor are uploaded to the server, up to 50 MB for each
  survey (the server setting `LIMIT_MAX_ASSET_BYTES_PER_SURVEY`). See
  [Images and files in your survey](images-and-files.md).
