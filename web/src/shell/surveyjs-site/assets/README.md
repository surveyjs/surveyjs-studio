# surveyjs.io shell assets

The `surveyjs-site` shell looks like surveyjs.io on purpose (decision D14): its markup, class names,
styles, fonts, icons and texts are copied from the site. This file records where each copy comes
from.

**Source:** the surveyjs.io site, repository `the site's repository`, project `the site`, commit
`(a site commit)` (2026-10-14); the My Surveys page copies (Step 4) come from commit `(a site commit)`
(2026-10-15), which has no changes to the copied files since `(a site commit)`. Everything under `site/`
keeps the path it has in that project, so a copy
can be compared with its original (`site/X` is `the site/the site's source` or
`the site/X`). Prettier skips `site/`, so the copies stay comparable line by line (git stores them with LF line endings; the site has CRLF).

## What is copied

| Copy                                         | Original                                                         | Change                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/**/*.scss` (31)         | `the site's source` (same paths)                                 | None, except `cookies-popup.scss`: the close icon's `url('/Content/Images/…')` is now relative (`../Images/…`).      |
| `site/Content/Fonts/V2/*.woff2` (5)          | `the site's source`                                              | None.                                                                                                                |
| `site/Content/Images/V2/Tour/Close16x16.svg` | `the site's source`                                              | None.                                                                                                                |
| `site/Views/Shared/V2/_icons/**/*.svg` (52)  | `Views/Shared/V2/_icons/**/*the site's page markup` (same names) | Extension `the site's page markup` → `.svg`; the leading byte-order mark removed. Each partial is one plain `<svg>`. |

Step 4 (the My Surveys page) added these copies to the rows above:

| Copy                                                                                   | Used by                                                     |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `site/Content/Styles/components/header.scss`                                           | the page heading (`V2/components/Header`)                   |
| `site/Content/Styles/components/switcher.scss`                                         | the Active / Archived switch (`V2/components/switcher`)     |
| `site/Content/Styles/components/loading.scss`                                          | the loading indicator while a survey is created             |
| `site/Content/Styles/pages/my-surveys.scss`                                            | the page, its actions, project drop-down, rows, empty state |
| `site/Views/Shared/V2/_icons/{16x16/Projects,12x12/Drop-Down-Arrow,64x64/Loading}.svg` | the project drop-down and the loading indicator             |

