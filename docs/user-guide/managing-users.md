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

| Column       | Shows                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| User         | The user's name, and their email under it                                                                |
| Role         | **Admin** (an instance admin) or **User**                                                                |
| Status       | See below                                                                                                |
| Last sign-in | The last sign-in, by any method, or **Never**                                                            |
| Actions      | **Make admin** or **Make user**, **Disable** or **Enable**, **Reset password**, **Sign-ins**, **Delete** |

The status is one of these:

| Status                    | Means                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ |
| **Invited**               | No password yet; their link waits to be used                                   |
| **Invited, link expired** | No password yet, and the link has expired: reset their password for a new link |
| **Active**                | They can sign in                                                               |
| **Reset pending**         | You reset their password, and they have not used the new link yet              |
| **Disabled**              | They cannot sign in                                                            |

Each action asks you to confirm first. When the server refuses one, the reason appears above the
table. While an action runs, the buttons of that row are off, so a second click sends nothing.

## Create a user

There is no email: you send each user their link yourself.

1. Enter the user's **Email** and **Name**. Tick **Instance admin** to make them one.
2. Choose **Create user**. The user appears in the table as **Invited**.
3. A box shows their **set-password link**. Choose **Copy link** and send it to them, by chat or
   email. The link is shown **only now**: once you choose **Done**, it is gone. If you lose it,
   reset the user's password to get a new one.

   On a page served over plain HTTP, the browser does not let the page copy. **Copy link** then
   selects the link and says so: press Ctrl+C (⌘C on a Mac) to copy it.

4. The user opens the link, enters a password twice, and chooses **Set password**. They are now
   **Active** and land signed in; later they sign in on the **Sign in** page.

A link works **once** and expires after **7 days**. An email that already has an account is
refused: "An account with this email exists."

## Reset a password

For a user who forgot their password, or whose password you want to stop:

1. Choose **Reset password** in their row, and confirm.
2. Their password stops working at once, and they are signed out everywhere within a minute.
   Their earlier links stop working too.
3. Their linked sign-ins (Google, GitHub, Facebook, SurveyJS) are unlinked as well. Their status
   is **Reset pending** until they use the new link.
4. Copy the new link from the box and send it to them. They set a new password with it.

For an **Invited** user, this gives a new invitation link (for example when the first one expired).

A reset leaves the new link as the only way in that you chose. Use it when you think someone else
got into the account. If the user signs in with Google, GitHub, Facebook or SurveyJS again later,
and that provider gives the account's email as verified, the sign-in links again by itself.

You cannot reset your own password here: it would sign you out and lose the link. Change it with
**Change password** in your account, or ask another instance admin.

## Linked sign-ins

**Sign-ins** in a user's row opens a line under it with how they sign in: **Password** (or **No
password**), and each linked Google, GitHub, Facebook or SurveyJS sign-in with the email the
provider gave and the day it was linked. Choose **Sign-ins** again to close it.

**Unlink** removes one, after you confirm. That sign-in no longer reaches the account, and the user
is signed out within a minute. If the provider still gives the account's email as verified, signing
in with it links it again. To keep someone out, disable them.

## Disable and enable a user

- **Disable** signs the user out within a minute and stops them from signing in, with their
  password and with every linked sign-in. Their surveys, results, memberships and linked sign-ins
  stay.
- **Enable** lets them sign in again with their password or their linked sign-in method. A user who
  has neither goes back to **Invited**: reset their password to send a new link.

## Make another instance admin

**Make admin** gives a user the instance admin role; **Make user** takes it away. The instance
always keeps at least one active admin: demoting, disabling or deleting the last one is refused
with "The instance must keep at least one active admin.", also for yourself. Make someone else an
admin first.

The change applies to the user's next request on the server that made it. An instance that runs
several servers keeps each account's state for up to 60 seconds, so there it takes up to a minute.
A page the user has open shows the old menu until they reload it.

## Your own row

The questions for your own row say what happens to you: disabling or deleting yourself, or
unlinking one of your sign-ins, signs you out at once, and **Make user** takes you off this page.
Deleting yourself cannot be undone. **Reset password** is off in your own row.

## Delete a user

**Delete** removes the user and their data, as deleting a surveyjs.io account does (see
[Moving from the old My Surveys](moving-from-the-old-my-surveys.md)):

- first the account is disabled, so they are signed out and cannot sign in while the rest runs;
- their personal surveys go, with their results and files;
- they leave every project. Where they were the only admin, another member becomes admin. A
  project with no other member is deleted with its surveys;
- their account is gone, with its linked sign-ins.

This cannot be undone. If something fails on the way, the user stays **Disabled**: choose
**Delete** again.

## Every project

An instance admin sees **every project** of the instance on the **Projects** page, also the ones
they are not a member of, and can do everything a project admin does there: rename and delete the
project, add members, change roles and remove members. This way a project whose admins left can
still be managed. In **My Surveys**, the project list stays the projects you are a member of.
