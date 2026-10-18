# Downloading, sharing and deleting results

The **Details** tab of the results page holds the totals, the downloads, the settings **Grant Access** and
**Save Respondent IP**, and **Delete Results**. It works like the Details tab of surveyjs.io, with the
differences listed on this page. The other two tabs are described in
[Viewing results: Summary and Table](viewing-results.md).

Open it from the survey list: the "…" menu of a survey, **View Results**, then the **Details** tab. The
address is `/surveys/<survey id>/results?tab=details`.

## Totals and dates

The top left of the tab shows:

| Line                   | Shows                                 |
| ---------------------- | ------------------------------------- |
| **Total responses:**   | The number of responses of the survey |
| **First response at:** | When the oldest response was sent     |
| **Last response at:**  | When the newest response was sent     |

- **The total is the true count.** The old page counted the first 1,000 responses and showed that number.
  This page asks the server, so a survey with 1,500 responses shows 1500.
- **The dates are in your browser's format.** They use your language and time zone, for example
  `5/1/2026, 8:00:00 AM` in a US browser set to UTC. The same moment reads differently in another browser or time
  zone. The Table and the downloads use UTC.
- **With no responses** the two dates are not shown.
- The numbers are read when you open the tab. After you delete the results they update at once. A response
  that arrives while the tab is open shows after you reload the page.
- While the numbers load the tab says "Loading statistics…". If they cannot be loaded it says "The
  statistics could not be loaded. Check your connection and try again." with a **Try again** button.

## Download all results

Under "Download all results as:" two buttons give the whole data set: **JSON** and **CSV**. Anyone who can
see the survey can download, also a user who cannot modify it.

Both files hold **every response**, oldest first. There is no limit of 1,000. The browser saves the file as
**`<survey name>.json`** or **`<survey name>.csv`**. A survey with no name gives `results.json` or
`results.csv`.

### JSON

The file is one list. Each entry is one response:

```json
[
  {
    "id": "b0f1c3a8-52de-5a41-8c97-3e6d9f2b7a10",
    "submittedAt": "2026-05-01T08:00:00.000Z",
    "data": { "color": "Red", "score": 4, "channels": ["Search", "Ad"] },
    "clientId": "…",
    "respondentIp": "203.0.113.7"
  }
]
```

- `data` holds the answers, as they were sent. A question with several answers is a list, a matrix is an
  object.
- `clientId` and `respondentIp` are there only when the response has them. The JSON holds an IP address
  that was stored, also when **Save Respondent IP** is off now.
- The old site's file was `{ "ResultCount": …, "Data": […] }`. This file is the plain list. For the exact
  shape see [Exporting results](../api/exporting-results.md).

### CSV

A CSV file opens in a spreadsheet program. It is UTF-8 with a byte order mark, so Excel reads accented and
non-Latin letters correctly. Fields are separated by commas, and a field that contains a comma, a quote or
a line break is put in quotes.

| Column                  | Holds                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `Submitted`             | When the response was sent, in UTC, as `2026-05-01T08:00:00.000Z`                        |
| `IPAddress`             | The respondent's IP address. The column is there **only while Save Respondent IP is on** |
| One column per question | The answer. The header is the question's **name** (for example `color`), not its title   |
| `<name>-Comment`        | The comment or "other" text of a question that has one, right after that question        |
| `ClientId`              | The browser's id for that survey. It is always the last column                           |

- The columns follow the order of the survey. A survey with no responses gives the header line only.
- A question with several answers (a checkbox, a matrix) is one cell with the answer as JSON text, for
  example `["Search","Ad"]`.
- **Why names and not titles.** Titles can repeat, can be empty and can be translated. Names are always
  there and are unique.
- A file for a survey with 1,500 responses has 1,501 lines: the header and one line for each response.
- The file is different from **Export As... CSV** in the Table. That one is made in your browser, uses the
  titles of the questions and holds the columns you show. This one comes from the server and holds
  everything.

