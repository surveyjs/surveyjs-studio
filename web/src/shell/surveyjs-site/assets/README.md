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

| Copy                                         | Original                                          | Change                                                                                                          |
| -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/**/*.scss` (31)         | `the site's source` (same paths)            | None, except `cookies-popup.scss`: the close icon's `url('/Content/Images/…')` is now relative (`../Images/…`). |
| `site/Content/Fonts/V2/*.woff2` (5)          | `the site's source`                       | None.                                                                                                           |
| `site/Content/Images/V2/Tour/Close16x16.svg` | `the site's source`   | None.                                                                                                           |
| `site/Views/Shared/V2/_icons/**/*.svg` (52)  | `Views/Shared/V2/_icons/**/*the site's page markup` (same names) | Extension `the site's page markup` → `.svg`; the leading byte-order mark removed. Each partial is one plain `<svg>`.           |

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
| `site/Views/Shared/V2/_icons/16x16/Edit.svg`          | the pencil next to the survey name (`the site's page markup` → `.svg`, byte-order mark removed)                                                                                                                                                |

The "…" button's three dots and the flyout chevron are inline `<svg>` in the site's view, not partials;
the React row inlines them too.

Step 6 (the survey editor) copies no new style file: the editor page uses rules of the
`pages/my-surveys.scss` copy above. It copies markup and Creator settings from
`the site's page markup` and `the site's source` (commit `(a site commit)`):

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                      | In                             | Original                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Creator container `div#creator.editor-editor.v2-class---my-surveys-edit-survey` and the fixed bottom bar `#edit-survey-change-name-container.v2-class---edit-survey-change-name-container` with the survey name (`…__survey-name-container`, `…__survey-name`)                                                                                                                                                                        | `src/editor/EditorPage.tsx`    | `the site's page markup`; styled by `my-surveys.scss:589-684` (the bar) and `:787-797` (the Creator height)                                         |
| The hidden site footer (`footer { display: none; }`)                                                                                                                                                                                                                                                                                                                                                                                      | `src/editor/editor.module.css` | the inline style of `the site's page markup`, limited to the page that holds `#creator`                                                              |
| Creator options: `showTranslationTab`, `showLogicTab`, `showThemeTab`, `generateValidJSON`, auto-save, `settings.layout.allowCollapseSidebar = false`, the hidden `file.storeDataAsText` property, the survey themes registered as survey and Creator themes, Ace for the JSON tab (search box, language tools, JSON mode and worker, `clouds_midnight`), the Creator UI theme kept in `localStorage["OnlineEditorSurveyCreatorThemeV3"]` | `src/editor/creatorSetup.ts`   | `the site's page markup`, `:112-144`; `editor.tsx:128-175`. The site's "Saved to surveyjs.io service" text is not copied (the default "Saved" stays) |

The save status at the left of the bar, the conflict notice above the Creator and the load error are
the app's own (glue in `src/editor/editor.module.css`); the site has none of them.

The editor's extras (toolbar items, the obfuscated export, the footer rename and the Embed tabs) copy
these, from the same commit:

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                | In                                                                                                                                                                                                      | Original                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `icons/editor/v1/{help,publish,embedsurvey-24x24,embedcreator-24x24,copy,react,angular,vanilla}.svg`, `icons/editor/v2/{help,publish,embedsurvey-24x24,embedcreator-24x24,copy}.svg`                                                                                                                                                                                                                                                | `src/editor/creatorSetup.ts` (registered as `icon-eud`, `icon-publish`, `icon-embedsurvey`, `icon-embedcreator`, `icon-copyembedded`, `icon-react`, `icon-angular`, `icon-vanillajs`, as the site does) | `the site's source`, `…/v2/` (same names). None changed                                    |
| `icons/editor/obf-download.svg` (`icon-obf-download`)                                                                                                                                                                                                                                                                                                                                                                               | `src/editor/creatorSetup.ts`                                                                                                                                                                            | the inline `obfIconSvg` string of `the site's source:50`                                         |
| `site/Content/Styles/pages/create-free-survey/embedded-tab.scss`                                                                                                                                                                                                                                                                                                                                                                    | `src/editor/embed/EmbedTab.tsx` (Creator chunk only)                                                                                                                                                    | the same path under `wwwroot/`. None changed                                                              |
| Toolbar items: Clear Survey (`clear-survey`, `icon-clear`, its title and confirm text, before `svd-settings` and fifth in the footer toolbar), Help (`goto-eud`, "Read the tool guide", the end-user guide URL), Run (`run-survey`, "Click here to run this survey..."), the JSON tab's `svc-json-export-list` drop-down ("Download JSON", "Download obfuscated JSON", `survey.obf.json`, "Please fix error(s)", the popup options) | `src/editor/creatorSetup.ts`                                                                                                                                                                            | option values and texts of `the site's source:29-127`, `:281-295`                                |
| The Embed tabs: names (`customembeded`, `customembededcreator`), titles, icons, the component name `svc-tab-customembeded`, the platform choices (texts, icon names, `spg-platform-choice`, default React), "Load Survey JSON from service", the intro text, the Creator licence notice and its two links, the code blocks' markup and class names, "Copy Code"                                                                     | `src/editor/embed/EmbedTab.tsx`, `embedCode.ts`                                                                                                                                                         | `the site's page markup`, `the site's source` (markup and texts only) |
| The footer name editor: `…__edit-survey-name-container` with the `v2-class---text-edit` input ("Enter a survey name..."), the Save and Cancel buttons (`V2/components/Button`, Brand, Tertiary, Small), the name and the inline pencil `<svg>` in its `<a style="position: relative;">`                                                                                                                                             | `src/editor/FooterNameEditor.tsx`                                                                                                                                                                       | `the site's page markup`; styled by the `my-surveys.scss:589-684` copy above              |

