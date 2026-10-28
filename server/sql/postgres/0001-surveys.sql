-- Surveys with their definitions and themes, and the definition history
-- (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.

create table surveys (
  id uuid primary key,
  name text not null,
  owner_user_id uuid,
  owner_project_id uuid,
  creator_id uuid,
  post_id uuid not null unique,
  result_id uuid not null unique,
  published boolean not null,
  archived boolean not null,
  public_results boolean not null,
  store_respondent_ip boolean not null,
  use_cookies boolean not null,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  definition jsonb,
  definition_version text not null,
  theme jsonb,
  theme_version text not null,
  constraint surveys_one_owner check ((owner_user_id is null) <> (owner_project_id is null))
);

-- The survey list: one scope, active or archived, newest change first (keyed paging).
create index surveys_personal_list on surveys (owner_user_id, archived, updated_at desc, id)
  where owner_user_id is not null;

create index surveys_project_list on surveys (owner_project_id, archived, updated_at desc, id)
  where owner_project_id is not null;

create table survey_history (
  survey_id uuid not null references surveys (id) on delete cascade,
  id uuid not null,
  at timestamptz(3) not null,
  user_id uuid,
  snapshot jsonb not null,
  primary key (survey_id, id)
);

-- History pages: newest first, ties by id descending.
create index survey_history_order on survey_history (survey_id, at desc, id desc);
