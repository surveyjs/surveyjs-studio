-- API tokens (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.

-- A bearer credential for the API. Only the SHA-256 hash of the value is stored, and the last four
-- characters to tell tokens apart. The creator is a GUID without a foreign key, as
-- project_members.user_id is. A token with a project is scoped to it and goes with it.
create table api_tokens (
  id uuid primary key,
  creator_id uuid not null,
  project_id uuid references projects (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_four text not null,
  created_at timestamptz(3) not null,
  last_used_at timestamptz(3),
  revoked_at timestamptz(3)
);

create index api_tokens_creator on api_tokens (creator_id, project_id);
create index api_tokens_project on api_tokens (project_id);
