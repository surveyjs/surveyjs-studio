# 27. Branding and the licence key

Date: 2026-10-29

## Status

Accepted.

## Context

The self-hosted image (mode 2b) is free, and builds on commercial SurveyJS components: Survey Creator, the Dashboard and
the PDF export. The spec (spec-self-hosted.md › Shell, branding and licence; D20, D21) asks for:

- a `powered-by` shell with the instance's name, logo and colours, and "Powered by SurveyJS" on every page;
- a licence key that unlocks the components while the branding shows (S24), and a paid key that lets the admin remove
  it (S25);
- the surveyjs.io-only features (the Embed tab, the API docs, API tokens) hidden outside the surveyjs.io shell (S26).

The branding-bound key was an open question of the spec. The decision (2026-10-29): the key is passed in the environment
(`SURVEYJS_LICENSE_KEY`) or another way; with a key, end users see no licence banners; "Powered by SurveyJS" is shown by
default and switched off by a setting; ordinary users get a special key shipped in the image or obtained from
surveyjs.io, and developers use their own key and may switch the mark off.

## Decision

- **The app does not inspect the key.** `SURVEYJS_LICENSE_KEY` is handed to the SurveyJS libraries as before; what a
  key allows, including whether it requires the branding, is the libraries' check. `/config.branding` therefore reports
  the brand and whether the mark shows (`poweredBy`), not the spec's `required`/`removable`.
- **`BRANDING=on|off`**, default `on`. `off` hides "Powered by SurveyJS" and is refused at start-up without a
  `SURVEYJS_LICENSE_KEY`: switching the mark off is for an admin with their own key.
- **The `powered-by` shell** (`APP_SHELL=powered-by`): `BRAND_NAME`, `BRAND_LOGO_URL` (https or a path on this site,
  what the pages' CSP loads), `BRAND_ACCENT_COLOR` (a CSS custom property), `TERMS_URL` and `PRIVACY_URL`. It frames
  every signed-in page, the sign-in, set-password and public results pages, and puts its footer under a running survey.
  It loads nothing from other sites.
- **Features by shell** (`/config.features`): `embed`, `apiDocs` and `apiTokens` are on only in `surveyjs-site`.
  The server does not register `/api/docs` elsewhere (`404`), and refuses `API_DOCS=true` there.

## Consequences

- When the libraries' branding-bound check exists, nothing in the app changes: the shipped key works only with the mark
  shown, and the libraries say so. If the app ever has to know the kind of key, one function feeding
  `branding.poweredBy` reads it.
- A shipped key with `BRANDING=off` starts (the app cannot tell it from a paid key); the libraries decide what the
  components show then. **For self-hosted Step 7** (the image): ship the image's key apart from
  `SURVEYJS_LICENSE_KEY` (a separate variable or a build constant), and make `BRANDING=off` require a
  `SURVEYJS_LICENSE_KEY` that is set and differs from it. That keeps the rule meaningful without reading keys: once the
  image fills `SURVEYJS_LICENSE_KEY` with its own key, "a key is set" no longer means "the admin's own key".
- studio.surveyjs.io keeps the `surveyjs-site` shell and is unchanged.
- The API tokens page is the hosted track's; its flag is reported now so the web app can hide it when it exists.
