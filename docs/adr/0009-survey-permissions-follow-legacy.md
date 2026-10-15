# 9. Survey permissions follow the legacy rules

Date: 2026-10-15

## Status

Accepted. The product owner has not confirmed it yet (see "If the product owner decides otherwise").

## Context

Step 4 returns `permissions.canModify` with every survey, and decides which surveys a user can see.

- `spec.md` says that any member of a project may modify its surveys, "as today".
- The current surveyjs.io code is not that. Its list shows the modify actions when the user's role in
  the current scope is `admin` (always true for Personal Surveys) **or** the user is the survey's
  creator (`MySurveyInfo.CanModifySurvey`,
  [layout, section 6](../architecture/legacy-data-layout.md#6-directory-d12)). A plain member can
  therefore see a project's surveys, but cannot change the ones that others created.
- The plan for Step 5 tests "a member without modify rights" (the editor opens read-only for such a
  member). That case does not exist if every member may modify.

## Decision

The new application reproduces the legacy rules:

| Question                | Personal survey                        | Project survey                                         |
| ----------------------- | -------------------------------------- | ------------------------------------------------------ |
| Can see (list, get)     | The user is the owner                  | The user is a member of the project, in any role       |
| `permissions.canModify` | `true` (only the owner can see it)     | The user's role is `admin`, **or** the user created it |
| Can create in the scope | Always (the user's own personal scope) | Any member                                             |

- A survey the user cannot see answers `404 not-found`, exactly like an unknown id, so the answer
  does not reveal that the survey exists.
- A survey whose creator is unknown (the legacy `creatorid` is all zeros or missing) can only be
  modified by a project admin.
- The role comes from the Directory (`getUserProject`); role names are compared ignoring case.
- The rules are one pure module, `server/src/surveys/permissions.ts`, with its own tests. The
  conformance suite checks the result for the fixture users: Mia (a member) gets `true` for
  "Campaign survey", which she created, and `false` for "Archived campaign"; Adam (an admin) gets
  `true` for both; Olivia, a plain member of Engineering, gets `false` for "Engineering retro".
- The legacy site also has a hard-coded list of site administrators who may open any survey. It is
  not reproduced: the application has no such role.

## If the product owner decides otherwise

The question is open as
[gap 12 of the layout document](../architecture/legacy-data-layout.md#11-gaps-and-open-questions).
If "any member may modify" is chosen:

- change `canModify` in `permissions.ts` to "any member of the project" for project surveys;
- change its unit tests and the conformance expectations that depend on the creator;
- the front end needs no change, because it only reads `permissions.canModify`;
- the Step 5 test of a member without modify rights goes away, because that case no longer exists.

Nothing is stored, so there is no data to migrate.

## Consequences

- The behaviour matches surveyjs.io for the people who use it today, and Step 5 can hide actions by
  `canModify` and test it.
- `spec.md` and this decision differ in wording. The spec's phrase "as today" is read as the legacy
  rule; this ADR is the record of that reading.
- A project survey created by someone who later leaves the project can be modified only by an admin.
  This is also how surveyjs.io behaves.
