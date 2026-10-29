# Data model (SQL providers)

Status: self-hosted track Step 3 (2026-10-29). The tables of [Built](#built) exist; the tables of
[Planned](#planned) are the model the later steps build, and each step may refine its own tables in the same PR
that adds their migration.

This is the logical schema of the SQL providers: SQLite and PostgreSQL, one implementation with two dialects
([ADR 0023](../adr/0023-sqlite-driver-node-sqlite.md), [ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md)).
The self-hosted image uses it, and the hosted service moves to it in mode 1.3 ([spec-hosted.md](../../spec-hosted.md)
› Data model and mapping). The legacy Azure layout it replaces is in [legacy-data-layout.md](legacy-data-layout.md).

## Conventions

| Kind          | PostgreSQL       | SQLite                                                                   | In the code (`server/src/sql/values.ts`)                                                                                                                       |
| ------------- | ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GUID          | `uuid`           | `text`, lower-case                                                       | A lower-case string. A value that is not a GUID matches no row and is never sent to the database (paging cursors of surveys and history accept GUID ids only). |
| Timestamp     | `timestamptz(3)` | `text`, ISO 8601 UTC as `Date#toISOString` writes it (`…T10:00:00.000Z`) | Written as that text; read back in the same form (`isoOf`). In SQLite text order is time order.                                                                |
| Boolean       | `boolean`        | `integer`, 0 or 1                                                        | `flagOf`                                                                                                                                                       |
| JSON document | `jsonb`          | `text`                                                                   | Written as `JSON.stringify` text; read with `jsonOf`.                                                                                                          |
| Other text    | `text`           | `text`                                                                   |                                                                                                                                                                |

Two consequences of `jsonb`:

- **Key order is not kept.** PostgreSQL stores an object's keys in its own order. Nothing reads meaning into key order
  (the Creator builds its model from the JSON), but the text read back can differ from the text written. That is why a
  document's **version token is stored** (`definition_version`, `theme_version`: the SHA-256 of the JSON text
  written, as in the memory provider) and never computed from what is read back.
- **`\u0000` is refused** inside a JSON string. The legacy data is checked for it in the hosted migration mapping.

Ids are kept as the domain gives them: survey, Post, Result, response, history entry, project and user ids are GUIDs;
file ids are 64 lower-case hex digits ([ADR 0013](../adr/0013-editor-uploads-and-files.md)).

Migrations are plain SQL, one set per dialect, `server/sql/{sqlite,postgres}/NNNN-name.sql`, with the same versions and
names in both. The table `schema_migrations` (`version` integer key, `name`, `applied_at`) records what is applied
([ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md)).

## Built

### `surveys` (0001)

One row per survey: the record, the definition and the theme. `SurveyStore` (`server/src/sql/survey-store.ts`).

| Column                | Type              | Notes                                                                                         |
| --------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `id`                  | GUID, primary key |                                                                                               |
| `name`                | text              |                                                                                               |
| `owner_user_id`       | GUID, null        | Set for a personal survey. Exactly one of the two owner columns is set (`surveys_one_owner`). |
| `owner_project_id`    | GUID, null        | Set for a project survey. Self-hosted Step 2 adds the foreign key to `projects`.              |
| `creator_id`          | GUID, null        | null for legacy rows whose creator is the all-zero GUID                                       |
| `post_id`             | GUID, unique      | The legacy public id; the hosted compatibility layer looks surveys up by it                   |
| `result_id`           | GUID, unique      | The legacy public results id                                                                  |
| `published`           | boolean           | A new survey is published (ADR 0014 S1)                                                       |
| `archived`            | boolean           |                                                                                               |
| `public_results`      | boolean           |                                                                                               |
| `store_respondent_ip` | boolean           |                                                                                               |
| `use_cookies`         | boolean           | Legacy only: never changed by the app                                                         |
| `created_at`          | timestamp         |                                                                                               |
| `updated_at`          | timestamp         | Moves on every record change and every definition or theme save                               |
| `definition`          | JSON, null        | null: none stored, read as `{}`                                                               |
| `definition_version`  | text              | The version token of `definition` (the hash of `""` when none)                                |
| `theme`               | JSON, null        | null: none stored, read as `{}`                                                               |
| `theme_version`       | text              | The version token of `theme`                                                                  |

Indexes: `surveys_personal_list` (`owner_user_id`, `archived`, `updated_at` desc, `id`) and `surveys_project_list`
(`owner_project_id`, …), both partial on their owner column. They serve the survey list and its keyed paging
(`listSurveyPage`: `updated_at` descending, then `id` ascending), so a page is a seek, never a scan.

A save is one statement: `update … set definition, definition_version, updated_at … where id = ? and
definition_version = ?`. No row changed means a conflict (the survey exists) or not found.

### `survey_history` (0001)

One row per saved definition. Deleted with the survey (`on delete cascade`).

| Column      | Type       | Notes                        |
| ----------- | ---------- | ---------------------------- |
| `survey_id` | GUID       | Foreign key to `surveys`     |
| `id`        | GUID       | Primary key with `survey_id` |
| `at`        | timestamp  |                              |
| `user_id`   | GUID, null | null for legacy entries      |
| `snapshot`  | JSON       | The definition saved         |

Index `survey_history_order` (`survey_id`, `at` desc, `id` desc) serves `listHistory` paging.

### `survey_responses` (0002)

One row per stored response. Deleted with the survey (`on delete cascade`).

| Column          | Type       | Notes                                                                          |
| --------------- | ---------- | ------------------------------------------------------------------------------ |
| `survey_id`     | GUID       | Foreign key to `surveys`                                                       |
| `id`            | GUID       | Primary key with `survey_id`: the contract's response id                       |
| `submitted_at`  | timestamp  |                                                                                |
| `data`          | JSON       | The answers, a JSON object                                                     |
| `client_id`     | text, null | 1–256 characters (contract `ClientId`), matched exactly                        |
| `respondent_ip` | text, null | Only when the survey stores respondent addresses                               |
| `partial`       | boolean    | Legacy partial rows; the app stores `false` (HM Step 4 adds partial responses) |

Index `survey_responses_order` (`survey_id`, `submitted_at`, `id`) serves `listResponsePage` (keyed paging in
submission order) and `stats`. `appendResponse` inserts with `on conflict do nothing` on the key, which makes a
repeated response id `exists`, and writes the client's marker in the same transaction.

### `completion_markers` (0002)

`survey_id` (FK, cascade), `client_id` (text, matched exactly), `partial` (boolean); primary key (`survey_id`,
`client_id`). `completion` reads it: no row is `none`.

### `saved_views`, `legacy_views` and `private_questions` (0002)

| Table               | Columns                                                                                                                  | Notes                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `saved_views`       | `survey_id`, `user_id` (GUIDs), `view` (`summary` or `table`), `state` (JSON, null), `updated_at`; primary key all three | A user's layout; a null `state` is a reset marker                                                    |
| `legacy_views`      | `survey_id`, `view`, `state` (JSON); primary key (`survey_id`, `view`)                                                   | The legacy per-survey layout, `getView`'s fallback (R4); filled by the seed and the hosted migration |
| `private_questions` | `survey_id` (primary key), `names` (JSON array, no duplicates)                                                           | The questions hidden from public results                                                             |

The view store does not check that a survey exists, so these tables have **no foreign key**; `deleteSurvey` deletes
their rows in its transaction. A clone copies none of them; "delete all results" keeps them.

### `projects` and `project_members` (0002)

**`projects`**: `id` (GUID, primary key), `name`, `creator_id` (GUID, null), `created_at`. The creator is the project's
`ownerId` while they have a membership row (R2); removing or erasing the creator clears `creator_id`, so a creator
added again is not the owner again.

**`project_members`**: `project_id` (FK, cascade), `user_id` (GUID), `role` (`admin` or `user`), `created_at`,
`updated_at`; primary key (`project_id`, `user_id`). One row per user: the hosted migration merges the legacy store's
repeated rows (an admin row wins). Index `project_members_user` serves a user's projects.

The project store asks the provider set's **user directory** whether each member's user exists and what it is called:
with `USER_DIRECTORY=local` one batched read of `users` on the store's own transaction, otherwise the memory
directory. A row whose user the directory does not know
is an orphan (R11): counted in `memberCount`, neither listed nor an admin. Projects and members are sorted in the code
with the shared orderings, because SQL's `lower()` and collations differ from JavaScript's.

The last-admin rule, member erasure, adding a member and project deletion run in one transaction each. On PostgreSQL
the project row is locked first (`select … for update`), so two role changes of one project are decided one after the
other; on SQLite every transaction already runs alone. `deleteProject` moves the project's surveys to the receiver's
personal scope (`updated_at` = now; id, creator, published, archived and settings unchanged) and deletes the project
with its members.

### `files` (0003)

The metadata of stored files ([ADR 0025](../adr/0025-file-storage-for-the-sql-providers.md)); the bytes are in the
byte store (`FILE_STORE`: a folder or an S3 bucket) under `{survey id}/{file id}`.

| Column         | Type              | Notes                                                                                   |
| -------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `id`           | text, primary key | 64 lower-case hex digits ([ADR 0013](../adr/0013-editor-uploads-and-files.md)), checked |
| `survey_id`    | GUID              | No foreign key: the service deletes a survey's files first (R10)                        |
| `kind`         | text              | `asset` (editor) or `response` (respondent)                                             |
| `name`         | text              | The uploaded name                                                                       |
| `content_type` | text              | One of the allowed types                                                                |
| `size`         | bigint / integer  | Bytes                                                                                   |
| `created_at`   | timestamp         |                                                                                         |

Index `files_survey` (`survey_id`, `kind`) serves `usage` (the quota), per-survey deletes and asset copies. A new
file's row is written before its bytes and read again after them (a delete in between removes the bytes too); a delete
removes the bytes, then the rows, so a failed delete can be retried.

### `users` and `password_links` (0004)

The accounts of the local user directory (`USER_DIRECTORY=local`,
[ADR 0026](../adr/0026-revoking-stateless-sessions-with-an-epoch.md)). `pnpm seed` loads the fixture users here as
active accounts without a password (a blocked one disabled), and the seed's instance admin, Ivy Instance
(`instance-admin@example.com`), also when the directory is `memory`. A seed row replaces an account with its id or
email.

| Column                 | Type              | Notes                                                                                     |
| ---------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| `id`                   | GUID, primary key | The user id of projects, members and sessions                                             |
| `email`                | text, unique      | Lower-case                                                                                |
| `display_name`         | text              |                                                                                           |
| `instance_role`        | text              | `admin` or `user`                                                                         |
| `status`               | text              | `invited`, `active` or `disabled`. Only `active` signs in; `disabled` is a blocked user   |
| `password_hash`        | text, null        | An argon2id PHC string; null before a password is set                                     |
| `must_change_password` | boolean           | The first admin from `ADMIN_PASSWORD`: every operation but three answers `401` until then |
| `session_epoch`        | integer           | Starts at 0; raised by each password change and set-password link. Sessions must match it |
| `created_at`           | timestamp         |                                                                                           |
| `last_sign_in_at`      | timestamp, null   | The last password sign-in (not written under `READ_ONLY=true`)                            |

**`password_links`**: `token_hash` (text, primary key: the SHA-256 of the token, base64url; the token itself is never
stored), `user_id` (FK to `users`, cascade), `purpose` (`setup`, `invitation` or `reset`), `created_at`,
`expires_at`, `used_at` (null until used). Index `password_links_user` (`user_id`). A link is used by one
`UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING user_id`, so two uses at once cannot both succeed.
An instance admin's new user gets an `invitation` link, a reset a `reset` link (and the user's earlier unused links
are marked used); links expire after 7 days. The first admin's setup link is not a row: there is no account to point at yet, and the token lives in the server's
memory.

