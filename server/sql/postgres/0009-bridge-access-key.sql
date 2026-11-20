-- The bridge's access-key actions (ADR 0040 point 3). Statements end with a semicolon at the end
-- of a line.

-- The publish ID the old service gave a survey, which sites still use to reach it (null for
-- surveys made in Studio). Set by the hosted migration; never changed by the app.
alter table surveys add column legacy_publish_id text;

create index surveys_legacy_publish_id on surveys (legacy_publish_id);
