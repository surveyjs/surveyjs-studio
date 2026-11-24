-- Hosted sign-in through surveyjs.io (ADR 0043 points 1 and 6). Statements end with a semicolon at
-- the end of a line.

-- The site's block on the account, refreshed at each sign-in. It blocks like status = 'disabled'
-- but is not an admin's decision, so status is left alone. Booleans are 0 or 1.
alter table users add column site_blocked integer not null default 0 check (site_blocked in (0, 1));

-- When the person's licence ends (ISO 8601 text), as the site reports it at sign-in; null when none
-- is known.
alter table users add column licence_expires_at text;
