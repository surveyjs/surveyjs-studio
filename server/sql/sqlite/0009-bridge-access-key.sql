-- The bridge's access-key actions (ADR 0040 point 3). Statements end with a semicolon at the end
-- of a line.

-- The publish ID the old service gave a survey, which sites still use to reach it (null for
-- surveys made in Studio). Set by the hosted migration; never changed by the app.
alter table surveys add column legacy_publish_id text;

create index surveys_legacy_publish_id on surveys (legacy_publish_id);

-- A survey's shared results layouts (ADR 0040 point 4), one per kind: the text as given, stored and
-- returned verbatim. No foreign key: the view store does not check the survey, and deleteSurvey
-- deletes these rows itself. They replace legacy_views, the old per-survey layouts that were the
-- fallback of a user's view; its rows move here.
create table survey_layouts (
  survey_id text not null,
  kind text not null check (kind in ('table', 'summary', 'columns')),
  text text not null,
  primary key (survey_id, kind)
);

insert into survey_layouts (survey_id, kind, text)
select survey_id, view, state from legacy_views;

drop table legacy_views;

-- An editor file that belongs to no survey (uploadLegacyFile, ADR 0040 point 3) has an owner
-- instead: the user who uploaded it, whose account deletion deletes it. Exactly one of survey_id
-- and owner_user_id is set. Its bytes are in the file store under uploads/{file id}.
--
-- SQLite cannot change a column's constraints in place, so files is rebuilt. The migrator runs in
-- one transaction with foreign keys on, where dropping files would delete its legacy_files rows
-- (cascade): legacy_files is rebuilt first, referring to the new table, so the old files table has
-- no children when it is dropped. Renaming files_new to files renames the reference with it.
create table files_new (
  id text primary key check (length(id) = 64 and id not glob '*[^0-9a-f]*'),
  survey_id text,
  owner_user_id text,
  kind text not null check (kind in ('asset', 'response')),
  name text not null,
  content_type text not null,
  size integer not null check (size >= 0),
  created_at text not null,
  check ((survey_id is null) <> (owner_user_id is null))
);

insert into files_new (id, survey_id, owner_user_id, kind, name, content_type, size, created_at)
select id, survey_id, null, kind, name, content_type, size, created_at from files;

create table legacy_files_new (
  kind text not null check (kind in ('asset', 'response')),
  legacy_name text not null,
  file_id text not null references files_new (id) on delete cascade,
  primary key (kind, legacy_name)
);

insert into legacy_files_new (kind, legacy_name, file_id)
select kind, legacy_name, file_id from legacy_files;

drop table legacy_files;

drop table files;

alter table files_new rename to files;

alter table legacy_files_new rename to legacy_files;

create index files_survey on files (survey_id, kind);

-- A user's files, for the account deletion.
create index files_owner on files (owner_user_id);

create index legacy_files_file on legacy_files (file_id);
