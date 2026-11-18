# ADR 0035: A compatibility bridge in front of Studio's public API

Status: Accepted (hosted Step 1, 2026-11-17). Supersedes the endpoint decisions of
[ADR 0034](0034-legacy-api-scope.md) and changes plan-hosted Steps 3 and 5–7.

## Context

At the cutover the data of `studio.surveyjs.io` moves from the legacy Azure stores to PostgreSQL and S3-compatible
storage ([ADR 0033](0033-hosted-target-stores.md)). The old Web API on `api.surveyjs.io` reads and writes the Azure
stores, so it cannot simply keep running: survey definitions edited in Studio and responses posted to the old API
would then live in two places.

The plan so far had Studio itself answer the old paths (Steps 5–6), keeping some endpoints and answering `410 Gone` for
the rest ([ADR 0034](0034-legacy-api-scope.md)). That puts legacy routes and response shapes inside Studio, makes a
usage threshold decide which integrators keep working, and leaves the site's demos and jobs on the same host to a proxy
by path (Step 7).

The old API is a service of the surveyjs.io site: about 65 actions under `public/Survey` and `private/Surveys`, plus
the site's own scheduled jobs, each under one or two prefixes (`v1` and not) and often with and without an `{id}` path
segment. Private actions authenticate with the `accessKey` query parameter, or with the site's cookie sign-in. Its
code and data access are described in the legacy documentation (private location, plan-hosted.md rule 6).

## Decision

**A separate service, the bridge, answers on `api.surveyjs.io` exactly as the old API does, and does its work through
Studio's public API.**

1. **The contract is the old API's, one to one.** Every route, method, parameter, status code, header, JSON shape
   (property names and casing, HTML-encoded fields, `dxsimage:`/`dxsfile:` answers) and error text is reproduced, for
   every action of the old API, used or not. Nothing answers `410`. The reference is the old API's behaviour,
   recorded from production as golden files (Step 5), and its code where no recording exists. Two exceptions, below:
   the actions that fail today are made to work, and the cookie sign-in is not carried over.
   - **`getSurveyAndIsCompleted` and `image` work** as their code intends: the survey with its completion state, and
     the respondent's image bytes. Today every request to them fails ([ADR 0034](0034-legacy-api-scope.md), C4), so
     nobody can depend on the failure. They get tests from the documented behaviour, since there is no successful
     answer to record.
   - **Access keys only.** The private actions also accept a cookie sign-in, which only the site's old My Surveys
     pages use (SurveyJS team, 2026-11-17). Those pages go at the cutover, so the bridge does not accept it.
2. **The bridge holds no data and no store credentials.** It translates each old call into one or more calls to
   Studio's public API (`contract/openapi.yaml`) and shapes the answer. Studio stays the only program that reads or
   writes PostgreSQL and S3, so every rule (history, partial responses, files, audit, quotas) is enforced in one place.
3. **The caller's credential passes through.** The migration copies each legacy access key into Studio's
   `legacy_access_keys` (hashed as `api_tokens` are, tied to its owner), and Studio accepts a key as a bearer token.
   The bridge forwards the `accessKey` value as the caller's bearer token, or no token for
   the public actions, so it never acts with more rights than its caller.
4. **Studio's public API covers everything the old API can do,** as ordinary features of a clean API, not as
   legacy-shaped routes: addressing a survey by its `postId` and its results by `resultId`, a respondent's completion by
   client ID, response paging and export, uploads, publish state, results layouts and permissions, history points.
   Where Studio has no concept of its own for an old setting (for example `setGenerationJSONType`, `publishVersion`),
   the API stores the value with the survey or the user so the old answer round-trips. The bridge is therefore the
   proof that the public API is complete, and its mapping is the migration guide.
5. **The bridge takes the whole host.** Paths that are not My Surveys, the site's demos and jobs (`getTempFile`,
   `uploadTempFiles`, `tempFiles`, `deleteTempFile`, `nps`, `getSurveyNPCResults`, `getSurveyNPSResults`,
   `getSurveyPublicDemoResults`, and the site's scheduled jobs), are forwarded unchanged to the old service, which keeps
   their data in Azure. The bridge reaches the old service by that service's own host name. They answer exactly as before, by
   construction. So Step 7 is a DNS switch of `api.surveyjs.io` to the bridge, which the SurveyJS team makes.
6. **Where it lives and runs:** in this repository as its own package and image, in TypeScript, with a client
   generated from `contract/openapi.yaml`, so a breaking change to the public API fails the bridge's tests in the same
   pull request. It runs next to Studio on the production server, and it caches `getSurvey` with
   `ETag`/`If-None-Match` revalidation against Studio, which absorbs the one scheduled caller that makes most of that
   traffic ([Legacy API usage](../architecture/legacy-api-usage.md#client-types-preview-2026-11-17)) while an edit in
   Studio still shows at once.

### Why not the alternatives

| Option                                                                         | Why not                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio answers the old paths itself (the plan so far, ADR 0034)                | Legacy routes and shapes inside Studio; a usage threshold decides who keeps working; the site's paths need a proxy by path                                                                         |
| The bridge reads and writes PostgreSQL and S3 directly, on Studio's store code | Two programs writing one database: they must ship together and every rule depends on both using the store layer correctly. No credential separation, and it does not prove the public API complete |
| Keep running the old API                                                       | It reads and writes the Azure stores, so the data would split, or nothing could move                                                                                                               |
| A copy of the old API's code with its storage rewritten                        | Two languages and two codebases for the same rules; the storage half, the part that matters, is new code anyway                                                                                    |

## Consequences

- **Step 3 grows and moves onto the critical path:** Studio's public API must cover the old API's capabilities
  (point 4), with tokens, before the cutover. It is needed anyway: it is what integrators move to.
- **Steps 5–6 become the bridge:** the public actions, then the access-key actions, each tested against golden files
  recorded from the old API. Nothing is retired at the cutover, so ADR 0034's decisions no longer apply; its usage data
  sets the build order (most used first) and tells which actions need a recording made on purpose, since production
  traffic never calls them.
- **Step 7 becomes a DNS switch:** the SurveyJS team points the `api.surveyjs.io` record at the bridge, which forwards
  the site's paths to the old service. The site team keeps those paths' code and data, and can move them off the host
  later, independent of this track; the bridge's forwarding list then shrinks.
- **The migration** keeps every legacy identifier the old answers expose (`postId`, `resultId`, client IDs, history
  point IDs, access keys as tokens), as [the mapping](../architecture/hosted-migration-mapping.md) already plans.
- **One more network hop** per call, on the same server; the `getSurvey` cache keeps the busiest path cheap.
- **Retiring the old API later** is deleting the bridge, once its traffic has gone; Studio does not change.
- **ADR 0034** keeps its evidence (shares, callers, days of use) and is superseded for its decisions.
