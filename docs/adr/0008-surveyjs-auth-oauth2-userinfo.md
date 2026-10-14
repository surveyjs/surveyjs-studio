# 8. Sign in to auth.surveyjs.io as an OAuth 2.0 client, with identity from UserInfo

Date: 2026-10-14

## Status

Accepted

## Context

The plan and the spec described the hosted sign-in as "surveyjs.io OIDC": a confidential OpenID
Connect client that gets the user's identity from an ID token.

The legacy sign-in server, `auth.surveyjs.io`, is not a full OpenID provider
([legacy layout, 6.1](../architecture/legacy-data-layout.md#61-sign-in-server-authsurveyjsio)):

- It publishes OAuth 2.0 authorization server metadata (RFC 8414,
  `/.well-known/oauth-authorization-server`). It has no `/.well-known/openid-configuration` and no
  `jwks_uri`.
- Its token endpoint issues an opaque access token and **no ID token**. It accepts the client secret
  in the request body (`client_secret_post`) or in the `Authorization` header.
- The user's identity (`sub`, `email`, `name`) comes from its UserInfo endpoint.
- Its logout accepts `client_id` and `post_logout_redirect_uri`.

A strict OIDC client cannot sign in there: discovery fails, and there is no ID token to validate.
Self-hosted deployments may still want a real OpenID provider.

## Decision

The `surveyjs-oidc` identity provider (name kept) is an **OAuth 2.0 authorization code client** that
also speaks OIDC when the provider supports it.

- **Discovery** is chosen by `OIDC_DISCOVERY`: `oauth-authorization-server` (default; RFC 8414, what
  auth.surveyjs.io serves) or `openid-configuration`.
- **The identity always comes from the UserInfo endpoint** (`sub`, `email`, `name`, and `picture`
  when present), with the access token.
- **An ID token is validated when one comes back** (issuer, audience, expiry, signature, and the
  nonce when one was sent), and its `sub` must equal the UserInfo `sub`. A response without an ID
  token is not an error in `oauth-authorization-server` mode.
- PKCE (S256) and `state` are always used. A `nonce` is sent only in `openid-configuration` mode with
  the `openid` scope. The default scopes follow the mode: `profile email`, or `openid profile email`.
- Sign-out uses the provider's `end_session_endpoint` with `client_id` and
  `post_logout_redirect_uri`, as auth.surveyjs.io expects.

## Consequences

- My Surveys can sign in against auth.surveyjs.io as it is, without changes to the legacy server.
- In the default mode the user's identity rests on TLS to the provider and on the access token, not
  on a signed ID token. `OIDC_ISSUER_URL` must therefore be https, except for a loopback host (the
  local mock OIDC server).
- The same code runs against the mock OIDC server (`mock-oauth2-server`, Azurite mode). It serves RFC
  8414 metadata under the issuer path and does send an ID token, so the ID-token check is exercised
  too.
- A self-hosted deployment can use a standard OpenID provider with
  `OIDC_DISCOVERY=openid-configuration`.
- The name `surveyjs-oidc` and the `OIDC_*` variable names are kept, although the default mode is
  plain OAuth 2.0.
