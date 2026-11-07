-- The metadata of stored files: editor assets and respondent files
-- (docs/architecture/data-model.md). The bytes are in the file store (FILE_STORE), under
-- {survey id}/{file id}. Statements end with a semicolon at the end of a line.
-- GUIDs are lower-case text; timestamps are ISO 8601 text.

-- No foreign key to surveys: the file store does not check the survey, and the service deletes a
-- survey's files before the survey (R10).
create table files (
  id text primary key check (length(id) = 64 and id not glob '*[^0-9a-f]*'),
  survey_id text not null,
  kind text not null check (kind in ('asset', 'response')),
  name text not null,
  content_type text not null,
  size integer not null check (size >= 0),
  created_at text not null
);

-- A survey's files by kind: usage (the quota), deletion and copies.
create index files_survey on files (survey_id, kind);
