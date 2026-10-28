# Data model (SQL providers)

Status: self-hosted track Step 1 (2026-10-28). The tables of [Built](#built) exist; the tables of
[Planned](#planned) are the model the later steps build, and each step may refine its own tables in the same PR
that adds their migration.

This is the logical schema of the SQL providers: SQLite and PostgreSQL, one implementation with two dialects
([ADR 0023](../adr/0023-sqlite-driver-node-sqlite.md), [ADR 0024](../adr/0024-kysely-and-plain-sql-migrations.md)).
The self-hosted image uses it, and the hosted service moves to it in mode 1.3 ([spec-hosted.md](../../spec-hosted.md)
› Data model and mapping). The legacy Azure layout it replaces is in [legacy-data-layout.md](legacy-data-layout.md).

## Conventions

| Kind          | PostgreSQL       | SQLite                                                                   | In the code (`server/src/sql/values.ts`)                                                          |
| ------------- | ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| GUID          | `uuid`           | `text`, lower-case                                                       | A lower-case string. A value that is not a GUID matches no row and is never sent to the database. |
| Timestamp     | `timestamptz(3)` | `text`, ISO 8601 UTC as `Date#toISOString` writes it (`…T10:00:00.000Z`) | Written as that text; read back in the same form (`isoOf`). In SQLite text order is time order.   |
| Boolean       | `boolean`        | `integer`, 0 or 1                                                        | `flagOf`                                                                                          |
| JSON document | `jsonb`          | `text`                                                                   | Written as `JSON.stringify` text; read with `jsonOf`.                                             |
| Other text    | `text`           | `text`                                                                   |                                                                                                   |

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

## Planned

Each table names the step that builds it and the provider interface it serves. "SH" is the self-hosted plan,
"HM" the hosted-migration plan.

### Results (SH Step 2: `ResultStore`)

**`survey_responses`**: `survey_id` (FK, cascade), `id` (GUID; primary key with `survey_id`), `submitted_at`, `data`
(JSON), `client_id` (text, null), `respondent_ip` (text, null), `partial` (boolean). Index (`survey_id`,
`submitted_at`, `id`) for the paging of `listResponsePage` and for `stats`. `appendResponse` inserts with
`on conflict do nothing` on the key, which is the idempotency of the contract's response id.

**`completion_markers`**: `survey_id` (FK, cascade), `client_id` (text), `partial` (boolean); primary key
(`survey_id`, `client_id`). Client ids match exactly (case-sensitive).

Partial responses (HM Step 4) use `partial = true` rows of `survey_responses`.

### Views and private questions (SH Step 2: `ViewStore`)

**`saved_views`**: `survey_id` (FK, cascade), `user_id` (GUID), `view` (`summary` or `table`), `state` (JSON, null:
a reset marker), `updated_at`; primary key (`survey_id`, `user_id`, `view`).

**`surveys.private_questions`** (a new column, JSON array of question names, default `[]`): the questions hidden from
public results. Kept by "delete all results", not copied by a clone.

### Files (SH Step 3: `FileStore`)

**`files`**: `id` (64 hex digits, primary key), `survey_id` (FK, cascade), `kind` (`asset` or `response`), `name`,
`content_type`, `size` (bigint), `created_at`. Index (`survey_id`, `kind`) for `usage` and cascades. The bytes are in
the file store (`FILE_STORE=local|s3`) under the file id; the row is the metadata and the quota's source.

### Projects and members (SH Step 2: `ProjectStore`)

**`projects`**: `id` (GUID, primary key), `name`, `creator_id` (GUID, null: the owner while the creator is a member;
cleared when the creator leaves), `created_at`.

**`project_members`**: `project_id` (FK, cascade), `user_id` (GUID), `role` (`admin` or `user`), `created_at`,
`updated_at`; primary key (`project_id`, `user_id`). One row per user: the legacy store's repeated rows are merged by
the hosted migration (an admin row wins). Index (`user_id`) for `listUserProjects`.

The last-admin rule and the moves of `deleteProject` run inside one transaction.

### Users, identities and invitations (SH Steps 4 and 8, HM Step 2: `UserDirectory`)

**`users`**: `id` (GUID, primary key), `email` (lower-case, unique), `display_name`, `instance_role` (`admin` or
`user`), `status` (`invited`, `active` or `disabled`), `password_hash` (null without a password), `must_change_password`
(boolean), `session_epoch` (integer), `blocked` (boolean; the hosted profile from UserInfo, ADR 0022), `created_at`,
`last_sign_in_at` (null). The local directory (modes 2b and 3) and the hosted `profiles` directory (mode 1.3) both
keep their users here; columns one of them does not use stay at their defaults.

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

| Table                | Columns                                                                              | Purpose                                                                  |
| -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `legacy_files`       | `legacy_name` (primary key), `file_id` (FK to `files`, cascade)                      | Legacy editor images and `dxsfile:`/`dxsimage:` uploads                  |
| `legacy_access_keys` | `key_hash` (primary key), `user_id`, `revoked` (boolean)                             | The `accessKey` API of the compatibility layer                           |
| `legacy_views`       | `survey_id` (FK, cascade), `view`, `state` (JSON); primary key (`survey_id`, `view`) | The legacy per-survey layouts, `getView`'s fallback (R4)                 |
| `deleted_responses`  | `survey_id`, `id`, `submitted_at`, `data` (JSON), `deleted_at`                       | The legacy `postdelete{postId}` copies, purged 30 days after the cutover |

## Mapping to the provider interfaces

| Interface (`server/src/providers/types.ts`) | Tables                                                       | State                    |
| ------------------------------------------- | ------------------------------------------------------------ | ------------------------ |
| `SurveyStore`                               | `surveys`, `survey_history`                                  | Built                    |
| `ResultStore`                               | `survey_responses`, `completion_markers`                     | SH Step 2                |
| `ViewStore`                                 | `saved_views`, `surveys.private_questions`, (`legacy_views`) | SH Step 2                |
| `ProjectStore`                              | `projects`, `project_members`, (`surveys` for the moves)     | SH Step 2                |
| `FileStore`                                 | `files` and the file store                                   | SH Step 3                |
| `UserDirectory`                             | `users`, `user_identities`, `invitations`                    | SH Steps 4, 8; HM Step 2 |

Until SH Step 2 the SQL providers keep every store but `SurveyStore` in memory (the memory provider's, seeded by
`MEMORY_SEED`). The server says so at start-up, refuses `NODE_ENV=production` with them, and the cross-store writes
(project deletion moving surveys, account erasure, a survey's deletion dropping its results) do not reach the database
yet.