**Text that looks like a formula.** A spreadsheet program runs a cell that starts with `=`, `+`, `-` or
`@` as a formula, and a respondent can type such text. To keep that from happening, the CSV file puts a
`'` before any text answer that starts with one of these characters (or with a tab or a line break). A
respondent who typed `=SUM(A1)` is in the file as `'=SUM(A1)`. This also holds for harmless text such as
`-5` or `+1 555 0100`: it appears as `'-5` and `'+1 555 0100`. A number question's answer is not text and
stays as it is. The JSON file is never changed this way.

If a download fails, the browser says so (for example "Failed - Network error"). Try again.

## Grant Access and the public link

**Grant Access** lets anyone with a link see the results, without signing in. The button is in the right
half of the tab (only for users who can modify the survey).

1. Click **Grant Access**. The text changes to "Your Survey results can be accessible via direct Url." and
   the link **Go to the results page** appears, with the button **Disable Access**.
2. Click **Go to the results page**. It opens `/results/<survey id>` in a new tab. Copy that address to share
   it.
3. Click **Disable Access** to close it. The change is at once: the next visit to the link, and a page
   that is already open when it reloads, says "These survey results are not available."

What a visitor sees:

- The survey name as the heading, and two tabs, **Summary** and **Table**. There is no Details tab, no
  download and no **Export As...** menu, and nothing can be changed. The page needs no sign-in and shows no
  menu of this application.
- **Every response**, not the first 1,000. A survey with many responses takes a moment to load. While it
  loads the page says "Loading the results…". If it cannot be loaded it says "The results could not be loaded.
  Check your connection and try again." with **Try again**.
- **No IP addresses, client ids or response ids**, and no answers to the questions you made private (below).
- The layout is the default one, not yours. A visitor cannot save a layout.
- The address ends in the survey's id. Anyone who has the address can read the results until you click
  **Disable Access**. Do not share it with people who must not see the answers.

**It works for an unpublished or archived survey too.** Grant Access is your own choice and does not depend
on **Publish**. A survey that nobody can fill in now can still show its results.

