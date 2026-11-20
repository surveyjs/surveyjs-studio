# Demo: hosted Step 6, the bridge for the old API's access-key actions

This page lets you check hosted Step 6 without reading code. It takes about thirty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root; the answers are shown with `jq`.

What Step 6 delivers: **a server built for the old API's `accessKey` actions keeps working when its calls reach
Studio.** The bridge answers `getActive`, `changeJson`, `getSurveyResults` and the other forty or so actions of
`private/Surveys` through Studio's public API, sending the key as a bearer credential, and a key that is revoked or wrong
gets the old API's answer. Studio's public API gained what those actions need (a survey's shared results layout,
deleting one response and others), and integrators who want to move off the old API have a
[migration guide](../api/migrating-from-api-surveyjs-io.md). The design is
[ADR 0040](../adr/0040-bridge-access-key-actions.md); the guides are [the bridge](../api/legacy-compat.md) and the
[migration guide](../api/migrating-from-api-surveyjs-io.md). Studio has no new screen in this step.

## Before you start

You need what [the Step 5 demo](hosted-05.md#before-you-start) lists: the self-hosted Step 1 tools, `jq`, a browser, and
free ports **3000** (Studio), **5173** (the web app), **3002** (the bridge) and **5180** (the sign-in stub). The stub of
the old service (port 3009) is not needed here: every action below is answered by Studio. Check the ports (nothing is
printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|3002|5173|5180) '
```

Start four shells, from the repository root. Studio runs as the **hosted edition**, as in Step 5, and with
`LEGACY_KEY_REVOKE=true`, so the **API tokens** page can revoke a legacy access key (it cannot by default).

1. **The sign-in stub** (shell 4), then **Studio** with the legacy fixture users and data (shell 1; PowerShell: set each
   variable with `$env:NAME = "value"` first, then run `pnpm demo`):

   ```sh
   pnpm oauth-stub
   ```

   ```sh
   APP_EDITION=hosted IDENTITY_PROVIDER=surveyjs-oidc OIDC_ISSUER_URL=http://127.0.0.1:5180/surveyjs \
     OIDC_CLIENT_ID=demo OIDC_CLIENT_SECRET=stub-secret-surveyjs LEGACY_KEY_REVOKE=true pnpm demo
   ```

   Open <http://localhost:5173> and sign in. In the stub's form enter Olivia Owner's ID,
   `11111111-0000-4000-8000-a00000000001`, as `sub` and choose **Sign in**.

2. **The bridge** in front of Studio (shell 2):

   ```sh
   pnpm dev:bridge
   ```

   - **Check:** a `starting` log line, then `Server listening at http://127.0.0.1:3002`.

3. **The commands** (shell 3):

   ```sh
   API=http://localhost:3000/api/v1
   BRIDGE=http://localhost:3002
   ```

   The demo keeps its data in memory: stop it with Ctrl+C and start it again for a clean slate. The seeded users have
   legacy access keys: `access-key-1` is Olivia's (the owner), and `access-key-3` is Mia Member's, a member of the
   Marketing project.

## 1. `getActive` matches the golden file (checklist 1)

The golden files of `legacy-compat-tests` hold what the old API answered. Mia's own active surveys:

```sh
curl -s "$BRIDGE/private/v1/Surveys/getActive?accessKey=access-key-3" | jq -S . > got.json
jq -S .response.body.json legacy-compat-tests/golden/getActive/member-personal.json > want.json
diff got.json want.json && echo "same as the golden file"
curl -s -i "$BRIDGE/private/v1/Surveys/getActive?accessKey=access-key-3" | grep -i -E '^(HTTP|content-type)'
rm got.json want.json
```

- **Check:** `same as the golden file` (one survey record, with the old property names `Name`, `IsArchived`, `PostId`,
  `ResultId`, `AllowAccessResult` and the rest), then `200` and `application/json; charset=utf-8`.
- The route works in any letter case, with a trailing slash, and under both prefixes. The key's name too:

  ```sh
  curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/PRIVATE/Surveys/GETACTIVE/?ACCESSKEY=access-key-3"
  ```

  - **Check:** `200`.

## 2. `changeJson` changes the survey (checklist 2)

1. Make a survey as Olivia, the way an old integration does, with `create`, and read its record back with
   `getSurveyInfo`:

   ```sh
   KEY=access-key-1
   curl -s -X POST "$BRIDGE/private/v1/Surveys/create?accessKey=$KEY" -H "Content-Type: application/json" -d '{}' > created.json
   ID=$(jq -r .Id < created.json); jq -c '{Name, IsPublished, CreatorId}' created.json
   curl -s "$BRIDGE/private/v1/Surveys/getSurveyInfo?accessKey=$KEY&surveyId=$ID" | jq -c '.Info.Name, .Json'
   ```

   - **Check:** `{"Name":"New Survey 1","IsPublished":true,"CreatorId":"11111111-0000-4000-8000-a00000000001"}`, then
     the name again and `"{}"` for the empty definition. (The old API answered no name and a `null` creator here: two of
     the [listed differences](../api/legacy-compat.md#access-key-actions-smaller-differences).)

2. Change the definition. The old `changeJson` takes the survey's id and the definition **as a string**:

   ```sh
   curl -s -i -X PUT "$BRIDGE/private/v1/Surveys/changeJson?accessKey=$KEY" -H "Content-Type: application/json" \
     -d "{\"Id\":\"$ID\",\"Json\":\"{\\\"title\\\":\\\"Changed through the bridge\\\",\\\"elements\\\":[{\\\"type\\\":\\\"text\\\",\\\"name\\\":\\\"q1\\\"}]}\"}" | grep -E '^HTTP|content-length'
   ```

   - **Check:** `200` with `content-length: 0`: the old answer is empty.

3. Look at the survey through Studio's own API, with the same key as a bearer value:

   ```sh
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/definition" | jq -c .
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/history" | jq -c '.items | length, (.[0].user.displayName)'
   ```

   - **Check:** `{"title":"Changed through the bridge","elements":[{"type":"text","name":"q1"}]}`, then `2` entries (the
     one made by `create` and the save) and `"Olivia Owner"`.

4. In the web app (signed in as Olivia), open **My Surveys**, find "New Survey 1", and open it in the editor.
   - **Check:** the editor shows the title "Changed through the bridge" and one text question `q1`.
   - Open **View History** in the "…" menu: the newest entry is the save you made through the bridge, by Olivia Owner.
     Click its time to see the JSON.

## 3. Revoking the key gives the old answer for a wrong key (checklist 3)

1. Before the revoke the call works:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/private/v1/Surveys/getActive?accessKey=$KEY"
   ```

   - **Check:** `200`.

2. In the web app, open **API tokens** (the account menu). The **Legacy access key** row has **Revoke** now (without
   `LEGACY_KEY_REVOKE=true` it has only a link to surveyjs.io). Choose **Revoke** and confirm ("Revoke this key?
   Integrations that use it stop working.").
   - **Check:** the legacy row is gone.

3. Run the same call, and a wrong key beside it, and compare them with the golden file:

   ```sh
   curl -s -i "$BRIDGE/private/v1/Surveys/getActive?accessKey=$KEY"
   curl -s -i "$BRIDGE/private/v1/Surveys/getActive?accessKey=no-such-key"
   jq -c '.response | {status, headers}' legacy-compat-tests/golden/getActive/wrong-key.json
   ```

   - **Check:** both answers are `401 Unauthorized` with `content-length: 0` and no `Location` header, as the golden file
     says (`"location":null`). The old API redirected to the site's sign-in page here; the bridge does not
     ([listed](../api/legacy-compat.md#access-key-actions-on-purpose)).

4. The five actions that answered with a text page keep doing so, and the key is HTML-encoded:

   ```sh
   curl -s -i "$BRIDGE/private/v1/Surveys/getSurveyDemoResults/$ID?accessKey=$KEY" | grep -E '^HTTP|^content-type|^The'
   curl -s "$BRIDGE/private/v1/Surveys/getSurveyDemoResults/$ID?accessKey=%3Cb%3Ex%3C/b%3E"; echo
   ```

   - **Check:** `200`, `text/html; charset=utf-8` and `The accessKey 'access-key-1' is incorrect.`; then
     `The accessKey '&lt;b&gt;x&lt;/b&gt;' is incorrect.`
   - **Check:** the revoke touched only the key. Mia's key works as before:

     ```sh
     curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/private/v1/Surveys/getActive?accessKey=access-key-3"
     ```

     prints `200`.

## 4. A few more actions

With Mia's key (the key that still works):

```sh
KEY=access-key-3
# A project's surveys: ownerId is the Marketing project's id (see the golden file member-project.json)
curl -s "$BRIDGE/private/v1/Surveys/getActive?accessKey=$KEY&ownerId=55555555-0000-4000-8000-a00000000001" | jq -c '.[0] | {Name, UserId}'
# Olivia's personal survey, which Mia cannot see: the action's own refusal text
curl -s -X PUT "$BRIDGE/private/v1/Surveys/changeName/22222222-0000-4000-8000-a00000000001?accessKey=$KEY&name=Mine"; echo
# The same survey through getSurveyInfo: an empty 400, as for an unknown survey
curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/private/v1/Surveys/getSurveyInfo?accessKey=$KEY&surveyId=22222222-0000-4000-8000-a00000000001"
```

- **Check:** `{"Name":"Campaign survey","UserId":"55555555-0000-4000-8000-a00000000001"}`; then
  `"You are not authorized to modify the survey 22222222-0000-4000-8000-a00000000001"` (a `400`, as the old API
  answered); then `400`.

The migration guide shows the same operations as Studio's own calls: pick a row of
[its table](../api/migrating-from-api-surveyjs-io.md#every-action-and-its-operations) and run the example.

## Stop everything

Stop the shells with Ctrl+C (the bridge, Studio and the stub), and remove the file you made:

```sh
rm -f created.json
```

The check of all of this against the golden files is the compatibility suite: `pnpm test:compat`
([Testing](../testing.md#the-compatibility-suite)). That the migration guide lists what the bridge answers is checked by
`pnpm vitest run bridge/src/guide.test.ts`.

## Nothing private

Run `pnpm scan:secrets`.

- **Check:** no leaks found. The docs hold only sample values.