## Planned

Each table names the step that builds it and the provider interface it serves. "SH" is the self-hosted plan,
"HM" the hosted-migration plan.

### Identities and invitations (SH Step 8, HM Step 2: `UserDirectory`)

The hosted `profiles` directory (mode 1.3) keeps its users in `users` too (built above); its blocked flag from
UserInfo (ADR 0022) is `status` `disabled`, and the columns it does not use stay at their defaults.

**`user_identities`** (SH Step 8): `provider` (`surveyjs`, `google`, `github`, `facebook`), `subject`, `user_id` (FK,
cascade), `email`, `email_verified`; primary key (`provider`, `subject`).

**`invitations`** (SH Step 8, HM Step 2): `project_id` (FK, cascade), `email` (lower-case), `role`, `invited_by` (GUID),
`created_at`; primary key (`project_id`, `email`). An invitation becomes a `project_members` row at the first sign-in
with that email.

### API tokens (HM Step 3)

**`api_tokens`**: `id` (GUID, primary key), `user_id` (FK, cascade), `name`, `token_hash` (unique), `created_at`,
`last_used_at` (null), `revoked_at` (null).

### Survey events (HM Step 8)

**`survey_events`**: `id` (GUID, primary key), `survey_id` (GUID, no foreign key: the log outlives the survey), `type`,
`user_id` (null), `at`, `details` (JSON). Shaped as a general audit table; the hosted migration fills it from the legacy
event log, and the audit log can use it later.

