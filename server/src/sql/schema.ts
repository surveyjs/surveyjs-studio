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
}
