# Survey history

Every time the survey definition is saved, My Surveys keeps that version. The history page lists them.

## Open it

Open the "…" menu of a survey and click **View History**. The address is
`/surveys/<survey id>/history`. You can open it for every survey you can see, also one you cannot
modify. A survey that does not exist, or that you cannot see, shows "This survey is not available."

## What the page shows

The heading is **Survey editing history of the '<survey name>'**. Below it is one row for each saved
version, the **newest first**:

- a small clock;
- the date and time of the save, in your browser's language and time zone, with the zone shown (for
  example `10/15/2026, 9:30 AM UTC`);
- **by** and the name of the person who saved it, when it is known.

Click the time of a row to see the survey JSON saved in that version. It opens under the row, with a
**Copy JSON** button above it that copies the JSON to the clipboard; the button reads **Copied** for a
moment after. Click the time again to hide it. While the JSON loads, the row says "Loading…"; if it
cannot be loaded, "Could not load this version. Please try again." shows, and the next click tries
again. If the browser does not allow copying, "Could not copy to the clipboard." shows; you can still
select the JSON and copy it yourself.

Versions saved by the old surveyjs.io editor open the same way.

In the sandbox demo, which keeps its data in your browser, only the 20 newest versions of a survey keep
their JSON. An older one says "The demo keeps the JSON of the 20 newest saves of a survey."

The list shows 50 entries at a time. When there are more, a **Show more** link loads the next ones. A
survey that was never saved shows "No edits yet.". **Back to My Surveys** returns to the list.

If the history cannot be loaded, the page says "Could not load the history. Please try again." with a
**Try again** button. If only a later page fails, the entries you have stay, "Could not load more
entries. Please try again." shows, and **Show more** tries again.

## What is in the history

| Event                                                     | Entry                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------- |
| A change saved in the editor (autosave), Clear Survey too | One entry, with your name                                  |
| A survey created with a definition (through the API)      | One entry, with the creator's name                         |
| A clone of a survey that has a definition                 | One entry in the copy, with the name of the person cloning |
| A theme saved                                             | No entry                                                   |
| A rename, publish, archive or move                        | No entry                                                   |

Autosave saves after every short pause, so one editing session can leave many entries.

### Entries without a name

Entries made by the old surveyjs.io editor were stored **without a user**, so they show only the time.
An entry also has no name when the person who made it no longer exists. If the old editor and My
Surveys save the same survey at about the same time, the old editor can rewrite one entry, which then
shows without a name and with a new time.

## Not here yet

You cannot compare two versions or restore an older one from the page yet.
