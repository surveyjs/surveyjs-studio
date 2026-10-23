# 19. Run page isolation and security headers

Date: 2026-10-19

## Status

Accepted. The product owner has not confirmed that `/s/*` may be framed by any site (`frame-ancestors *`), that a
content-security policy alone protects the run page (no separate origin), that `id` is no longer a reserved search
member of the run page, and that the server's trace log now redacts the upload request headers; see "To confirm".

## Context

The Step 8 notes left one question open. A survey's author HTML (HTML questions, the completed page, titles) and
URL-prefilled `{placeholders}` are rendered by survey-core on the run page, at `/s/{id}`, which is on **the same
origin as the signed-in app**. Script that runs there can read the CSRF cookie (it is not `HttpOnly`) and call the
state-changing API as an author who opens a hostile survey. The run page needs no sign-in, so anyone can be sent
such a link, and an author who is signed in is the target.

The research of Step 12 found:

- the app sent no security header at all except on the dev sign-in page and on file downloads;
- survey-core renders titles and HTML as markup, and Creator and the Dashboard render question names and titles
  too, so the libraries cannot be relied on to escape;
- the built bundle needs no `unsafe-eval` and no inline script: one module script and same-origin chunks;
- the Embed tab generates package-based code for the author's own site, not an iframe and not a script tag that
  points here, so it needs CORS on the public API (not `frame-ancestors`), and the legacy run page could be framed.

The rulings are numbered R16 to R21 and grouped by topic. (R19, that CORS is not built, belongs to the hosted track.)

## Decision

### CSP alone, not an isolated run-page origin (R16)

Two ways to protect the run page were weighed:

| Option                        | What it gives                                                                                                              | What it costs                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CSP alone** (chosen)        | `script-src 'self'`, no inline script and no `unsafe-eval`: inline handlers, `<script>` and `javascript:` links stay inert | Same-origin requests that need no script (an `img` GET) and phishing markup are still possible; the policy must stay strict                                                                                        |
| A cookie-less run-page origin | Script on the run page cannot reach the app's cookies at all, even if the CSP failed                                       | **CORS** on `/api/v1/public/*` (the hosted track's Step 3), a run-page base URL in the configuration, new links everywhere the app builds a run address (Run, copy ID, Embed), and the redirect map pointing at it |

**CSP alone is chosen for Phase 1.** The end-to-end spec for the "XSS in question name" survey shows the policy is
load-bearing and not decoration: with CSP violations **not** allowed, the spec fails on CSP-blocked inline event
handlers (1 in the editor and 4 on the run page). survey-core and Creator render the author's HTML as given; **the
CSP is what stops the script**. Creator does not save the survey on open, so the editor test writes nothing. The
isolated origin stays the stronger option for later. It needs CORS first, and CORS is not built here.

If this is wrong: a later step adds the isolated origin; nothing built now prevents it.

### The header policy (R17, R18)

