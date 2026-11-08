# Managing users

This page is for **instance admins** of a self-hosted My Surveys that keeps its own accounts. An
instance admin creates the users, sends them their links, resets passwords, disables and deletes
users, and can manage every project. On studio.surveyjs.io there are no instance admins: accounts
are surveyjs.io accounts.

The first instance admin is made when the instance is set up (see
[Signing in with a password](signing-in.md#signing-in-with-a-password)). That admin can make others.

## The Users page

Open it from the account menu: hover over your name and choose **Users** (in the plain shell, the
**Users** link in the header). Only instance admins see the item. Anyone else who opens
`/admin/users` reads "Only instance admins can manage users."

The table lists every user, ordered by email:

| Column       | Shows                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------ |
| Name, Email  | The user's name and email                                                                  |
| Role         | **Admin** (an instance admin) or **User**                                                  |
| Status       | **Invited** (no password yet), **Active** or **Disabled**                                  |
| Last sign-in | The last sign-in with a password, or **Never**                                             |
| Actions      | **Make admin** or **Make user**, **Disable** or **Enable**, **Reset password**, **Delete** |

Each action asks you to confirm first. When the server refuses one, the reason appears above the
table.

## Create a user

There is no email: you send each user their link yourself.

1. Enter the user's **Email** and **Name**. Tick **Instance admin** to make them one.
2. Choose **Create user**. The user appears in the table as **Invited**.
3. A box shows their **set-password link**. Choose **Copy link** and send it to them, by chat or
   email. The link is shown **only now**: once you choose **Done**, it is gone. If you lose it,
   reset the user's password to get a new one.
4. The user opens the link, enters a password twice, and chooses **Set password**. They are now
   **Active** and land signed in; later they sign in on the **Sign in** page.

A link works **once** and expires after **7 days**. An email that already has an account is
refused: "An account with this email exists."

## Reset a password

For a user who forgot their password, or whose password you want to stop:

1. Choose **Reset password** in their row, and confirm.
2. Their password stops working at once, and they are signed out everywhere within a minute.
   Their earlier links stop working too.
3. Copy the new link from the box and send it to them. They set a new password with it.

For an **Invited** user, this gives a new invitation link (for example when the first one expired).

## Disable and enable a user

- **Disable** signs the user out within a minute and stops them from signing in. Their surveys,
  results and memberships stay.
- **Enable** lets them sign in again with their password. A user who never set a password goes
  back to **Invited**: reset their password to send a new link.

## Make another instance admin

**Make admin** gives a user the instance admin role; **Make user** takes it away. The instance
always keeps at least one active admin: demoting, disabling or deleting the last one is refused
with "The instance must keep at least one active admin.", also for yourself. Make someone else an
admin first.

## Delete a user

**Delete** removes the user and their data, as deleting a surveyjs.io account does (see
[Moving from the old My Surveys](moving-from-the-old-my-surveys.md)):

- their personal surveys go, with their results and files;
- they leave every project. Where they were the only admin, another member becomes admin. A
  project with no other member is deleted with its surveys;
- they are signed out, and their account is gone.

This cannot be undone.

## Every project

An instance admin sees **every project** of the instance on the **Projects** page, also the ones
they are not a member of, and can do everything a project admin does there: rename and delete the
project, add members, change roles and remove members. This way a project whose admins left can
still be managed. In **My Surveys**, the project list stays the projects you are a member of.
