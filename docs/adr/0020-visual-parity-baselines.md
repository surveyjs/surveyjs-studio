# 20. Visual parity baselines

Date: 2026-10-20

## Status

Accepted. The product owner decided the dedicated account and the committed screenshots, and the public results page
without the site shell (see "Decided by the product owner"). Still open for the owner: the header's account text, the
live site's disclaimer and 1,000-responses banner staying out of the app, and the live publish flag; see "To confirm".
Answered there on 2026-10-21: the library versions (3.2.2), the history screen (back in the run; captured 2026-10-22)
and the local-only run (kept local). New on 2026-10-22: the Firefox offset of `projects-expanded`.

## Context

Step 13 makes the app look like surveyjs.io (spec, Seams 2). "Looks like" needs a measure, and the only reference is a
live site behind sign-in. Three things follow.

- **The reference is not in the repository.** The pages are on surveyjs.io, which needs a signed-in account. A test
  cannot sign in on its own, and no test may write to the site.
- **The product owner's data is not the seed's.** A real account has other surveys, dates, names and counts than the
  memory seed. Comparing the two as they are would fail on content, not on look.
- **The live site has parts the app leaves out or changes on purpose** (the licence banners, the run page's
  disclaimer, the 1,000-responses banner), and parts that change every day (dates, the GitHub star count).

A read-only inspection of the live pages, with the product owner signed in, also found that the header's account item
reads literally "Account", not the user's name. Plan Step 3 shows the name. The app's account text is therefore a
parity difference, and it is open for the product owner (see To confirm). The test does not decide it, because both sides
are normalized to "Account" (see below).

## Decision

### The approach

One **visual data set** (`e2e/visual/data-set.ts`) describes the account content of both sides: five surveys, one
project, three responses. A person creates it once by hand in a **dedicated surveyjs.io account**. The visual run
creates the same content through the HTTP API for Erin Erasable in a fresh memory server (ports 3002 and 5175; it never
touches the functional servers on 3000, 3001, 5173 and 5174). One **manifest** (`e2e/visual/manifest.ts`) lists the 18
screens (`history` awaits its first capture, see To confirm) with their live and app paths, the steps to reach the
state, the element to shoot and the adjustments of each side. One **preparation module** (`e2e/visual/support/screen.ts`) opens and prepares a screen the same way on both
sides.

### Normalize, hide, mask, with reasons

Text that cannot match (dates, names, the star count) is **normalized**: both sides get the same fixed text, so the
layout is equal. A part that differs by a recorded decision is **hidden** (`display: none`). A **mask** is the last
resort, because its box changes with the text width. Every adjustment has a `reason` and a `category`. The header's
account item and the star count are normalized on every screen that shows the header. A selector that matches nothing
fails the screen, unless it is marked `optional`.

### Baselines and browsers

The baselines are the live site, captured by a person on a Windows machine in one run, for Chromium, Firefox and
WebKit: `e2e/visual/baselines/{platform}/{browser}/{id}.png`, 18 screens in 3 browsers (54 images), plus
`e2e/visual/baselines/states.json` (the live history length and the library versions the live pages report). One
Chromium baseline for all three engines was rejected: the engines render fonts differently by more than any useful
threshold.

### Local on Windows only, not in CI

Linux CI renders text differently and cannot sign in to surveyjs.io. CI typechecks, lints and unit-tests the harness
and does not run `pnpm e2e:visual`. The tests are valid on the machine (or an identical setup: system, fonts, display
settings) where the baselines were captured. A missing baseline fails the test; it never skips. (Until the capture of
2026-10-22 the manifest could mark a screen `awaitingBaseline`, skipped until its first image; `history` was the only
one, and the field is gone.)

### Thresholds

Playwright compares with a per-pixel `threshold` of 0.2 everywhere, and a `maxDiffPixelRatio` by kind. These are
starting values chosen from the image sizes; nothing measured them. If the first comparison shows only noise above
them on identical markup, the controller may raise a default once, and this ADR records why.

| Kind      | Default | Cap  | Why                                                                       |
| --------- | ------- | ---- | ------------------------------------------------------------------------- |
| `page`    | 0.005   | 0.01 | About 6,500 px of a 1440×900 page: a short word. A missing button fails.  |
| `element` | 0.01    | 0.02 | Smaller images, so the same ratio is fewer pixels.                        |
| `library` | 0.02    | 0.05 | Drawn by Creator, Dashboard or Form Library, which may run another build. |

### The acceptance rule