One module in the web package, `web/security-headers.ts` (pure data and `securityHeaders(pathname, { https })`),
holds the policy for the app's pages. `vite preview` applies it through a small plugin in `web/vite.config.ts` and
skips the proxied prefixes (`/api`, `/__dev`, `/healthz`, `/readyz`), which keep the server's own headers. **The Vite
dev server sends none**, because it injects inline scripts: `pnpm demo` has no CSP and `pnpm demo:preview` has it.
A production static host uses the same module (Step 14) or copies the values from
[Operations](../operations.md#the-header-policy).

| Header                      | Value                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`   | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data:; connect-src 'self' https:; worker-src 'self' blob:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors <per route>` |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                                                                                                                                                             |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                                                                                                                                                                     |
| `Strict-Transport-Security` | `max-age=31536000`, only when the site is served over https                                                                                                                                                                                                                                                                   |

`https:` appears in `img-src`, `media-src`, `connect-src` and `frame-src` because surveys load images, videos,
`choicesByUrl` data and embedded frames from anywhere; **scripts never**. `style-src` keeps `'unsafe-inline'`
because the libraries set style attributes. `worker-src` allows `blob:` for the Ace editor's worker. The policy was
tightened only where the full Chromium end-to-end run showed no violation.

**The `frame-ancestors` split.** `frame-ancestors *` applies to `/s/*` only: the legacy run page could be framed, and
a hosted survey embeds only as an iframe of its run URL. Every other page, including `/results/*`, is `'none'`.

The **server** adds, in an `onSend` hook and without overwriting a header a route set (the dev sign-in page and file
downloads keep theirs): `X-Content-Type-Options`, `Referrer-Policy`, HSTS when `PUBLIC_BASE_URL` is https, and
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. `/api/docs` gets `frame-ancestors 'none'`
only, because Redoc needs its inline script. Conformance asserts these on an API answer, a problem answer and an
unknown path.

### The run page's Idempotency-Key (R20)

`crypto.randomUUID` does not exist on plain HTTP outside localhost, so the run page's `Idempotency-Key` threw in
`onComplete` there. `submit.ts` now uses `randomId()` of `run/clientId.ts`, which falls back to `getRandomValues`; a
unit test removes `randomUUID` and checks that a version 4 UUID is sent.

### No respondent data in logs (R21)

A unit test captures the server's log at `LOG_LEVEL=trace` through `BuildOptions.logStream` during a submission with
marker answers and a client id (success, an idempotent replay, `422`, `413`, IP capture on, a store failure) and a
respondent file upload, and fails if a line holds a marker. It is a unit test and not a conformance test, because a
port's logs are not observable over HTTP. **It found a leak**: at trace level `@fastify/multipart` logs its
`busboyOptions`, which hold the upload's request headers (the session cookie and the full `X-Forwarded-For` address).
The logger now redacts `busboyOptions.headers` (`REDACTED_LOG_PATHS` in `server/src/logging.ts`).

### The rate-limiting review (US 45)

Step 12 reviewed which operations are rate limited, against `server/src/app.ts` (`PUBLIC_OPERATIONS`,
`SIGN_IN_OPERATIONS` and the `rateLimits` map). Nothing changed: every public operation that does work per request
is limited, and the rest are cheap or reached only by a signed-in user or a signed sender.

| Operations                                                                       | Limit                                           | Why                                                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `getPublishedSurvey`, `submitResponse`, `uploadResponseFile`, `getPublicResults` | `PUBLIC_RATE_LIMIT` per minute and address      | Public: respondents and anyone with a link (Step 8, Step 10)                |
| `downloadFile`                                                                   | `PUBLIC_FILE_RATE_LIMIT` per minute and address | Public: a run page loads many images (Step 8)                               |
| `login`, `loginCallback`, `passwordLogin`                                        | `SIGN_IN_RATE_LIMIT` per minute and address     | Public sign-in (Step 3)                                                     |
| `receiveAccountDeleted`                                                          | None                                            | R10: the signature check is cheap and a bulk deletion must not be throttled |
| `getConfig`, `logout`                                                            | None                                            | Public but cheap: no store is read                                          |
| Every other operation                                                            | None                                            | Needs a session (and CSRF for writes) or a bearer token                     |

`/healthz` and `/readyz` sit outside `/api` and are not limited. `/readyz` touches the stores, so the reverse proxy
forwards it only for the monitor (it forwards every other path, since the Step 14 image serves the web app too), and
concurrent calls share one check whose answer is reused for 5 s ([operations](../operations.md#health-and-readiness)).
The counters live in each process: one instance is enough for mode 1.1, and a second one needs shared counters first
(later; [architecture](../architecture.md), "Open for later steps").

### `/published` removed, `id` no longer reserved (R22)

The `/published` alias of Step 8 (S21 of [ADR 0014](0014-run-page-and-response-collection.md)) is removed: the
surveyjs.io site redirects old links ([ADR 0018](0018-accounts-by-deployment-mode.md),
[the redirect map](../operations/surveyjs-redirects.md)), and the app handles no legacy URL. The run page's `id`
exclusion goes too: only `locale` is reserved, because the site's redirect moves `id` into the path and a stray
`id` member must not collide. The root route has a not-found page ("Page not found", with a link to My Surveys) for
every unknown address.

## Consequences

- The run page and the app share an origin, and the CSP is the only barrier against a script in a survey. A change
  that loosens `script-src` (an `unsafe-inline`, a host) removes the protection, and the XSS spec exists to catch it.
- Markup that does not need a script still renders: a survey can show an image from any https host, which tells that
  host who opened it, and can show a deceptive page. The isolated origin would not remove those either.
- Any site can frame a run page, so a respondent can be clickjacked on a survey. A survey is public by design.
- CORS for embeds is not built here; the Embed tab's code works on the app's own origin only until the hosted
  track's Step 3 (API tokens and CORS) ([ADR 0012](0012-editor-content-and-history.md)).
- A different static host must send the same headers, or the run page loses its protection. `pnpm demo` shows the
  unprotected case on purpose.
- The browser console shows CSP refusals for a survey with inline handlers. That is the policy working.

## Open

- **The enforced policy on Firefox and WebKit** was checked on Chromium only (full memory run); the other browsers
  run in CI.
- **`style-src 'unsafe-inline'`** stays until the libraries stop needing it.
- **A cookie-less run-page origin** (and the CORS and base URL it needs), after the hosted track's Step 3.
- **The SPA policy in the production image.** Done in Step 14: the module moved to
  `server/src/web/security-headers.ts`, and the server applies it to the web app's answers when `WEB_ROOT` is set
  ([ADR 0021](0021-production-image-and-web-serving.md)).

## To confirm

These are decisions of the team, not of the product owner. Until the owner confirms them they stand as written.

- **`frame-ancestors *` on `/s/*`.** Any site may embed a run page in an iframe. The owner may prefer an allow-list
  of origins, which a self-hosted instance would have to configure.
- **CSP alone.** The owner may want the isolated origin before the app is opened to more users.
- **`id` is no longer reserved on `/s/{id}`.** A question named `id` is now prefilled from `?id=`, and an old link
  that kept `id` in the query would prefill it too (the site's redirect moves it into the path).
- **The multipart header redaction.** A trace-level log of an upload no longer carries the request headers; a
  debugging session loses that detail.
