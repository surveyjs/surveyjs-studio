# Architecture decision records

An ADR records one decision that is hard to see from the code: the context, the choice and its
consequences. Use the format from [ADR 0001](0001-record-architecture-decisions.md). Number them
in order, never edit an accepted ADR to change its decision (add a new one that supersedes it),
and add each one to this index.

| No.                                                        | Title                                                                           | Status   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)              | Record architecture decisions                                                   | Accepted |
| [0002](0002-node-24-lts.md)                                | Node.js 24 LTS                                                                  | Accepted |
| [0003](0003-custom-contract-loader.md)                     | Build routes from the contract with our own loader                              | Accepted |
| [0004](0004-body-limit.md)                                 | Request body limit equals the response size limit                               | Accepted |
| [0005](0005-respondent-files-as-urls.md)                   | Respondent files are stored as URLs (D11)                                       | Accepted |
| [0006](0006-legacy-replica.md)                             | SQL Server 2022 next to Azurite for the legacy replica                          | Accepted |
| [0007](0007-dev-identity-provider.md)                      | A development identity provider, outside the contract                           | Accepted |
| [0008](0008-surveyjs-auth-oauth2-userinfo.md)              | Sign in to auth.surveyjs.io as an OAuth 2.0 client, with identity from UserInfo | Accepted |
| [0009](0009-survey-permissions-follow-legacy.md)           | Survey permissions follow the legacy rules                                      | Accepted |
| [0010](0010-writing-to-the-legacy-stores.md)               | Writing to the legacy stores                                                    | Accepted |
| [0011](0011-survey-actions.md)                             | Survey actions: who may do what, and what each one changes                      | Accepted |
| [0012](0012-editor-content-and-history.md)                 | The editor, survey content and history                                          | Accepted |
| [0013](0013-editor-uploads-and-files.md)                   | Editor uploads and file serving                                                 | Accepted |
| [0014](0014-run-page-and-response-collection.md)           | Run page and response collection                                                | Accepted |
| [0015](0015-results-summary-table-and-views.md)            | Results: Summary, Table and saved layouts                                       | Accepted |
| [0016](0016-results-details-exports-and-public-results.md) | Results: Details, exports and public results                                    | Accepted |
| [0017](0017-projects-and-members.md)                       | Projects and members                                                            | Accepted |
| [0018](0018-accounts-by-deployment-mode.md)                | Accounts by deployment mode (its user API superseded by 0022)                   | Accepted |
| [0019](0019-run-page-isolation-and-security-headers.md)    | Run page isolation and security headers                                         | Accepted |
| [0020](0020-visual-parity-baselines.md)                    | Visual parity baselines                                                         | Accepted |
| [0021](0021-production-image-and-web-serving.md)           | The production image and web serving                                            | Accepted |
| [0022](0022-users-from-sign-in.md)                         | Users from sign-in, not from a user API                                         | Accepted |
| [0023](0023-sqlite-driver-node-sqlite.md)                  | The SQLite driver: Node's built-in `node:sqlite`                                | Accepted |
| [0024](0024-kysely-and-plain-sql-migrations.md)            | Kysely and plain-SQL migrations                                                 | Accepted |
| [0025](0025-file-storage-for-the-sql-providers.md)         | File storage for the SQL providers                                              | Accepted |
| [0026](0026-revoking-stateless-sessions-with-an-epoch.md)  | Revoking stateless sessions with an epoch                                       | Accepted |
