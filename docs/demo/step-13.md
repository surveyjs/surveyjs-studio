# Demo: Step 13, visual parity with surveyjs.io

This page lets you check Step 13 without reading code. It takes about thirty minutes (the visual run builds the web
app and opens three browsers). Commands are for Git Bash (or any POSIX shell).

What Step 13 delivers: **a way to measure how much the app looks like surveyjs.io, and the fixes it points to.** A
SurveyJS team member captures screenshots of 17 live pages once (an 18th, the history page, is skipped for now) (the _baselines_). A local test opens the same pages in
the app, with the same data, and compares the images. The harness, the capture guide and the reasons are in
[Testing › Visual parity](../testing.md#visual-parity) and [ADR 0020](../adr/0020-visual-parity-baselines.md).

## Before you start

You need what [the Step 1 demo](step-01.md#before-you-start) lists (Node.js 24.21.0, pnpm 12.11.2). Run `pnpm install`
once, and install the browsers once:
`pnpm --filter @my-surveys/e2e exec playwright install chromium firefox webkit`.

If the default `node` of your machine is older than 24 (for example with nvm on Windows), put Node 24 first once in
each Git Bash window, before any `pnpm` command: `export PATH="$APPDATA/nvm/v24.21.0:$PATH"`. Check with
`node --version`; it must print `v24.21.0`.

Ports **3002** and **5175** must be free (the visual run uses them; ports 3000 and 5173 are not needed for parts 1
and 3). For part 2 you also need 3000 and 5173.

The baselines must be committed: `e2e/visual/baselines/` holds `states.json` and a `win32` folder with one folder per
browser (17 PNGs each, captured 2026-10-20 from live Form Library and Creator 3.2.2). If they are missing, `pnpm e2e:visual` stops at once and says so (see Troubleshooting). A person captures them
once, as [Capturing baselines](../testing.md#capturing-baselines) describes. The tests are valid on the machine where
they were captured, not in CI.

## 1. The visual tests pass (checklist 1)

```sh
pnpm e2e:visual
```

It builds the web app, starts its own server and preview on 3002 and 5175, and runs 17 screens (the history screen is
skipped) in Chromium, Firefox and WebKit. The result is `52 passed, 3 skipped`. Then open the report:

```sh
pnpm e2e:visual:report
```

Click a screen. You see two images, `surveyjs.io (baseline)` and `app`. Compare them. A screen that fails also shows
the diff. Every difference the team accepted instead of fixing is listed in
[Accepted differences](../testing.md#accepted-differences) with its reason.

## 2. Side by side (checklist 2)

In one terminal start the demo:

```sh
pnpm demo
```

Open <http://localhost:5173/> and sign in as **Olivia Owner** (`owner`). Open these four pages, and the same pages on
surveyjs.io with any account:

| Page            | In the app                                            | On surveyjs.io            |
| --------------- | ----------------------------------------------------- | ------------------------- |
| The survey list | `/`                                                   | My Surveys                |
| The "…" menu    | Hover a row, click **…**                              | The same row menu         |
| The editor      | **…** then **Edit**                                   | The same survey's editor  |
| The results     | **…** then **View Results** (a survey with responses) | The same survey's results |

The header, the list rows, the menu and the footer should look the same. The list is not identical to the baseline
screenshots, because your data differs from the visual data set.

## 3. Optional: check the harness (checklist 3)

```sh
pnpm e2e:visual --self
```

It needs no baselines. It writes throwaway app screenshots to `e2e/visual/.self-baselines/` (git-ignored), then runs
again against a fresh server. The second run must pass: it proves that the app side gives the same images every time. It
says nothing about parity with surveyjs.io.

## Checklist

| #   | Check                                                                                                                       | Result |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | `pnpm e2e:visual` passes, and `pnpm e2e:visual:report` shows each screen with a `surveyjs.io (baseline)` and an `app` image |        |
| 2   | The app's list, "…" menu, editor and results look like the same pages on surveyjs.io                                        |        |
| 3   | `pnpm e2e:visual --self` passes (optional)                                                                                  |        |
| 4   | `pnpm e2e:visual -u` prints `Baselines come only from surveyjs.io.` and exits non-zero                                      |        |
| 5   | `CI=1 pnpm visual:capture` prints `pnpm visual:capture is run by a person, never in CI.` and exits non-zero                 |        |
| 6   | `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test:unit` and `pnpm test:conformance` are green                  |        |

## Known differences

The accepted differences and their reasons are in [Testing › Accepted differences](../testing.md#accepted-differences).
In short:

- **Left out on purpose** (`departure`): the run page's "Disclaimer of liability", the "first 1,000 responses" banner,
  the app's save status in the editor, and on the public results page the site header, footer and Details tab (ADR 0016
  R19, confirmed by the product owner).
- **Library builds** (`library`): the live Creator and Form Library run 3.2.2, the app 3.1.2. The licence banners of
  Creator and Dashboard show only in the app, and are hidden.
- **Content that cannot match** (`live-data`): dates, the GitHub star count, the member name and the survey ids in the
  embed code.
- **The header's account item** reads "Account" on live and the user's name in the app. Both are normalized, so the
  tests do not catch it (open for the product owner).
- **The history screen is skipped**, because the live history is empty for a fresh account.

- **The visual tests run locally only.** The baselines are Windows renders; CI cannot see a visual regression.
- **The baselines are Windows renders.** The tests are valid on the machine (or an identical setup: system, fonts,
  display scaling) that captured them, and after a Playwright upgrade they need a recapture.
- **Text that cannot match is normalized**, so a format difference in a date or a name is not caught by the images.
  The functional specs assert the formats.

## Troubleshooting

- **`No surveyjs.io baselines for win32.`** The baselines are not committed on this machine. A SurveyJS team member
  captures them ([how](../testing.md#capturing-baselines)).
- **`Missing surveyjs.io baseline <path>`.** One screen has no image for this browser. Recapture it with
  `pnpm visual:capture --grep <id>`.
- **Many small diffs on every screen.** The machine renders text differently from the one that captured the baselines
  (system, fonts, display scaling), or Playwright was upgraded. Recapture on this machine.
- **"port already in use".** Something runs on 3002 or 5175 (or, for part 2, on 3000 or 5173).

## What is not in Step 13

- Running the visual tests in CI, or Linux baselines.
- Upgrading `survey-*` to the versions the live site runs. The differences inside Creator, Dashboard and Form Library
  are accepted as `library` ([ADR 0020](../adr/0020-visual-parity-baselines.md)).
- The screens outside Phase 1: the License Manager, Billing and the rest of the account page.
