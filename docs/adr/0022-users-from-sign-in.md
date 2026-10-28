# 22. Users from sign-in, not from a user API

Date: 2026-10-28

## Status

Accepted. Supersedes the user API half of [ADR 0018](0018-accounts-by-deployment-mode.md) (R9). The account-deleted
webhook of R9 stays.

## Context

ADR 0018 (R9) specified a surveyjs.io user API for the site team to build
([the user API document](../integrations/surveyjs-user-api.md)): four server-to-server calls behind a bearer token.
The hosted track was to switch to it before the cutover (hosted plan Step 2, spec H27), so that the app holds no
credentials for the site's `Users` table.

A review with the product owner (2026-10-28) went through what each call is used for:

| Call                       | Used for                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `GET /users/{id}`          | Sign-in (the `blocked` flag, the site's name); history author names; member answers |
| `POST /users/by-email`     | Adding a project member by email                                                    |
| `POST /users/lookup`       | Reconciliation only: owners and members whose accounts are gone                     |
| `GET /users/{id}/licences` | The licence-expiry notices of the signed-in user                                    |

Findings:

- **UserInfo already gives the signed-in user** (`sub`, `email`, `name`; [ADR 0008](0008-surveyjs-auth-oauth2-userinfo.md)).
  The other calls ask about **other** people, which an ordinary OAuth provider cannot answer. A design that needs
  only UserInfo also works with Google or GitHub sign-in later.
- **Before the cutover the API removes nothing.** In modes 1.1 and 1.2 the Azure legacy provider reads `Surveys`,
  `Organizations` and `OrganizationUsers` from the same database, so the credentials stay. `surveyjs-sql` already does
  every job of the API there.
- **`Blocked` on surveyjs.io means "no survey service", not "no sign-in".** A blocked user still signs in to the site
  and sees a reduced account page; My Surveys, published surveys and the `accessKey` API refuse them. So the sign-in
  server must not refuse blocked users for every client.
- **The sign-in server's session claims went stale.** Its `/OAuth/Authorize` built the code from the 30-day session
  cookie, so a block, a new email or a deleted account was not seen until the next interactive sign-in.

## Decision

**No user API.** The site team is not asked to build the four calls. The account-deleted webhook stays as specified.

**Until the cutover (modes 1.1 and 1.2) nothing changes.** `USER_DIRECTORY=surveyjs-sql` reads the site's `Users`
table and licences, as today.

**At the cutover (mode 1.3) users come from sign-in.** A new user directory (working name `profiles`, built in hosted
plan Step 2) keeps an app-owned table:

| Job                      | How                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The signed-in user       | Every sign-in writes the profile from UserInfo: id (`sub`), email, display name, `blocked`, last sign-in                                                          |
| Blocked users            | UserInfo's `blocked` claim; a blocked user gets no session (`403`), as with `surveyjs-sql`                                                                        |
| History author names     | The profile by id; no profile shows the entry without a name                                                                                                      |
| Adding a member by email | The profile with that email. Without one, a **pending invitation** (project, email, role, who invited) becomes a membership when someone signs in with that email |
| Existing people          | The migration seeds a profile for every user the copied data names (owners, members, history authors) from the site's `Users` table                               |
| Licence notices          | A surveyjs.io site endpoint, asked by the web app's shell for the signed-in user, in the hosted edition only                                                      |
| Deleted accounts         | The account-deleted webhook only                                                                                                                                  |

**The sign-in server** (`the site's sign-in service` in the surveyjs-site repository) re-reads the account on every
`/OAuth/Authorize`, so the code carries the current email, name and `Blocked`, and a session of a deleted account gets
no code (the session is dropped). UserInfo adds `blocked` (a boolean). Each client decides what a blocked user may do.

## Consequences

- The site team builds one small change in `the site's sign-in service` and the licence endpoint, instead of four calls with a
  service credential.
- The app keeps a copy of names and emails of the surveyjs.io users its data names. The copy is refreshed only when
  the person signs in, so a member who changed their email on the site and has not signed in since is found by the
  old address only; a new invitation to the new address still works once they sign in.
- **Reconciliation is not available with `profiles`.** A profile directory knows only who signed in or was seeded,
  so "not known" does not mean "deleted"; `missingUsers` refuses. The webhook must be reliable: the site retries it,
  and `READ_ONLY` windows return `503` so the site retries later (as today).
- **Invitations are new behaviour** and change the contract: `addMember` can answer with a pending invitation instead
  of `user-not-found`, and admins need to list and cancel invitations.
- A blocked state set after sign-in takes effect at the next sign-in, as it does now (the app session is a sealed
  cookie).
- The `surveyjs-api` directory, its stub, the user-API conformance run and `USER_API_URL` / `USER_API_TOKEN` have no
  consumer. Hosted plan Step 2 removes them.

## Open

- **`email_verified`.** Invitations trust the email that sign-in reports. That holds for surveyjs.io accounts today.
  Before another provider (Google, GitHub) can claim invitations, UserInfo must say whether the address is verified,
  and an unverified address must not claim one.
- **The licence endpoint** (its path, how the shell authenticates to it, CORS) is designed with the site team.
- **The directory's name** and whether the self-hosted `local` directory shares its table are settled in hosted plan
  Step 2 and the self-hosted track.
