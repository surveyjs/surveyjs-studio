# Legacy golden fixtures

Synthetic, anonymised data in the **legacy storage formats** of surveyjs.io My Surveys. Every value
is made up: GUIDs follow the scheme in `docs/architecture/legacy-data-layout.md` ("Examples are
synthetic"; the last group starts with `a`, so that upper-casing an id changes it and the case tests mean something), emails use `example.com`, and the PNG is one pixel.

The spec asks for fixtures copied from the current storage. No storage copy was available in
Step 2, so these are written by hand from the layout document; confirming or extending them against
a read-only storage copy is open (see [Open for later steps](../../../docs/architecture.md#open-for-later-steps)).

They are the **shared seed** of every mode:

- the memory provider can start from them (`MEMORY_SEED=legacy-fixtures`);
- the SQL providers load them with `pnpm seed` (`server/src/cli/db.ts`; `pnpm seed:sqlite` and
  `pnpm seed:postgres` for the demo databases);
- the local Azurite and SQL Server replica is loaded from them (`pnpm legacy:load`);
- the sandbox's browser seed (`web/src/sandbox/seed.json`) is generated from a subset of them by
  `pnpm sandbox:seed`; the subset is listed in `server/fixtures/sandbox.json`;
- the surveyjs.io user-API stub (`pnpm user-api:stub`) answers from their users and licences;
- the shared provider suite (`server/src/providers/suite`) and the conformance suite run against them.

Two seed entries are added in code, not here, and only where the user directory is local: the instance
admin Ivy Instance (`server/src/providers/seed-instance-admin.ts`; the memory and SQL seeds) and a
pending invitation to Marketing (`server/src/providers/seed-invitations.ts`; the memory and SQL seeds and
the sandbox). The Azure replica and the provider suite have neither.

## Layout

| Path                                      | Content                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql/schema.sql`                          | Our own T-SQL DDL for `Users`, `Surveys`, `Organizations`, `OrganizationUsers`, `UserLicenses`, `LicenseTransfers`, with the replica indexes and keys.    |
| `sql/<Table>.json`                        | Array of rows. Keys are lower-case column names. GUIDs are strings, `tinyint` is a number or null, `datetime` is ISO `Z`.                                 |
| `tables/<account>/<TableName>.json`       | Azure Table entities in Table REST JSON: `PartitionKey`, `RowKey`, properties and `<prop>@odata.type` annotations. `<account>` is `surveys` or `results`. |
| `blobs/<account>/<container>/<blob name>` | Raw blob content. A blob name with `/` is a nested folder. Loaded as append blobs.                                                                        |
| `files/<account>/<share>/<name>`          | Raw Azure Files content. Kept for completeness; Azurite has no Files service, so nothing loads it.                                                        |

## What is in them

| Entity                       | Fixture                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Users                        | owner, admin, member, outsider, a blocked user with no display name, and Erin Erasable (no data; erasure tests only)                                                                                                                             |
| Projects                     | Marketing (created by the owner; admin changed role, member joined) and Engineering (created by the admin; the owner joined). One role is stored as `Admin`.                                                                                     |
| Surveys                      | 9 surveys: personal, project and private-API (zero creator id); published (1), unpublished (0), never switched (NULL, read as published), archived; the member's "XSS in question name" (markup in every text; read only)                        |
| Definition and history blobs | `surveyjson` and `surveytext` for five surveys; two history points for the first                                                                                                                                                                 |
| Layout blobs                 | all four containers for the first survey (`surveyresultcolumns` in the old format)                                                                                                                                                               |
| Event log                    | `surveys` table audit rows for the main operations                                                                                                                                                                                               |
| Results                      | `post{postId}` for two surveys: plain, client id and partial, IP address, inline file, `dxsimage:` reference, plus 1,500 generated rows for "API created" (see `large-survey.ts`); `SurveyCompletion{surveyId}` and one `postdelete{postId}` row |
| Files                        | one editor asset and one respondent file                                                                                                                                                                                                         |
| Licences                     | owner: expired and valid; admin: expires soon; member: a seat of the owner's valid one; outsider: no date, and a transfer                                                                                                                        |

## Changing them

1. Edit the JSON or blob files and keep them valid legacy data (check the layout document first).
   Use lower-case GUIDs and the documented Edm annotations.
2. Run `pnpm prettier --write server/fixtures` for the JSON files.
3. The expected domain objects in `server/src/providers/suite/expected.ts` are **written by hand**,
   not computed from the mapping. Update them to match, or the provider suite fails.
4. When a change touches a user, survey or project of the sandbox subset (`server/fixtures/sandbox.json`),
   run `pnpm sandbox:seed` and bump the tag file's `version`, so a browser that stored the old seed finds it
   outdated and offers a reset. A unit test fails while the committed `seed.json` is out of date.
5. Run `pnpm test:unit`.
6. The 1,500 results rows of "API created" are code, not a file: change
   `server/src/providers/azure-legacy/large-survey.ts`. Its expectations in `expected.ts` stay hand-written.
