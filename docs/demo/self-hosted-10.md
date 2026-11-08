# Demo: self-hosted Step 10, publishing the sandbox

This page lets you check self-hosted Step 10 without reading code. The **local part** takes about twenty minutes and
needs Docker. The **live part** needs the product owner's one-time setup, and is for after that. Commands are for Git
Bash (or any POSIX shell), from the repository root.

What Step 10 delivers: **the sandbox on the web at `https://studio.demos.surveyjs.io`**, served by the shared demos
server with the server's security headers, tested and released by a CI workflow, with a guard that offers a reset to a
returning visitor whose stored data is from another release. Details:
[Operations › The sandbox](../operations.md#the-sandbox-studiodemossurveyjsio),
[Development › Publishing the sandbox](../development.md#publishing-the-sandbox-step-10) and
[ADR 0031](../adr/0031-publishing-the-sandbox.md).

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists (Node and `pnpm install`),
Docker running, a current Chrome or Edge, and port 8080 free (`netstat -ano | grep -E ":8080 .*LISTENING"` prints
nothing).

## Local part

### 1. Build and serve the site as the server does

```sh
pnpm build:sandbox
pnpm sandbox:serve
```

**Check:** the build ends without an error, and `pnpm sandbox:serve` prints `http://localhost:8080`. (It starts
`nginx:1.30-alpine` with `deploy/sandbox/nginx.conf`; the first run pulls the image.)

### 2. The headers and the version file

```sh
curl -sI http://localhost:8080/ | grep -iE "content-security-policy|cache-control|x-content-type|referrer-policy|strict-transport"
curl -sI http://localhost:8080/s/x | grep -i content-security-policy
curl -sI http://localhost:8080/mockServiceWorker.js | grep -i cache-control
curl -s http://localhost:8080/version.json
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/assets/no-such.js
```

**Check:**

- the first command shows the web app's policy ending in `frame-ancestors 'none'`, `Cache-Control: no-cache`,
  `X-Content-Type-Options: nosniff` and the referrer policy;
- the second shows the same policy ending in `frame-ancestors *`;
- the worker is `no-cache`;
- `version.json` is `{"commit":"<your HEAD sha>","dataVersion":1}`;
- the missing asset is `404`.

(nginx also sends `Strict-Transport-Security` on every answer, even over plain HTTP here.)

### 3. The suites against that server

```sh
E2E_SANDBOX_URL=http://localhost:8080 pnpm e2e:sandbox:url
```

**Check:** it ends green. The `sandbox-chromium` project is the `@sandbox` stories, and `sandbox-host` checks the
headers, the cache rules, `version.json` and that the app starts with no policy violation. This is what the workflow
runs before it publishes.

### 4. The version guard

1. Open <http://localhost:8080> (a window with no earlier data for this origin) and pick **Olivia Owner**.
2. Open DevTools, Application, Local Storage, `http://localhost:8080`. Select the key `studio-sandbox:v1`, and in its
   value change `"version":1` to `"version":0` (keep the rest). Or in the Console:

   ```js
   const k = "studio-sandbox:v1";
   const d = JSON.parse(localStorage.getItem(k));
   d.version = 0;
   localStorage.setItem(k, JSON.stringify(d));
   ```

3. Reload (F5).
   - **Check:** the page says **This demo has been updated**, with one button **Reset to continue**. Nothing else
     loads: no account list, no surveys.
4. Click **Reset to continue**.
   - **Check:** the page is **Pick an account**, and after picking **Olivia Owner**, **Customer feedback** is listed.
     `version` in the stored document is `1` again.

### 5. A setting changes without a rebuild

The demos server mounts a config directory over the site's `sandbox.config.json`. Try the same with Docker. Stop the
first server and start one with a mount:

```sh
pnpm sandbox:serve --stop
ROOT="$(pwd -W 2>/dev/null || pwd)"
CFG="$(mktemp -d)"
CFG_MOUNT="$(cygpath -w "$CFG" 2>/dev/null || echo "$CFG")"
echo '{"maxUploadKb": 50, "storageLimitKb": 4096, "seedBudgetKb": 1024}' > "$CFG/sandbox.config.json"
MSYS_NO_PATHCONV=1 docker run --rm -d --name studio-sandbox-config -p 8080:80 \
  -v "$ROOT/web/dist-sandbox:/usr/share/nginx/html:ro" \
  -v "$ROOT/deploy/sandbox:/etc/nginx/sandbox:ro" \
  -v "$ROOT/deploy/sandbox/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$CFG_MOUNT:/srv/sandbox-config:ro" \
  nginx:1.30-alpine
curl -s -D - http://localhost:8080/sandbox.config.json
```

(`pwd -W` and `cygpath -w` print Windows paths in Git Bash; elsewhere the `||` falls back to the plain path.)

**Check:** the answer holds `"maxUploadKb": 50` (the build has 200) and `Cache-Control: no-store`. Now edit
`$CFG/sandbox.config.json`, set `maxUploadKb` to `75`, and run the `curl` again without restarting.
**Check:** it answers `75`. Remove the file and `curl` again: **Check:** the build's `200` is back.

Clean up:

```sh
docker rm -f studio-sandbox-config
rm -rf "$CFG"
```

On the real server the same happens with `projects/surveyjs-studio-sandbox/config/sandbox.config.json`.

## Live part (after the one-time setup)

The setup is in [Operations](../operations.md#one-time-setup-product-owner): the read-only token and the licence key
in the demos server's `env/.env`, the push webhook, and the demos-infrastructure branch deployed.

### 6. Run the workflow

1. In GitHub open **Actions › Publish sandbox › Run workflow**, leave `ref` as `master` (or give a tag) and run it.
2. **Check:** the jobs are **test**, **publish** and **smoke**, all green. **publish** added a commit on the branch
   `sandbox` whose only file is `COMMIT`. **smoke** waited until the live site showed the commit.
3. Run `curl -s https://studio.demos.surveyjs.io/version.json`. **Check:** `commit` is the sha the run published.

### 7. The full loop on the live site

1. Open <https://studio.demos.surveyjs.io> and pick **Olivia Owner**. **Check:** no licence notice shows (the key
   covers the domain), and the demo banner is at the top.
2. Do the steps of [the Step 9 demo](self-hosted-09.md#1-pick-the-owner-and-see-the-seeded-surveys-and-their-results-checklist-1)
   (sections 1 to 4: the seeded surveys, a change kept after a reload, publish and run in a new tab, Reset demo data).
3. Run the header checks of step 2 above against `https://studio.demos.surveyjs.io` (the `/` page also has
   `Strict-Transport-Security`).

### 8. A release with a new data version

1. In a branch, raise `version` in `server/fixtures/sandbox.json` to `2` and run `pnpm sandbox:seed`. Merge it, or
   run the workflow on that branch.
2. When the run is green, reload the live site in the window of step 7.
   - **Check:** **This demo has been updated** and **Reset to continue** appear. After the reset the app starts on the
     seed, and `https://studio.demos.surveyjs.io/version.json` has `"dataVersion":2`.
3. Open the site in two tabs, publish the bump again (version `3`), reload one tab and click **Reset to continue**,
   then use the other, older tab. **Check:** the banner at the top says **The demo was updated in another tab. Reload this page.** with a **Reload** button.

### 9. The storage-full walk on the live origin

A Step 9 follow-up: do the full-storage check where the visitor will. On the live site, with **Olivia Owner**, fill
the browser's storage for the origin (in the Console, set a large dummy key: `localStorage.setItem("pad",
"x".repeat(4_500_000))`), then upload a file or save a change. **Check:** the message "Browser storage is full" and
the offer to reset appear. Remove the key (`localStorage.removeItem("pad")`) and use **Reset demo data**.

### 10. Roll back

Run the workflow again with an older tag or commit as `ref` (one that already has `build:sandbox`, `sandbox:serve` and
`e2e:sandbox:url`). **Check:** the run is green, a new commit is on `sandbox`, and `version.json` names the older
commit.

## Clean up (local)

```sh
pnpm sandbox:serve --stop
```

The demo data of `localhost:8080` stays in your browser: clear the site's data for it.

## What the automated tests cover

- `pnpm test:unit`: the version guard (a current, an outdated and a damaged document; the `503` for an outdated
  document mid-session; the start-up screen), the `/config` licence key (empty means `null`), `version.json`, the
  nginx file against `server/src/web/security-headers.ts`, and the workflow's wait script's arguments.
- `pnpm e2e:sandbox` includes the `@sandbox` test of the **This demo has been updated** screen.
- `E2E_SANDBOX_URL=<url> pnpm e2e:sandbox:url`: the `@sandbox` stories and the `@sandbox-host` checks (the shell is
  `no-cache` and not frameable, the run page may be framed, the worker, `version.json`, `sandbox.config.json`, hashed
  assets, no policy violation at start-up) against a running site. CI runs it on the repo's nginx before publishing and
  on the live site after.

This page does not check the demos server's build (that is the live part), the webhook, or other browsers than
Chromium for the live suites.
