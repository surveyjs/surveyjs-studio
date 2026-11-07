-- The metadata of stored files: editor assets and respondent files
-- (docs/architecture/data-model.md). The bytes are in the file store (FILE_STORE), under
-- {survey id}/{file id}. Statements end with a semicolon at the end of a line.

-- No foreign key to surveys: the file store does not check the survey, and the service deletes a
-- survey's files before the survey (R10).
create table files (
  id text primary key check (id ~ '^[0-9a-f]{64}$'),
  survey_id uuid not null,
  kind text not null check (kind in ('asset', 'response')),
  name text not null,
  content_type text not null,
  size bigint not null check (size >= 0),
  created_at timestamptz(3) not null
);

-- A survey's files by kind: usage (the quota), deletion and copies.
create index files_survey on files (survey_id, kind);