A difference is **fixed** in markup or CSS by default. It may be **accepted** (a hide, a mask, a normalization or a
raised ratio, never above the cap) only as one of four categories, and every acceptance is a manifest entry and a row in
[Testing › Accepted differences](../testing.md#accepted-differences).

| Category    | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `departure` | The app differs by a decision recorded in the idea, the spec or an ADR (named in the reason). |
| `library`   | The difference is inside library markup, and the live page runs another version (both named). |
| `live-data` | Content that cannot be reproduced: counts, dates, ids, names.                                 |
| `rendering` | Sub-pixel antialiasing left after markup, classes and computed styles match the legacy.       |

A hide or mask never covers a whole screen, the whole Creator or a whole Dashboard.

### The capture is read only

The capture runs against the live site with a real account, so it is read only in three ways. The `Step` type allows
only `click` and `hover`. An ESLint rule on the capture and support folders forbids typing, form input, uploads and
direct requests. A network guard aborts every request with a method other than GET, HEAD and OPTIONS, to surveyjs.io
or to any other host, and fails that screen; it deletes that screen's image so no baseline shows a failed save.

Two POSTs are let through, because each reads only. Both are proven in the legacy source.

| Request                         | Where the page sends it            | Why it is read only                                        |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `POST /api/CodeViewer/getfiles` | The editor, for the Embed tab code | It builds example code and returns JSON; no store write.   |
| `POST /api/cart/calcprepare`    | The renewals calculator on /manage | It computes dates on an in-memory order; nothing is saved. |

An allow-list entry needs a comment that names the legacy line which proves the request reads only. The guard also
aborts the analytics and advertising hosts the live pages load. Service workers are blocked in the capture, so the
guard sees every request.

The capture suppresses the live site's pop-ups with the site's own `localStorage` keys, so no click is needed:
`expiredNotificationDateTime` and `expiresSoonNotificationDateTime` (licence notices), `isTourRejected` (the editor
tour) and `isInformedAboutCookieAndPolicies` (the cookie banner, except on the cookie-banner screen).

The person signs in; the code never types into a field. The sign-in state goes to the git-ignored `e2e/visual/.auth/`,
and the runner deletes it at the end (`--keep-sign-in` keeps it). Playwright's traces and failure screenshots of the
capture go to `e2e/visual/.auth/test-results/`, so they are deleted with it. The repository never holds credentials,
cookies or a storage state.

### Baselines never come from the app

No script, task or flag writes a baseline from the app. `pnpm e2e:visual` refuses `-u` and `--update-snapshots`, and so
does the visual config when Playwright is run directly. The one exception is `pnpm e2e:visual --self`, the harness
check: it writes throwaway app screenshots to the git-ignored `e2e/visual/.self-baselines/` and compares a second,
fresh server with them. It proves the app side is deterministic. It says nothing about parity. Only `--self` selects
the throwaway baselines: in normal mode the runner removes a `VISUAL_BASELINES` variable left in the caller's
environment.

### Decided by the product owner (2026-10-20)

- **A dedicated surveyjs.io account was used, and its screenshots are committed.** The product owner captured the
  baselines and reviewed every image. Names and emails are normalized, and no image shows personal data.
- **The public results page stays without the site header and footer.** [ADR 0016](0016-results-details-exports-and-public-results.md)
  R19 is confirmed, so the live header and footer are hidden as a `departure`.

### Settled here

The menu under the cookie banner stays as surveyjs.io has it. [ADR 0011](0011-survey-actions.md) left it open: the
survey "…" menu's last items can sit under the fixed cookie banner and the footer on a short viewport. The live site has
the same behaviour, and parity is the goal, so the app does not change it.

## Consequences

- **A recapture is needed** after a Playwright upgrade (the browser builds change) and after a deliberate change of the
  live site. The capture takes about three times as long as one browser.
- **Each recapture adds a few MB** of images to git. Git LFS is not set up and not proposed.
- **CI cannot catch a visual regression.** A reviewer runs `pnpm e2e:visual` locally. Renovate's Playwright pull
  requests need a local run and a recapture before they merge.
- **A format difference is not caught visually**, because dates and names are normalized. The functional specs assert
  the formats.
- **A page that reads with POST fails to capture** until its endpoint is allow-listed with proof from the legacy
  source.
- **A person captures the baselines**, once, in about fifteen minutes of preparation plus the run. A wrong account state
  is caught by the preconditions before any image is written, not by bad baselines.
- **Sign-in may not carry over** to Firefox or WebKit through the stored state. The capture then asks the person to sign
  in in that browser too, up to three times.
- **Live content can change** between the capture and a fix. A screen that fails only for that reason is reported and
  recaptured with `--grep <id>`.
- **Findings from the live site** that become parity work: the account item's text ("Account"), the 1,000-responses
  warning, and the library versions. The public results page keeps no site shell (decided 2026-10-20).

## To confirm

These are decisions of the team, not of the product owner. Until the owner confirms them they stand as written. None
of them blocks Step 13; each one is due before the Step 14 point named in its _Answer by_ (plan.md › Step 14).

- **The header's account item.** Live reads "Account"; the app shows the user's name (plan Step 3). Both sides are
  normalized to "Account", so the test does not decide it. Keep the name, or show "Account"? _Answer by:_ rollout step
  2, the opt-in beta link, when real users first see it.
- **The run page's "Disclaimer of liability"** ([ADR 0014](0014-run-page-and-response-collection.md), S13). It is hidden
  on the live side, because the visual account has no licence, and the app does not build it. Build it, or drop it?
  _Answer by:_ rollout step 3, the redirects, after which respondents no longer see the old run page.
- **No "first 1,000 responses" banner** ([ADR 0015](0015-results-summary-table-and-views.md), R12). It is hidden on the
  live side. Confirm. _Answer by:_ rollout step 2.
- **Library versions.** Live Form Library and Creator run 3.2.2; the app ran 3.1.2. The live Dashboard version is not
  exposed (`states.json`). Differences inside them are accepted as `library`. **Answered (product owner, 2026-10-21):**
  all five `survey-*` packages move to 3.2.2, as live runs (Step 14). If the look changes against the baselines, the
  product owner recaptures (`pnpm visual:capture`).
- **The `history` screen was skipped** (`skip` in the manifest, 2026-10-20). The live history page was empty for the
  dedicated account. **Answered (2026-10-21):** the cause was on surveyjs.io. Its history page did not list the saved
  points. The product owner fixed it in surveyjs.io commit `3389d6cd49` on `master` ("Fix empty survey editing history
  page", 2026-10-20): the site writes `surveyjsonhistory/{surveyId}/{pointId}` append blobs and lists the direct
  children of `{surveyId}/`, newest first. The app already writes that shape, so the app does not change. Points saved
  before the fix are not listed. The screen is no longer skipped; it is marked `awaitingBaseline` until the product
  owner captures it. Before the capture, the product owner makes **two editor saves** of `Customer feedback` on
  surveyjs.io (change its title, then restore it; checklist step 9, `HISTORY_SAVES` in `data-set.ts`). The capture
  refuses fewer than two entries and records the live count in `states.json`; the visual run gives the app's survey the
  same number of entries through the API. Then `pnpm visual:capture --grep history`, and remove `awaitingBaseline` in
  the same commit as the images. **Captured (product owner, 2026-10-22):** two entries; `awaitingBaseline` is removed.
  The app's page now uses the live page's frame (`section.my-surveys-page__results-section`, the `.title` heading, the
  entries in the `.action-link` font). The user after each time ("by {name}", ADR 0012 R23) and "Back to My Surveys"
  are hidden on the app side; the times are not underlined, because the app has no JSON view (R23).
- **The Firefox offset of `projects-expanded`.** Firefox's live capture of 2026-10-22 draws the section below the
  heading 1 px lower than the capture of 2026-10-20 (3,639 px between the two live images, with no change on the site).
  With the Projects heading (ADR 0017 R20, a residual) the app is 0.0134 from it, over the `element` default of 0.01.
  The screen's ratio is 0.015 (cap 0.02) with that reason. _To do:_ the product owner recaptures it
  (`pnpm visual:capture --project=firefox --grep projects-expanded`); if the offset is gone, the ratio goes back to
  0.01.
- **The live publish flag.** On the dedicated account `Customer feedback` may list as unpublished
  (`data-ispublished="false"`) after Publish (the list shows "true" only when `IsPublished == true`; the run page
  refuses only when it is `false`). It listed as published in the end (`states.json` has `feedbackPublished: true`).
  The capture records the flag as `feedbackPublished` in `states.json` and the row-menu screens use `Product poll`,
  so neither depends on it. Why it can lag is open. _Answer by:_ the Step 14 compatibility smoke test, because the app
  writes the flag that the legacy site and `api.surveyjs.io` read in modes 1.1 and 1.2. **Answered (product owner,
  2026-10-21; Step 14):** an empty flag means published in the app, as on the old run page
  ([ADR 0014](0014-run-page-and-response-collection.md), S1); Publish and Unpublish write 1 and 0, and
  `pnpm smoke:legacy` reads both back through `api.surveyjs.io` (`IsPublished` `true` and `false`). The old list still
  shows **Publish** for an empty flag: an accepted difference
  ([Legacy smoke test](../operations/smoke-test.md#manual-checklist-on-surveyjsio)). Why the live list lagged on
  2026-10-20 is not known.
- **Local-only visual tests on Windows**, three engines, recaptured after Playwright upgrades. **Answered (product
  owner, 2026-10-21): kept local for now.** Visual tests in CI would need: a second baseline set for Linux
  (`e2e/visual/baselines/linux/`), captured by a person on the same system image CI runs (the pinned Playwright Docker
  image, for its fonts), because CI cannot sign in to surveyjs.io; a CI job that runs `pnpm e2e:visual` in that image
  and uploads `e2e/visual-report/` on failure; and a Linux recapture with every Windows one (Playwright upgrades, live
  site changes).
