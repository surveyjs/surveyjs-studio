# ADR 0037: Access keys and API tokens

Status: Accepted (hosted Step 3, 2026-11-18). Changes spec-hosted's rule "no new keys are issued"
([spec-hosted.md](../../spec-hosted.md) › Compatibility layer, Access keys) and fills in › API tokens and CORS.

## Context

Integrators call My Surveys today with a **legacy access key**: one per user, a GUID written as 32 hex digits, passed as
the `accessKey` query parameter of the old API. It acts as its owner: everything the owner can do on their personal and
project surveys. The site makes a key for a user the first time they open certain site pages, and its "generate new
key" replaces it.

Hosted Step 3 adds **API tokens** to Studio's own API (`bearerAuth` in the contract, spec-hosted H12–H14), and
[ADR 0035](0035-legacy-api-bridge.md) has the bridge pass every legacy key through to Studio as a bearer token. The spec
had legacy keys as a separate, read-only thing: shown with Revoke, never issued again.

The SurveyJS team's wishes (2026-11-18):

- every legacy key keeps working after the migration, through the bridge, with the same access level and area, unless
  its owner revokes it;
- Studio manages access keys: one list, where the old key is marked as legacy;
- an owner can only revoke the old key; new keys are a new, prefixed kind.

## Decision

**One credential list, two kinds, told apart by their prefix.**

| Kind                  | Format                                              | Rights                                                                                           | In the list                                                                       | Who can do what                                                |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Legacy access key** | as today (32 hex digits); anything not `sjs_…`      | **as today:** what its owner can do, on personal and project surveys                             | "Legacy access key", at most one per user                                         | the owner can revoke it; nobody can create one in Studio       |
| **API token** (new)   | `sjs_` + 43 characters (32 random bytes, base64url) | **one scope:** Personal (the owner's personal surveys) or one project (a project admin's rights) | named by its creator; shows the last four characters, created and last-used times | the owner (Personal) or a project admin creates and revokes it |

1. **Recognition.** A bearer value that starts with `sjs_` is looked up as an API token. Any other value is looked up
   as a legacy key, matched as the old API matches it (whether letter case counts follows the site database's
   collation; Step 3 confirms it on the replica and production). Neither kind is tried as the other, so a
   wrong value costs one lookup. Unknown, revoked or malformed: `401`.
2. **What no bearer credential can do:** manage tokens or keys, change the account, create a project, manage project
   members, delete a project. These stay with the signed-in session (cookie and CSRF), so a leaked credential cannot
   create another. No action of the old API does any of these, so the legacy kind loses nothing it has today.
   Everything else follows the kind's rights above.
   - **One exception: a credential may replace itself.** The old `generateAccessKey` lets a key replace itself, and
     the bridge holds nothing but the caller's credential. So one bearer operation, "replace the credential this
     request carries", answers `generateAccessKey` (point 5). A leaked key can do this today too.
   - **A blocked or disabled owner stops all their credentials,** as the old API refuses a blocked user's key today:
     legacy key, Personal tokens and the project tokens they created. The check runs per request, with the same short
     cache as the session check.
3. **API tokens.**
   - Shown once, at creation; only a SHA-256 hash is stored (the value is random, so a slow hash adds nothing), with
     the name, the scope, the creator, the last four characters, created, last used and revoked times.
   - **Project tokens belong to the project.** They keep working when their creator leaves the project or stops being
     an admin, and go when the project is deleted. The creator is recorded as the acting user (history author, survey
     creator) and is shown in the list; deleting the creator's account revokes their tokens.
   - Through the bridge an API token acts within its scope: on the old API a Personal token sees only the personal
     surveys.
