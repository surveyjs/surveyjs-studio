# Demo: self-hosted Step 9, the sandbox

This page lets you check self-hosted Step 9 without reading code. It takes about fifteen minutes. Commands are for Git
Bash (or any POSIX shell), from the repository root. It needs no server, no database and no Docker.

What Step 9 delivers: **the sandbox, the web app with a back-end inside the browser.** A visitor picks one of four demo
accounts, and everything they change stays in their own browser (in localStorage). Other visitors, and other browsers,
start from the same small seed. Nothing is sent to a server: there is none. Details:
[Development › The sandbox](../development.md#the-sandbox-step-9) and
[ADR 0030](../adr/0030-the-sandbox-mock-in-the-browser.md).

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists (Node and `pnpm install`), and a
current Chrome or Edge, plus a private window of the same browser. Port 5173 must be free. To check, run
`netstat -ano | grep -E ":(5173) .*LISTENING"`: it must print nothing. An old `pnpm dev` that still runs keeps 5173
busy; stop it first.

Start the sandbox. It stays running.

```sh
pnpm dev:sandbox
```

**Check:** it prints a `Local: http://localhost:5173/` line.

Open <http://localhost:5173>. Use a window that has not visited the sandbox before, or remove the site's data first
(the browser's developer tools, Application, Storage, **Clear site data**). **Check:** the page is **Pick an account**,
with four accounts: **Olivia Owner**, **Adam Admin**, **Mia Member** and **Oscar Outsider**. A strip at the top says
"This is a demo. Your data stays in this browser, and other visitors don't see it." with the links **Run it yourself**
and **Source code**, and the button **Reset demo data**.

## 1. Pick the owner and see the seeded surveys and their results (checklist 1)

1. Click **Olivia Owner**.
   - **Check:** My Surveys opens. The list has **Customer feedback** and **Draft idea**, the surveys of the
     projects **Marketing** and **Engineering** (for example **Campaign survey**), and **Old poll** under **Archived**.
     The banner stays at the top.
2. Open the menu of **Customer feedback** and click **View Results**, then the **Details** tab.
   - **Check:** it says `Total responses: 5`, and the rows hold seeded answers.
3. Open the account menu. **Check:** there is no **Users** item and no **Change password**: a demo account has no
   password and no instance role.

## 2. A change is kept, and a private window does not see it (checklist 2)

1. Go back to **My Surveys**, open **Customer feedback** in the editor (its row menu, **Edit**), click the survey name
   in the bar at the bottom, type `Demo renamed`, and press Enter.
   - **Check:** the status says **All changes saved**.
2. Reload the page (F5). **Check:** you are still signed in as **Olivia Owner**, the editor shows `Demo renamed`, and
   My Surveys lists `Demo renamed`.
3. Open a **private window** (Ctrl+Shift+N) at <http://localhost:5173> and pick **Olivia Owner**.
   - **Check:** the list shows **Customer feedback**, not `Demo renamed`. The private window has its own storage, so it
     starts from the seed. (A private window of Firefox blocks service workers: the page then says "This demo needs a
     browser with service workers…". Use Chrome or Edge for this step.)
4. Close the private window.

## 3. Publish, run in a new tab, submit, see the response (checklist 3)

1. In the first window, in the row menu of `Demo renamed`, click **Unpublish**, then **Publish**.
2. In the row menu click **Run**. **Check:** a new tab opens at `/s/<id>` with the survey and a smaller demo strip
   (no links).
3. Choose **3** for the satisfaction question and click **Complete**.
   - **Check:** "Thank you for completing the survey".
4. Close that tab. In the row menu click **View Results**, then **Details**.
   - **Check:** `Total responses: 6`. Reload the page: still 6.

## 4. Reset demo data brings the seed back (checklist 4)

1. Click **Reset demo data** in the banner.
   - **Check:** a question: "Reset all demo data? Your changes in this browser are lost."
2. Click **Reset**.
   - **Check:** the page is **Pick an account** again: the session went with the data.
3. Pick **Olivia Owner**. **Check:** **Customer feedback** is back and `Demo renamed` is gone. Open its results:
   `Total responses: 5`.

## 5. A smaller upload limit shows the quota message (checklist 5)

1. Make a test image of about 100 KB, in the repository root (a PNG header and random bytes; any image of that size will do):

   ```sh
   head -c 100000 /dev/urandom > big.bin && printf '\x89PNG\r\n\x1a\n' | cat - big.bin > big.png && rm big.bin
   ```

2. Edit `web/sandbox-public/sandbox.config.json` and set `"maxUploadKb": 50`, then save.
3. Reload the sandbox page (F5) and pick **Olivia Owner** if asked. **Check:** the page loads without a warning page.
4. Open **Customer feedback** in the editor. On the **Designer** tab click **Image** in the toolbox (it adds an image
   question), then the question's **Choose Image** button, and pick `big.png` from the repository root.
   - **Check:** a message appears: "A survey can store up to 50 KB of files in total. This file was not uploaded." The
     image question stays empty.
5. Optionally upload a small image (a few KB). **Check:** it is accepted and shows in the question.

## Clean up

Stop the sandbox with Ctrl+C. Then:

```sh
git checkout web/sandbox-public/sandbox.config.json   # maxUploadKb back to 200
rm -f big.png
```

**Check:** `git status` shows no change to `web/sandbox-public/sandbox.config.json`. The demo data stays in your
browser: use **Reset demo data**, or clear the site's data for `localhost:5173`.

## What the automated tests cover

- `pnpm test:unit`: the store (round trips, reset, an old or damaged document, a refused write, the storage limit),
  the settings file (each setting, a missing file, bad values), every handler area, the coverage test that fails when
  the contract gains an operation that is neither handled nor listed as unsupported, the seed (up to date and under
  `seedBudgetKb`), the account picker, the banner, and that the copied worker file is MSW's own.
- `pnpm test:conformance:sandbox`: the conformance suite's survey, content, file, public, results, view, project and
  member tests against the mock handlers under `msw/node` (13 files; skips carry their reason: fixtures the seed
  leaves out, server-only behaviour, CSRF-only tests).
- `pnpm e2e:sandbox` (Chromium, the sandbox build on `vite preview`): rename in the editor and reload; the member
  sees Marketing; publish, run in a new tab and see the sixth response, with no request to another site; Reset demo
  data; another browser context starts from the seed.
- `pnpm build:sandbox` and `pnpm build` check that the sandbox build has its worker and its settings file, and that
  the normal build holds no sandbox code.
- In CI (Linux): the conformance and the e2e runs above.

This page does not check a full browser storage (the unit tests and the conformance run do), two tabs that save at
once, or the Dashboard's images from uploads. The sandbox is not published yet: that is Step 10.
