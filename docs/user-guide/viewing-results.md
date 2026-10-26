# Viewing results: Summary and Table

The results page shows the answers of a survey in three tabs: **Summary** (a chart for each question),
**Table** (one row for each response) and **Details**. It works like the results page of surveyjs.io,
with the differences listed on this page.

## Open it

In the survey list, open the "…" menu of a survey and click **View Results**
([Managing a survey](managing-a-survey.md)). The item is there for every survey you can see, also an
archived one and one you cannot modify. The address is `/surveys/<survey id>/results`.

- The heading is the survey name. **Back to My Surveys** returns to the list.
- A survey that does not exist, or that you cannot see, shows "This survey is not available."
- The page needs you to be signed in.
- The results are read **once** each time you open the page. Responses that arrive later show after you
  reload the page.
- While the answers load, the page says "Loading results…". If they cannot be loaded, it says "The
  results could not be loaded. Check your connection and try again." with a **Try again** button.

## The three tabs

| Tab         | Address                             | Shows                                                                                                                                                     |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Summary** | `/surveys/<id>/results`             | A chart for each question                                                                                                                                 |
| **Table**   | `/surveys/<id>/results?tab=table`   | The responses as a table                                                                                                                                  |
| **Details** | `/surveys/<id>/results?tab=details` | The totals, the downloads, the access settings, **Delete Results** and the two **Reset** buttons ([Details](downloading-sharing-and-deleting-results.md)) |

The address after `?tab=` names the tab, so you can bookmark or share a link to one. A link without
`tab`, or with a value other than `summary`, `table` or `details`, opens the Summary. The Summary tab's own
link has no `tab`.

**Every response counts.** The old page showed a banner, "displays only the first 1,000 responses", and
charted only the first 1,000. This page loads all responses, in pages of 1,000, and charts every one of them.

## Summary

The Summary is the SurveyJS Dashboard. It shows one chart for each question of the survey, in the
order of the survey.

- **All questions** are shown. The old page charted only the first 15.
- **Choose question to show...** lists every question, with a check mark on the ones shown. Pick a
  hidden one to show it again.
- **Hide** on a chart removes it from the page. It stays in the list of the chooser.
- **Drag** a chart by its header to put it in another place.
- **Click a bar or a slice** to filter: the other charts then count only the responses that chose that
  answer.
- A drop-down on each chart (for example "Bar") changes how the question is drawn: bar, pie, table and
  so on, as the question allows.
- Text questions show a list of the answers. There is no word cloud, as on the old page.

## Table

The Table has one row for each response and one column for each question, in survey order. Two more
columns are added at the end:

| Column        | Holds                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Submitted** | When the response was sent, in UTC, as `2026-05-01T08:00:00.000Z`                                                                                                                            |
| **IPAddress** | The respondent's IP address, when [Save Respondent IP](publishing-and-collecting-responses.md#save-respondent-ip) was on. The column is there only when at least one response has an address |

A question that is itself called `HappendAt` or `IPAddress` keeps its own answer, and the extra column of
that name is left out. The table never shows the response id or the client id.

What you can do:

- **Columns.** Each column header has the buttons **Hide column** and **Move to Detail**. A column moved to
  detail shows in the detail panel that opens for a row, and **Show as Column** brings it back. The
  **Columns** drop-down above the table shows a hidden column again. Each column also has a box to
  search in it.
- **Paging.** The table shows **5** rows a page. A page-size selector offers 1, 5, 10, 25, 50 and 100. With
  1,500 responses and 5 rows a page, the last page is page 300.
- **Export As...** offers **CSV**, **Excel** and **PDF**. The file is called `results.csv`,
  `results.xlsx` or `results.pdf`. The export holds **every row**, not only the page you see, and the
  columns you show. The export is made in your browser: nothing is sent to the server. The Excel and
  PDF code loads the first time you use it, so the first Excel or PDF export takes a moment longer. If it
  cannot be loaded, the page says "The export could not be prepared. Please try again."
- A CSV file from a table of 1,500 responses has 1,501 lines: the header and one line for each response.

## Your layout is saved

What you change on the Summary (hidden charts, their order, the chart types) and on the Table (hidden and
moved columns, their order, the page size) is **your layout**. It is saved on its own, about half a second
after the last change, and also when you switch tab, leave the page or close it. The next time you open
the page, the layout is back.

- **A layout belongs to you and to the survey.** Another user, also one of the same project, does not see
  your layout and you do not see theirs. Changing a layout changes nothing for anybody else, and does not
  change the survey: it does not move in the list and adds no entry to the history.
- **Anyone who can see the survey** has a layout of it, also a user who cannot modify the survey.
- The Summary and the Table have **separate layouts**.
- A layout is deleted with its survey. A clone starts with the default layout.
- If a save fails, a quiet line says "Your layout could not be saved. It is saved again with your next
  change." Nothing else is lost.

**A survey you had laid out on the old site.** The old site kept one layout of the Summary and one of the
Table for the whole survey. The first time you open such a survey here, you see **that layout**, as it
was. It stays what you see until you change something (your own layout is then saved, and the old one is
no longer used for you) or reset the layout. The old layouts are only read: this application never
changes them, so the old site still shows its own. The old site's own list of table columns
(`surveyresultcolumns`) and its "public" marks are not used.

**A question added or removed later.** If you add a question to the survey after you saved a layout, its
chart (on the Summary) or its column (on the Table) is shown at the end of your layout. A question you
remove from the survey is dropped from the layout. The rest of the layout stays as you saved it. This
also holds for an old-site layout.

## Details: reset a layout

**Details** has two buttons, **Reset Table State** and **Reset Summary State**. Each asks "Are you absolutely
sure that you want to remove table state ?" (or "summary state ?"). On **OK** your saved layout of that tab is
deleted, and the tab shows its default layout from then on. The page then says "The table layout is reset." or
"The summary layout is reset.". If the reset fails, it says "The layout was not reset. Please try again."

A reset also hides an old-site layout from you: after **Reset Summary State** you see the default
Summary, also for a survey that had an old-site layout. Other users are not affected.

The rest of the Details tab (the response count, the download of all the data, public results, the IP
setting and deleting all responses) is described in [Downloading, sharing and deleting
results](downloading-sharing-and-deleting-results.md).

## The licence banner

The charts and the table are SurveyJS Dashboard components, a commercial product. When the server has no
SurveyJS licence key, they show the library's own banner about the missing licence, and the results stay
usable. The key is set with `SURVEYJS_LICENSE_KEY` (see
[Development](../development.md#environment-variables-server)). The same key serves the editor.

## Not here yet

- The locale picker of the old table ("Choose locale...").
- The table's row actions of the old page, **Show in Survey** and **Delete Result**. There is no way yet to
  delete one response.
- The tab named in an old `#summary`, `#table` or `#info` link. An old results link opens on the Summary tab
  ([Moving from the old My Surveys](moving-from-the-old-my-surveys.md)).
