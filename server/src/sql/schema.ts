import type { ColumnType } from "kysely";

/**
 * The tables as Kysely sees them (docs/architecture/data-model.md). Values differ by dialect on
 * the way out, so each column's select type allows both:
 * - GUIDs: PostgreSQL `uuid`, SQLite lower-case text; always lower-case strings.
 * - Timestamps: PostgreSQL `timestamptz(3)` (a Date), SQLite ISO 8601 text as Date#toISOString
 *   writes it (so text order is time order). Written as that ISO text in both.
 * - Booleans: PostgreSQL `boolean`, SQLite 0 or 1.
 * - JSON documents: PostgreSQL `jsonb` (parsed by the driver), SQLite text. Written as JSON text.
 */
type Timestamp = ColumnType<Date | string, string, string>;
type Flag = ColumnType<boolean | number, boolean, boolean>;
type Json = ColumnType<unknown, string, string>;

export interface SchemaMigrationsTable {
  version: number;
  name: string;
  applied_at: Timestamp;
}

export interface SurveysTable {
  id: string;
  name: string;
  /** Exactly one of the two owner columns is set. */
  owner_user_id: string | null;
  owner_project_id: string | null;
  creator_id: string | null;
  post_id: string;
  result_id: string;
  published: Flag;
  archived: Flag;
  public_results: Flag;
  store_respondent_ip: Flag;
  use_cookies: Flag;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** null: no definition stored (read as `{}`). */
  definition: Json | null;
  definition_version: string;
  /** null: no theme stored (read as `{}`). */
  theme: Json | null;
  theme_version: string;
}

export interface SurveyHistoryTable {
  survey_id: string;
  id: string;
  at: Timestamp;
  user_id: string | null;
  snapshot: Json;
}

export interface SurveyResponsesTable {
  survey_id: string;
  id: string;
  submitted_at: Timestamp;
  data: Json;
  client_id: string | null;
  respondent_ip: string | null;
  partial: Flag;
}

export interface CompletionMarkersTable {
  survey_id: string;
  /** Matched exactly (case-sensitive). */
  client_id: string;
  partial: Flag;
}

export interface SavedViewsTable {
  survey_id: string;
  user_id: string;
  view: "summary" | "table";
  /** null: a reset marker. */
  state: Json | null;
  updated_at: Timestamp;
}

export interface LegacyViewsTable {
  survey_id: string;
  view: "summary" | "table";
  state: Json;
}

export interface PrivateQuestionsTable {
  survey_id: string;
  /** A JSON array of question names. */
  names: Json;
}

export interface ProjectsTable {
  id: string;
  name: string;
  /** The owner while that user is a member (R2); cleared when the creator leaves. */
  creator_id: string | null;
  created_at: Timestamp;
}

export interface ProjectMembersTable {
  project_id: string;
  user_id: string;
  role: "admin" | "user";
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface FilesTable {
  /** 64 lower-case hex digits. */
  id: string;
  survey_id: string;
  kind: "asset" | "response";
  name: string;
  content_type: string;
  /** PostgreSQL's bigint arrives as a string. */
  size: ColumnType<number | string, number, number>;
  created_at: Timestamp;
}

export interface UsersTable {
  id: string;
  /** Stored lower-case. */
  email: string;
  display_name: string;
  instance_role: "admin" | "user";
  status: "invited" | "active" | "disabled";
  password_hash: string | null;
  must_change_password: Flag;
  session_epoch: number;
  created_at: Timestamp;
  last_sign_in_at: Timestamp | null;
}

export interface PasswordLinksTable {
  token_hash: string;
  user_id: string;
  purpose: "setup" | "invitation" | "reset";
  created_at: Timestamp;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface UserIdentitiesTable {
  provider: "surveyjs" | "google" | "github" | "facebook";
  subject: string;
  user_id: string;
  /** Lower-case, at link time. */
  email: string | null;
  email_verified: Flag;
  created_at: Timestamp;
}

export interface ProjectInvitationsTable {
  project_id: string;
  /** Stored lower-case. */
  email: string;
  role: "admin" | "user";
  invited_by: string;
  created_at: Timestamp;
}

export interface DatabaseSchema {
  schema_migrations: SchemaMigrationsTable;
  surveys: SurveysTable;
  survey_history: SurveyHistoryTable;
  survey_responses: SurveyResponsesTable;
  completion_markers: CompletionMarkersTable;
  saved_views: SavedViewsTable;
  legacy_views: LegacyViewsTable;
  private_questions: PrivateQuestionsTable;
  projects: ProjectsTable;
  project_members: ProjectMembersTable;
  files: FilesTable;
  users: UsersTable;
  password_links: PasswordLinksTable;
  user_identities: UserIdentitiesTable;
  project_invitations: ProjectInvitationsTable;
}
