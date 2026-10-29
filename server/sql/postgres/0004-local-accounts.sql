-- The local user directory's accounts and their set-password links
-- (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.

create table users (
  id uuid primary key,
  -- Stored lower-case.
  email text not null unique,
  display_name text not null,
  instance_role text not null check (instance_role in ('admin', 'user')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  -- An argon2id PHC string; null before a password is set.
  password_hash text,
  must_change_password boolean not null,
  -- Raised by every password change and reset and by disabling: older sessions end.
  session_epoch integer not null,
  created_at timestamptz(3) not null,
  last_sign_in_at timestamptz(3)
);

-- One-time set-password links (setup, invitation, reset). Only a hash of the token is kept.
create table password_links (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  purpose text not null check (purpose in ('setup', 'invitation', 'reset')),
  created_at timestamptz(3) not null,
  expires_at timestamptz(3) not null,
  used_at timestamptz(3)
);

create index password_links_user on password_links (user_id);