Step 5 (the row's "…" menu and rename editor) added these copies:

| Copy                                                  | Used by                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/components/forms/text-edit.scss` | the rename input (`V2/components/forms/Text-Edit`). Change: the `select` rule's `background-image: url(/Content/Images/V2/cart-page/icons/expand.svg)` line is dropped (the image is not copied and the shell has no `select`). |
| `site/Views/Shared/V2/_icons/16x16/Edit.svg`          | the pencil next to the survey name (`the site's page markup` → `.svg`, byte-order mark removed)                                                                                                                                 |

The "…" button's three dots and the flyout chevron are inline `<svg>` in the site's view, not partials;
the React row inlines them too.

Step 6 (the survey editor) copies no new style file: the editor page uses rules of the
`pages/my-surveys.scss` copy above. It copies markup and Creator settings from
`the site's page markup` and `the site's source` (commit `(a site commit)`):

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                      | In                             | Original                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Creator container `div#creator.editor-editor.v2-class---my-surveys-edit-survey` and the fixed bottom bar `#edit-survey-change-name-container.v2-class---edit-survey-change-name-container` with the survey name (`…__survey-name-container`, `…__survey-name`)                                                                                                                                                                        | `src/editor/EditorPage.tsx`    | `the site's page markup`; styled by `my-surveys.scss:589-684` (the bar) and `:787-797` (the Creator height)                                          |
| The hidden site footer (`footer { display: none; }`)                                                                                                                                                                                                                                                                                                                                                                                      | `src/editor/editor.module.css` | the inline style of `the site's page markup`, limited to the page that holds `#creator`                                                              |
| Creator options: `showTranslationTab`, `showLogicTab`, `showThemeTab`, `generateValidJSON`, auto-save, `settings.layout.allowCollapseSidebar = false`, the hidden `file.storeDataAsText` property, the survey themes registered as survey and Creator themes, Ace for the JSON tab (search box, language tools, JSON mode and worker, `clouds_midnight`), the Creator UI theme kept in `localStorage["OnlineEditorSurveyCreatorThemeV3"]` | `src/editor/creatorSetup.ts`   | `the site's page markup`, `:112-144`; `editor.tsx:128-175`. The site's "Saved to surveyjs.io service" text is not copied (the default "Saved" stays) |

The save status at the left of the bar, the conflict notice above the Creator and the load error are
the app's own (glue in `src/editor/editor.module.css`); the site has none of them.

The editor's extras (toolbar items, the obfuscated export, the footer rename and the Embed tabs) copy
these, from the same commit:

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                | In                                                                                                                                                                                                      | Original                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `icons/editor/v1/{help,publish,embedsurvey-24x24,embedcreator-24x24,copy,react,angular,vanilla}.svg`, `icons/editor/v2/{help,publish,embedsurvey-24x24,embedcreator-24x24,copy}.svg`                                                                                                                                                                                                                                                | `src/editor/creatorSetup.ts` (registered as `icon-eud`, `icon-publish`, `icon-embedsurvey`, `icon-embedcreator`, `icon-copyembedded`, `icon-react`, `icon-angular`, `icon-vanillajs`, as the site does) | `the site's source`, `…/v2/` (same names). None changed                      |
| `icons/editor/obf-download.svg` (`icon-obf-download`)                                                                                                                                                                                                                                                                                                                                                                               | `src/editor/creatorSetup.ts`                                                                                                                                                                            | the inline `obfIconSvg` string of `the site's source:50`                     |
| `site/Content/Styles/pages/create-free-survey/embedded-tab.scss`                                                                                                                                                                                                                                                                                                                                                                    | `src/editor/embed/EmbedTab.tsx` (Creator chunk only)                                                                                                                                                    | the same path under `wwwroot/`. None changed                                 |
| Toolbar items: Clear Survey (`clear-survey`, `icon-clear`, its title and confirm text, before `svd-settings` and fifth in the footer toolbar), Help (`goto-eud`, "Read the tool guide", the end-user guide URL), Run (`run-survey`, "Click here to run this survey..."), the JSON tab's `svc-json-export-list` drop-down ("Download JSON", "Download obfuscated JSON", `survey.obf.json`, "Please fix error(s)", the popup options) | `src/editor/creatorSetup.ts`                                                                                                                                                                            | option values and texts of `the site's source:29-127`, `:281-295`            |
| The Embed tabs: names (`customembeded`, `customembededcreator`), titles, icons, the component name `svc-tab-customembeded`, the platform choices (texts, icon names, `spg-platform-choice`, default React), "Load Survey JSON from service", the intro text, the Creator licence notice and its two links, the code blocks' markup and class names, "Copy Code"                                                                     | `src/editor/embed/EmbedTab.tsx`, `embedCode.ts`                                                                                                                                                         | `the site's page markup`, `the site's source` (markup and texts only)        |
| The footer name editor: `…__edit-survey-name-container` with the `v2-class---text-edit` input ("Enter a survey name..."), the Save and Cancel buttons (`V2/components/Button`, Brand, Tertiary, Small), the name and the inline pencil `<svg>` in its `<a style="position: relative;">`                                                                                                                                             | `src/editor/FooterNameEditor.tsx`                                                                                                                                                                       | `the site's page markup`; styled by the `my-surveys.scss:589-684` copy above |

Changes to them:

- Run opens the app's run page `/s/{id}` (the old site's address, `/published?id=`, is handled by the site's redirect); Help and Run open with
  `noopener`.
- The Embed tabs' settings are in the Creator's sidebar, as a settings survey copied from
  `embed-tab.tsx` (platform, display method, load from service; the class names and the
  `spg-custom-dropdown-control` styling are the site's); jQuery is not offered (no SurveyJS 3.1.2 jQuery
  package), and the "Display Method" has only On-Page. The intro's last sentence reads "You can also
  paste this code into an online code editor, such as Plunker or CodeSandbox", with links to the two start
  pages: the site builds the example projects with its own services. The "Get Started" link goes to
  surveyjs.io. The code is the app's own template (`embedCode.ts`).
- The links and code headers of `embedded-tab.scss` use a font token that Creator 3.1.2 does not
  define, and its `--sjs2-color-utility-surface-embed` background is not defined either: glue sets the
  font to the page's.
- The pencil's `clip-path` id is unique per page; the pencil link is named "Rename survey". A failed
  rename shows a notice above the Creator ("Could not rename the survey. Please try again.") instead of
  the site's `alert`.
- The obfuscated export's drop-down gets the Creator's download title (the site's has none), and
  "Please fix error(s)" is a Creator notification instead of an `alert`.

The React components in `..` reproduce the markup of these Razor views (structure, class names and
texts): `the site's page markup`, `Views/Shared/V2/top-bar/*the site's page markup`,
`Views/Shared/V2/components/{Button,Logo,Drop-Down-Menu-Item,FAQ-Question,Expand-Collapse-Button,Badge}the site's page markup`,
`Views/Shared/V2/components/circle-icon/{Icon,Circle-Icon}the site's page markup`,
`Views/Shared/V2/components/popups/{Cookies,LicencesExpired,LicencesExpiresSoon}the site's page markup`,
`Views/Shared/V2/footer/*the site's page markup` and `Views/Shared/V2/mobile-menu/*the site's page markup`.

The My Surveys page (`src/surveyList/`) and its placeholder pages reproduce
`the site's page markup` (page structure, actions bar, project drop-down, empty state
and the row markup with its two inline date icons) and the partials it uses:
`V2/components/{Header,Button,Loading}the site's page markup` and `the site's page markup`. The "…" menu
(`the site's page markup`), the pencil and the rename editor are added
with the row's menu (Step 5); the menu's entries are the pure function `surveyMenuItems` in
`src/surveyList/menuItems.ts`. Changes to the markup:

- The two date icons and the `16x16/Edit` pencil repeat the same `clip-path` ids in every row on the
  site; each row gets its own ids here.
- The project drop-down's button is focusable (`role="button"`) and its menu carries `hidden` while
  closed; the switch's checkbox can take focus (glue in `SurveyListPage.module.css`).
- Glue classes for what the site does not have: the "Load more" button (a retry when a page of the
  list fails) and one error message for a failed create, row action or page.
- The "…" menu is rendered while it is open (the site clones `#survey-popup` into the button on the
  first open and keeps it). Its separators are `li` elements (the site puts a `div` directly in the
  `ul`), and the site's `div.survey-canmodify` wrappers are not rendered: React leaves out the items
  the user may not use.
- Keyboard access: the three dots (`…-svg-container`) are a focusable button named "Survey actions"
  (`aria-haspopup`, `aria-expanded`); Enter or Space toggle the menu, Escape closes it and focuses
  the dots again, a mouse press outside or focus leaving closes it. The role sits on the dots, not on
  the site's clickable `div`, because that `div` holds the menu's links. The same goes for the
  submenus (Survey IDs, Move to Project): their text is a focusable button, and a click or Enter
  toggles `v2-class---drop-down-menu--open` (the site toggles it on touch). The pencil link is named
  "Rename survey" and also shows while the focus is in its row (glue).
- Actions are `<a href="#">` (the site's have no `href`, except Archive), so the keyboard reaches
  them; Run links to `/s/{id}` and Edit, View Results and View History to the app's routes.
- "Move to Project" also lists "Personal Surveys" inside a project, as a clickable item (the site
  shows it only in Personal Surveys, marked and inert, so a survey cannot move back).

## Which styles, and why not the whole stylesheet

The site builds one stylesheet, `/Content/css.V2`, from `the site's source`
(`compilerconfig.json`, `Code/the site's code`). `app.scss` is not one indivisible file: it
imports about 200 partials, most of them for the site's own pages (pricing, docs, account pages…).
The shell's entry, `surveyjs-site.scss`, imports only the 37 partials that the top bar, the menus,
the footer, the cookie banner, the licence dialogs, the My Surveys page and the History page use, in the order of
`app.scss`: the design tokens (`sizes`, `media-breakpoints`, `text-styles`, `color-styles`,
`effect-styles`), the base (`layout-styles`, `common-styles`, `mobile-menu`, `cookies-popup`), the
components, the top-bar and footer styles, and `pages/my-surveys.scss`. Compiled, they are about
127 KB of CSS (before minification), against about 940 KB for the whole site.

The entry also holds three small additions next to the copies:

- `@keyframes rotation`, which `loading.scss` uses: the site defines it in `pages/cart-page.scss`,
  which the shell does not copy; the lines are copied from there.
- The page's own `pageStyles` section of `the site's page markup` (`main` as a flex column, an opaque
  loading indicator), limited to pages that render the My Surveys article.
- `#my-surveys-loading .v2-class---loading { display: block }`: `loading.scss` hides the indicator
  and the site's page never unhides it; the app renders it only while a survey is created.

The partials use Sass `@import`, which Dart Sass marks as deprecated; `web/vite.config.ts` silences
that one warning.

## Fonts

All five families are under the SIL Open Font License 1.1 (OFL): they may be copied, embedded and
redistributed with software, and the licence text travels with the files. Each directory holds one
`OFL-<Family>.txt` per family, with that family's copyright line and the full licence.

| Font                       | Files                                                     | Version | Copyright and licence                                                                                                                                        |
| -------------------------- | --------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lato (Latin)               | `Fonts/V2/LatoLatin-{Regular,Medium,Semibold,Bold}.woff2` | 2.015   | © 2011-2015 tyPoland Łukasz Dziedzic, Reserved Font Name "Lato". `Fonts/V2/OFL-Lato.txt`.                                                                    |
| DM Mono                    | `Fonts/V2/DMMono-Regular.woff2`                           | 1.000   | © 2020 The DM Mono Project Authors. `Fonts/V2/OFL-DMMono.txt`. Declared by the copied `fonts.scss`; the shell never uses it, so browsers do not download it. |
| Open Sans (variable, wght) | `Fonts/Google/OpenSans-latin.woff2`, latin subset         | 3.003   | © 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans). `Fonts/Google/OFL-OpenSans.txt`.                                             |
| Raleway (variable, wght)   | `Fonts/Google/Raleway-latin.woff2`, latin subset          | 4.026   | © 2010 The Raleway Project Authors (impallari@gmail.com), Reserved Font Name "Raleway". `Fonts/Google/OFL-Raleway.txt`.                                      |

Lato and DM Mono are copies of the site's own files. Open Sans and Raleway are not in the legacy
source: the site loads them from Google Fonts (`the site's page markup`). The two files here are
the unmodified latin-subset woff2 files that the Google Fonts CSS API serves for those families
(`fonts.googleapis.com/css`, then `fonts.gstatic.com`), downloaded on 2026-10-20 (Step 13). The
shell and the app declare them in `surveyjs-site.scss`, bundled by Vite, so they make no runtime
call to Google. Open Sans is the `body` font of `common-styles.scss`; Raleway styles the results
page headings. Letters outside the latin subset fall back to Helvetica Neue / Helvetica / Arial.
Reserved Font Names: the files keep their original names and are not modified.

## Left out on purpose

- Third-party content the site loads at runtime: Google Tag Manager and the consent updates, the
  Product Hunt badge image and the SourceForge badge script in the footer.
- The live GitHub star count: the site's server asks the GitHub API; the shell shows the site's own
  fallback value, `4.7k`.
- The cart count: the site reads it from its own `/api/Cart/get`; the shell shows the empty cart.
- The "logged in as another user" badge and the scroll-to-top button.

Step 6 (the History page) copies one more file:

| Copy                                  | Used by                                 | Original                          |
| ------------------------------------- | --------------------------------------- | --------------------------------- |
| `site/Content/Images/Clock_12x12.svg` | the clock in front of each entry's time | `the site's source`; none changed |

The page uses the `.my-surveys-history-item` and `.my-surveys-page__clock-icon` rules of the
`pages/my-surveys.scss` copy. It shows the time in the browser's locale and time zone with the zone
named (the site shows the server's `DateTime.ToString()` without a zone).

Step 14 (visual parity) copies the frame of `the site's page markup` into `src/history/HistoryPage.tsx`:
`section.my-surveys-page__results-section`, `div.mod-pt-40 > div.my-surveys-page__header-content >
h1.title.my-surveys-page__title`, and the entries in `div.mod-mt-50.mod-mb-50`. Changes to the markup:

- The entries are a `ul` of `li.my-surveys-history-item`, not `div`s, and the time is a `time`. The site
  wraps the clock and the time in `span.action-link`, a link that opens the saved JSON; the app has no
  JSON view (ADR 0012 R23), so the entry takes the link's font and colour, not its underline or
  pointer. (ADR 0032 replaces this; see below.)
- " by {name}" follows the time in `span.my-surveys-history-item__user` when the user is known.
- The loading, error, "No edits yet." and Show more texts sit in the entries' `div`; "Back to My
  Surveys" follows it. All of them are the app's own.

The JSON view of a history entry ([ADR 0032](../../../../../docs/adr/0032-history-json-view.md)) copies these, from
commit `(a site commit)` (none of them has changed since):

| Copy                                                                                                                                                                                                                                                                                                                                                                                                       | Used by                          | Original                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/components/footer-toolbar-item.scss`                                                                                                                                                                                                                                                                                                                                                  | the Copy JSON button             | the same path under `wwwroot/`, imported where `app.scss` has it (after `forms/checkbox`). None changed                   |
| `site/Views/Shared/V2/_icons/{24x24,20x20}/Copy-Code.svg`                                                                                                                                                                                                                                                                                                                                                  | the Copy JSON button's two icons | `Views/Shared/V2/_icons/{24x24,20x20}the site's page markup` (`the site's page markup` → `.svg`, byte-order mark removed) |
| The entry's `span.action-link` around the clock and the time; the block under it: the Copy JSON button (`V2/components/Footer-Toolbar-Item`: Type Button, not icon-only, its two icons in `circle-icon/Icon` boxes, Smedium and SSmedium, Primary), `div.svc-custom-embedded-tab__code-container` (with `user-select: text`) and `pre.source-code.source-code-embed > code.content-js.language-javascript` | `src/history/HistoryPage.tsx`    | `the site's page markup`                                                                                                  |

Changes to them:

- The `span.action-link` is a `button.action-link` with `aria-expanded`; `history.module.css` drops the button's own
  look. It also holds " by {name}".
- The site sets the JSON with `innerHTML` and colours it with Prism (`prettyElements`). The app sets it as text, without
  Prism; the `pre` has `language-json`, so the `.source-code[class*="language-"]` rule of `common-styles.scss` gives it
  its frame, and glue in `history.module.css` gives it padding, a 480 px height limit and its own scroll.
- The site loads the entry with its clock icon shown a second time; the app says "Loading…". The load error, the
  "Copied" label and the clipboard error are the app's own.

Step 8 (the run page, `src/run/`) copies one piece of markup, from commit `adeaa47cbd`
(2026-10-16; `the site's page markup` has not changed since `a1fd364fb4`, 2026-10-02, so it is
the same in the commits above):

| Copy                                                                                                                                                                                                                                                                                        | In                         | Original                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------ |
| The not-available heading: `h3.running-survey-not-available-header` with its inline style (`position: absolute; top: 0; left: 0; bottom: 80px; right: 0; text-align: center; font-family: Arial; color: red`), the text "This survey is not currently available." and the `<br />` after it | `src/run/NotAvailable.tsx` | `the site's page markup` |

Changes and additions:

- The heading sits in `<main class="running-survey">` (the site puts it straight in `<body>`;
  `running-survey` is the class of the site's survey wrapper). The page title is "Survey not
  available" (the site's run page has an empty title).
- `src/run/run-page.css` sets `margin: 0` on the `body` of a run page, as the site's
  `<body style="margin: 0">` (`the site's page markup`).
- The footer is the Form Library's own brand block (`showBrandInfo`), as on the site: nothing is
  copied for it. `src/run/run-page.css` centres it (`text-align: center`); the library, and so the
  site, aligns it right except on mobile. The run page's other texts (loading, load failure, saving and upload messages) are
  the app's own.

Step 9 (the results page, `src/results/`) copies markup and texts from `the site's page markup`
and `the site's source` (commit `(a site commit)`, the last change of both files,
2026-10-05). No style file is copied: the classes below come from the stylesheets already copied.

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                                         | In                            | Original                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| The tabs: `div.tabs.survey-results-page__tabs` around `ul.tabs__wrapper.my-surveys-page__tabs-wrapper` with three `li.tabs__tab-wrapper > a.tabs__tab`, labelled "Summary", "Table" and "Details" in this order; the active tab adds `tabs__tab--active my-surveys-page__tabs-tab-active`; the tab body is `div.tabs__tab-content.survey-results-page__tab-content`                                                                                          | `src/results/ResultsPage.tsx` | `the site's page markup`, `:54-64` (the list), `:65`, `:71`, `:78` (the bodies) |
| The two Reset sections, each a `div.mod-mt-30` with its text and a `button.rounded-button.rounded-button--danger` (`type="button"`): "Your custom survey data table will be reset to its default state. Please be aware that the table state reset is irreversible." / "Reset Table State", then "Your custom survey data summary will be reset to its default state. Please be aware that the summary state reset is irreversible." / "Reset Summary State" | `src/results/DetailsTab.tsx`  | `the site's page markup`                                                        |
| The confirm questions before a reset: "Are you absolutely sure that you want to remove table state ?" and "Are you absolutely sure that you want to remove summary state ?" (`window.confirm`)                                                                                                                                                                                                                                                               | `src/results/DetailsTab.tsx`  | `survey-results.ts:227-250`                                                     |

Changes and additions:

- The tabs are links to `?tab=summary|table|details` (the summary without `tab`), not the site's
  `#summary`, `#table` and `#info` hash; the active one also has `aria-current="page"`. Only the active
  tab's body is rendered.
- The Reset texts are plain `div`s, as on the site, without the site's `role="alert"` (static text
  is not a live region). After a reset the page shows "The table layout is reset." or "The summary layout is
  reset." (or "The layout was not reset. Please try again.") instead of reloading.
- The page shows the site's "My Surveys. Results" heading (`h3.survey-results-page__title`) and the
  survey name under it; the name is an `h1` styled as the site's description span, so it stays the
  page's level 1 heading. The locale picker is not copied, and the site's "only the first 1,000
  responses" panel is left out: the page shows every response.
- "Back to My Surveys" is the app's own and sits out of the flow where the site draws that panel
  (`results.module.css`), so the page is as tall as the site's.
- Step 13: the page's styles are `site/Content/Styles/pages/survey-results.scss` (a copy of
  `the site's source`, byte-order mark removed), imported after
  `my-surveys.scss`. The Details tab body has the site's `#resultsInfo` id (its flex rule needs it)
  and the Summary body `#summaryContainer`. The Reset texts are plain `div`s, and the Delete Results
  confirmation block (`#ctrlClearAll`) is always laid out and hidden (`visibility: hidden`) until opened (the site uses `visibility: collapse`; `hidden` takes the same room and keeps the block out of the accessibility tree).
- The loading, load-failure, save-failure and export-failure texts are the app's own; the texts inside
  the charts and the table come from survey-analytics.

Step 10 (the Details tab, `src/results/DetailsTab.tsx`) copies markup and texts from the same two files
(`the site's page markup` and `the site's source`, last changed by
commit `(a site commit)`). No style file is copied.

| Copy                                                                                                                                                                                                                                                                                                                                                                      | Original                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| The two columns: `div.column-layout` with `div.column-layout__column.survey-results-header-left` and `div.column-layout__column.column-layout__column--float-right.survey-results-header-right`                                                                                                                                                                           | `the site's page markup`, `:120` |
| The stat lines `div.survey-results-header-line`: "Total responses:", "First response at:", "Last response at:"                                                                                                                                                                                                                                                            | `the site's page markup`         |
| "Download all results as:" (`div.survey-results-header-line.mod-mt-30`) and the links "JSON" and "CSV" (`div.mod-mt-20 > a.rounded-button`)                                                                                                                                                                                                                               | `the site's page markup`         |
| Grant Access: `div#resultaccess.survey-results-header-line`, "Toggle if you want to enable access to the survey results with a direct link." and "Grant Access"; on: "Your Survey results can be accessible via direct Url.", `a.action-link` "Go to the results page" and "Disable Access" (`button.rounded-button > span`)                                              | `the site's page markup`         |
| Save Respondent IP: `div#resultstoreIP.survey-results-header-line`, "Toggle to store the IP addresses of your respondents along with other answers" and "Save Respondent IP in Results"; on: "The IP addresses of your respondents are stored along with other answers. Toggle not to store." and "Do not save Respondent IP in Results" (`button.rounded-button.btn-sm`) | `the site's page markup`         |
| Delete Results: `div.mod-mt-30`, `button.rounded-button.rounded-button--danger` "Delete Results", "Deletes all survey results without the possibility to restore.", the placeholder "Type the survey name" and "Clear All Data"                                                                                                                                           | `the site's page markup`         |
| The confirm question before the deletion: "Are you absolutely sure that you want to delete all results ?" (`window.confirm`)                                                                                                                                                                                                                                              | `survey-results.ts:169-171`      |

Changes and additions:

- The site shows the downloads, toggles and Delete Results only for private surveys and reloads the page
  after a deletion. Here the toggles and Delete Results show to callers who may modify the survey, the
  downloads to everyone who sees the page, and the page refreshes itself.
- The link "Go to the results page" points to the app's public page `/results/<survey id>`; the site's
  link goes to `/Results/Survey/<result id>`. The link is the only place the address shows.
- The dates are the viewer's `toLocaleString()`. The dates and Delete Results are hidden when there are no
  responses (as the site's `totalResponses` binding does).
- The delete warning is `p.v2-class---paragraph` without the site's `role="alert"`; the name field has an
  `aria-label`. The Delete panel opens and closes with its button.
- The outcome texts ("All results are deleted.", "The results could not be deleted. Please try again."),
  the toggle failure ("The setting could not be saved. Please try again."), the statistics texts ("Loading
  statistics…", "The statistics could not be loaded. Check your connection and try again.") and the
  private-question failure ("The list of private questions could not be saved. Please try again.") are the
  app's own. "Make private" and "Make public" come from survey-analytics.

Step 11 (the Projects page, `src/projects/`) added these copies, from commit `adeaa47cbd`
(2026-10-16; the copied files last changed in `a1fd364fb4`, 2026-10-02). `surveyjs-site.scss` imports
the three style files in the order of `app.scss`, just before `pages/my-surveys.scss`. None of them is
changed.

| Copy                                                              | Used by                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/pages/account/index.scss`                    | the page frame (`v2-class---account-page`, `__section-container`), the `Section-Size--Account` mixin, `__actions-footer`, `--not-for-mobile` and `--for-mobile-only` |
| `site/Content/Styles/pages/account/sections/license-manager.scss` | the "Add a New Member" button (`v2-class---add-assignment__button`, `__button-text`)                                                                                 |
| `site/Content/Styles/pages/account/sections/projects.scss`        | the section, the cards, the member rows, the Admin badge, the pills and the editors                                                                                  |
| `site/Views/Shared/V2/_icons/pages/account/{Add,Remove}.svg`      | the plus of Create a Project and Add a New Member, and the remove "x" of a member row (`the site's page markup` → `.svg`, byte-order mark removed)                   |

The page reproduces the markup of `the site's page markup` (structure, class names
and texts) in `ProjectsPage.tsx`, `ProjectCard.tsx`, `ProjectNameEditor.tsx`, `MemberRow.tsx` and
`AddMemberForm.tsx`, with the partials it uses (`V2/components/{Header,Button,Expand-Collapse-Button}`).
Changes to the markup:

- The heading is **Projects**, an `h1` like the My Surveys page's, instead of the section's "Manage
  MySurveys" `h3`. The page is the section alone, in the account page's `article` and selected section
  container, without the account page's sidebar.
- The intro's link "the Free Survey Tool" goes to `/`, the app's My Surveys page.
- Knockout bindings and the `data-details` toggles are React state: the `<details>` card opens and
  closes through its state (a click on the summary), and the members are read when it first opens.
- New: the "Leave Project" link for plain members (an admin leaves through the "x" on their own
  row), the confirm questions (the site asks "Are you sure?"), the error messages in the card or
  under the editor (the site shows none, or an `alert`), and "Loading the members…". Their texts are
  in `src/projects/messages.ts`. Glue for the error text is in `ProjectsPage.module.css`, with a
  focus outline for the card's summary (`account/index.scss` removes it).
- The controls are focusable: Create a Project, Add a New Member and the remove "x" are
  `role="button"` with `tabIndex` (Enter and Space activate them); the links have `href="#"`. The "x"
  is named "Remove {name}". The inputs have an `aria-label`.
- The summary's links (Rename, Remove, Leave Project) do not open or close the card.
- The plus icons sit in a `span` (the site puts the partial's `<svg>` straight in the `div`).
