# Publishing and collecting responses

A survey collects responses while it is **published**. This page describes what people see when they open
it, the settings that change how it collects, and where the answers go. It works like the "Run" page of
surveyjs.io, with a few differences that are listed below.

## Publish, unpublish and Run

In the survey list, **Publish** and **Unpublish** are items of the "…" menu ([Managing a
survey](managing-a-survey.md#run-publish-and-unpublish)). **Run** is in the menu only while the survey is
published. It opens `/s/<survey id>` in a new tab, for example `http://localhost:5173/s/22222222-0000-4000-8000-a00000000001`.
That address is the **link to give to respondents**. It needs no sign-in.

- The survey must be **published**. An unknown survey and an unpublished one look the same to a respondent
  (see [the not-available page](#what-respondents-see)).
- **Archiving does not stop collecting.** An archived survey that is still published keeps accepting
  responses, as it does on surveyjs.io. Unpublish it to stop.
- **Unpublish** stops new responses at once. The responses already stored stay.
- A survey that was never switched on or off on the old site (its published flag is empty) counts as
  **not** published here. Publish it once.

## Old links keep working

A link of the old site, `/published?id=<survey id>`, opens the same survey: the address changes to
`/s/<survey id>`. Anything else in the link (`locale` and prefilled answers, see
[below](#pre-filling-answers-and-the-language)) is kept. A link without an `id` shows the not-available
page.

## What respondents see

| Page                | What it shows                                                                                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The survey          | The survey in its **theme** (the one you chose in the editor's Themes tab), without the site header or footer. The browser tab shows the survey name, or "Survey" when the name is empty      |
| The footer          | The Form Library's own block at the bottom: "Try and see how easy it is to create a survey", the logo and the "Terms of Use & Privacy Statement" link. It is the same block as on surveyjs.io |
| After the last page | The library's thank-you page ("Thank you for completing the survey"), or the thank-you text you set in the survey                                                                             |
| Not available       | A centred red line, "This survey is not currently available.", for a survey that does not exist, is not published or has a bad address                                                        |
| Loading failed      | "The survey could not be loaded. Check your connection and try again." with a **Try again** button, when the server cannot be reached                                                         |
| Already completed   | "You have already completed this survey." instead of the questions, when [Limit to one response](#limit-to-one-response) is on and this browser has answered                                  |

The run page never loads the editor or the results code, so it opens quickly.

**The brand footer loads its logo from `surveyjs.io`.** Offline, the logo is a missing image.

**Not built yet:** the orange "Disclaimer of liability" banner that surveyjs.io shows for owners without a
licence. It is open for Step 13.

## Limit to one response

"Limit to one response" lets each respondent answer once. It is on for a survey in either of two cases:

- the survey's **Limit to one response** property is filled in the editor (the property holds a cookie
  name; the Creator calls it that), or
- the survey has the old site's setting "Limit to one response" (the `usecookies` flag of a survey made
  on surveyjs.io). This application only **reads** that flag. It cannot be changed here. For such a survey
  the run page uses the survey's ID as the cookie name.

When it is on:

1. **The browser** remembers the answer. The Form Library sets a cookie with the survey's cookie name when
   the survey is completed, and shows "You have already completed this survey." on the next visit.
2. **The server** checks too. The run page keeps one random id for this browser (in the browser's local
   storage). It never sends that id: it sends an id made from it and the survey's ID, the same on every
   visit to this survey and a different one for every other survey. So the authors of two surveys cannot
   tell that the same browser answered both. After a completed response, the server refuses a second one
   for the same id (`409 already-completed`), and the page shows "You have already completed this survey.".

It is a **courtesy limit, not a lock**. It cannot stop a respondent who clears the browser's data, opens
the link in another browser, device or private window, or sends the requests without the page. Two
responses sent at the same moment from one browser may both be stored.

With the limit off, the run page does not keep an id and never refuses a second response.

## File questions

A **File Upload** or **Signature Pad** question uploads each file to the server when the respondent chooses
it. The response keeps only the file's link.

- **Any file type** is accepted, up to **10 MB per file** by default (the server setting
  `LIMIT_MAX_FILE_BYTES`). A larger file is refused with "This file is too large. A file can be up to
  10 MB." The number is your server's limit.
- A file that is not a picture or a video is stored and served as a download.
- Files are stored apart from the response, so a response with files is small.
- **A file link is public:** anyone who has the link can open the file without signing in. The link is long
  and cannot be guessed, but it is in the response, so whoever can read the response can pass it on.
- Files **stay until the survey is deleted** ([Images and files](images-and-files.md#when-you-delete-a-survey)
  covers the same for editor pictures). A file that was uploaded but whose survey was never completed also
  stays. There is no limit on the total, besides the [rate limit](../api/public-endpoints.md#rate-limits).
- **Clone** does not copy respondent files.

A response over **32,768 characters** of answers (without the files) is refused when the server stores
into the old site's tables. Other servers allow up to 1 MB. A refused response shows "Your answers are too
large to send.".

## Save Respondent IP

The survey setting **Save Respondent IP** is **off** by default. When it is on at the moment a response is
sent, the server stores the respondent's IP address with the response. It is the address of the connection;
behind a reverse proxy the server needs to know the proxy ([Public
endpoints](../api/public-endpoints.md#the-respondents-ip-address)). The setting is changed through the API
for now ([Not here yet](managing-a-survey.md#not-here-yet)). Request logs never hold the full address (the last
part is cut) and never hold answers.

## Pre-filling answers and the language

Add query parameters to the link to fill in answers before the respondent starts, as on the old site:

```text
http://localhost:5173/s/<survey id>?locale=de&name=Ann&satisfaction=4
```

- `locale` sets the survey's language, for example `de` or `fr`. For a language other than English the
  page also loads the Form Library's translations of its own texts. If that fails, the survey runs in
  English.
- **Every other parameter** is the name of a question and its answer. A value is read as JSON when it can be
  (`4` is a number, `true` a boolean, `["a","b"]` a list), else as text.

## Count the responses now

The answers are on the results page ([Viewing results](viewing-results.md)); the count of the Details tab
arrives with Step 10. A signed-in user who can see the survey can read the count through the API now:

```sh
curl -s http://localhost:5173/api/v1/surveys/<survey id>/results/stats -b "msid=<cookie value>"
```

```json
{
  "count": 2,
  "firstSubmittedAt": "2026-10-17T09:12:41.208Z",
  "lastSubmittedAt": "2026-10-17T09:15:02.774Z"
}
```

`count` is the number of stored responses. A survey without responses has `count` 0 and both times `null`.
Opening the same address in the signed-in browser shows the same JSON. The [Step 8 demo](../demo/step-08.md)
walks through it.

## Where the answers are stored

On the old site's stores, each response is one row in the survey's own results table, in the format the
old site reads. The old results pages show it. Unlike the old site, the text of the answers is stored as it
was typed, not passed through the old site's HTML cleaner. The answers of a survey are deleted with the
survey.
