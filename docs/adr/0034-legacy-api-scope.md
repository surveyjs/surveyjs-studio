# ADR 0034: The scope of the legacy API compatibility layer

Status: **Superseded** for its decisions by [ADR 0035](0035-legacy-api-bridge.md) (2026-11-17): a bridge answers
every old action exactly, so nothing is retired and `changeJson` needs no decision. The evidence below (shares, callers,
days of use) still stands and sets the bridge's build order.

## Context

At the cutover the app answers the My Surveys paths of `api.surveyjs.io` itself (hosted Steps 5–7). The spec keeps the
public endpoints and lets usage decide the private ones ([spec-hosted.md](../../spec-hosted.md) › Compatibility layer).
[Legacy API usage](../architecture/legacy-api-usage.md) lists the endpoints and, since 2026-11-13, their measured use
over 30 days from the old service's monitoring: shares, callers in plain words, days of use. The counts are private
(plan-hosted.md, rule 6).

The measurement has limits, all stated there: sampling, gaps in the data, and no client types until the HTTP logs have
collected some. It is good enough to decide by, because the decisions below rest on whether an endpoint is used at all
and by how many steady callers, not on exact counts.

The SurveyJS team said on 2026-11-13 that `getTempFile`, `uploadTempFiles` and the `nps` endpoints serve the
surveyjs.io site's demos and are not needed by SurveyJS Studio.

## Decision

### Criteria

| #   | Rule                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | **A public endpoint the Form Library calls is kept** when it was seen in the 30 days.                                                                                                                                                                                                            |
| C2  | **A private endpoint is kept** when a caller other than the old surveyjs.io pages uses it on **7 days or more** of the 30. Seven days separate steady use from a one-off script or a test; under sampling a steadily used endpoint is still seen on most days, while a single day can be a probe |
| C3  | **Calls from the old surveyjs.io pages do not keep an endpoint:** those pages go when My Surveys moves (mode 1.2). Their pattern in the data is many keys, each on a few days, from web pages on another origin                                                                                  |
| C4  | **An endpoint that never succeeds today is kept working, not kept failing,** when C1 keeps it: nobody can depend on its failure, and its documented behaviour is small. It gets tests from the documented behaviour instead of golden files, since there is no successful answer to record       |
| C5  | **Everything else answers `410 Gone`** with the migration guide (Step 6). The `410` count per endpoint is watched after the cutover (Step 7), so a caller the 30 days missed is found and told                                                                                                   |
| C6  | **What is not My Surveys stays on the old service:** the site's demos and scheduled jobs on the same host. The compatibility layer neither serves nor retires them                                                                                                                               |

### Endpoints

`…` is `public/Survey` or `public/v1/Survey`; private paths are under `private/Surveys` (both with and without `v1`).

| Endpoint                                                                                                                                                                                    | Decision                               | Why                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `…/getSurvey`                                                                                                                                                                               | Keep                                   | C1; most of all traffic                                                                   |
| `…/getResult`, `…/isCompleted`                                                                                                                                                              | Keep                                   | C1                                                                                        |
| `…/getSurveyAndIsCompleted`                                                                                                                                                                 | Keep, working                          | C1, C4: every request fails today                                                         |
| `…/file`                                                                                                                                                                                    | Keep                                   | C1                                                                                        |
| `…/image`                                                                                                                                                                                   | Keep, working                          | C1, C4: every request fails today (layout gap 14)                                         |
| `…/post`                                                                                                                                                                                    | Keep                                   | C1                                                                                        |
| `…/upload`                                                                                                                                                                                  | Keep                                   | C1: seen, though on one day only                                                          |
| `…/post/page-number`                                                                                                                                                                        | `410`                                  | C5: not seen, in the unsampled HTTP logs either (preview, 2026-11-17)                     |
| `files?name=`                                                                                                                                                                               | Keep                                   | Public in practice (no key); legacy image URLs in survey JSON depend on it                |
| `getSurveyPublicResults/{id}`                                                                                                                                                               | Keep                                   | Public in practice (no key); public results links                                         |
| `getActive`                                                                                                                                                                                 | Keep                                   | C2: steady callers                                                                        |
| `getSurveyInfo`                                                                                                                                                                             | Keep                                   | C2: steady callers. The provisional `410` is reversed                                     |
| `getSurveyResults/{id}`                                                                                                                                                                     | Keep                                   | C2                                                                                        |
| `exportSurveyResults`                                                                                                                                                                       | Keep                                   | C2                                                                                        |
| `deleteResult`                                                                                                                                                                              | Keep                                   | C2: one caller, on enough days                                                            |
| `changeJson`                                                                                                                                                                                | **Open**, leaning `410`                | Mostly the old editor (C3). HTTP logs preview: one outside page on one day, so C2 not met |
| `getSurveyDemoResults`                                                                                                                                                                      | `410`                                  | C3: the site's My Surveys section (confirmed 2026-11-17); it stops calling at the cutover |
| `changeTheme`, `changeName`, `uploadFiles`                                                                                                                                                  | `410`                                  | C3: the old editor                                                                        |
| `publish`, `unpublish`, `deleteAllResults`, `archive`, `makeResultPublic`, `storeIpAddressInResult`, `setResultSummaryState`, `setResultTableState`, `setResultPermissions`                 | `410`                                  | C2 not met: one or two days, or the old pages' writes                                     |
| `getArchive`, `getIsPublished`, `getHistoryPoint`, `changeOrganization`, `setUseCookies`, `publishVersion`, `changeVersionTitle`, `generateAccessKey`, the survey create and delete actions | `410`                                  | C5: not seen                                                                              |
| Names that were only probed (`removeResults`, `clearResults`, `resetResults` and similar)                                                                                                   | `404`, as any unknown path             | Not endpoints of the old API                                                              |
| `getTempFile`, `uploadTempFiles`, `tempFiles`, `nps…`, `getSurveyNpcResults`, `getSurveyPublicDemoResults`, the site's scheduled jobs                                                       | Not served: the old service keeps them | C6: the site's demos and jobs                                                             |

## Consequences

- **Steps 5 and 6** build the kept endpoints with golden files, except the two C4 endpoints, which get tests from the
  documented behaviour. Step 6 builds the `410` answer and the migration guide for the rest.
- **Step 7 cannot switch the whole host by DNS:** the C6 endpoints stay on the old service. The switch is a proxy rule
  set by path (the plan's first option), or the site team moves the demos and jobs to another host first. Recorded in
  the plan's Step 7 inputs.
- **The kept private endpoints have few callers.** Before the cutover the SurveyJS team can contact them by access
  key, with the migration guide, besides the general announcement.
- **One scheduled server-side job makes most of the `getSurvey` traffic** (HTTP logs preview, 2026-11-17,
  [Legacy API usage › Client types](../architecture/legacy-api-usage.md#client-types-preview-2026-11-17)). It sends no
  access key, so the SurveyJS team finds its owner from the surveys it reads and contacts them before the cutover
  (owner found 2026-11-18).
  Step 7 sizes the app for its steady rate.
- **Paths with and without a trailing slash** are both in use (`post/` more than `post`); Step 5 serves both.
- **The site's My Surveys section calls `getSurveyDemoResults`** today: the site stops calling it at the cutover,
  since its data is no longer in Azure after the move.
- **`changeJson` is decided with query 5** of [the usage queries](../operations/legacy-api-usage-queries.md), once the
  HTTP logs hold one or two weeks: kept if pages outside surveyjs.io or servers call it on 7 days or more (C2), `410`
  otherwise. The preview of their first days showed no such caller, and no `post/page-number` call.
