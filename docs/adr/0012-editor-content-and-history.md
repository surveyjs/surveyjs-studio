# 12. The editor, survey content and history

Date: 2026-10-16

## Status

Accepted. The product owner has not confirmed rulings R8, R12, R16 (Clear Survey saves), R20 and R22 yet
(see "For the product owner to confirm").

## Context

Step 6 builds the survey editor (the SurveyJS Survey Creator, as on surveyjs.io), the saving of the
survey definition and theme with conflict detection, and the history page. The contract
(`getSurveyDefinition`, `saveSurveyDefinition`, `getSurveyTheme`, `saveSurveyTheme`,
`listSurveyHistory`), `spec.md` and the plan leave a number of questions open, and the current
surveyjs.io code answers some of them in ways that do not fit the contract or that look like gaps. Each
ruling below says what legacy does, what this application does, and why. The stores are shared with the
legacy site, which keeps running during the transition, so a save must leave data that its code reads
([layout, section 5.3](../architecture/legacy-data-layout.md#53-what-a-writer-must-do-so-legacy-readers-see-a-change)).
The write order and the legacy formats are in [ADR 0010](0010-writing-to-the-legacy-stores.md).

## Decision

The rulings are numbered R1 to R27, in the order of the plan, and grouped here by topic.

### Versions and conflicts (R1 to R5)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Version tokens  | Each document read returns an opaque **version**. The HTTP `ETag` is the **strong** tag `"<version>"`. **Memory:** SHA-256 of the stored text (base64url, no padding, 43 characters), and of the empty text when nothing is stored. **Azure definition:** the `surveyjson/{id}` blob's own ETag, from the same download that returned the text, and `"none"` when the blob does not exist. **Azure theme:** the SHA-256 of the raw column text (`NULL` counts as empty) |
| R2  | Compare-and-set | The store's save takes `ifVersion` and writes only when the current version equals it, otherwise it answers `conflict` and writes **nothing**. The check is inside the store, not before it, so there is no window between check and write. Details below                                                                                                                                                                                                               |
| R3  | `If-Match`      | Required on both `PUT`s: absent or blank is `428 if-match-required`. A comma-separated list of entity tags, or `*`. `*` matches any current version. Weak tags (`W/"..."`) never match (strong comparison, RFC 9110, 13.1.1). A malformed value matches nothing (`412`)                                                                                                                                                                                                 |
| R4  | Order of checks | The framework first (authentication, CSRF, `413`, `415`, `422`), then `404` (unknown or not visible), `403` (cannot modify, [ADR 0009](0009-survey-permissions-follow-legacy.md)), `428`, then the version (`412`), then the save (a `conflict` from the store is `412`, `not-found` is `404`), then `204` with the new `ETag`. Nothing is written before every check passes                                                                                            |
| R5  | `412` and `428` | `412` `edit-conflict`, "The survey was changed by someone else" (the contract's example), `428` `if-match-required`, "If-Match required". Guide: [Concurrent editing with ETags](../api/concurrency.md)                                                                                                                                                                                                                                                                 |

**Why not the legacy behaviour.** Legacy has no conflict detection: the last save wins, and the legacy
editor never knows. The contract requires `If-Match`. A legacy editor that still runs in parallel writes
**without** a token, and any version that changes whenever the stored text changes makes our next save
fail, which is what we want (the editor then shows the conflict notice). The blob ETag and the content hash
both have that property. The theme lives in a SQL column, which has no version of its own, so its
version is a hash of the text.

**The compare-and-set, per provider.**

| Provider                   | How `ifVersion` is checked                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory`                   | In one synchronous step: compare the hash of the stored text, then replace                                                                                                                                                                                                                                     |
| `azure-legacy`, definition | The first write is the `surveyjson` replacement with `ifMatch` set to the blob ETag (`ifNoneMatch: "*"` for `"none"`). A storage `412` or `409` is a conflict and nothing else is written. Each following append is conditioned on the ETag of the write before, so two texts are never mixed in one blob      |
| `azure-legacy`, theme      | One statement: `UPDATE Surveys SET theme = @theme, [timestamp] = @ts OUTPUT inserted.theme WHERE id = @id AND ISNULL(theme, '') COLLATE Latin1_General_BIN2 = @expected AND DATALENGTH(...) = DATALENGTH(@expected)`. No row means re-check: the survey is gone (`not-found`) or the text changed (`conflict`) |

The returned version is worked out from what is **stored**, not from what was sent. For the theme that is
the `OUTPUT` text, because a `varchar` column can change non-ASCII characters; a version taken from the
sent text would make every later save of such a theme fail. The `DATALENGTH` term is there because SQL
Server's `=` ignores trailing spaces even under a binary collation. A trigger on `Surveys` would forbid
the bare `OUTPUT` (then `OUTPUT INTO` a table variable is needed); the replica schema and the legacy SQL
have none.

### What a save writes (R6, R7, R11, R13)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R6  | `updatedAt`     | Both saves set `updatedAt` to the save time (azure: `Surveys.timestamp`). Only the definition save adds a history entry. Legacy rewrites `timestamp` on a theme save too ([layout, 5.3](../architecture/legacy-data-layout.md#53-what-a-writer-must-do-so-legacy-readers-see-a-change))                                                                                                                                                         |
| R7  | History entries | One entry for each definition save, plus one for a create with a definition and one for a clone whose source has a definition (Steps 4 and 5 already write a history blob there). An entry is `{ id, at, userId }` and a **snapshot**: the full definition saved. `userId` is the saving user (for a create or clone: the new survey's creator). Legacy entries have no user. Legacy also writes a point for each save, so the unit is the same |
| R11 | Stored text     | The server stores `JSON.stringify(body)` (compact, as in Step 4), in `surveyjson`, in `surveytext` and in the history point. Legacy readers only parse the text, so one serialisation everywhere is enough                                                                                                                                                                                                                                      |
| R13 | Audit rows      | Azure, best effort as in ADR 0010. A definition save writes `SURVEY_UPDATE` without a payload. A theme save writes `SURVEY_THEME_CHANGE` with `theme`, but **without** it when the text is longer than 32,000 UTF-16 code units, because an Azure Table string is limited to 64 KiB. Legacy fails the whole theme save there; we keep the theme and lose the audit text                                                                         |

### Where the history user is kept (R8, R9, R10)

| #   | Question              | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8  | History user on Azure | The legacy-format point `surveyjsonhistory/{surveyId}/{pointId}` (append blob, the definition text, UTF-8 without a BOM) gets blob **metadata** `userid` (lower-case GUID) and `savedat` (ISO 8601 UTC with milliseconds). No new container. On reading, `at` is `savedat` when it parses, otherwise the blob's `lastModified`, and `userId` is `userid` when it is a GUID, otherwise none. Blobs outside `{surveyId}/` are ignored |
| R9  | Order and paging      | Newest first by `at`, ties by entry id descending. Cursor paging with an opaque cursor over `(at, id)` (a new kind in `server/src/paging/cursor.ts`, same rules as the others). Azure lists every blob under `{surveyId}/` with its metadata, sorts, then cuts the page                                                                                                                                                             |
| R10 | The user's name       | `user` is `{ id, displayName }` from the directory, or `null` when the entry has no user or no user has that id. One lookup for each distinct user on a page                                                                                                                                                                                                                                                                        |

**Why metadata, and what it costs.** Legacy records no user, and its History page shows only the time of
each point. Blob metadata is invisible to legacy readers, keeps one source of truth (the point itself)
and needs no second store to keep in step. The cost: a save by the legacy editor in parallel rewrites one
point (the alphabetically first one of the survey, because of how the current port finds a blob by prefix,
[layout, 3.4](../architecture/legacy-data-layout.md#34-survey-history-blob-container-surveyjsonhistory)),
so that entry loses its user and its time moves. Root-level points written by that port belong to no
survey folder and are ignored.

### The body limit (R12)

| #   | Question   | Ruling                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R12 | Body limit | The two `PUT`s get their own limit, `LIMIT_MAX_DOCUMENT_BYTES`, default **30000000**. Every other route keeps `LIMIT_MAX_RESPONSE_BYTES` ([ADR 0004](0004-body-limit.md)). `GET /config` reports it as `limits.maxDocumentBytes`. A larger body is `413 payload-too-large`. The conformance server runs with `262144`, and the test reads the limit from `/config` |

Legacy accepts about 28.6 MiB for a definition. Surveys with inline images exist, so a 1 MB cap would break
saving of existing surveys. The cost is one more variable and a contract field. ADR 0004 is not changed:
its rule (the global limit applies unless a route says otherwise) holds, and this is the first per-route
override it announced.

### The Creator and its toolbar (R14 to R17)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R14 | Creator version | `survey-creator-core`, `survey-creator-react` and `survey-react-ui` **3.1.2**, with `survey-core` 3.1.2 (SurveyJS moves as one), and `ace-builds` 1.44.0 for the JSON tab (legacy loads Ace too). All of `survey-core/i18n` for the Translation tab; the `survey-core/themes` themes registered for the survey and for the Creator. No translations of the Creator's own UI (legacy shows English). Cost: the weight of Ace and the integration; a plain text box is allowed as a fallback                                                                                                    |
| R15 | Options         | Copied from legacy: translation, logic and theme tabs on, `generateValidJSON`, the sidebar cannot be collapsed, the `file` question's `storeDataAsText` is hidden, autosave on with the default 500 ms delay, the Creator's own colour theme remembered in `localStorage` (key `OnlineEditorSurveyCreatorThemeV3`, every access in `try`/`catch`), the licence key applied (and awaited) before the Creator is built. Legacy's override of the "saved" text to "Saved to surveyjs.io service" is **not** copied, because it names the old service; the default "Saved" stays                  |
| R16 | Toolbar         | **Clear Survey**, **Help** and **Run** and the obfuscated download, with the legacy ids, icons, titles and the legacy confirmation text. **Departure: after Clear Survey the cleared survey is saved.** Legacy saves only with the next edit, so a reload brings the old survey back, a data-loss trap. The order of the toolbar follows the legacy code (Run comes after Help). The "Please fix error(s)" check of the obfuscated download uses the JSON plugin's `allowingDeactivate()`, because in Creator 3.1.2 `hasErrors` also counts linter warnings and would block most real surveys |
| R17 | Obfuscation     | Our own pure implementation of the legacy algorithm (a survey-core model in design mode; the same renaming of panels and questions and scrambling of texts in every language, `{name}` references rewritten), not a copy of the site's script. One fix: old names are **regex-escaped** before the references are replaced, because a name with `.` or `(` broke legacy. A name that equals another old name is not renamed twice                                                                                                                                                             |

### Saving in the browser (R18, R19, R20, R27)

| #   | Question    | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R18 | Save state  | Own savers, one for the definition and one for the theme: **one `PUT` in flight for each document**. A newer request while one is in flight replaces the pending content, and each `PUT` uses the `ETag` of the previous `204`. The Creator's callback is called for every save number a successful save covers, and with `false` when a save fails. A **persistent status** in the bottom bar: "Saving…", "All changes saved", "Changes are not saved", "Read-only". The Creator's own notifications stay. The Creator shares one save number between the survey and the theme, and legacy loses errors silently. The bar is an addition to the legacy UI; during a conflict it reads "Changes are not saved" and the notice carries the explanation |
| R19 | Conflict    | On `412` from either document: both savers stop (pending content is dropped), and a notice shows above the Creator ("The survey was changed by someone else. Your latest changes are not saved.") with **Reload latest**. Reload reads both documents again, loads them into the Creator, resets both savers with the new ETags, and hides the notice. If the reload fails the notice stays. Any other error keeps the Creator editable, and the next change tries again with the same ETag. If a reload happens while a save is still in flight, the state stays "Saving…" until that old save ends, and its late result cannot overwrite the new ETag                                                                                               |
| R20 | Read-only   | Without `permissions.canModify` the Creator is read-only: no save functions, no Clear Survey, the name in the bottom bar cannot be edited, status "Read-only". The server answers `403` anyway. Legacy has no read-only mode: a member who could save there cannot here. This follows user story 36 and [ADR 0009](0009-survey-permissions-follow-legacy.md)                                                                                                                                                                                                                                                                                                                                                                                          |
| R27 | Fresh reads | Each time the editor opens it reads the definition and theme from the server. Nothing refetches them while it is open, except **Reload latest** (no refetch on focus or reconnect, and the cache entry is dropped when the editor closes). After each successful save the survey lists and the history query are marked stale without refetching. A cached old version would conflict at the first save                                                                                                                                                                                                                                                                                                                                               |

### The page (R21 to R26)

| #   | Question        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R21 | Name in the bar | Copied markup and styles. Enter or blur saves; Esc or Cancel restores; a blank or unchanged name sends nothing; saving closes the box at once and sends `PATCH { name }`; on failure the old name returns and the page says "Could not rename the survey. Please try again." (legacy shows `alert(statusText)`). Hidden on a small screen, as in legacy. The state machine is shared with the list row                                                                                                                                                                                                                                                                                                                                            |
| R22 | Embed tabs      | Two custom tabs with the legacy names, titles and icons: "Embed Survey" and "Embed Creator". The settings are in the tab (not in the Creator's sidebar): the platform, and for Embed Survey "Load Survey JSON from service" (off, as legacy). The legacy "Display method: Pop-up" is **not** offered. The platforms are **Angular, React and VanillaJS**; jQuery is dropped because Creator and survey 3.1.2 have no jQuery package. The code comes from our own templates, with the address of this application (`window.location.origin`) and the public run endpoints. The Plunker and CodeSandbox sentence of the legacy intro is left out. Legacy templates are site data we do not have. Cost: a visual and feature gap; revisit in Step 13 |
| R23 | History page    | At `/surveys/$surveyId/history`, in the My Surveys frame. Heading "Survey editing history of the '{name}'" (legacy). One row for each entry, newest first: the clock, the time (browser locale and time zone, zone shown) and "by {name}" when known. **No JSON view** (the contract has no operation to read one entry) and a **Show more** link for paging; legacy's lazy JSON view was broken in the port anyway. The texts "No edits yet.", "Could not load the history. Please try again." (with **Try again**) and "Could not load more entries. Please try again." are ours                                                                                                                                                                |
| R24 | Row click       | In the Active view only, a click on the row (outside the name editor, the pencil and the "…" menu) or on the name opens the editor, as legacy `editSurveyOnItemClick`. The Archived view does not navigate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R25 | Code splitting  | The list route and the editor route's own module import no `survey-creator-*`, `survey-react-ui` or `ace-builds`. The Creator sits behind one dynamic `import()` in the editor page, in a chunk named `survey-creator`, and its CSS is imported only there. (With the default chunk grouping the Creator group pulled in React and `survey-core`, and `index.html` loaded the Creator at once; recursive dependencies are therefore not included.) An end-to-end test checks that the survey list loads none of it                                                                                                                                                                                                                                |
| R26 | Editor layout   | The page renders the shell header and **hides the site footer** (the legacy inline style, limited to the page that has the Creator). The Creator's container and its height rule, and the fixed bottom bar, are copied                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Left out on purpose

| Item                                          | Why                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine translation                           | The Translation tab's auto-translate calls a surveyjs.io site endpoint that is not in the contract. The tab works without it                                                        |
| Deleting the preview image                    | Legacy deletes `my-surveys-survey-preview-image-{id}` from the `surveyfiles` share on each save. There is no file store yet (Step 7). A stale preview image stays in legacy storage |
| One history snapshot over HTTP, diff, restore | P1                                                                                                                                                                                  |
| Image and file upload                         | Step 7                                                                                                                                                                              |
| CORS for embeds on other origins              | Hosted track, Step 3 (API tokens and CORS); not built in Step 12 ([ADR 0019](0019-run-page-isolation-and-security-headers.md))                                                      |

## For the product owner to confirm

| #   | Ruling                        | Question                                                                                                                                           |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| R8  | History user in blob metadata | Is it acceptable that a parallel save by the legacy editor can remove the user from one entry? The alternative is a second store for history users |
| R12 | A 30 MB limit on two routes   | Keep the legacy limit (about 28.6 MiB), or lower it? A lower limit breaks existing large surveys                                                   |
| R16 | Clear Survey saves            | Clear Survey saves the empty survey, where legacy does not until the next edit. The earlier version stays in the history. Keep this departure?     |
| R20 | Read-only editor              | A user who can see but not modify a survey gets a read-only editor (legacy has none and lets such a member edit). Keep this?                       |
| R22 | Embed tabs                    | Our own templates, three platforms and no Pop-up option. Is the gap to the legacy tabs acceptable until Step 13?                                   |

## Consequences

- A save that loses the race is refused with `412`, and the editor says so. The legacy editor, which sends
  no token, is not protected: its save can still overwrite ours. Ours then fails at the next save.
- **An append-blob rewrite is not atomic**, as in legacy (`OpenWrite(true)`). The replacement is a Put
  Blob followed by appends of at most 4 MiB. Two things keep a failed append from losing the survey:
  - Each append that fails for a reason that may pass (no answer, `408`, `429`, `5xx`) is tried again,
    up to 3 tries in total with a short wait (100 ms, then 200 ms), still conditioned on the ETag of the
    write before. A `412` is a conflict and is never tried again.
  - When every try fails right after the Put Blob, `surveyjson` is left empty with a new ETag, and the
    client gets a failed save (`500`). `surveytext` is written after `surveyjson`, so it still holds the
    previous text. A definition read that finds an empty `surveyjson` serves the `surveytext` text with
    `surveyjson`'s ETag as the version. The editor's next save is then refused with `412` (its ETag is
    the old one), "Reload latest" shows the previous text instead of an empty survey, and the save after
    the reload rewrites both blobs.
  - Left open: a definition above 4 MiB needs several appends. If a later one fails on every try,
    `surveyjson` holds part of the text, which does not parse and reads as `{}` (with a warning) until the
    next save. An append whose answer was lost after it was applied is tried again with the old ETag and
    gets `412`, so that save reads as a conflict.

  We accept this to stay compatible with the legacy format; the conditioned appends make sure two writers
  never mix their texts in one blob.

- A history time (`savedat`) keeps its milliseconds, while `Surveys.timestamp` is a SQL `datetime`
  (about 3 ms steps), so an entry's time and the survey's `updatedAt` can differ by a few milliseconds.
- The memory provider and the `azure-legacy` provider give different `ETag` values for the same text. The
  value is opaque, so clients must not depend on it.
- Every history point holds a full definition, as in legacy, and autosave makes many. History storage
  grows with editing; nothing prunes it.
- The theme audit row can miss the `theme` text for very large themes.
- The Creator is about 2.8 MB of script, loaded only on the editor route.
