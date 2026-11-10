# ADR 0030: The sandbox mock in the browser

Status: Accepted (self-hosted Step 9). The product owner asked to execute the step, and these decisions were made in
the plan for it.

## Context

Mode 2a is a static site where anyone tries every feature on demo data kept in their own browser
([idea.md §3.0](../../idea.md#30-deployment-modes-2026-10-19)). It has no server. The web app talks to `/api/v1`, so
the sandbox needs something in the browser that answers the same contract. Step 9 builds it with Mock Service Worker
(MSW), which answers requests from a service worker (and, in tests, from Node). Step 10 publishes the result.

The questions: how is the sandbox built, where does its data live, how does a visitor "sign in", and how is the mock
kept in step with the real server?

## Decision

| #   | Topic                      | Decision                                                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | A build mode               | `import.meta.env.MODE === "sandbox"` (`web/src/sandbox/mode.ts`, `IS_SANDBOX`). Vite drops the dead branch, so the normal build has no sandbox code. The sandbox build goes to `web/dist-sandbox/`, with `web/sandbox-public/` as its public directory and no `/api` proxy. `e2e/scripts/run.mjs` strips `VITE_*`, so no env switch is used |
| D2  | One localStorage document  | All data is one JSON value under `studio-sandbox:v1`. Each handler reads it at the start of a request and writes it back in one `setItem`. There is no in-memory cache, so another tab's change is visible on the next request, and a failed write leaves the previous data intact. The app's own keys are never touched, not even by Reset |
| D3  | The session is a cookie    | Picking an account sets `msid=<userId>` (path `/`, `SameSite=Lax`) with `document.cookie`. Handlers read it through MSW's `cookies` argument. There is no CSRF token: the web app's `csrfMiddleware` sends nothing when `msid_csrf` is absent. The conformance driver sets the same cookie                                                  |
| D4  | Navigations are the app's  | The service worker never sees a page navigation. So in the sandbox build the private guard sends a 401 to `/sign-in`, `/sign-in` shows **Pick an account**, `logout` answers `redirectUrl: "/sign-in"`, and the export links are hidden                                                                                                     |
| D5  | Files are same-origin URLs | Uploaded bytes are base64 in the document. `StoredFile.url` is `<origin>/api/v1/public/files/<fileId>`, answered by the mock with the server's headers, so `<img>`, `<video>` and the Dashboard load them through the worker                                                                                                                |
| D6  | A local directory          | `/config` answers `shell: "self-hosted"`, `features: {embed: false, apiDocs: false, apiTokens: false}` and `authMethods: ["password"]`, so no code path offers a surveyjs.io redirect. `/me` has `hasPassword: false` and no `instanceRole`. `addMember` with an unknown email makes a pending member                                       |
| D7  | What answers 501           | `login`, `loginCallback`, `passwordLogin`, `setPasswordWithLink`, `changeOwnPassword`, the seven `/admin/users` operations, `exportResults`, `receiveAccountDeleted`, and a catch-all for any other `/api/v1/*` request. A unit test fails when the contract gains an operation that is neither handled nor listed                          |
| D8  | A generated seed           | `pnpm sandbox:seed` writes `web/src/sandbox/seed.json` from `legacyFixtureSeed()` and `withSeedInvitation`, restricted by the tag file `server/fixtures/sandbox.json`. A unit test regenerates it in memory and fails when the file is stale or larger than `seedBudgetKb`                                                                  |
| D9  | `@sandbox` and the stories | `e2e/tests/sandbox.spec.ts` covers the plan's sandbox stories through the UI. Since 2026-11-10 the user-story specs run on the sandbox build too (`pnpm e2e:sandbox:stories`): `page.request` bypasses the page's service worker, so their set-up runs `fetch` in the page. What cannot apply skips itself with its reason                  |
| D10 | Pages closing mid-request  | MSW answers from the page, so a `keepalive` request sent while a page closes (saving a results view on `pagehide`) may be lost. Documented, not fixed                                                                                                                                                                                       |

Settings live in `web/sandbox-public/sandbox.config.json`, served next to `index.html` and read at start-up. A missing
or invalid file falls back to the defaults, with a console warning.

| Setting          | Default | Meaning                                                                                                    |
| ---------------- | ------- | ---------------------------------------------------------------------------------------------------------- |
| `maxUploadKb`    | 200     | The largest file, and the files a survey may hold in total. A larger file gets `413 quota-exceeded`        |
| `storageLimitKb` | 4096    | At or above it, or when the browser refuses a write: `413` "Browser storage is full" and an offer to reset |
| `seedBudgetKb`   | 1024    | The largest allowed seed, checked in CI                                                                    |

Details that follow:

- **The sandbox does not import `server/src`.** It mirrors the server's rules in its own small modules, each citing
  the server file it mirrors. The conformance suite, run against the handlers under `msw/node`
  (`pnpm test:conformance:sandbox`), is what checks that the two agree.
- **The normal build stays clean.** `web/scripts/check-run-chunks.mjs` fails the build when its output holds
  `mockServiceWorker`, `studio-sandbox:v1` or the seed owner's id. Shared files reach sandbox UI only through
  `web/src/sandboxLazy.tsx`, behind an inline `import.meta.env.MODE === "sandbox"` test: the imported `IS_SANDBOX`
  constant alone is not removed by the bundler.
- **A 401 sends the tab to the picker.** In the sandbox build a 401 from any query or mutation goes to `/sign-in`
  with the current path as `returnTo`, except the `/me` query on pages that are not private. This answers a Reset in
  another tab, which removes the session. Other builds keep the open global-401 item. (Later, the users' linked
  sign-ins work made this the rule of every build, for private pages only: a 401 there makes the private guard ask
  for the current user again, which sends the tab to sign-in.)
- **A worker that cannot start** shows "This demo needs a browser with service workers and site storage…" instead of an empty app.
- **A stale or damaged document** (missing, an old `version`, unparsable) is replaced by the seed.
- **`mockServiceWorker.js` is MSW's own file**, copied into `web/sandbox-public/`. `web/src/sandbox/worker-file.test.ts`
  checks that it is byte-equal to the installed `msw`'s, so an upgrade that forgets the copy fails.
- **`msw` and `openapi-msw` are runtime dependencies of `web`** (same exact versions as before), because the sandbox
  build ships them.

## Alternatives set aside

- **IndexedDB.** It holds more, but it is asynchronous and has no single atomic write across collections. One
  localStorage document, read per request, makes two tabs and a refused write easy to reason about. The seed fits in
  the 1 MB budget and the 4 MB limit is a demo's, not a product's.
- **A separate sandbox app.** A copy of the web app would drift from it. A build mode keeps one app, and the dead
  branch is removed from the normal build (D1).
- **Serving the sandbox from the server** (an in-memory server for visitors). It needs hosting, a per-visitor store
  and a way to keep visitors apart, and the data would not stay in the visitor's browser. The sandbox is a static
  site.
- **Tagging the existing e2e specs `@sandbox` now.** They build their data through `page.request`, which skips the
  worker (D9). Doing it needed another way to create that data. Done on 2026-11-10 with a `fetch` in the page
  rather than through the UI ([Testing](../testing.md#the-user-stories-on-the-sandbox-build)).

## Consequences

- **Links work only in the same browser.** Data and the mock live in one browser's localStorage. A run link (`/s/<id>`)
  works in another tab of that browser, not on another machine. Opening a file URL as a page does not work either: the
  worker answers subresource requests, not navigations (D4, D5).
- **A closing page may lose a `keepalive` request** (D10).
- **No CSRF, rate limits, IP capture or byte-sniffed file types.** There is no network between the page and the mock,
  and the demo has one visitor. The mock types a file by its extension.
- **Answers 501:** sign-in by password or provider, changing a password, the instance admin's users, and results
  exports (D7). The pages for them are hidden or absent (D4, D6).
- **The storage can fill up.** The visitor sees the banner's message and **Reset demo data**. The banner clears its
  message once a later write is stored (say, after deleting surveys).
- **An upload refused because the browser storage is full shows the per-survey file quota message** (the answer is
  `413 quota-exceeded`), while the banner shows the full-storage text.
- **There is no cross-tab lock.** Two tabs writing at nearly the same moment both start from the same document, and
  only the last write is kept.
- **History keeps the JSON of a survey's 20 newest saves only** (2026-11-08, for [ADR 0032](0032-history-json-view.md)).
  The editor saves after nearly every change, so a copy per save would fill the 4 MB of browser storage in one editing
  session. Each entry is `{ id, at, userId, snapshot }`; a save drops `snapshot` from the survey's entries past the
  newest 20 (`handlers/history.ts`). `getSurveyHistoryEntry` answers `200` with the JSON, `404` as on the server, and
  `501` with the reason for an older entry, which the History page shows in place of "Please try again". The seed
  keeps its legacy entries' JSON.
- **A new contract operation needs a handler or an entry in the unsupported list.** The coverage test fails
  until it has one ([Development](../development.md#the-sandbox-step-9)).
- **The seed is a snapshot.** A change to the shared fixtures or the tag file needs `pnpm sandbox:seed` and a commit.
- **Conformance in the sandbox skips what cannot apply:** fixtures the seed leaves out, server-only behaviour and
  tests whose only assertion is the CSRF 403.
