-- Hosted archives and legacy access keys (ADR 0037, ADR 0043). Statements end with a semicolon at
-- the end of a line. GUIDs are lower-case text; timestamps are ISO 8601 text.

-- The per-user access keys of the old service. Only the SHA-256 hash of the lower-cased value is
-- stored, and the last four characters to tell keys apart. The user is a GUID without a foreign
-- key, as api_tokens.creator_id is. A replaced key stays as a revoked row; the user's key is the
-- newest row.
create table legacy_access_keys (
  key_hash text primary key,
  user_id text not null,
  last_four text not null,
  created_at text not null,
  revoked_at text
);

create index legacy_access_keys_user on legacy_access_keys (user_id, created_at);

-- What happened to a survey (a time-ordered log), the payload as JSON text.
create table survey_events (
  id text primary key,
  survey_id text not null,
  type text not null,
  at text not null,
  payload text
);

create index survey_events_survey on survey_events (survey_id, at);

-- The responses that were deleted, kept as JSON text until a purge removes them.
create table deleted_responses (
  survey_id text not null,
  response_id text not null,
  deleted_at text not null,
  response text not null,
  primary key (survey_id, response_id)
);

create index deleted_responses_deleted_at on deleted_responses (deleted_at);