A survey that does not exist, and a survey with Grant Access off, show the same page ("These survey results
are not available."), so nobody can tell whether a survey exists.

**The old links** of the form `/Results/Survey/<result id>` do not work yet (Step 12).

### Make a question private

By default the visitors see the answers to every question. To hide one:

1. Open the **Summary** tab. A button **Make private** is on each chart (for users who can modify the
   survey).
2. Click it. The button on that chart changes to **Make public**. Click **Make public** to show the question
   again.

The change is saved at once, for the survey. If it cannot be saved, the page says "The list of private
questions could not be saved. Please try again." A private question:

- is not in the public **Summary** and not a column of the public **Table**;
- has its answers (and its comment) left out of the data the server sends to the public page, not only
  hidden. A visitor who looks at the network traffic does not find them either;
- is still in your own Summary, your own Table and in your downloads.

The list belongs to the survey, not to a user, so every user who can modify the survey sees and changes the
same list. The old site had the same list. A question that you hide from your own Summary with **Hide** is
**not** made private by that, and stays as it was: private or public. Making a question private changes
your saved Summary layout a little too (the question's mark in it), and the survey setting is the one that
counts.

## Save Respondent IP

**Save Respondent IP in Results** stores the IP address of each respondent with the response. The setting
is **off** by default.

- Click **Save Respondent IP in Results**. The text changes to "The IP addresses of your respondents are stored
  along with other answers. Toggle not to store." and the button to **Do not save Respondent IP in
  Results**.
- **It applies to new responses only.** A response that was sent while the setting was off never gets an
  address, also when you turn it on later. Turning it off later does **not** remove the addresses that were
  stored: they stay with their responses.
- The address shows in the **IPAddress** column of the Table, in the JSON file, and (while the setting is on)
  in the CSV file. It is never in the public results.
- It is the address of the connection. In a local demo that is the loopback address (`127.0.0.1` or `::1`),
  because the browser and the server run on the same machine. Behind a reverse proxy the server has to be
  told about it ([Public endpoints](../api/public-endpoints.md#the-respondents-ip-address)).
- An IP address is personal data in many countries. Turn the setting on only if you need it, and tell your
  respondents.

## Delete Results

**Delete Results** removes all the responses of the survey for good. It is in the right half of the tab, and
only when the survey has at least one response.

1. Click **Delete Results**. A box opens with "Deletes all survey results without the possibility to
   restore."
2. Type the **survey name** in the box, exactly as it is (letters in the same case). The button **Clear All
   Data** is enabled only when the text is the name. A survey with no name enables it at once.
3. Click **Clear All Data**. The browser asks "Are you absolutely sure that you want to delete all results ?".
   Click **OK**.

The tab says "All results are deleted." and the total becomes 0. The Summary and the Table are empty without
a reload. If the deletion fails, the tab says "The results could not be deleted. Please try again." Some
responses may already be gone, so try again until it says "All results are deleted.".

**Deleted:**

- the responses, with the IP addresses and client ids stored with them;
- the records that say a respondent has already completed the survey ("Limit to one response");
- the files that respondents uploaded (a link to such a file then shows "not found").

**Kept:**

- the survey, its definition and its theme;
- the settings, including Grant Access and the list of private questions;
- your saved layouts of the Summary and the Table;
- the images you added in the editor.

- **A respondent can answer again.** The record of the completion is deleted. If "Limit to one response" is
  on, the browser of a respondent may still hold the library's own cookie that remembers the completion, and
  the run page may still show the survey as completed in that browser until the cookie is gone.
- **It cannot be undone.** There is no copy. Download the JSON file first if you may need the data.
- Deleting does not change the survey's place in the list or its history. The old site's event log gets one
  entry that says the results were deleted (never any answer).
- Other people who have the results page open see the old numbers until they reload.

## Reset the layouts

The two **Reset Table State** and **Reset Summary State** buttons are on the same tab, under the other
controls. They are described in [Viewing results](viewing-results.md#details-reset-a-layout). They are shown
to everyone who can see the survey.

## Who sees which controls

| Control                                                             | Can see the survey               | Can modify the survey |
| ------------------------------------------------------------------- | -------------------------------- | --------------------- |
| Totals and dates, **JSON**, **CSV**                                 | Yes                              | Yes                   |
| **Reset Table State**, **Reset Summary State**                      | Yes                              | Yes                   |
| **Grant Access** and **Disable Access**, the public link            |                                  | Yes                   |
| **Save Respondent IP in Results** and **Do not save Respondent IP** |                                  | Yes                   |
| **Delete Results**                                                  |                                  | Yes                   |
| **Make private** and **Make public** on the Summary                 |                                  | Yes                   |
| The public page `/results/<id>`                                     | Anyone, while Grant Access is on |                       |

Who can modify a survey is in [Managing a survey](managing-a-survey.md): the owner of a personal survey, a
project admin or the survey's creator for a project survey. A user who can see a survey but not modify it
sees the totals and the downloads, and nothing else of this page. The server checks the rule as well: a
request to turn a setting on, to make a question private or to delete the results from a user who cannot
modify the survey is refused.

## Not here yet

- The old page's **Show in Survey** and **Delete Result** for one response in the Table. There is no way yet
  to delete one response.
- The **make public** action of the Table's columns. Use the Summary's **Make private** and **Make public**.
- The old page's links, `/Results/Survey/<result id>` and the `#summary` links (Step 12).
- Excel and PDF files of all results made by the server. The Table's **Export As...** makes Excel and PDF in
  your browser.
- Special handling of files and pictures that the old site stored in answers as `dxsimage:` or `dxsfile:`
  texts, or as data URLs. The Table shows what is stored.
- A shareable link with a password or a token (phase 2).
