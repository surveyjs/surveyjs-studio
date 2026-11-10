# Branding and the licence key

How a self-hosted My Surveys shows your instance's name, logo and colours, what "Powered by SurveyJS" is, and how the
SurveyJS licence key fits in. The decisions behind it are in
[ADR 0027](../adr/0027-branding-and-the-licence-key.md).

## The shells

`APP_SHELL` picks the look of the app:

| `APP_SHELL`               | Look                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `surveyjs-site` (default) | The surveyjs.io header and footer, as on studio.surveyjs.io. The Embed tab and the API docs (`/api/docs`) are here                      |
| `self-hosted`             | A minimal site frame of its own: your instance's name, logo and accent colour; its only SurveyJS part is the "Powered by SurveyJS" mark |
| `plain`                   | A minimal frame without styles, for development and tests                                                                               |

A custom shell is a code change in a fork (mode 3): register it in `web/src/shell/registry.tsx` and set its name in
`APP_SHELL`.

## The self-hosted shell

`APP_SHELL=self-hosted` is a plain site frame for an instance of its own, and a starting point for customising one:

- a header with the instance's logo and name (linking to My Surveys), the main navigation (**My Surveys**,
  **Projects**, and **Users** for instance admins) and the account (the user's name, **Change password**,
  **Sign Out**);
- the page;
- a footer with **Terms**, **Privacy** and **Powered by SurveyJS**.

Nothing in it comes from surveyjs.io but that mark: it loads none of the site's styles or fonts (system fonts only).
Its code is in `web/src/shell/self-hosted/`:

| File                    | What it holds                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelfHostedShell.tsx`   | The frame (`SelfHostedFrame`), the shell of a signed-in page (`SelfHostedShell`) and the footer (`SelfHostedFooter`)                                          |
| `self-hosted.css`       | The frame's styles: readable global class names, `sh-*`                                                                                                       |
| `self-hosted-pages.css` | A neutral look for the app's pages inside the frame (My Surveys, Projects, the editor's bar, results, history, Users, the account pages), scoped to `.sh-app` |
| `accentText.ts`         | The text shade of the accent colour (WCAG AA on white)                                                                                                        |

The classes, for restyling it in a fork or from another stylesheet:

| Class                                                   | Element                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `sh-app`                                                | The frame's root; carries the custom properties below                    |
| `sh-header`                                             | The header                                                               |
| `sh-brand`, `sh-brand__logo`, `sh-brand__name`          | The logo and name, a link to My Surveys                                  |
| `sh-nav`, `sh-nav__link`                                | The main navigation                                                      |
| `sh-account`, `sh-account__name`, `sh-account__link`    | The user's name and Change password                                      |
| `sh-button`                                             | The shell's buttons (Sign Out)                                           |
| `sh-message`, `sh-message--error`                       | Account notices and a failed sign-out, above the page                    |
| `sh-content`                                            | The page                                                                 |
| `sh-footer`, `sh-footer__link`, `sh-footer__powered-by` | The footer and its links; `sh-footer--standalone` under a running survey |

| Custom property                                                                                                    | Value                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `--sh-accent`                                                                                                      | `BRAND_ACCENT_COLOR`: lines (the header line, the current tab, focus rings) and the border of Sign Out |
| `--sh-accent-text`                                                                                                 | The accent darkened until it reads on white (4.5:1): links, the pages' buttons, Sign Out's text        |
| `--sh-text`, `--sh-muted`, `--sh-border`, `--sh-surface`, `--sh-subtle`, `--sh-danger`, `--sh-radius`, `--sh-font` | The neutral palette, radius and font, set on `.sh-app`                                                 |

The shell loads only with `APP_SHELL=self-hosted` (a lazy chunk), so its styles never reach the `surveyjs-site` look.
Its look is pinned by its own visual tests (`pnpm e2e:visual:self-hosted`, [Testing](../testing.md)).

## Branding settings

These apply to the `self-hosted` shell:

| Variable                   | Value                                                           | Default              |
| -------------------------- | --------------------------------------------------------------- | -------------------- |
| `BRAND_NAME`               | Your instance's name, at most 80 characters                     | `My Surveys`         |
| `BRAND_LOGO_URL`           | An https URL, or a path on this site such as `/brand/logo.svg`  | none: the name alone |
| `BRAND_ACCENT_COLOR`       | `#rgb` or `#rrggbb`: links, the header line, buttons            | `#19b394`            |
| `TERMS_URL`, `PRIVACY_URL` | http(s) URLs, linked as **Terms** and **Privacy** in the footer | none: no link        |
| `BRANDING`                 | `on`, or `off` to hide "Powered by SurveyJS"                    | `on`                 |

Example:

```sh
APP_SHELL=self-hosted
BRAND_NAME="Acme Surveys"
BRAND_LOGO_URL=https://cdn.acme.example/logo.svg
BRAND_ACCENT_COLOR=#0a7d4f
TERMS_URL=https://acme.example/terms
PRIVACY_URL=https://acme.example/privacy
```

A wrong value stops the server at start-up with a message naming the variable.

**Where the branding shows:** the header of every signed-in page (My Surveys, Projects, the editor, results, history,
Users), the sign-in and set-password pages, the public results page, and the footer under a running survey. The run page
shows no header: respondents see the survey and the footer. Unless `BRANDING=off`, the survey also shows the Form
Library's "Powered by SurveyJS" block under it, with its logo served by the app.

The logo must be reachable over https, or served by the same site: the pages' Content-Security-Policy loads images from
this site and https only. **My Surveys does not serve your logo file itself**: the server serves only the built web app.
A path such as `/brand/logo.svg` works when your reverse proxy serves that path from your own files (in front of the
app, on the same origin); otherwise use an https URL. The shell loads no fonts or images of its own (the page styles and
their fonts come with the app), so with the logo served by your proxy the instance makes no calls to other sites (S11).

Links, Sign Out and the pages' buttons use a darker shade of the accent colour when the colour itself is too light to
read on white (WCAG AA, 4.5:1). The lines keep the colour as set.

## "Powered by SurveyJS" and the licence key

SurveyJS Studio uses two commercial libraries, Survey Creator and SurveyJS Dashboard. These components can display a
license warning when no valid license key is present. The **Powered by SurveyJS** attribution is a separate part of
the Studio interface.

- **Free official image** &ndash; The image includes a key that removes the license
  warning. Keep `BRANDING=on` to display the **Powered by SurveyJS** attribution
  required by the [Docker Image Terms](../../DOCKER-IMAGE-TERMS.md).
- **White-label deployment** &ndash; Set `SURVEYJS_LICENSE_KEY` to your own key under a
  license that permits white-label use, then set `BRANDING=off` to hide the
  attribution.

`BRANDING=off` stops the server at start-up unless `SURVEYJS_LICENSE_KEY` is set to a key other than the image's:

```text
Invalid configuration:
  - BRANDING: off requires SURVEYJS_LICENSE_KEY set to your own SurveyJS licence key, not the image's key
```

This rule only asks for a key of your own; it does not read keys. What a key allows is checked by the SurveyJS
libraries, and that check is the real one: anyone can set an environment variable. The key is
public by nature, like any licence key in a web page: `/config` hands it to the browser.

## What the shell offers

`GET /config` reports the branding and the shell's features:

```json
{
  "shell": "self-hosted",
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