Changes to them:

- Run opens the app's run page `/s/{id}` (the site's is `/published?id=`); Help and Run open with
  `noopener`.
- The Embed tabs' settings are inside the tab (glue in `src/editor/embed/EmbedTab.module.css`), not a
  settings survey in the Creator's sidebar; jQuery is not offered (no SurveyJS 3.1.2 jQuery package),
  nor the "Display Method" (pop-up) choice; the intro leaves out its last sentence (viewing the
  example on Plunker or CodeSandbox: the site builds those projects with its own services). The
  "Get Started" link goes to surveyjs.io. The code is the app's own template (`embedCode.ts`).
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
- Glue classes for what the site does not have: the "Load more" button and one error message for a
  failed create or row action.
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
The shell's entry, `surveyjs-site.scss`, imports only the 31 partials that the top bar, the menus,
the footer, the cookie banner, the licence dialogs and the My Surveys page use, in the order of
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

| Font             | Files                                            | Licence                                                                                                                                                         |
| ---------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lato 2.0 (Latin) | `LatoLatin-{Regular,Medium,Semibold,Bold}.woff2` | SIL Open Font License 1.1 (© Łukasz Dziedzic): may be copied, embedded and redistributed with software.                                                         |
| DM Mono          | `DMMono-Regular.woff2`                           | SIL Open Font License 1.1 (© The DM Mono Project Authors). Declared by the copied `fonts.scss`; the shell itself never uses it, so browsers do not download it. |

The site serves these files itself, and so does the shell (bundled by Vite). The site also loads
**Raleway** and **Open Sans** from Google Fonts. The shell does not: it makes no runtime calls to
third parties, and the legacy source has no copies of those files. Raleway only styles legacy page
classes the shell does not use. Open Sans is the second choice after Lato in the site's font stack
and the `body` font of `common-styles.scss`, so page text outside the shell's elements falls back to
Helvetica Neue / Helvetica / Arial. Step 13 (visual parity) decides whether to self-host Open Sans
(it is licensed under the SIL OFL 1.1, so that is allowed).

## Left out on purpose

- Third-party content the site loads at runtime: Google Tag Manager and the consent updates, the
  Product Hunt badge image and the SourceForge badge script in the footer.
- The live GitHub star count: the site's server asks the GitHub API; the shell shows the site's own
  fallback value, `4.7k`.
- The cart count: the site reads it from its own `/api/Cart/get`; the shell shows the empty cart.
- The "logged in as another user" badge and the scroll-to-top button.

Step 6 (the History page) copies one more file:

| Copy                                  | Used by                                 | Original                                               |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `site/Content/Images/Clock_12x12.svg` | the clock in front of each entry's time | `the site's source`; none changed |

The page uses the `.my-surveys-history-item` and `.my-surveys-page__clock-icon` rules of the
`pages/my-surveys.scss` copy. It shows the time in the browser's locale and time zone with the zone
named (the site shows the server's `DateTime.ToString()` without a zone).

Step 8 (the run page, `src/run/`) copies one piece of markup, from commit `adeaa47cbd`
(2026-10-16; `the site's page markup` has not changed since `a1fd364fb4`, 2026-10-02, so it is
the same in the commits above):

| Copy                                                                                                                                                                                                                                                                                        | In                         | Original                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------ |
| The not-available heading: `h3.running-survey-not-available-header` with its inline style (`position: absolute; top: 0; left: 0; bottom: 80px; right: 0; text-align: center; font-family: Arial; color: red`), the text "This survey is not currently available." and the `<br />` after it | `src/run/NotAvailable.tsx` | `the site's page markup` |

Changes and additions:

