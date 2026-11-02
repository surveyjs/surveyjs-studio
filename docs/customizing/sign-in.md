# Signing in with Google and others

A self-hosted instance with its own accounts (`USER_DIRECTORY=local`) can offer Google, GitHub, Facebook and
surveyjs.io sign-in next to the email and password. Each method adds a button to the **Sign in** page. The decisions
behind this page are in [ADR 0029](../adr/0029-linking-identities-by-verified-email.md). Every setting is in
[Operations](../operations.md#configuring-accounts).

## What you set up

1. Create an OAuth app at the provider ([below](#google)). Give it **one redirect address**, the same for every
   provider:

   ```text
   <PUBLIC_BASE_URL>/api/v1/auth/callback
   ```

   For `PUBLIC_BASE_URL=https://surveys.example.com` that is `https://surveys.example.com/api/v1/auth/callback`.

2. Set the provider's client ID and secret, and add its name to `AUTH_METHODS`:

   ```text
   USER_DIRECTORY=local
   AUTH_METHODS=password,google,github
   GOOGLE_CLIENT_ID=<your client id>
   GOOGLE_CLIENT_SECRET=<your client secret>
   GITHUB_CLIENT_ID=<your client id>
   GITHUB_CLIENT_SECRET=<your client secret>
   ```

3. Restart the container. The **Sign in** page shows a **Sign in with …** link for each method. The server refuses
   to start when a listed method lacks its settings, or when `USER_DIRECTORY` is not `local`.

The secrets are never logged. Pass them to Docker by name (`-e GOOGLE_CLIENT_SECRET`), not on the command line.

| Method      | `AUTH_METHODS` | Settings                                       | Scopes asked                |
| ----------- | -------------- | ---------------------------------------------- | --------------------------- |
| Google      | `google`       | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | `openid email profile`      |
| GitHub      | `github`       | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`     | `read:user user:email`      |
| Facebook    | `facebook`     | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `email` (Graph API `v23.0`) |
| surveyjs.io | `surveyjs`     | The `OIDC_*` settings                          | `OIDC_SCOPES`               |

## Google

1. In the Google Cloud console, create (or pick) a project and open **APIs & Services > Credentials**.
2. Configure the OAuth consent screen if it is new. The scopes are the basic ones: email, profile, openid.
3. Create an **OAuth client ID** of type **Web application**. Under **Authorized redirect URIs** add the
   [redirect address](#what-you-set-up).
4. Copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

## GitHub

1. In GitHub open **Settings > Developer settings > OAuth Apps > New OAuth App** (for an organisation, in the
   organisation's settings).
2. **Homepage URL** is your `PUBLIC_BASE_URL`. **Authorization callback URL** is the
   [redirect address](#what-you-set-up).
3. Create the app, then **Generate a new client secret**. Copy both values into `GITHUB_CLIENT_ID` and
   `GITHUB_CLIENT_SECRET`.

## Facebook

1. At Meta for Developers create an app and add the **Facebook Login** product (type **Web**).
2. Under **Facebook Login > Settings > Valid OAuth Redirect URIs** add the [redirect address](#what-you-set-up).
3. The app needs the `email` permission. Copy the **App ID** and **App secret** (Settings > Basic) into
   `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET`.

A Facebook account without an email address cannot sign in: see [Verified email](#verified-email).

## surveyjs.io

`surveyjs` with a local directory signs in people who have a surveyjs.io account. It needs the `OIDC_*` settings of
your OAuth client at surveyjs.io (`OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`), and the same redirect
address. When `AUTH_METHODS` is `surveyjs` alone, sign-in goes straight to surveyjs.io. With other methods listed, the
**Sign in** page has a **Sign in with SurveyJS** link.

## Verified email

An identity signs in for the first time only with a **verified email**. The server never trusts an address the
provider has not confirmed: someone could otherwise make an account at a provider with another person's address and
take over that person's account here.

| Provider    | Counts as verified                                                                            |
| ----------- | --------------------------------------------------------------------------------------------- |
| Google      | The `email_verified` claim is `true`                                                          |
| GitHub      | The primary email of the account, marked verified (read from `GET /user/emails`)              |
| Facebook    | An email is present: Meta returns only a confirmed address (a rule the product owner reviews) |
| surveyjs.io | UserInfo does not say `email_verified: false` (a rule the product owner reviews)              |

Without a verified email the person sees [the refused page](#when-sign-in-is-refused), reason `email-unverified`.

## What happens at sign-in

The server follows this order for the person who signed in:

1. **A known identity** (this provider and this person signed in before) signs in to its account.
2. Else, **a verified email that belongs to an account** links the identity to that account and signs in. A person
   with a password account who signs in with Google, using the same verified address, lands in the same account. The
   password keeps working.
3. Else a **new account** is made when the email has a pending invitation, its domain is in `SIGN_UP_DOMAINS`, or
   `OPEN_SIGN_UP=on`. The account is an ordinary user, active, with no password.
4. Else the sign-in is **refused** (`not-invited`).

A **disabled** account is refused at steps 1 and 2. An account an instance admin created and nobody has used yet
(**Invited**) becomes **Active** when an identity links to it.

## Who may join

| Way in            | Effect                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An invitation     | A project admin added the email to a project ([Projects and team members](../user-guide/projects-and-team-members.md#add-a-member)). That person may join                     |
| `SIGN_UP_DOMAINS` | Comma-separated domains, such as `example.com,acme.org`. A person whose verified email ends in `@example.com` may join. The match is exact: `team.example.com` does not match |
| `OPEN_SIGN_UP=on` | Anyone with a verified email may join. Off by default. Use it only when the instance is meant to be open                                                                      |

With none of these, only people who already have an account can sign in. An invitation is used up at the person's
first sign-in, by any method: Google, a password or a set-password link.

## Sign out

**Sign Out** ends the session in My Surveys and returns to the start page. It does **not** sign the person out of
Google, GitHub or Facebook, so choosing a sign-in link again may sign them straight back in. That is how those
providers work.

## When sign-in is refused

The server sends the browser to `/sign-in/refused?reason=…&provider=…`. The page says "You can't sign in yet" and
links back to the **Sign in** page. The server logs the provider and the reason, never the email address.

| Reason             | The page says                                                       | What to do                                                                             |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `not-invited`      | This instance is open to invited people only.                       | Invite the email to a project, add its domain to `SIGN_UP_DOMAINS`, or create the user |
| `email-unverified` | Your account at the provider didn't share a verified email address. | The person verifies the email at the provider, or signs in another way                 |
| `disabled`         | This account is disabled.                                           | An instance admin enables it on the **Users** page                                     |

Other problems:

| What you see                                             | Cause                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The provider says the redirect address does not match    | The address at the provider differs from `<PUBLIC_BASE_URL>/api/v1/auth/callback` (scheme, host, port or path)     |
| "Sign-in is unavailable"                                 | The provider did not answer within 10 seconds, or refused the client secret. See the server log                    |
| "The sign-in expired or was not started in this browser" | The sign-in took over 10 minutes, or cookies are blocked. Start again                                              |
| "My Surveys is read-only at the moment"                  | `READ_ONLY=true`: a first sign-in would write an account or a link ([Operations](../operations.md#read-only-mode)) |

## Trying it without real providers

For development, `pnpm oauth-stub` runs a local stand-in for all four providers, and `OAUTH_STUB_URL` points the
server at it. The stub is refused in production. See [Development](../development.md#the-oauth-stub) and the
[Step 8 demo](../demo/self-hosted-08.md).
