# 23. The JSON of a history entry

Date: 2026-10-30

## Status

Accepted. Supersedes the "No JSON view" part of [ADR 0012](0012-editor-content-and-history.md) R23 and its
"One history snapshot over HTTP" item (left for P1). Diff and restore stay in P1.

## Context

ADR 0012 R23 built the History page without a JSON view: the contract had no operation to read one entry. The store
kept a full snapshot with every entry from the start (R7, US 58), and `SurveyStore.getHistorySnapshot` reads it on both
providers, so only the HTTP operation and the page were missing.

The surveyjs.io History page (`the site's page markup`) has this view. Each entry's time is a `span.action-link`;
a click reads the point from `api.surveyjs.io` (`getHistoryPoint`) and opens a block under it with a **Copy JSON**
button (the site's `Footer-Toolbar-Item`, icon `24x24/Copy-Code`) and the JSON in `pre.source-code` (coloured by
Prism). A second click hides it. The site writes the JSON into the page with `innerHTML`.

## Decision

| #   | Topic          | Decision                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| J1  | Entry id       | `HistoryEntry` gains a required `id` (the store's entry id: the legacy point id on `azure-legacy`)                                                                                                                                                                                                                                                                                                 |
| J2  | Operation      | `getSurveyHistoryEntry`: `GET /surveys/{surveyId}/history/{entryId}`, `200` with the definition saved in the entry. Who: anyone who can see the survey (as `listSurveyHistory`). `404` for an invisible or unknown survey, an unknown entry and an entry of another survey. No `ETag`: an entry never changes. A legacy entry whose text cannot be mapped gives `{}` (the provider logs a warning) |
| J3  | Page           | The entry's clock, time and "by {name}" are one `button.action-link` (the site's link, as a button for the keyboard) with `aria-expanded`. The first open reads the entry (the web app keeps it, `staleTime: Infinity`); later opens show it at once. While it loads, "Loading…"; on failure, "Could not load this version. Please try again.", and the next open tries again                      |
| J4  | The JSON block | The site's markup: the Copy JSON button (`v2-class---footer-toolbar-item--button` with both `Copy-Code` icons), then `div.svc-custom-embedded-tab__code-container > pre.source-code.source-code-embed > code`. The JSON is the definition with a two-space indent, set as text (never as HTML). No Prism: `.source-code[class*="language-"]` gives the frame, so the `pre` has `language-json`     |
| J5  | Copy JSON      | Copies the text shown. The label reads "Copied" for two seconds after a copy. Without a clipboard, or when the browser refuses, "Could not copy to the clipboard." (the survey list's text) shows under the button; the JSON can still be selected                                                                                                                                                 |

## Consequences

- The contract has 41 operations.
- The History page's times are underlined again, as on surveyjs.io: the visual manifest no longer lists that difference
  as a residual (ADR 0020 records the earlier state).
- The shell copies `components/footer-toolbar-item.scss` and the `24x24` and `20x20` `Copy-Code` icons from the site
  (`web/src/shell/surveyjs-site/assets/README.md`).
- Diff and restore can build on `getSurveyHistoryEntry`.