4. **Legacy access keys.**
   - **Before the cutover** Studio reads them from the site database through the Azure legacy provider: a key the user
     regenerates on the site works in Studio at once. Studio never writes the site's key.
   - **At the cutover** the migration copies every key, hashed (SHA-256 of the lower-cased value) and tied to its owner,
     into `legacy_access_keys`, with any revocation made in Studio. Nothing expires.
   - **Revoke appears from Step 7 on.** Until the DNS switch the old API checks keys itself, so a revoke in Studio alone
     would not stop the key. Until then the row links to the site's own "generate new key". From Step 7 (a setting the
     Step 7 deployment turns on) Revoke switches the key off in Studio and the bridge, recorded in an app-owned store
     before the cutover and in `legacy_access_keys` after it. A key the owner later regenerates on the site is a new key
     and works. The setting (`LEGACY_KEY_REVOKE`) goes on once the DNS switch has held for a day, and off again first
     on a switch back ([ADR 0041](0041-taking-over-the-legacy-api-host.md), point 2).
   - The value is never shown in Studio. After the cutover only its hash exists; the cutover announcement tells
     integrators to copy their key from the site beforehand.
5. **The old `generateAccessKey`, answered by the bridge** (Step 6):
   - with a legacy key: a new legacy key that replaces it, in the old format, as today. Until the cutover the bridge
     forwards this action to the old service, which owns the key; after it, Studio replaces the hash;
   - with an API token: the token is **rotated**: the old value stops working and a new `sjs_` value with the same name
     and scope comes back.
6. **Storage.**
   - SQL providers: `api_tokens` as the next migration (`0006`) for SQLite and PostgreSQL: id, creator, project (null
     for Personal), name, hash (unique), last four, created, last used, revoked. `legacy_access_keys` follows in hosted
     Step 8 as planned.
   - Azure legacy provider: an app-owned table that legacy code never reads (spec-hosted), keyed for a lookup by hash
     and a listing by scope; it also holds the legacy-key revocations of Step 7 until the cutover.
   - Memory provider: in memory.
   - Last used is written at most once a minute per credential.
7. **CORS,** as spec-hosted: `/public/*` and bearer requests answer any origin without credentials; cookie requests stay
   same-origin; preflights are answered.
8. **The API tokens page** (surveyjs-site shell, `features.apiTokens`): the user's legacy key (if any) and Personal
   tokens, then one section per project the user administers. Create shows the value once with a copy button; revoke
   asks for confirmation.

### Why not the alternatives

| Option                                                      | Why not                                                                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Legacy keys read-only, no new keys (the spec so far)        | Studio would not manage access keys; an integrator who loses a key has nothing but a token of another kind                 |
| Access keys and API tokens as two separate systems          | Two sets of rules, pages and tests for the same job                                                                        |
| New tokens with the legacy key's user-wide reach            | One leaked token exposes every project; scopes are what H12–H14 ask for                                                    |
| Revoke in Studio before Step 7 by writing the site database | A new write to the legacy stores for a few weeks of overlap; the site's own "generate new key" already covers a leaked key |
| Try a bearer value as both kinds                            | Two lookups for every wrong value, and the kind of a credential is no longer obvious from its value or to secret scanners  |

## Consequences

- **Spec-hosted changes:** "no new keys are issued" gives way to new `sjs_` tokens; the legacy key is listed as one of
  the user's credentials. Hosted Step 3 builds the list, the tokens, the recognition, CORS and the page; Step 6 builds
  `generateAccessKey`; Step 7 turns legacy Revoke on; Steps 8–9 build and fill `legacy_access_keys`.
- **The contract** gains the token operations (list, create, revoke) and the legacy key's revoke, all session-only, and
  the bearer-only "replace this credential" the bridge needs; `bearerAuth` loses `x-phase: P1`; `createProject` and
  the member and project-deletion operations drop `bearerAuth`.
- **Plan-hosted Step 3** follows this record: the legacy key's Revoke and its store are built behind a setting that is
  off until Step 7, and the tests check both states.
- **Secret scanning** can find leaked tokens by the `sjs_` prefix (the repository's own scan and GitHub's).
- **Self-hosted installations** get API tokens with the SQL providers; the page stays in the surveyjs-site shell for now,
  and they have no legacy keys.
