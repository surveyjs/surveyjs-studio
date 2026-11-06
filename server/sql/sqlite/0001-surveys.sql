-- Surveys with their definitions and themes, and the definition history
-- (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.
-- GUIDs are lower-case text; timestamps are ISO 8601 text as Date#toISOString writes it, so text
-- order is time order; booleans are 0 or 1; JSON documents are text.

create table surveys (
  id text primary key,
  name text not null,
  owner_user_id text,
  owner_project_id text,
  creator_id text,
  post_id text not null unique,
  result_id text not null unique,
  published integer not null,
  archived integer not null,
  public_results integer not null,
  store_respondent_ip integer not null,
  use_cookies integer not null,
  created_at text not null,
  updated_at text not null,
  definition text,
  definition_version text not null,
  theme text,
  theme_version text not null,
  constraint surveys_one_owner check ((owner_user_id is null) <> (owner_project_id is null))
);

-- The survey list: one scope, active or archived, newest change first (keyed paging).
create index surveys_personal_list on surveys (owner_user_id, archived, updated_at desc, id)
  where owner_user_id is not null;

create index surveys_project_list on surveys (owner_project_id, archived, updated_at desc, id)
  where owner_project_id is not null;

create table survey_history (
  survey_id text not null references surveys (id) on delete cascade,
  id text not null,
  at text not null,
  user_id text,
  snapshot text not null,
  primary key (survey_id, id)
);

-- History pages: newest first, ties by id descending.
create index survey_history_order on survey_history (survey_id, at desc, id desc);
