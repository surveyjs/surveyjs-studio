-- API tokens (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.
-- GUIDs are lower-case text; timestamps are ISO 8601 text.

-- A bearer credential for the API. Only the SHA-256 hash of the value is stored, and the last four
-- characters to tell tokens apart. The creator is a GUID without a foreign key, as
-- project_members.user_id is. A token with a project is scoped to it and goes with it.
create table api_tokens (
  id text primary key,
  creator_id text not null,
  project_id text references projects (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_four text not null,
  created_at text not null,
  last_used_at text,
  revoked_at text
);

create index api_tokens_creator on api_tokens (creator_id, project_id);
