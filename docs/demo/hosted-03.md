# Demo: hosted Step 3, API tokens, legacy access keys and CORS

This page lets you check hosted Step 3 without reading code. It takes about twenty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root.

What Step 3 delivers: **integrators can call the API with a per-scope token, and from browsers.** A user makes
**API tokens** (`sjs_…`) on a new page, Personal or for one project. A **legacy access key** works as a token too.
Browser pages of other origins can call the public endpoints, and any endpoint with a bearer credential, through CORS.
The design is [ADR 0037](../adr/0037-access-keys-and-api-tokens.md); the guides are the
[API guide](../api/api-tokens.md) and the [user guide](../user-guide/api-tokens.md). Nothing changes for users until
they make a token: studio.surveyjs.io is not affected.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists. Ports 3000, 5173 and 4000
must be free. Start the demo, with the legacy fixture users, from the repository root:

```sh
pnpm demo
```

Open <http://localhost:5173>. The users are **Olivia Owner** (admin of Marketing, with a legacy access key) and the
others of [the Step 5 demo](step-05.md#before-you-start). In a second shell:

```sh
API=http://localhost:3000/api/v1
```

## 1. A Personal token (checklist 1)

1. Sign in as **Olivia Owner**. Open the account menu in the header and choose **API tokens**.
   - **Check:** the page has a **Personal** section with a **Legacy access key** row (the last four characters, no
     value) and a section for **Marketing**, where Olivia is admin.
2. Choose **Create token**, type the name `Demo`, leave the scope on **Personal** and choose **Create**.
   - **Check:** the dialog shows a value that starts with `sjs_`, a **Copy token** button and "Copy this token now.
     You won't see it again."
3. Copy the value into the shell, and choose **Done**:

   ```sh
   TOKEN=<the value you copied>
   curl -s -H "Authorization: Bearer $TOKEN" "$API/surveys"
   ```

   - **Check:** the answer lists Olivia's personal surveys: the same ones as **Your surveys** shows under Personal,
     with no project survey.

4. Reload the page.
   - **Check:** the `Demo` token is in the table with its last four characters, its creator and date, and an empty
     **Last used**; the value is nowhere on the page.
5. Run the `curl` again and reload the page.
   - **Check:** **Last used** has a time now.

## 2. A project token (checklist 2)

1. On the same page choose **Create token**, name it `Marketing demo` and choose the scope **Marketing**.
   Copy the value:

   ```sh
   PTOKEN=<the value you copied>
   curl -s -H "Authorization: Bearer $PTOKEN" "$API/surveys"
   ```

   - **Check:** only Marketing's surveys are listed.

2. Ask for a survey of Olivia's personal space with the project token. Take the `id` of one from step 1:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $PTOKEN" "$API/surveys/<a personal survey id>"
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/surveys?project=<the Marketing id>"
   ```

   - **Check:** both print `404`: a token cannot see outside its scope.

3. Try something a token may not do:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/api-tokens"
   curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $PTOKEN" "$API/projects"
   ```

   - **Check:** both print `401`: managing credentials and projects needs a signed-in session.

4. Sign in as **Adam Admin** in a private window (he is admin of Marketing) and open **API tokens**.
   - **Check:** the Marketing section lists `Marketing demo`, made by Olivia Owner. A member of a project who is not
     an admin sees no section for it.

## 3. Revoke (checklist 3)

1. As Olivia, choose **Revoke** on the `Marketing demo` row.
   - **Check:** the browser asks "Revoke this token? Integrations that use it stop working." After you confirm,
     the row is gone.
2. Run the project `curl` of section 2 step 1 again.
   - **Check:** the answer is `401` with the code `unauthenticated`.

## 4. Another origin (checklist 4)

1. Serve a page from port 4000. Any static server will do; for example, in an empty folder:

   ```sh
   npx --yes http-server -p 4000
   ```

2. Open <http://localhost:4000/> (a page that says 404 is fine), open the browser's console there, and run, with the
   id of a published survey of the demo:

   ```js
   await (await fetch("http://localhost:3000/api/v1/public/surveys/<the id>")).json();
   ```

   - **Check:** the survey comes back, with no CORS error.

3. In the same console call an endpoint that needs a credential, first without one and then with your token:

   ```js
   (await fetch("http://localhost:3000/api/v1/surveys")).status; // a CORS error: no cookie is sent, no CORS headers
   (
     await fetch("http://localhost:3000/api/v1/surveys", {
       headers: { Authorization: "Bearer <the Personal token>" },
     })
   ).status;
   ```

   - **Check:** the first call fails in the browser (a request without a bearer credential gets no CORS headers); the
     second answers `200`.

4. Look at the headers:

   ```sh
   curl -si -H "Origin: http://localhost:4000" "$API/public/surveys/<the id>" | grep -i "^access-control"
   curl -si -X OPTIONS -H "Origin: http://localhost:4000" -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: authorization" "$API/surveys" | grep -i "^access-control"
   ```

   - **Check:** `Access-Control-Allow-Origin: *` in both, `Access-Control-Allow-Headers` with `Authorization`,
     `Content-Type`, `Idempotency-Key`, `If-Match` and `If-None-Match`, and no `Access-Control-Allow-Credentials`.

## 5. A legacy access key (checklist 5)

1. The fixture user Olivia Owner has the key `access-key-1`:

   ```sh
   KEY=access-key-1
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys"
   ```

   - **Check:** the same personal surveys as with the Personal token in section 1. The key also reaches the projects
     Olivia belongs to: add `?project=<the Marketing id>`.

## 6. The legacy key's link and Revoke

1. On the **API tokens** page look at the **Legacy access key** row.
   - **Check:** the row has the link **Replace it on surveyjs.io** and no **Revoke**: the setting
     `LEGACY_KEY_REVOKE` is off, its default.
2. Try the operation anyway, signed in (use the browser console on
   <http://localhost:5173>):

   ```js
   const csrf = document.cookie.match(/msid_csrf=([^;]+)/)[1];
   (
     await fetch("/api/v1/api-tokens/legacy-key", {
       method: "DELETE",
       headers: { "X-CSRF-Token": csrf },
     })
   ).json();
   ```

   - **Check:** `409` with the code `legacy-key-revoke-unavailable`.

3. Stop the demo (Ctrl+C) and start it with the setting on: `LEGACY_KEY_REVOKE=true pnpm demo`. Sign in as Olivia Owner
   and open **API tokens**.
   - **Check:** the legacy row has **Revoke** now.
4. Choose **Revoke** and confirm ("Revoke this key? Integrations that use it stop working."). Run the legacy `curl`
   of section 5 again.
   - **Check:** the row is gone and the call answers `401`. The tokens of sections 1 and 2 are not affected (the
     demo's memory is empty after a restart; make a Personal token again to see that it still works).

## 7. A token replaces itself

1. Rotate the Personal token (make a new one first if you restarted the demo):

   ```sh
   curl -s -X POST -H "Authorization: Bearer $TOKEN" "$API/me/credential"
   ```

   - **Check:** `{"value":"sjs_…"}`, a new value. The old `$TOKEN` now gets `401` on `$API/surveys`; the new one
     answers `200`.

2. With a session instead of a bearer value the same operation is refused:

   ```js
   (await fetch("/api/v1/me/credential", { method: "POST", headers: { "X-CSRF-Token": csrf } }))
     .status;
   ```

   - **Check:** `401`: only a bearer credential can replace itself.

The conformance suite (`api-tokens.test.ts`, [Testing](../testing.md#api-tokens-on-the-conformance-server)) checks these rules, and the blocked-owner rule,
against every provider.

## Nothing private

Run `pnpm scan:secrets`.

- **Check:** no leaks found. The docs hold only the sample value `sjs_EXAMPLE…`.
