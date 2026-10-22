# Redirect map for the old My Surveys addresses

For the surveyjs.io team. The new app **keeps no legacy URL** ([ADR 0018](../adr/0018-accounts-by-deployment-mode.md),
decision D19 of the product idea): `/published`, `/Service/*` and `/Results/*` are ordinary unknown addresses there
(the server answers `404`, and the web app shows "Page not found"). The surveyjs.io site makes the redirects, so that
links already shared, bookmarks, release notes and menus keep working. This page is the map.

## The rules for every redirect

- **Match the path in any letter case.** The site's router does (`/service/mysurveys` and `/SERVICE/MYSURVEYS` are one
  address). Ids are GUIDs and parse in either case.
- **GET only.** Redirect nothing else.
- **`301 Moved Permanently`.**
- **A host-relative `Location`**: a path that starts with `/`, never built from the request's `Host` header. If the new
  app is served from another origin, put that origin, a fixed value from the site's configuration, in front of the
  same paths.
- **Keep the query string.** Where the table moves a member into the path, drop that member and carry the rest.
- Redirect before the sign-in challenge. A signed-out visitor lands on the new app and signs in there.
- Keep the redirects for a long time. Links outside the site (customer pages, emails, QR codes) are their real users,
  and nobody knows how many there are; the front-door logs would tell.

## The map

`{id}` is a survey id, `{orgId}` a project id and `{resultId}` the old result id (not a survey id).

| Old address (any case)                                                    | New address                     | Notes                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/service/mysurveys`                                                      | `/`                             | The old list remembers the last project for 24 hours in a cookie; the redirect cannot, so the new list opens on Personal       |
| `/Service/MySurveys/personal`, `/Service/MySurveys?id=personal`           | `/?project=personal`            | Personal is also what the new list shows without a project                                                                     |
| `/Service/MySurveys/{orgId}`, `/Service/MySurveys?id={orgId}`             | `/?project={orgId}`             | The old list shows Personal for an id that is unknown or not the user's. The id is not validated, so the redirect passes it on |
| any of the three above with `?type=archived`                              | the same, with `&archived=true` | `type=list` or no `type`: leave it out. The old site compares `personal` and `archived` in lower case only                     |
| `/Service/EditSurvey/{id}`, `/Service/EditSurvey?id={id}`                 | `/surveys/{id}/edit`            |                                                                                                                                |
| `/Service/SurveyResults/{id}`                                             | `/surveys/{id}/results`         | **The results tab is lost.** See below                                                                                         |
| `/Service/History/{id}`                                                   | `/surveys/{id}/history`         |                                                                                                                                |
| `/published?id={id}`, `/Published/Index/{id}`, `/Published/Index?id={id}` | `/s/{id}`                       | `id` moves into the path; every other member (`locale`, prefilled answers) is kept. See "The run address"                      |
| `/Service/RunSurvey/{id}`                                                 | `/s/{id}`                       | The old site answers with a plain redirect to `/published?id=` and forgets the query. Nothing on the site links to it          |
| `/Results/Survey/{resultId}`, `/Results/Survey?id={resultId}`             | `/results/{surveyId}`           | **Needs a lookup** from the result id to the survey id. See "Public results"                                                   |
| `/manage` with the section `#manage-mysurveys`                            | `/projects`                     | See "The account page"                                                                                                         |

### The results tab is lost

The old results page shows its tab in the **URL fragment** (`#summary`, `#table`, `#info`). A fragment never reaches a
server, so no redirect rule can read it. A browser does re-attach the old fragment to the redirect target when the
target has none, but the new app does not read fragments. The visitor lands on the Summary tab. The new address could
carry the tab as `?tab=summary`, `?tab=table` or `?tab=details` (the old "info" is the new "Details"), so a link that
the site rewrites itself, such as one in release notes, can name a tab.

### The run address

- The old run link is `/published?id={id}`. There is no `/published/{id}` form and no embed script address; a survey
  is embedded as a frame of the run address.
- Every query member other than `id` and `locale` is a **prefilled answer** on the old page, set as `name=value`. The
  redirect must carry the whole query string, minus `id`. Treat `?ID=` and `?Id=` like `?id=`: the old router binds
  the name in any case.
