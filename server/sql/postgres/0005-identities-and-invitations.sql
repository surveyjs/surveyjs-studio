-- Linked sign-in identities (Google, GitHub, Facebook, surveyjs.io) and pending project
-- invitations (docs/architecture/data-model.md). Statements end with a semicolon at the end of a line.

-- An account's identity at an external provider. One (provider, subject) belongs to one account.
create table user_identities (
  provider text not null check (provider in ('surveyjs', 'google', 'github', 'facebook')),
  subject text not null,
  user_id uuid not null references users (id) on delete cascade,
  -- Lower-case, as the provider gave it when the identity was linked.
  email text,
  email_verified boolean not null,
  created_at timestamptz(3) not null,
  primary key (provider, subject)
);

create index user_identities_user on user_identities (user_id);

-- A member added by email before that person has an account. Claimed at the first sign-in with
-- that email. The inviter is a GUID without a foreign key, as project_members.user_id is.
create table project_invitations (
  project_id uuid not null references projects (id) on delete cascade,
  -- Stored lower-case.
  email text not null,
  role text not null check (role in ('admin', 'user')),
  invited_by uuid not null,
  created_at timestamptz(3) not null,
  primary key (project_id, email)
);

create index project_invitations_email on project_invitations (email);
