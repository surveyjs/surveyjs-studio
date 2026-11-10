# Signing in

On studio.surveyjs.io, My Surveys has no accounts of its own. You sign in with your surveyjs.io
account, and the pages you see belong to it. A self-hosted My Surveys can keep its own accounts
instead: then you sign in with an email and a password (see
[Signing in with a password](#signing-in-with-a-password)). This page describes what you see in the surveyjs.io look (the `surveyjs-site`
shell). The window around the page can differ if your administrator chose another shell.

## Sign in

1. Open any page of My Surveys, for example the home page.
2. If you are not signed in, the browser goes to the sign-in page of surveyjs.io. It is not a page
   of My Surveys.
3. Enter your surveyjs.io email and password.
4. You come back to the page you opened in step 1, not to the home page. A link to a survey or a
   filtered list works the same way.

The header now shows your avatar (or the surveyjs.io account icon) and your name.

Your session lasts **12 hours** from the moment you sign in. It does not renew while you work.
After 12 hours the next page asks you to sign in again. Your work is not lost, but save it before
the time runs out.

If the sign-in does not finish (for example you waited more than ten minutes on the sign-in
page), the browser shows the server's error as a short JSON text: its `detail` line says what went
wrong. Open the page again and sign in again. You can start a sign-in in several tabs at once; each
one finishes on its own.

If your surveyjs.io account has no email address, the sign-in stops with an error and no session
starts.

If your account is blocked, the message is "This account is blocked" and no session starts.
Contact SurveyJS support.

### In a local demo

A server started with `pnpm demo` has no surveyjs.io behind it. It shows a "Sign in as…" page with
the test users, with no password. See [Step 3 demo](../demo/step-03.md).

## Signing in with a password

On a self-hosted My Surveys with its own accounts, the sign-in page is part of My Surveys.

1. Open any page of My Surveys. If you are not signed in, the **Sign in** page opens.
2. Enter your email and password, and choose **Sign in**. Upper and lower case in the email do not
   matter; in the password they do.
3. You come back to the page you opened in step 1.

If the instance also allows surveyjs.io, Google, GitHub or Facebook, the page has a **Sign in with …** link for each.
See [Signing in with a provider](#signing-in-with-a-provider).

The session lasts 12 hours, as above.

### Choosing a password

A password needs **at least 12 characters**, and it must not be a common one (such as
"password1234"). A few words in a row make a password that is long and easy to remember.

### Changing your password

Choose **Change password** in the account menu (in the plain shell: in the header), or open
`/change-password`. Enter your current password, then the new one twice, and choose **Change
password**. The new password must differ from the current one.

Changing the password ends your sessions **everywhere else**, within a minute. A page left open
in another browser or device goes to the **Sign in** page at its next request, and back to where
it was once you have signed in. The browser you changed it in stays signed in.

The same happens to any signed-in page whose session ends: you signed out in another tab, the
session expired, or an instance admin disabled you, reset your password or unlinked the sign-in you
used. Public pages (a survey's run page, public results) are not affected.

### The first sign-in of the first admin

When the operator created the first admin with a password in the server's settings
(`ADMIN_EMAIL` and `ADMIN_PASSWORD`), that password must be changed at the first sign-in:

1. Sign in with that email and password.
2. The **Change your password** page opens: "You must choose a new password before you continue."
   Nothing else opens until you do.
3. Enter the password you signed in with, then a new one twice, and choose **Change password**.
4. You come back to the page you opened.

### A link from your administrator

An instance admin creates your account and sends you a **set-password link** (there is no email
from My Surveys). Open it, enter a password twice, and choose **Set password**. You land signed
in, on My Surveys. Next time, sign in with your email and that password.

The link works once and for 7 days. If it expired or was used, ask your administrator for a new
one. If you forgot your password, ask them to reset it: you get a new link the same way.

### The setup link

When the operator set no first admin, the server writes a one-time link to its log: "This instance
has no admin yet. Open this one-time link to create the first one". Open it, enter the admin's
email, name and password (twice), and choose **Create the admin**. You land signed in as that admin.

The link works once. If it is lost, restarting the server writes a new one, as long as there is no
admin yet.

### Too many failed attempts

After five wrong passwords in a row for an email, the page says "Too many failed attempts. Try
again in 1 minute(s)." Each further failure doubles the wait, up to an hour. A successful sign-in
resets it. The same happens for an email that has no account: the page never tells whether an
account exists.

## Signing in with a provider

A **Sign in with Google** (or GitHub, Facebook, SurveyJS) link on the **Sign in** page takes you to that provider.
After you sign in there, you come back to the page you opened.

- **Your first time.** The provider must share a **verified email address**. If your email already belongs to an
  account, the provider is linked to it, and you land in that account (your password, if you have one, still works).
  If it does not, you need an invitation, or the instance must let your email domain, or anyone, join. Your name is
  the one the provider gives; if it has none, your email.
- **Next times.** The provider alone is enough.
- **No password.** An account made through a provider has no password, so the account menu has no **Change
  password**. An instance admin can still send you a set-password link.
- **If you are refused**, the page **You can't sign in yet** says why: you are not invited ("This instance is open to
  invited people only. Ask a project admin or the person who runs it to invite your email address, then sign in
  again."), the provider did not share a verified email ("Verify it with …, or sign in another way"), or your account
  is disabled. **Back to sign in** returns to the sign-in page.
- **Signing out** of My Surveys does not sign you out of Google, GitHub or Facebook. The next **Sign in with …** may
  not ask for a password.

An invitation you had is used at your first sign-in, whichever way you sign in.

## The account menu

Hover over your name in the header, or move to it with the keyboard and press Enter, Space or the down arrow.
The menu has these items:

| Item      | Opens                                  |
| --------- | -------------------------------------- |
| Settings  | Your surveyjs.io account page          |
| Help Desk | Your tickets in the SurveyJS help desk |
| Billing   | The billing section of your account    |
| Sign Out  | Ends your session (see below)          |

Escape closes the menu and keeps focus on your name. An administrator can change where Settings,
Help Desk and Billing point (`SHELL_LINKS`, see [Development](../development.md#environment-variables-server)).

## Sign out

Choose **Sign Out** in the account menu.

1. My Surveys ends your session and deletes its cookies.
2. The browser goes to surveyjs.io, which ends your surveyjs.io session too, and then returns to
   the start page of My Surveys.
3. The start page asks you to sign in again.

Sign Out also works when your session has already ended (for example the page stayed open for more
than 12 hours): the browser still goes to surveyjs.io, so you are not signed straight back in.

If sign-out fails (for example the network is down), a message "Could not sign out. Please try
again." appears above the page. You are still signed in; try again.

Signing out on one device does not end a session on another device. A session ends on its own
after 12 hours.

## Licence notices

When your SurveyJS licence has expired, or expires in less than 15 days, a dialog opens when you sign in,
as on surveyjs.io:

| Situation                              | Dialog                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| A licence of yours has expired         | "Your renewal subscription has expired." with **Renew** and **Later**  |
| A licence expires in less than 15 days | "Your renewal subscription expires soon." with **Renew** and **Later** |

- **Renew** opens your account page, where you can renew.
- **Later** closes the dialog. It does not open again in this browser. Your browser remembers the
  choice, as on surveyjs.io, so it also stays closed after you sign out and in again.
- While the dialog has not been dismissed, the account icon pulses. Settings in the menu keeps a
  warning mark for as long as the notice applies.
- If both notices apply, only the "expired" dialog opens.
- The dialog also links to the help desk.

The dialog reflects the licence state when you signed in. If you renew while signed in, open the
page again to update it. If the licence service is unavailable, no dialog opens, and you can work
as usual.

## The cookie banner

On your first visit a banner "Your cookie settings" appears at the bottom, as on surveyjs.io.

- **Accept All** closes it. The browser remembers this and does not show the banner again.
- **Cookie Settings** opens "Privacy Overview", with the three categories. **Confirm My Choices**
  closes it. The check boxes are for show: both buttons record the same consent.

My Surveys needs only its two session cookies, which it sets when you sign in. It loads no
analytics or advertising scripts. The banner text is copied from surveyjs.io and mentions
advertising partners. That text does not describe this application. An operator of a hosted
deployment should have it reviewed (see [Architecture](../architecture.md#open-for-later-steps)).

## Troubleshooting

| What you see                                                    | What to do                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "The sign-in took too long, or it started in another browser"   | Open the page you want again, and sign in again. Do not use an old link.  |
| "Too many sign-in attempts"                                     | Wait a minute, then try again.                                            |
| "… could not be reached. Try again in a few minutes"            | The sign-in service did not answer. Try again later.                      |
| "The sign-in … could not be completed"                          | Sign in again. If it happens again, ask your admin.                       |
| You are sent to sign in again after a while                     | The 12 hours are over. Sign in again.                                     |
| You signed in and still land on the sign-in page                | The browser blocks cookies for this site. Allow them, and try again.      |
| "The email or the password is wrong."                           | Check both, and the keyboard layout. The password is case-sensitive.      |
| "Too many failed attempts. Try again in …"                      | Wait as long as it says, then try again.                                  |
| "Use at least 12 characters." or "This password is too common." | Choose a longer or less common password.                                  |
| "This link was used already, has expired, …"                    | Ask for a new link, or restart the server for a lost setup link.          |
| You are asked to sign in again after a password change          | The password was changed in another browser. Sign in with the new one.    |
| "You can't sign in yet"                                         | The sign-in was refused: read the reason on the page, and ask your admin. |
