# ADR 0031: Publishing the sandbox

Status: Accepted (self-hosted Step 10). The product owner chose the host, the token and the trigger on 2026-11-06,
and the other decisions were made in the plan for the step. Two of them (D2, D3) were amended by rulings made while
the step was reviewed, and this record states them as amended. D11 was amended on 2026-11-10 (see Notes).

## Context

[ADR 0030](0030-the-sandbox-mock-in-the-browser.md) built the sandbox, a static site. Step 10 puts it on the web at
`https://studio.demos.surveyjs.io`. The repository is private until Step 11, the SurveyJS demos already share one
server, and a release must be tested before visitors get it. The questions: where is it hosted, how does the host read
a private repository, what moves a release there, what headers and cache rules does it send, and what happens to a
visitor whose browser holds data from an older release?

## Decision

| #   | Topic                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The demos server                | The site is `projects/surveyjs-studio-sandbox/` in `demos-infrastructure`, routed by Traefik on `Host(studio.demos.surveyjs.io)`. The wildcard `*.demos.surveyjs.io` DNS record covers it. The plan's `studio.demo.surveyjs.io` became `studio.demos.surveyjs.io`                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | A private repo, read by a token | The demo's Dockerfile fetches the pointer branch with `ADD <repo>.git#${STUDIO_REF}` (`STUDIO_REF=sandbox`), authenticated by the BuildKit secret `GIT_AUTH_TOKEN` taken from `STUDIO_GITHUB_TOKEN` in the server's `env/.env`: a fine-grained, read-only (Contents: read) token for this one repo. A `RUN --mount=type=secret` step then fetches the commit named in `COMMIT`, with the token in `git -c http.extraHeader`, never in a URL, so it is in no layer and no `.git` file. **Ruling:** BuildKit sends an empty `GIT_AUTH_TOKEN` as an empty credential and GitHub answers 401, even for a public repo. So once the repo is public the operator removes the compose file's `secrets` blocks; the token is not left empty |
| D3  | A pointer branch                | The **Publish sandbox** workflow runs on a `v*` tag, or by hand with a `ref`. It tests, then publishes, then smoke-tests. **Ruling:** `GITHUB_TOKEN` cannot get the `workflows` permission, and GitHub refuses a ref move across commits that change `.github/workflows/*`. So `sandbox` is a **pointer branch**: its only file, `COMMIT`, holds the tested 40-character sha. `publish` adds a commit with plumbing commands and pushes it as a plain fast-forward. The branch log is the deploy history; a rollback is a run with an older ref. A push webhook sends the branch to the demos server's whd, which runs `make up-surveyjs-studio-sandbox`                                                                           |
| D4  | The server's headers            | nginx sends the CSP of `server/src/web/security-headers.ts` (`frame-ancestors *` on `/s/*`, `'none'` elsewhere) with the referrer, `nosniff` and HSTS headers. The Traefik router has `compress@file` only, because `security-headers@file` would replace the CSP with `frame-ancestors *`. A unit test fails when the nginx file and the module disagree. `worker-src 'self' blob:` already allows the worker                                                                                                                                                                                                                                                                                                                     |
| D5  | Cache rules                     | `/assets/*`: `public, max-age=31536000, immutable`, and a missing asset is a real 404. `/index.html`, the fallback, `/mockServiceWorker.js` and `/version.json`: `no-cache`. `/sandbox.config.json`: `no-store`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D6  | Settings without a rebuild      | nginx serves `/sandbox.config.json` from `/srv/sandbox-config/` when the file exists there, and from the build otherwise. The compose file mounts the demo's `config/` directory (not the file, so a replaced inode still works) read-only. An edit shows on the next page load                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D7  | The licence key at build time   | `VITE_SANDBOX_LICENSE_KEY` is baked into the bundle and `/config` answers it as `surveyjsLicenseKey`; empty or unset answers `null` and the licence notice shows. The demo image takes it as the build arg `SURVEYJS_LICENSE_KEY`. It is committed nowhere, and CI builds have none                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D8  | `version.json`                  | The build writes `{"commit": "<sha>", "dataVersion": <n>, "base": "<path>"}`. The commit is `SANDBOX_COMMIT`, else `git rev-parse HEAD`, else `unknown`, trimmed. `base` is the base path of the build (D11). The smoke job polls it, and an operator reads it to see what is live                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D9  | The version guard               | The seed's `version` (in `server/fixtures/sandbox.json`) is the data version. A missing or damaged stored document is replaced silently. A valid one with another `version` is **outdated**: the app shows **This demo has been updated** with **Reset to continue** and starts nothing until it is clicked. Mid-session, a request that finds an outdated document (a newer release in another tab) answers `503`, and the store never overwrites a document of another version                                                                                                                                                                                                                                                   |
| D10 | One browser                     | The publish suites run on Chromium, like `e2e-modes` in `ci.yml`. The full browser matrix stays in the user-story suites                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D11 | The base path at build time     | **Amended 2026-11-10** (was "No sub-path"). The demo stays at the root of its subdomain. A build can also live under a sub-path: `SANDBOX_BASE` (default `/`) is Vite's `base`, fixed at build time. The assets, the router's `basepath`, the worker's URL and scope, `sandbox.config.json`, `version.json` and the API the worker answers (`/studio/api/v1`) follow it. `pnpm e2e:sandbox:subpath` runs the sandbox spec on a build for `/studio/`. The repo's nginx file serves the root only                                                                                                                                                                                                                                    |

