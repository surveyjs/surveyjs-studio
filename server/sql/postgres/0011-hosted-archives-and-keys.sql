-- Hosted archives and legacy access keys (ADR 0037 for the keys, ADR 0033 for the survey events
-- and deleted responses). Statements end with a semicolon at
-- the end of a line.

-- The per-user access keys of the old service. Only the SHA-256 hash of the lower-cased value is
-- stored, and the last four characters to tell keys apart. The user is a GUID without a foreign
-- key, as api_tokens.creator_id is. A replaced key stays as a revoked row; the user's key is the
-- newest row.
create table legacy_access_keys (
  key_hash text primary key,
  user_id uuid not null,
  last_four text not null,
  created_at timestamptz(3) not null,
  revoked_at timestamptz(3)
);

create index legacy_access_keys_user on legacy_access_keys (user_id, created_at);

-- What happened to a survey (a time-ordered log), the payload as JSON text.
create table survey_events (
  id uuid primary key,
  survey_id uuid not null,
  type text not null,
  at timestamptz(3) not null,
  payload text
);

create index survey_events_survey on survey_events (survey_id, at);

-- The responses that were deleted, kept as JSON text until a purge removes them.
create table deleted_responses (
  survey_id uuid not null,
  response_id uuid not null,
  deleted_at timestamptz(3) not null,
  response text not null,
  primary key (survey_id, response_id)
);

create index deleted_responses_deleted_at on deleted_responses (deleted_at);
