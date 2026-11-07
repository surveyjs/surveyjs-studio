-- Responses, completion markers, results layouts, private questions, projects and members
-- (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.

create table survey_responses (
  survey_id uuid not null references surveys (id) on delete cascade,
  id uuid not null,
  submitted_at timestamptz(3) not null,
  data jsonb not null,
  client_id text,
  respondent_ip text,
  partial boolean not null,
  primary key (survey_id, id)
);

-- Results pages and statistics: submission order, ties by id (keyed paging).
create index survey_responses_order on survey_responses (survey_id, submitted_at, id);

create table completion_markers (
  survey_id uuid not null references surveys (id) on delete cascade,
  client_id text not null,
  partial boolean not null,
  primary key (survey_id, client_id)
);

-- A user's saved layout of a results view; a null state is a reset marker. No foreign key: the
-- view store does not check the survey, and deleteSurvey deletes these rows itself.
create table saved_views (
  survey_id uuid not null,
  user_id uuid not null,
  view text not null check (view in ('summary', 'table')),
  state jsonb,
  updated_at timestamptz(3) not null,
  primary key (survey_id, user_id, view)
);

-- The legacy per-survey layout, the fallback of a user without a saved state (R4).
create table legacy_views (
  survey_id uuid not null,
  view text not null check (view in ('summary', 'table')),
  state jsonb not null,
  primary key (survey_id, view)
);

-- The names of the questions hidden from public results, as a JSON array.
create table private_questions (
  survey_id uuid primary key,
  names jsonb not null
);

create table projects (
  id uuid primary key,
  name text not null,
  creator_id uuid,
  created_at timestamptz(3) not null
);

create table project_members (
  project_id uuid not null references projects (id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('admin', 'user')),
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  primary key (project_id, user_id)
);

-- A user's projects.
create index project_members_user on project_members (user_id);
