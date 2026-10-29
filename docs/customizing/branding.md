# Branding and the licence key

How a self-hosted My Surveys shows your instance's name, logo and colours, what "Powered by SurveyJS" is, and how the
SurveyJS licence key fits in. The decisions behind it are in
[ADR 0027](../adr/0027-branding-and-the-licence-key.md).

## The shells

`APP_SHELL` picks the look of the app:

| `APP_SHELL`               | Look                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `surveyjs-site` (default) | The surveyjs.io header and footer, as on studio.surveyjs.io. The Embed tab and the API docs (`/api/docs`) are here |
| `powered-by`              | The self-hosted look: your instance's name, logo and accent colour, and a footer with "Powered by SurveyJS"        |
| `plain`                   | A minimal frame without styles, for development and tests                                                          |

A custom shell is a code change in a fork (mode 3): register it in `web/src/shell/registry.tsx` and set its name in
`APP_SHELL`.

## Branding settings

These apply to the `powered-by` shell:

| Variable                   | Value                                                           | Default              |
| -------------------------- | --------------------------------------------------------------- | -------------------- |
| `BRAND_NAME`               | Your instance's name, at most 80 characters                     | `My Surveys`         |
| `BRAND_LOGO_URL`           | An https URL, or a path on this site such as `/brand/logo.svg`  | none: the name alone |
| `BRAND_ACCENT_COLOR`       | `#rgb` or `#rrggbb`: links, the header line, buttons            | `#19b394`            |
| `TERMS_URL`, `PRIVACY_URL` | http(s) URLs, linked as **Terms** and **Privacy** in the footer | none: no link        |
| `BRANDING`                 | `on`, or `off` to hide "Powered by SurveyJS"                    | `on`                 |

Example:

```sh
APP_SHELL=powered-by
BRAND_NAME="Acme Surveys"
BRAND_LOGO_URL=https://cdn.acme.example/logo.svg
BRAND_ACCENT_COLOR=#0a7d4f
TERMS_URL=https://acme.example/terms
PRIVACY_URL=https://acme.example/privacy
```

A wrong value stops the server at start-up with a message naming the variable.

**Where the branding shows:** the header of every signed-in page (My Surveys, Projects, the editor, results, history,
Users), the sign-in and set-password pages, the public results page, and the footer under a running survey. The run page
shows no header: respondents see the survey and the footer.

The logo must be reachable over https, or served by the same site: the pages' Content-Security-Policy loads images from
this site and https only. **My Surveys does not serve your logo file itself**: the server serves only the built web app.
A path such as `/brand/logo.svg` works when your reverse proxy serves that path from your own files (in front of the
app, on the same origin); otherwise use an https URL. The shell loads no fonts or images of its own (the page styles and
their fonts come with the app), so with the logo served by your proxy the instance makes no calls to other sites (S11).

Text in the accent colour (links, Sign Out) uses a darker shade of it when the colour itself is too light to read on
white (WCAG AA, 4.5:1); the header line keeps the colour as set.

## "Powered by SurveyJS" and the licence key

The editor, the results dashboard and the PDF export are commercial SurveyJS components. They need a licence key in
`SURVEYJS_LICENSE_KEY`. With a key, users see no licence banner; without one, the components show the SurveyJS banner
about a missing licence and stay usable.

- **The free official image** comes with a SurveyJS key (shipped in the image, or obtained from surveyjs.io) that is
  meant to be used with "Powered by SurveyJS" shown. Keep `BRANDING=on`, the default.
- **With your own SurveyJS licence**, set it in `SURVEYJS_LICENSE_KEY` and switch the mark off with `BRANDING=off`, to
  white-label the instance.

`BRANDING=off` without a `SURVEYJS_LICENSE_KEY` stops the server at start-up:

```text
Invalid configuration:
  - BRANDING: off requires SURVEYJS_LICENSE_KEY (your own SurveyJS licence key)
```

My Surveys does not tell one kind of key from another: what a key allows is checked by the SurveyJS libraries. The key is
public by nature, like any licence key in a web page: `/config` hands it to the browser.

## What the shell offers

`GET /config` reports the branding and the shell's features:

```json
{
  "shell": "powered-by",
  "branding": {
    "name": "Acme Surveys",
    "logoUrl": "https://cdn.acme.example/logo.svg",
    "accentColor": "#0a7d4f",
    "termsUrl": "https://acme.example/terms",
    "privacyUrl": "https://acme.example/privacy",
    "poweredBy": true
  },
  "features": { "embed": false, "apiDocs": false, "apiTokens": false }
}
```

The Embed Survey and Embed Creator tabs, the API docs and the API tokens page belong to surveyjs.io (D21): they are on
only in the `surveyjs-site` shell. Elsewhere the editor has no Embed tabs, and `/api/docs` answers `404`
(`API_DOCS=true` is refused at start-up there). The API itself is the same in every shell.