### Hosted-only tables (HM Step 8)

Empty and unused in the self-hosted image.

| Table                | Columns                                                         | Purpose                                                                  |
| -------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `legacy_files`       | `legacy_name` (primary key), `file_id` (FK to `files`, cascade) | Legacy editor images and `dxsfile:`/`dxsimage:` uploads                  |
| `legacy_access_keys` | `key_hash` (primary key), `user_id`, `revoked` (boolean)        | The `accessKey` API of the compatibility layer                           |
| `deleted_responses`  | `survey_id`, `id`, `submitted_at`, `data` (JSON), `deleted_at`  | The legacy `postdelete{postId}` copies, purged 30 days after the cutover |

## Mapping to the provider interfaces

| Interface (`server/src/providers/types.ts`) | Tables                                                   | State                |
| ------------------------------------------- | -------------------------------------------------------- | -------------------- |
| `SurveyStore`                               | `surveys`, `survey_history`                              | Built                |
| `ResultStore`                               | `survey_responses`, `completion_markers`                 | Built                |
| `ViewStore`                                 | `saved_views`, `legacy_views`, `private_questions`       | Built                |
| `ProjectStore`                              | `projects`, `project_members`, (`surveys` for the moves) | Built                |
| `FileStore`                                 | `files` and the byte store                               | Built                |
| `UserDirectory`, `LocalAccountStore`        | `users`, `password_links`                                | Built (`local`)      |
| `UserDirectory` (identities, invitations)   | `user_identities`, `invitations`                         | SH Step 8; HM Step 2 |

With `USER_DIRECTORY=memory` (the default for `sqlite` and `postgres`) the SQL providers keep the **users** in memory
(the memory provider's, seeded by `MEMORY_SEED`). The server says so at start-up and refuses `NODE_ENV=production`
with them; `USER_DIRECTORY=local` keeps them in `users`.
