# Demo: self-hosted Step 5, the instance admin

This page lets you check self-hosted Step 5 without reading code. It takes about twenty minutes. Commands are for Git
Bash (or any POSIX shell), from the repository root.

What Step 5 delivers: **an instance admin manages the users and every project.** The **Users** page creates users and
gives you a one-time link for each (there is no email: you send the link), resets passwords, disables, enables and
deletes users, and makes other instance admins. The instance always keeps one active admin. An instance admin also
sees and manages every project, including ones they are not a member of. Production (studio.surveyjs.io) is not
affected: it has no local accounts.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists. Ports 3000 and 5173 must be free,
and two browsers (or one normal and one private window).

Start from a fresh database: `rm -rf server/.data`, then `pnpm seed:sqlite`. Then start the app with passwords and a
first admin:

```sh
USER_DIRECTORY=local AUTH_METHODS=password \
  ADMIN_EMAIL=first-admin@example.test ADMIN_PASSWORD='a long local password' \
  pnpm dev:sqlite
```

Open <http://localhost:5173>, sign in as `first-admin@example.test` with `a long local password`, and change the password
to `the admin's own new password` when asked (as in [the Step 4 demo](self-hosted-04.md)).

## 1. Create a user, who sets a password and signs in (checklist 1)

1. Hover over **first-admin** and choose **Users**.
   - **Check:** the **Users** page lists the seed's users, **Ivy Instance** and **first-admin** as **Admin**, the others
     as **User**, with their status and last sign-in.
2. Enter `una@example.test` and `Una User`, and click **Create user**.
   - **Check:** a box shows **The set-password link for Una User**, says it is shown only now, and gives the expiry
     date 7 days ahead. **Una User** is in the table as **Invited**.
3. Click **Copy link**. **Check:** "Copied." Then click **Done**: the link is gone from the page.
4. Paste the link into the private window. **Check:** the **Set your password** page.
5. Enter `Una's first long password` twice and click **Set password**.
   - **Check:** Una lands signed in: My Surveys opens with **Una User** in the header, and her account menu has no
     **Users** item.
6. In the private window open <http://localhost:5173/admin/users>. **Check:** "Only instance admins can manage users."
7. Reload the Users page in the first browser. **Check:** Una is **Active**, with a last sign-in.

## 2. Reset Una's password (checklist 2)

1. In Una's row click **Reset password** and confirm. **Check:** a new link box.
2. In the private window reload the page. **Check:** the **Sign in** page opens. Sign in with Una's old password:
   "The email or the password is wrong."
3. Open the new link there and set `Una's second long password`. **Check:** My Surveys opens, signed in.
4. Open the first link from part 1 again. **Check:** "This link was used already, has expired, or is not a link of
   this site."

## 3. Disable, enable and delete

1. In Una's row click **Disable** and confirm. **Check:** **Disabled**. In the private window reload: the **Sign in**
   page; signing in is refused.
2. Click **Enable** and confirm. **Check:** **Active**, and Una signs in again.
3. As Una, create a survey (**Create a Survey**, any name).
4. In Una's row click **Delete** and confirm the message about her surveys. **Check:** Una is gone from the table, and
   the private window's next reload shows the **Sign in** page; her email no longer signs in.

## 4. The last instance admin (checklist 3)

1. In **Ivy Instance**'s row click **Disable** and confirm. Now **first-admin** is the only active admin.
2. In your own row click **Make user** and confirm. **Check:** "The instance must keep at least one active admin."
   Try **Disable** and **Delete** on your row: the same message.
3. Enable Ivy again.

## 5. A project you are not a member of (checklist 4)

1. Hover over **first-admin** and choose **Projects**.
   - **Check:** the seed's projects **Marketing** and **Engineering** are listed, though first-admin is not a
     member, and each shows the admin's controls.
2. Rename **Engineering** to `Engineering (renamed by the instance admin)`. **Check:** the new name stays after a reload.
3. Expand it. **Check:** its members are listed, and you can add a member or change a role.
4. Open **My Surveys**. **Check:** the project list there holds only your own projects (none).

Stop the app with Ctrl+C.

## Clean up

`rm -rf server/.data` removes the local database and files.

## What the automated tests cover

- `pnpm test:unit`: the last-instance-admin rule and the status rules; the account store suite on memory and SQLite
  (list, update, delete, reset, links used with the password in one transaction, two demotions at once); the admin
  API through the app (links of 128 bits that expire after 7 days, `410`, `409`, `403`, erasure on delete, the reset,
  project oversight); the web Users page and its visibility.
- `pnpm test:providers:postgres` and `pnpm test:providers:azurite`: the same stores on PostgreSQL, and every project on
  the legacy SQL Server.
- `pnpm test:conformance:password`: every `/admin/users` operation and error over HTTP, as the seed's instance admin.
- `pnpm e2e:password`: create a user, set the password in another browser, sign in; reset, disable, enable and delete.