- The heading sits in `<main class="running-survey">` (the site puts it straight in `<body>`;
  `running-survey` is the class of the site's survey wrapper). The page title is "Survey not
  available" (the site's run page has an empty title).
- `src/run/run-page.css` sets `margin: 0` on the `body` of a run page, as the site's
  `<body style="margin: 0">` (`the site's page markup`).
- The footer is the Form Library's own brand block (`showBrandInfo`), as on the site: nothing is
  copied for it. The run page's other texts (loading, load failure, saving and upload messages) are
  the app's own.

Step 9 (the results page, `src/results/`) copies markup and texts from `the site's page markup`
and `the site's source` (commit `(a site commit)`, the last change of both files,
2026-10-05). No style file is copied: the classes below come from the stylesheets already copied.

| Copy                                                                                                                                                                                                                                                                                                                                                                                                                                                         | In                            | Original                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| The tabs: `div.tabs.survey-results-page__tabs` around `ul.tabs__wrapper.my-surveys-page__tabs-wrapper` with three `li.tabs__tab-wrapper > a.tabs__tab`, labelled "Summary", "Table" and "Details" in this order; the active tab adds `tabs__tab--active my-surveys-page__tabs-tab-active`; the tab body is `div.tabs__tab-content.survey-results-page__tab-content`                                                                                          | `src/results/ResultsPage.tsx` | `the site's page markup`, `:54-64` (the list), `:65`, `:71`, `:78` (the bodies) |
| The two Reset sections, each a `div.mod-mt-30` with its text and a `button.rounded-button.rounded-button--danger` (`type="button"`): "Your custom survey data table will be reset to its default state. Please be aware that the table state reset is irreversible." / "Reset Table State", then "Your custom survey data summary will be reset to its default state. Please be aware that the summary state reset is irreversible." / "Reset Summary State" | `src/results/DetailsTab.tsx`  | `the site's page markup`                                                   |
| The confirm questions before a reset: "Are you absolutely sure that you want to remove table state ?" and "Are you absolutely sure that you want to remove summary state ?" (`window.confirm`)                                                                                                                                                                                                                                                               | `src/results/DetailsTab.tsx`  | `survey-results.ts:227-250`                                                       |

Changes and additions:

- The tabs are links to `?tab=summary|table|details` (the summary without `tab`), not the site's
  `#summary`, `#table` and `#info` hash; the active one also has `aria-current="page"`. Only the active
  tab's body is rendered.
- The Reset texts are `p.v2-class---paragraph` without the site's `role="alert"` (static text is not a
  live region). After a reset the page shows "The table layout is reset." or "The summary layout is
  reset." (or "The layout was not reset. Please try again.") instead of reloading.
- The page heading stays the survey name (the site's "My Surveys. Results" heading and its locale
  picker are not copied), and the site's "only the first 1,000 responses" panel is left out: the page
  shows every response.
- The loading, load-failure, save-failure and export-failure texts are the app's own; the texts inside
  the charts and the table come from survey-analytics.

Step 10 (the Details tab, `src/results/DetailsTab.tsx`) copies markup and texts from the same two files
(`the site's page markup` and `the site's source`, last changed by
commit `(a site commit)`). No style file is copied.

| Copy                                                                                                                                                                                                                                                                                                                                                                      | Original                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| The two columns: `div.column-layout` with `div.column-layout__column.survey-results-header-left` and `div.column-layout__column.column-layout__column--float-right.survey-results-header-right`                                                                                                                                                                           | `the site's page markup`, `:120` |
| The stat lines `div.survey-results-header-line`: "Total responses:", "First response at:", "Last response at:"                                                                                                                                                                                                                                                            | `the site's page markup`     |
| "Download all results as:" (`div.survey-results-header-line.mod-mt-30`) and the links "JSON" and "CSV" (`div.mod-mt-20 > a.rounded-button`)                                                                                                                                                                                                                               | `the site's page markup`    |
| Grant Access: `div#resultaccess.survey-results-header-line`, "Toggle if you want to enable access to the survey results with a direct link." and "Grant Access"; on: "Your Survey results can be accessible via direct Url.", `a.action-link` "Go to the results page" and "Disable Access" (`button.rounded-button > span`)                                              | `the site's page markup`    |
| Save Respondent IP: `div#resultstoreIP.survey-results-header-line`, "Toggle to store the IP addresses of your respondents along with other answers" and "Save Respondent IP in Results"; on: "The IP addresses of your respondents are stored along with other answers. Toggle not to store." and "Do not save Respondent IP in Results" (`button.rounded-button.btn-sm`) | `the site's page markup`    |
| Delete Results: `div.mod-mt-30`, `button.rounded-button.rounded-button--danger` "Delete Results", "Deletes all survey results without the possibility to restore.", the placeholder "Type the survey name" and "Clear All Data"                                                                                                                                           | `the site's page markup`    |
| The confirm question before the deletion: "Are you absolutely sure that you want to delete all results ?" (`window.confirm`)                                                                                                                                                                                                                                              | `survey-results.ts:169-171`        |

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
