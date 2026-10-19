# Moving from the old My Surveys

My Surveys used to be part of the surveyjs.io site. It is now its own application, with the same surveys, results
and projects. This page says what moved, what stays the same, and one thing that is new: **deleting your surveyjs.io
account erases your surveys here.**

## Your surveys and results came with you

Nothing was copied or imported. The new application reads the same stores as the old pages, so your surveys, their
results, their saved versions and your projects are already here, with the same ids. You sign in with the same
surveyjs.io account ([Signing in](signing-in.md)).

## Where things moved

| Before                                                 | Now                                                                                                                                                                  |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The My Surveys list at `surveyjs.io/service/mysurveys` | The survey list, the home page of the application                                                                                                                    |
| The editor, results and history pages of a survey      | The same three pages, now under `/surveys/<survey id>/…`                                                                                                             |
| The run link of a survey, `/published?id=<survey id>`  | `/s/<survey id>`                                                                                                                                                     |
| The public results link, `/Results/Survey/<result id>` | `/results/<survey id>`                                                                                                                                               |
| **Manage MySurveys** on your account page (`/manage`)  | The **Projects** page: account menu, **Projects**, or **Manage Projects** in the survey list's drop-down ([Projects and team members](projects-and-team-members.md)) |

**Old addresses still work.** Links you shared, bookmarks and the links in older articles are sent to the new address
by surveyjs.io, so a respondent who opens an old run link reaches the same survey, and anything after the `?` (the
language and prefilled answers) goes along. You do not need to change a link, although the new form is shorter. Two
things are different:

- **An old results page opens on its Summary tab**, whichever tab the link named. Choose the tab again.
- **A public results link keeps working only while "Grant Access" is on for the survey**, as before. The new address
  uses the survey id, which respondents see in the run link, so the old, hard-to-guess result id no longer keeps the
  page private: if you do not want anyone to open it, switch the access off in the Details tab
  ([Downloading, sharing and deleting results](downloading-sharing-and-deleting-results.md)).

The old addresses that **delete, archive, restore or clone** a survey with one click on a link are not redirected, and
are not kept: those actions are in the "…" menu of the survey list ([Managing a survey](managing-a-survey.md)).

An old address typed straight into the application, without surveyjs.io's redirect in front, shows **Page not found**
with a link back to My Surveys.

**Your account page stays.** `/manage` on surveyjs.io is still where you change your account and renew a licence (the
**Renew** button in a licence notice goes there). Only its My Surveys section moved.

## What stays the same

- The survey list, the "…" menu, creating, cloning, publishing, archiving and deleting a survey.
- The editor, its autosave and the themes; the saved versions on the history page.
- What a respondent sees, "Limit to one response", "Save Respondent IP", file questions and prefilled answers
  ([Publishing and collecting responses](publishing-and-collecting-responses.md)).
- The results page, its exports and who can open a project's surveys.
- The roles in a project, which are the ones you set before. The new Projects page does check a little more: a project
  always keeps an admin, and the last member cannot leave ([Projects and team members](projects-and-team-members.md)).
- Your licence notices, which come from your surveyjs.io licences.

## Deleting your surveyjs.io account erases your surveys here

When you delete your surveyjs.io account, My Surveys is told and **erases your data**. Until the surveyjs.io site sends
that message, an administrator erases the data of deleted accounts with a check that runs on a schedule, so it can
take until the next run:

- **Your personal surveys**, archived ones too, with their results, files, saved versions and saved layouts.
- **Your place in every project.** If you were the only admin, the next member of the project (by name) becomes an
  admin. If you were the only member, the project is deleted with its surveys.
- **The surveys of a shared project stay**, including the ones you created in it. Two small things of yours can
  remain: the layouts you saved on the results of surveys you do not own, and your name in the history of a project
  survey.

This cannot be undone. If you only want surveys gone, delete them from the survey list; if you want to keep a survey
for the team, **move it to a project first** (**Move to Project** in the "…" menu), because a personal survey goes with
the account. If a message is ever lost, an administrator can erase the data later, so do not rely on a deleted account
keeping its surveys.
