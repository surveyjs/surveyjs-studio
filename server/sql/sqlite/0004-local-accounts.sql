-- The local user directory's accounts and their set-password links
-- (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.
-- GUIDs are lower-case text; timestamps are ISO 8601 text; booleans are 0 or 1.

create table users (
  id text primary key,
  -- Stored lower-case.
  email text not null unique,
  display_name text not null,
  instance_role text not null check (instance_role in ('admin', 'user')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  -- An argon2id PHC string; null before a password is set.
  password_hash text,
  must_change_password integer not null,
  -- Raised by every password change and reset and by disabling: older sessions end.
  session_epoch integer not null,
  created_at text not null,
  last_sign_in_at text
);

-- One-time set-password links (setup, invitation, reset). Only a hash of the token is kept.
create table password_links (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('setup', 'invitation', 'reset')),
  created_at text not null,
  expires_at text not null,
  used_at text
);

create index password_links_user on password_links (user_id);
