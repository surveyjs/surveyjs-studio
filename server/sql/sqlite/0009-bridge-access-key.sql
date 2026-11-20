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
