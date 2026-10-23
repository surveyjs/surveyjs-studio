# 11. Survey actions: who may do what, and what each one changes

Date: 2026-10-15

## Status

Accepted. The product owner has not confirmed rulings R1, R2, R5 and R13 yet (see "For the product owner
to confirm").

## Context

Step 5 builds the row actions of the My Surveys page: rename, publish and unpublish, clone, move to a
project, archive and restore, delete, and copying the IDs. The contract (`updateSurvey`, `deleteSurvey`,
`cloneSurvey`), `spec.md` and the plan leave open a number of questions, and the current surveyjs.io
code answers some of them in ways that do not fit the contract or that look like gaps. Each ruling below
says what the legacy site does, what this application does and why. The legacy behaviour is described in
[layout, section 5](../architecture/legacy-data-layout.md#5-event-model) and in the
[writing rules of ADR 0010](0010-writing-to-the-legacy-stores.md).

## Decision

| #   | Question                                              | Ruling                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Who may change (any field, rename included) or delete | Users with `canModify` ([ADR 0009](0009-survey-permissions-follow-legacy.md)). A survey the user can see but not modify answers `403 forbidden`; an invisible or unknown one answers `404 not-found`                                             |
| R2  | Who may clone, where the copy goes, who creates it    | Anyone who can see the source. The copy goes to the source's scope, or to the caller's Personal surveys (`projectId: null`), or to a project the caller belongs to (else `403`). The **caller** is the creator                                   |
| R3  | The name of a clone                                   | The given `name`, or `Copy of {source name}` cut to 200 UTF-16 code units without splitting a surrogate pair                                                                                                                                     |
| R4  | What a clone contains                                 | The definition and the theme. Published like a new survey (empty flag, Step 14), not archived, every setting off, new `id`, `postId` and `resultId`, `createdAt` = `updatedAt` = now                                                             |
| R5  | What a move does                                      | A project id different from the current scope sets the owner to it and the **creator to the caller**. `null` moves to the **caller's** Personal surveys. The caller must belong to the target project (else `403`). The current scope is no move |
| R6  | `updatedAt`                                           | Every successful `PATCH` sets it to now, even when no value changes                                                                                                                                                                              |
| R7  | Names                                                 | Kept as sent, no trimming. Blank after trimming, or longer than 200 UTF-16 code units: `422` at `/name`                                                                                                                                          |
| R8  | Delete                                                | Checks: `404`, `403`, then `409 survey-not-archived`. The cascade covers the definition, theme, history, results, completion markers, deleted-result audit and saved results layouts. Children first, the record last, repeatable                |
| R9  | Files on delete                                       | None in Step 5. No file store exists, and legacy editor assets are not linked to a survey. Step 7 adds files to the cascade                                                                                                                      |
| R10 | Archive and published                                 | Archiving does not unpublish                                                                                                                                                                                                                     |
| R11 | A patch with several fields                           | One store call applies every field at once (one SQL `UPDATE`). The audit rows follow, best effort                                                                                                                                                |
| R12 | The menu                                              | The legacy items, order and conditions, plus "Personal Surveys" in **Move to Project** clickable inside a project                                                                                                                                |
| R13 | Confirmations                                         | Native `window.confirm` with the legacy texts, for Move and Delete only                                                                                                                                                                          |
| R14 | After an action                                       | Stay on the list, except Move, which opens the target scope's Active list                                                                                                                                                                        |
| R15 | Where Edit, View Results, View History and Run lead   | `/surveys/{id}/edit` (the existing stub), `/surveys/{id}/results` and `/surveys/{id}/history` (new placeholders), and `/s/{id}` in a new tab (a new public placeholder)                                                                          |

### R1: who may change or delete

The contract says "Requires modify permission". The legacy **server** lets any member of a project
rename, publish and archive its surveys; the legacy **page** hides those items from a member who is not
an admin and did not create the survey, except the pencil. This application follows the rule of the
page, applied to every field, so the server enforces what the page shows. It is the same rule as
`canModify` in ADR 0009, and the plan for this step expects "a member without modify rights" to see no
modifying items. A survey that is visible but not modifiable is `403`, not `404`: the user already sees it
in the list, so hiding its existence would help nobody. The legacy pencil is therefore **also** hidden
without modify rights (the page-only rule would have shown it for an action the server refuses).

### R2: clone

Legacy shows Clone to every member and keeps the source's creator, which gives a plain member a copy that
the member cannot modify, with the items hidden. Here the **caller** made the copy, so the caller is its
creator and can work with it. The target defaults to the source's scope (the same list, as in legacy).
`projectId` is an addition of the contract: `null` is the caller's Personal surveys, and a project needs
membership, like creating a survey.

### R3 and R4: the name and the contents

The text `Copy of ` comes from legacy. Legacy does not cut it, and fails on a name near the column limit;
the copy is cut to the 200 UTF-16 code units that fit the `name` column (never in the middle of a
surrogate pair). What is copied is what the contract says (definition and theme) and what legacy copies;
results, history and settings are not copied. A source without a definition gives a copy without one
(it reads `{}`).

**Step 14 change (R4).** A copy was "Unpublished" because the mapping read the empty (`NULL`) published flag as
not published. Clone still writes no flag, as legacy does, and an empty flag now means published
([ADR 0014](0014-run-page-and-response-collection.md) S1), so a copy is published like a new survey, whatever
the source's state.

### R5: move

Legacy moves a survey with the event `SURVEY_TRANSFER`, which writes the target as owner and the acting
user as creator. This application keeps it, so the stored result is the same and the legacy site shows the
same thing afterwards. Two points differ from legacy. The target project must be one the caller belongs to
(the contract requires it; legacy does not check, which is a gap: a user who knows a project id could put a
survey into it). And `projectId: null` is a value of the patch, meaning the caller's Personal surveys: the
legacy menu cannot move a survey back (R12 adds it, because the plan's demo needs it). Because the creator
changes, a user can lose the right to modify a survey by moving it, or gain it: a project's admins can
always modify, and the mover is the creator. The user guide says so.

### R6: `updatedAt`

Legacy rewrites the row, and its `timestamp`, on every action
([layout, section 5.3](../architecture/legacy-data-layout.md#53-what-a-writer-must-do-so-legacy-readers-see-a-change)),
so a list sorted by update shows an acted-on survey first, even when nothing changed. The contract's
sort is "newest `updatedAt` first". Keeping the legacy behaviour keeps both.

### R7: names

The same rule as creation ([ADR 0010](0010-writing-to-the-legacy-stores.md)): kept as sent; a blank name or
one longer than 200 UTF-16 code units is `422` at `/name`. The web page sends no request for a blank or an
unchanged name, so the user gets no error for it (the box just closes).

### R8 and R9: delete

The contract requires `409 survey-not-archived` unless the survey is archived. The order of the checks is
`404`, `403`, `409`, so a user is never told about the state of a survey that is not theirs to change. The cascade
deletes the children first and the record last, and tolerates a missing child, so a failure part of the
way leaves a survey that is still listed (it is archived) and a second delete finishes the work. Legacy
leaves the results-layout blobs behind; a deleted survey here leaves nothing. Files are not in the cascade
yet: there is no file store, and legacy editor assets are not tied to a survey
([layout, section 3.9](../architecture/legacy-data-layout.md#39-uploaded-files)). Step 7 adds them.

A restore that lands between the archived check and the store delete could let an active survey be
deleted. The window is tiny and legacy has the same race. A future fix is a conditional delete.

### R10 and R11

Legacy archives without unpublishing, so an archived survey that was published stays published. Whether
an archived survey still runs for respondents is for the run page (Step 8). A request with several fields
(for example `published` and `archived`) is applied with one `UPDATE`, so the record never shows half of
a request. The audit rows are written afterwards, one per change, and are best effort.

### R12 to R15: the page

- **Menu.** The items, their order and their conditions are the legacy ones (see the
  [user guide](../user-guide/managing-a-survey.md)). The markup, classes and texts are copied from the
  surveyjs.io page on purpose (D14). Three changes were needed: the separators are `li` elements and the
  `survey-canmodify` wrapper divs are not rendered (a `div` directly inside a `ul` is invalid HTML);
  "Personal Surveys" is clickable inside a project (R12); and the `role="button"` of the menu sits on the
  dots container (and on the flyout's text), **not** on the outer drop-down div, because that div
  contains the menu's links, and a button must not contain links.
- **Confirmations (R13).** Move and Delete ask with the browser's own dialog and the legacy texts,
  "organization" included. Archive, Restore, Publish, Unpublish and Clone ask nothing, as in legacy.
- **After an action (R14).** The list stays and refreshes. A move leaves the list the survey is gone from
  and opens the Active list of the target, as legacy redirects there.
- **Targets (R15).** Edit, View Results, View History and Run lead to the routes the spec names. The last
  three, and Run, are placeholders until Steps 6, 8 and 9 build them. Run opens `/s/{id}` in a new tab.
- **A rename that is blank or unchanged** sends no request.

## Consequences

- A move changes the creator, so rights can change with it (R5).
- A failed theme `UPDATE` after a clone's row insert fails the clone with `500` and leaves a copy without
  its theme. There is no rollback; a compensating delete of the copy is the natural fix if it matters
  ([ADR 0010](0010-writing-to-the-legacy-stores.md)).
- Two quick clicks on Clone create two copies: the page has no double-click guard, as the legacy page has
  none.
- The menu's last items can sit under the fixed cookie banner and the footer on a short viewport for a
  first-time visitor. Settled in Step 13: it stays as surveyjs.io has it (ADR 0020).
- The page checks nothing the server does not check: hiding items is a convenience, and the server answers
  `403` or `404` for every request regardless.

## For the product owner to confirm

These four rulings are choices between the legacy behaviour and the contract or a safer reading. Until
the owner confirms them, they stand as written.

- **R1:** the modifying actions need `canModify`, and the server enforces it for every field
  (legacy: the page hides items, the server checks nothing). If the owner wants any member to be able to
  rename, publish and archive, change `canModify` ([ADR 0009](0009-survey-permissions-follow-legacy.md)).
- **R2:** the caller is the creator of a clone (legacy keeps the source's creator).
- **R5:** a move makes the caller the creator, and needs membership of the target project (legacy has
  no check), and `null` moves to the caller's Personal surveys.
- **R13:** confirmations are the browser's native dialogs, for Move and Delete only. A styled dialog is
  a later polish.
