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
