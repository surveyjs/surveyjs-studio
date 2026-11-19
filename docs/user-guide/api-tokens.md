# API tokens

An **API token** lets a script, a server or an integration use My Surveys without signing in. It acts as you, or as an
admin of one project. This page describes the **API tokens** page in the surveyjs.io look. The developer's side, with
`curl` examples, is in the [API guide](../api/api-tokens.md).

## Open the page

Open the account menu in the header and choose **API tokens** (it comes after Projects). A self-hosted My Surveys that
uses another shell does not show it.

The page has a **Personal** section, then one section for each project where you are an admin. A member who is not an
admin sees no section for the project: only admins make and revoke a project's tokens.

Each table lists **Name**, **Token** (only the last four characters), **Created**, **Last used** and **Actions**.
"Last used" is accurate to the minute and shows "Never" until the token is used.

## Two kinds of token

- **Personal.** Reaches your personal surveys, and only those.
- **Project.** Reaches the surveys of one project, with a project admin's rights. It can read the project's member
  list but cannot change it. It keeps working when the person who made it leaves the project or stops being an admin,
  and it stops when the project is deleted. Its row shows who made it.

A token cannot create or delete projects, manage members or invitations, change your account or make other tokens.
You do those in the page, signed in.

## Create a token

1. Choose **Create token**.
2. Type a **Name** that tells you where the token is used, for example "Nightly export". It can have up to 100
   characters.
3. Choose the **Scope**: Personal, or a project you administer.
4. Choose **Create**.

The dialog shows the token, which starts with `sjs_`. **Copy it now** (**Copy token**): it is shown only once, and
My Surveys keeps no copy that can be shown again. Choose **Done** when you have saved it somewhere safe. If you lose
a token, revoke it and make a new one.

Send the token in the `Authorization` header of each request: `Authorization: Bearer sjs_…`. Treat it like a
password: anyone who has it can do what it allows. Tokens and legacy keys keep working after you change your password; to stop
them, revoke them.

## Revoke a token

Choose **Revoke** on its row. The browser asks "Revoke this token? Integrations that use it stop working." After you
confirm, the token stops working at once. A project admin can revoke any token of their project, whoever made it.

## The legacy access key

If you used an access key with the old My Surveys, your Personal section has a row **Legacy access key** with its last
four characters. It keeps working and reaches what you can reach, on your personal and project surveys. My Surveys
never shows it in full and cannot make a new one.

- Where your instance allows it, the row has **Revoke**. After you confirm ("Revoke this key? Integrations that use
  it stop working."), the key stops working at once.
- Where it does not, the row has a link, **Replace it on surveyjs.io**, to make a new key on your surveyjs.io account.
  The old key stops working there.

Make a new **API token** for anything new: it reaches only what you choose.

## If your account stops

If your account is blocked or disabled, all the tokens and the key that belong to you stop working, including the
project tokens you made. If you leave a project, or stop being an admin, the project's tokens you made keep working;
ask another admin to revoke them if they should stop.

## Using a token from a web page

A script on another website can call the API with a token (the API allows it), but anyone who opens that page can read
the token. Use a token in a page only if the page is private to your team; otherwise call the API from your server.