Details that follow:

- **The smoke check is not a gate.** The jobs run test, publish, smoke in that order, and the smoke runs after the
  pointer moved. It waits (up to 30 minutes) for the live `/version.json` to name the commit, then runs the suites
  against the live URL. A red smoke tells the operator that the site is wrong; the fix is a rollback run.
- **Publishing the live commit again pushes nothing.** When the pointer already names the commit and the live
  `/version.json` shows it, `publish` skips the push. Otherwise the webhook would rebuild the site while `smoke`, whose
  wait passes at once, runs against it (2026-11-10).
- **A rollback needs a ref the workflow can test.** The ref must already contain `build:sandbox`, `sandbox:serve` and
  `e2e:sandbox:url`, which the test job runs.
- **The build is from source on the demos server**, with the same nginx image and configuration as the CI test, so
  what CI tested is what runs.

## Alternatives set aside

- **A separate static host or CDN.** It needs an account, DNS and a deploy credential of its own, and its header
  rules would have to match `security-headers.ts` by hand. The demos server already serves the other demos, with the
  same webhook-and-make routine.
- **GitHub Pages.** It cannot send response headers, so there would be no CSP and no `frame-ancestors` split between
  `/s/*` and the rest, and no cache control for the worker.
- **Tracking `master`.** Every merge would reach visitors untested. The pointer moves only after the suites pass on
  the exact commit, and a rollback is a normal run.
- **Pushing the source to `sandbox`.** GitHub refuses it when the commits change workflow files and the token has no
  `workflows` permission (D3). A pointer commit has no such files.

## Consequences

- **The token goes away at Step 11.** When the repository is public, the operator removes the compose file's
  `secrets` blocks and `STUDIO_GITHUB_TOKEN` from `env/.env` (D2).
- **The webhook is a manual setup.** The product owner adds it once on GitHub, and
  [Operations](../operations.md#the-sandbox-studiodemossurveyjsio) describes it. Without it, the first publish moves
  the pointer but the server does not rebuild until someone runs `make up-surveyjs-studio-sandbox`, and the smoke
  job times out.
- **One browser publishes.** The live suites run on Chromium only (D10).
- **A data change needs a version bump.** Whoever changes the seed's content or the document's format bumps
  `version` in `server/fixtures/sandbox.json` (D9); a forgotten bump leaves old visitors on data the new code may not
  read.
- **A visitor's data is lost on a bump.** The reset is the only way forward; the demo's data is disposable.

## Notes

- **2026-11-06: Step 11.** The token goes away at the visibility switch. Once the repository is public, the operator
  removes the compose file's `secrets` blocks and `STUDIO_GITHUB_TOKEN` from `env/.env`, and revokes the token. The
  docs ([Operations](../operations.md#one-time-setup-product-owner)) now describe the token as needed only while the
  repository is private. The ruling on D2 stands: an empty token is a `401`, so the blocks are removed, not emptied.
- **2026-11-10: a base path, chosen at build time (D11).** The sandbox can now be hosted under a sub-path. The base is
  set at build time, not derived at run time. A relative base (`./`) breaks deep links: `index.html` is the answer for
  every page, and its relative asset URLs would resolve below the page's own path. A base found at run time would need
  the host to rewrite `index.html` or add a `<base>` tag. A build-time base needs nothing from the host, and the root
  build behaves as before. The cost: one build serves one path, and `pnpm sandbox:serve` refuses a build for
  another one.