- **A link that holds a publish id.** The old page looks the `id` up as a _publish id_ first and as a survey id
  second. A publish id is set only by a hidden API, so such links are rare, but the new `/s/{id}` takes a survey id
  only. The site can resolve the publish id to the survey id first, or the loss is accepted. Question 5 of
  [the user API document](../integrations/surveyjs-user-api.md#questions-for-the-surveyjsio-team) asks whether any
  exist.
- A missing, empty or malformed `id` is not redirected: let it fall through (`404`), as the old page shows an empty
  survey.
- The new run page treats only `locale` as reserved. If the site leaves an `id` in the query by mistake, it becomes an
  answer named `id`.

### Public results

The old public results link carries `{resultId}`, a different GUID from the survey id (`Surveys.resultid`). The
redirect needs **one indexed read** of the site's SQL, from `resultid` to the survey id. If a survey is found, redirect
to `/results/{surveyId}`; if not, answer `404`.

Two consequences to accept:

- The old link works only while public results are switched on for the survey, as before. The new page checks that
  too, and shows "not available" otherwise.
- **The old result id stops being a secret.** It was unguessable and was not the survey id. The new address uses the
  survey id, which every respondent sees in `/s/{id}`. That change is part of the product plan, and the redirect makes
  it visible: anyone who has the survey id can open the public results page if the survey allows it.

### The account page

`/manage` stays: the new app's **Renew** action points to it. Only its **Manage MySurveys** section (`#manage-mysurveys`)
goes. The fragment never reaches a server, so an old bookmark of `/manage#manage-mysurveys` opens `/manage` and
scrolls to nothing. To bring such a visitor to the Projects page, give `/manage` a link to `/projects` where the section
was, or a small script on that page that sends `#manage-mysurveys` there. Do not remove the section's endpoints
(`writeOrganization`, `addUserToOrganization`, `removeUserFromOrganization`, `changeUserRoleInOrganization`) until the
new app owns projects: **both apps writing `OrganizationUsers` is the migration risk**, because the new rules differ
([ADR 0017](../adr/0017-projects-and-members.md)).

## Never redirect

- **The state-changing GET links**: `/Service/CloneSurvey/{id}`, `/Service/DeleteSurvey/{id}`,
  `/Service/ArchiveSurvey/{id}`, `/Service/RestoreSurvey/{id}` and `/Service/ChangeOrganizationSurvey/{id}`. On the
  old site they do their work on a plain GET, with no verb check and no anti-forgery token, and are reached only from
  the list's menu. A stale bookmark or a crawler must never cause a delete anywhere. Let them answer `404`, or send
  them to the list page.
- `POST /Service/Create/{id}`: it is not a link.
- `/Service/AuthorizationError` and `/Service/InvalidSurveyError`: error pages the old actions bounce to.
- `/Service/ExportResults/{id}` and `/Results/ExportResults/{id}`: stubs that answer `204`.
- `/Service/PresetsEditor`, `/Service/SurveyNPS` and a bare `/Service`: not My Surveys pages.

## What else changes on the site

- **The top bar's "My Surveys" button** (`/service/mysurveys`) points to the new app.
- **`/create-free-survey` and `/creator-presets-editor` share the old My Surveys views** (`Service/EditSurvey` and
  `Service/PresetsEditor`). Deleting those views breaks the free creator page, a marketing entry. Keep a trimmed copy
  for the anonymous creator, or repoint it to the new app's demo mode.
- **Account deletion**: replace the loop that deletes My Surveys data with the
  [account-deleted webhook](../integrations/surveyjs-user-api.md#the-account-deleted-webhook), once the new app owns
  the surveys. Keep the site's own user deletion.
- **Hard-coded run links** (the editor script and the list menu) go with the old views. The release notes and the
  example document that link to `/service/mysurveys` are covered by the redirect to `/`.
- **Page metadata** for `/service/mysurveys`, and the "My Surveys" copy on the free survey tool page, need edits.
- **The site's router tests** assert the `published` route; they need the new rules.
- **Do not delete the shared storage code** unless `api.surveyjs.io` is retired: it still uses it. Survey files
  referenced by `api.surveyjs.io` links stop working only if that API is retired.
- **The `organizationId` cookie** that the old list sets is harmless once nothing reads it.

## Where the rules can live

The site's redirect middleware already sees every GET first and has a table of rewrites; it has no rule for My Surveys
today. It is the natural home for these, and it can do the two lookups (the result id and the publish id) in SQL. If
the rules can only live in front-door rules, the front door has no lookups: public results links then need a small
resolver endpoint, and publish-id links are lost. (Question 6 of the user API document.)

## How to check

On the local app, `http://localhost:5173/published?id=22222222-0000-4000-8000-a00000000004` shows "Page not found", and
`curl -i "http://127.0.0.1:3000/published?id=22222222-0000-4000-8000-a00000000004"` answers `404` with no `Location`
([the Step 12 demo](../demo/step-12.md)). The conformance suite checks the same (`legacy-urls.test.ts`).
