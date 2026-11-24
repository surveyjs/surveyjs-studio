-- Hosted sign-in through surveyjs.io (ADR 0043 points 1 and 6). Statements end with a semicolon at
-- the end of a line.

-- The site's block on the account, refreshed at each sign-in. It blocks like status = 'disabled'
-- but is not an admin's decision, so status is left alone.
alter table users add column site_blocked boolean not null default false;

-- When the person's licence ends, as the site reports it at sign-in; null when none is known.
alter table users add column licence_expires_at timestamptz(3);
