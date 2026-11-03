# ADR 0029: Linking identities by verified email

Status: Accepted (self-hosted Step 8). Two rules in D2 are open for the product owner (see [Open points](#open-points)).

## Context

Until Step 8 a self-hosted instance with local accounts had one way in: an email and a password
([ADR 0026](0026-revoking-stateless-sessions-with-an-epoch.md)). The setting `AUTH_METHODS` already named `google`,
`github` and `facebook`, but the server refused them, and refused `surveyjs` with a local directory
([ADR 0018](0018-accounts-by-deployment-mode.md)). Step 8 lets an instance offer Google, GitHub, Facebook and
surveyjs.io sign-in on top of its own accounts, and lets project admins invite people who have not signed in yet.

Two questions follow. When may an outside identity use an account that already exists? And who may get a new
account by signing in? Getting the first wrong lets someone take over an account with an email they do not own.

## Decision

| #   | Topic                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | One callback              | Every provider returns to `<PUBLIC_BASE_URL>/api/v1/auth/callback`. The provider is in the sealed sign-in transaction, set by `login?provider=<method>`. A transaction without it (an older cookie, or `login` with no `provider`) is finished by the primary provider. `login` with no `provider` keeps its behaviour: the dev page with `IDENTITY_PROVIDER=dev`, the surveyjs.io redirect when `AUTH_METHODS` is exactly `surveyjs`, else the web app's `/sign-in` page. The hosted service does not change |
| D2  | A verified email          | Google: `email_verified` is `true`. GitHub: the primary entry of `GET /user/emails` with `verified: true`. Facebook: the Graph API `email`, when present. surveyjs.io: verified unless UserInfo says `email_verified: false`. The first sign-in of an identity, linking or creating, needs a verified email                                                                                                                                                                                                   |
| D3  | The order at the callback | With a local directory: (1) a known identity signs in to its account; (2) else a verified email that names an account links the identity to it; (3) else an account is created when the email has a pending invitation, its domain is in `SIGN_UP_DOMAINS`, or `OPEN_SIGN_UP=on`; (4) else the sign-in is refused. A domain matches exactly, case-insensitively, the part after the last `@`; subdomains do not match                                                                                         |
| D4  | Pending members           | Only with `USER_DIRECTORY=local`. `addMember` with an email no account has stores an invitation and answers `201` with a `Member` whose `status` is `pending` and `userId` is `null`. The invitation moves into the project's members at the next successful sign-in of that email, by any method. `removeInvitation` removes it. The table is `project_invitations`. Hosted instances still answer `404 user-not-found`                                                                                      |
| D5  | Settings                  | `GOOGLE_*`, `GITHUB_*` and `FACEBOOK_*` (`CLIENT_ID` and `CLIENT_SECRET`), `SIGN_UP_DOMAINS`, `OPEN_SIGN_UP` (`on` or `off`, default `off`), and for development and tests `OAUTH_STUB_URL`, refused in production. surveyjs.io keeps `OIDC_*`                                                                                                                                                                                                                                                                |
| D6  | One test stub             | A single stub on `node:http` and `node:crypto` serves all four providers. Unit tests, the conformance setup and Playwright start it in the process. There is no Docker, so it runs on Windows and in CI. The plan said mock-oauth2-server plus stubs in Compose; the Azurite mode keeps its mock-oauth2-server                                                                                                                                                                                                |
| D7  | Accounts from OAuth       | `instanceRole: "user"`, `status: "active"`, no password, no forced change. The display name is the provider's name, else the email. `getCurrentUser` has `hasPassword`, so the shell hides **Change password** for them                                                                                                                                                                                                                                                                                       |
| D8  | Refusals                  | The callback redirects to `/sign-in/refused?reason=<reason>&provider=<method>`. Reasons: `not-invited`, `email-unverified`, `disabled`. The server logs the provider and the reason, never the email                                                                                                                                                                                                                                                                                                          |

Details that follow from the table:

- A `disabled` account is refused at steps 1 and 2. An `invited` account (made by an instance admin, no password yet)
  becomes `active` when an identity links to it, so the account-status rule counts a linked identity like a password.
- Every provider uses `state` and PKCE (S256); Google also checks the `nonce`; Facebook calls send `appsecret_proof`.
  Tokens are dropped after the callback. Calls to providers time out after 10 seconds.
- With `READ_ONLY=true` an OAuth2 sign-in writes nothing. A known identity of an active account signs in; anything
  that would link, create or activate answers `503 read-only`.
- An instance without `password` in `AUTH_METHODS` needs `ADMIN_EMAIL` (and refuses `ADMIN_PASSWORD`): while there is
  no active admin, start-up creates that admin, active and without a password, and the first OAuth2 sign-in with that
  verified email links to it (D3 step 2). No setup link is logged.
- Logout ends at `/` unless `AUTH_METHODS` is exactly `surveyjs`. It does not sign anyone out of Google, GitHub or
  Facebook.
- This ADR extends ADR 0018: `google`, `github`, `facebook` and `surveyjs` are valid with `USER_DIRECTORY=local`. It
  also lifts the refusal of `surveyjs` with a local directory that ADR 0026 noted.

### Alternatives set aside

| Alternative                                          | Why not                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link an identity by any email the provider returns   | Someone makes an account at a provider with another person's address, then signs in as them. Only a verified email shows control of the address                |
| One callback address per provider                    | Operators would register and keep several addresses in step with `PUBLIC_BASE_URL`. One address, with the provider in the transaction, is simpler to configure |
| mock-oauth2-server and small stubs in Docker Compose | Needs Docker for unit tests and on Windows, and three kinds of stub to keep. One TypeScript stub runs everywhere                                               |

## Consequences

- An operator creates an OAuth app per provider, with one redirect URI, and sets two variables per provider. The
  guide is [Signing in with Google and others](../customizing/sign-in.md).
- A person with a password account and a verified Google address lands in the same account. A person whose provider
  gives no verified email cannot sign in with it at all.
- An account, an instance admin's included, can be reached by anyone who controls its email at an enabled provider.
  Enable only providers you trust to verify emails.
- Invitations show to project admins as pending members and cost one table, `project_invitations` (migration 0005,
  [data model](../architecture/data-model.md)).
- Linking is one way: unlinking an identity is not built.

## Open points

These two rules are marked for the product owner to confirm. Until then they stay as written in D2.

- **Facebook:** an `email` in the Graph API answer counts as verified, because Meta returns only a confirmed address.
  If the owner does not trust that, Facebook could sign in only accounts that are already linked.
- **surveyjs.io:** an email counts as verified unless UserInfo says `email_verified: false`, because surveyjs.io
  confirms emails at registration. If the owner does not trust that, surveyjs.io would have to send
  `email_verified: true`.
