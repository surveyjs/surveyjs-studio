# Demo: self-hosted Step 6, the "Powered by SurveyJS" shell and branding

This page lets you check self-hosted Step 6 without reading code. It takes about fifteen minutes. Commands are for Git
Bash (or any POSIX shell), from the repository root.

What Step 6 delivers: **the self-hosted shell.** `APP_SHELL=self-hosted` is a minimal site frame of its own, with your
instance's name, logo and accent colour on every page, and "Powered by SurveyJS" and your Terms and Privacy links in the
footer: its only tie to SurveyJS. It loads none of the surveyjs.io styles or fonts; the pages inside it get a neutral
look of its own. The surveyjs.io-only features
(the editor's Embed tabs and the API docs) are hidden there. `BRANDING=off` removes the mark for an admin with their own
SurveyJS licence key. studio.surveyjs.io keeps its `surveyjs-site` look. Details:
[Branding and the licence key](../customizing/branding.md).

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists. Ports 3000 and 5173 must be free.
Start from a fresh database: `rm -rf server/.data`, then `pnpm seed:sqlite`.

## 1. Every page shows the branding (checklist 1)

Start the app in the self-hosted shell with a name, a logo and a colour:

```sh
APP_SHELL=self-hosted BRAND_NAME="Acme Surveys" \
  BRAND_LOGO_URL=https://www.surveyjs.io/favicon.ico BRAND_ACCENT_COLOR=#0a7d4f \
  TERMS_URL=https://acme.example/terms PRIVACY_URL=https://acme.example/privacy \
  pnpm dev:sqlite
```

1. Open <http://localhost:5173> and choose **Olivia Owner** on the "Sign in as…" page.
   - **Check:** the header shows the logo and **Acme Surveys**, **My Surveys** and **Projects**, then **Olivia Owner** and
     **Sign Out**, above a green line. The footer shows **Terms**, **Privacy** and **Powered by SurveyJS**. The page uses
     the system font, not the surveyjs.io fonts.
2. Open the "…" menu of **Customer feedback** and choose **Edit**. **Check:** the same header and footer around the
   Creator.
3. Go back, open the survey's "…" menu and choose **View Results**. **Check:** the same header and footer.
4. Open <http://localhost:5173/s/22222222-0000-4000-8000-a00000000001>. **Check:** the survey runs with the footer under
   it, and no header.

## 2. The surveyjs.io features are hidden (checklist 2)

1. In the editor (part 1, step 2), look at the tabs, also under **More**. **Check:** no **Embed Survey** and no
   **Embed Creator**.
2. Open <http://localhost:5173/api/docs>. **Check:** `404`.
3. Stop the app (Ctrl+C) and start it as usual: `pnpm dev:sqlite`. Open the editor again. **Check:** the surveyjs.io
   look, the **Embed Survey** tab is back, and <http://localhost:5173/api/docs> shows the API reference (after
   `pnpm build:docs`, which `dev:sqlite` runs).

## 3. Switching the mark off (checklist 3)

1. Start with `APP_SHELL=self-hosted BRANDING=off pnpm dev:sqlite`.
   - **Check:** the server stops: `BRANDING: off requires SURVEYJS_LICENSE_KEY (your own SurveyJS licence key)`.
     Step 7 changed the message to `BRANDING: off requires SURVEYJS_LICENSE_KEY set to your own SurveyJS licence key, not the image's key`.
2. Start with `APP_SHELL=self-hosted BRANDING=off SURVEYJS_LICENSE_KEY=<your key> pnpm dev:sqlite`.
   - **Check:** the pages show no **Powered by SurveyJS**; with a valid key, the editor shows no licence banner.

The check that a shipped, branding-bound key works only with the mark shown belongs to the SurveyJS libraries
([ADR 0027](../adr/0027-branding-and-the-licence-key.md)); My Surveys does not tell keys apart.

## Clean up

Stop the app with Ctrl+C. `rm -rf server/.data` removes the local database and files.

## What the automated tests cover

- `pnpm test:unit`: the settings and their refusals, `/config.branding` and `.features`, `/api/docs` gated by shell;
  the self-hosted shell's header, footer and accent colour; the branding on the sign-in, set-password, run and public
  results pages; the editor without the Embed tabs.
- `pnpm test:conformance:password`: `/config` and `/api/docs` in the self-hosted shell (the default run: surveyjs-site).
- `pnpm e2e:self-hosted`: the branding on sign-in, My Surveys, the editor, the results and the run page in a browser, no
  Embed tabs, and `/api/docs` answering `404`.
