# 21. The production image and web serving

Date: 2026-10-21

## Status

Accepted.

## Context

Until Step 14 the server answered only its own paths (`/api/v1/*`, `/api/docs`, `/__dev/*`, `/healthz`, `/readyz`).
The built web app (`web/dist`) needed a second host, and only `vite preview` sent the web app's security headers
([ADR 0019](0019-run-page-isolation-and-security-headers.md), "Open"). Step 14 builds one production image, so one
process must serve both, with the right headers on each answer.

Two more facts shape the choice:

- The app handles no legacy URL (D19, [ADR 0018](0018-accounts-by-deployment-mode.md)): surveyjs.io redirects old
  links. A legacy address such as `/published?id=…` must stay a real `404`, not a page that looks found.
- The sources import `./x.js` meaning `.ts`, and `@surveyjs-studio/contract` exports `src/index.ts`. Node's own type
  stripping resolves neither.

## Decision

### One origin for the app and the API

A new setting, `WEB_ROOT`, is the absolute path of a built `web/dist`. Unset, the server behaves exactly as before:
every development mode and the conformance suites run that way. Set, the server also serves the web app. A relative
path stops start-up (`WEB_ROOT: must be an absolute path`), and so does a root without `index.html`.

### The path split

| Path                                                 | Answer                                                        | Headers                             |
| ---------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `/api`, `/api/*`, `/__dev/*`, `/healthz`, `/readyz`  | The server's routes; an unknown path is a `404` Problem       | The server's (`default-src 'none'`) |
| Any other `GET` or `HEAD`, naming a file of the root | The file                                                      | The web app's (ADR 0019)            |
| Any other `GET` or `HEAD`                            | `index.html`: `200` on a client route, `404` on anything else | The web app's                       |
| Any other method                                     | A `404` Problem                                               | The web app's                       |

A file is served only if it is a regular file inside the root, after symbolic links are followed. A path with a
segment that starts with `.` (so `..` and `.vite/`) or holds a backslash is never a file. A directory is never
listed. `server/src/web/static.ts` holds the split (`isServerPath`, `registerWebApp`).

### The `index.html` fallback: 200 or 404

The client routes are listed once, in `server/src/web/client-routes.ts`: `/`, `/projects`, `/surveys/{id}/edit`, `/surveys/{id}/history`, `/surveys/{id}/results`, `/s/{id}` and `/results/{id}`.
A test reads `web/src/routes` and fails when the list and the files disagree. Any other path gets `index.html` with
`404`: the app renders its own "Page not found" either way, and the status tells crawlers, monitors and tools the
truth. A legacy URL therefore stays a `404` (D19).

### The cache rule

| Answer                           | `Cache-Control`                       |
| -------------------------------- | ------------------------------------- |
| `/assets/*` (hashed names)       | `public, max-age=31536000, immutable` |
| `index.html`, the fallback, rest | `no-cache`                            |

Compression is left to the reverse proxy.

### One source for the web app's headers

The web app's policy moved from `web/security-headers.ts` to `server/src/web/security-headers.ts`, unchanged.
The server's `onSend` hook applies it to every answer outside the server paths when `WEB_ROOT` is set. `vite preview`
imports the same module (`web/vite.config.ts`), so the two cannot drift.

### tsx at runtime

The image runs `node --import tsx src/main.ts`, not compiled JavaScript: Node's type stripping cannot resolve the
`.js` imports of `.ts` files or the contract's `src/index.ts`. A bundle step is a bigger change for no gain now.
`tsx` becomes a production dependency of the server. Revisit if start-up time matters.

## Consequences

- One process and one origin serve the app and the API: no CORS, and the cookies stay first party.
- A new client route needs a pattern in `client-routes.ts`; the drift test fails until it has one.
- An unknown address gets the app's "Page not found" page with a real `404`.
- `/s/*` is the only path a site may frame, on the image as on `vite preview`.
- The image carries the TypeScript sources and `tsx`.
