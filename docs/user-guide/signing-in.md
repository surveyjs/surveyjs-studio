# Signing in

My Surveys has no accounts of its own. You sign in with your surveyjs.io account, and the pages
you see belong to it. This page describes what you see in the surveyjs.io look (the `surveyjs-site`
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
page), you see a short error message from the server, as plain text in the browser. Open the page
again and sign in again.

If your account is blocked, the message is "This account is blocked" and no session starts.
Contact SurveyJS support.

### In a local demo

A server started with `pnpm demo` has no surveyjs.io behind it. It shows a "Sign in as…" page with
the test users, with no password. See [Step 3 demo](../demo/step-03.md).

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

| What you see                                             | What to do                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| "The sign-in expired or was not started in this browser" | Open the page you want again, and sign in again. Do not use an old link. |
| "Too many sign-in attempts"                              | Wait a minute, then try again.                                           |
| "Sign-in is unavailable"                                 | The sign-in service did not answer. Try again later.                     |
| You are sent to sign in again after a while              | The 12 hours are over. Sign in again.                                    |
| You signed in and still land on the sign-in page         | The browser blocks cookies for this site. Allow them, and try again.     |
