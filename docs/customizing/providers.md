# Writing a storage provider

A storage provider holds the app's data: surveys, results, files, projects and, with local accounts, users. You choose
one with `STORAGE_PROVIDER`. The image ships `memory`, `sqlite` and `postgres`, and the hosted build also has
`azure-legacy`. This page is for adding your own in a fork (mode 3). See [Licensing](licensing.md) first.

## The interface

A provider is a `ProviderSet`, declared in `server/src/providers/types.ts`. Everything the app stores goes through it.

| Member                      | What it holds                                                                |
| --------------------------- | ---------------------------------------------------------------------------- |
| `surveys`                   | Surveys, definitions, themes and history (`SurveyStore`)                     |
| `users`                     | The user directory (`UserDirectory`)                                         |
| `accounts`, `invitations`   | Local accounts and pending invitations; `null` unless `USER_DIRECTORY=local` |
| `projects`                  | Projects, members and roles                                                  |
| `files`                     | Files of a survey, with their bytes (`FileStore`)                            |
| `results`                   | Responses and their statistics                                               |
| `views`                     | Saved table and dashboard states                                             |
| `notices`                   | Account notices, such as a licence about to expire                           |
| `ready()`, `readinessNames` | One check per dependency, run by `/readyz`                                   |
| `close()`                   | Closes connections                                                           |

The domain types the stores use are in `server/src/domain/types.ts`. The data they describe is in the
[data model](../architecture/data-model.md): its tables, keys and the conventions for GUIDs, timestamps and JSON.

### The byte store

A SQL provider keeps file metadata in its `files` table and the bytes in a `ByteStore`
(`server/src/bytes/types.ts`), which `FILE_STORE` chooses: a folder on disk or an S3-compatible bucket. A store has
five methods: `put`, `get`, `delete`, `copy` and `probe`. Keys are `{survey id}/{file id}`, and `checkKey` refuses
anything else. To keep bytes somewhere new, implement `ByteStore` and return it from `openByteStore` in
`server/src/bytes/index.ts`.

## Where a provider is chosen

`createProviders` in `server/src/providers/index.ts` reads `STORAGE_PROVIDER` and calls the matching factory from a
registry. To add a provider:

1. Add its name to `STORAGE_PROVIDERS` in `server/src/config.ts`, and any settings it needs to the same file's schema.
   A wrong value then stops the server at start-up with a message that names the variable.
2. Write a factory that returns a `ProviderSet`.
3. Add it to the `registry` in `providers/index.ts`. TypeScript refuses the build until every name has a factory.

## A new SQL dialect

The SQL providers are one implementation with two dialects, over Kysely
([ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md)). The stores in `server/src/sql/` are written once. A new
dialect, such as MySQL or SQL Server, changes these:

1. **Open the database.** `openDatabase` in `server/src/sql/database.ts` builds a `Kysely` for a `DatabaseTarget`. Add
   a dialect to `SqlDialectName` and `DatabaseTarget`, and build the Kysely dialect there. `config.ts` fills the
   target from `DATABASE_URL` or `SQLITE_PATH`.
2. **Write the migrations.** One folder of plain SQL per dialect, `server/sql/<dialect>/NNNN-name.sql`, with the same
   versions and names as the others. A test checks that they match. Follow the
   [data model](../architecture/data-model.md).
3. **Handle the dialect's values.** Timestamps, booleans and JSON come back differently by dialect. The three helpers
   in `server/src/sql/values.ts` (`isoOf`, `flagOf`, `jsonOf`) read them. Check each for yours.
4. **Fix the queries that differ.** Most queries are shared. Locks, upserts and paging are where dialects part.
   `migrator.ts` takes a lock per dialect, so add yours.
5. **Run the suite.** A dialect is done when the suites below pass on it.

## Migrations

The server applies the pending migrations at start-up, in one transaction under a lock. It refuses a database that a
newer version migrated. To apply them without starting the server, run:

```sh
pnpm db:migrate
```

With `READ_ONLY=true` the server never migrates, and a pending migration stops the start. Add a migration as the next
numbered file in every dialect's folder. [ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md) has the rules.

## The provider suite

One suite checks that every provider behaves the same. It is the model to copy.

| File                                                | What it checks                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `server/src/providers/suite/provider-suite.ts`      | `describeProviderSuite(name, create)`: the whole `ProviderSet`, on the golden fixtures |
| `server/src/sql/*-suite.ts`                         | The SQL stores one by one, for a dialect (surveys, results, projects, migrator)        |
| `server/src/providers/suite/account-store-suite.ts` | The local account store                                                                |
| `server/src/bytes/byte-store-suite.ts`              | `describeByteStoreSuite(name, create)`: a `ByteStore`                                  |

`server/src/providers/sql.provider.test.ts` shows how a provider is wired in:

```ts
import { createSeededSqlProviders } from "./sql-suite-setup.js";
import { describeProviderSuite } from "./suite/provider-suite.js";

describeProviderSuite("sqlite (legacy fixture seed)", () => createSeededSqlProviders("sqlite"));
```

`create` returns a provider that holds the golden fixtures, and the suite calls `close()` after it. For your provider,
write a `create` that migrates a scratch database, seeds the fixtures and returns the set, and pass it the same way.
The suite uses only the `ProviderSet` interface, so any provider that passes it behaves like the others. The suite's
parts and how to run them, including against PostgreSQL and S3, are in [Testing](../testing.md#provider-suite).

The stores with a `*-suite.ts` file have one `*.test.ts` per dialect (for example `survey-store.test.ts` and
`survey-store.postgres.test.ts`). Add yours next to them.
