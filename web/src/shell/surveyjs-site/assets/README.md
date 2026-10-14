# surveyjs.io shell assets

The `surveyjs-site` shell looks like surveyjs.io on purpose (decision D14): its markup, class names,
styles, fonts, icons and texts are copied from the site. This file records where each copy comes
from.

**Source:** the surveyjs.io site, repository `the site's repository`, project `the site`, commit
`(a site commit)` (2026-10-14). Everything under `site/` keeps the path it has in that project, so a copy
can be compared with its original (`site/X` is `the site/the site's source` or
`the site/X`). Prettier skips `site/`, so the copies stay comparable line by line (git stores them with LF line endings; the site has CRLF).

## What is copied

| Copy                                         | Original                                          | Change                                                                                                          |
| -------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `site/Content/Styles/**/*.scss` (27)         | `the site's source` (same paths)            | None, except `cookies-popup.scss`: the close icon's `url('/Content/Images/…')` is now relative (`../Images/…`). |
| `site/Content/Fonts/V2/*.woff2` (5)          | `the site's source`                       | None.                                                                                                           |
| `site/Content/Images/V2/Tour/Close16x16.svg` | `the site's source`   | None.                                                                                                           |
| `site/Views/Shared/V2/_icons/**/*.svg` (49)  | `Views/Shared/V2/_icons/**/*the site's page markup` (same names) | Extension `the site's page markup` → `.svg`; the leading byte-order mark removed. Each partial is one plain `<svg>`.           |

The React components in `..` reproduce the markup of these Razor views (structure, class names and
texts): `the site's page markup`, `Views/Shared/V2/top-bar/*the site's page markup`,
`Views/Shared/V2/components/{Button,Logo,Drop-Down-Menu-Item,FAQ-Question,Expand-Collapse-Button,Badge}the site's page markup`,
`Views/Shared/V2/components/circle-icon/{Icon,Circle-Icon}the site's page markup`,
`Views/Shared/V2/components/popups/{Cookies,LicencesExpired,LicencesExpiresSoon}the site's page markup`,
`Views/Shared/V2/footer/*the site's page markup` and `Views/Shared/V2/mobile-menu/*the site's page markup`.

## Which styles, and why not the whole stylesheet

The site builds one stylesheet, `/Content/css.V2`, from `the site's source`
(`compilerconfig.json`, `Code/the site's code`). `app.scss` is not one indivisible file: it
imports about 200 partials, most of them for the site's own pages (pricing, docs, account pages…).
The shell's entry, `surveyjs-site.scss`, imports only the 27 partials that the top bar, the menus,
the footer, the cookie banner and the licence dialogs use, in the order of `app.scss`: the design
tokens (`sizes`, `media-breakpoints`, `text-styles`, `color-styles`, `effect-styles`), the base
(`layout-styles`, `common-styles`, `mobile-menu`, `cookies-popup`), the components and the top-bar
and footer styles. Compiled, they are about 70 KB of CSS (before minification), against about
940 KB for the whole site.

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
