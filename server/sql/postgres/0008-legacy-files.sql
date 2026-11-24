-- Files under the old service's names (docs/architecture/data-model.md, ADR 0039 point 3): an editor
-- image (asset) or a respondent upload (response), by the name sites still reference. The file
-- itself is a row of files with its bytes in the file store. Filled by the hosted migration; the
-- seed adds the fixtures' files. Statements end with a semicolon at the end of a line.

-- Names match as stored, case included (equality under the default collation is exact).
create table legacy_files (
  kind text not null check (kind in ('asset', 'response')),
  legacy_name text not null,
  file_id text not null references files (id) on delete cascade,
  primary key (kind, legacy_name)
);

-- A file's names, for the cascade when the file is deleted.
create index legacy_files_file on legacy_files (file_id);
