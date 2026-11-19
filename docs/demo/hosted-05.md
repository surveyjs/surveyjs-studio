# Demo: hosted Step 5, the bridge for the old API's public actions

This page lets you check hosted Step 5 without reading code. It takes about thirty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root; the answers are shown with `jq`.

What Step 5 delivers: **a page built for the old API keeps working when its calls reach Studio.** The bridge answers
the old API's public actions (`getSurvey`, `post`, `getResult`, `files?name=` and the rest) through Studio's public API,
and forwards every other path to the old service. A small page that uses Form Library v1 with `surveyId` loads a survey
through the bridge and posts its answers, and the answers show in Studio. The design is
[ADR 0039](../adr/0039-bridge-public-actions.md); the guides are [the bridge](../api/legacy-compat.md) and
[its operations](../api/public-endpoints.md#operations-for-the-bridge). Studio has no new screen in this step.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists, `jq`, and a browser. Four ports
must be free: **3000** (Studio), **5173** (the web app), **3002** (the bridge) and **3009** (the stub of the old service).
Check them (nothing is printed when they are free):

```sh
netstat -ano | grep LISTEN | grep -E ':(3000|3002|3009|5173) '
```

If 3000 is taken, stop what uses it. Set `BRIDGE_STUDIO_URL` before step 3 below only if you must move Studio
(`PORT=<port> pnpm demo` and `BRIDGE_STUDIO_URL=http://127.0.0.1:<port>/api/v1 pnpm dev:bridge`, and set `API` below to the same
port); the bridge's own port is `BRIDGE_PORT` the same way.

Start four shells, from the repository root.

1. **Studio**, with the legacy fixture users and data (shell 1):

   ```sh
   pnpm demo
   ```

   Open <http://localhost:5173> and sign in as **Olivia Owner**.

2. **A stub of the old service** (shell 2). It answers every request with what it received, so you can see what the
   bridge forwarded:

   ```sh
   node -e 'require("http").createServer((q,r)=>{let b="";q.on("data",c=>b+=c).on("end",()=>{r.setHeader("content-type","text/plain");r.end(`old service: ${q.method} ${q.url} x-demo=${q.headers["x-demo"]} body=${b}\n`)})}).listen(3009,"127.0.0.1")'
   ```

3. **The bridge** in front of Studio (shell 3). `bridge/demo.env` points it at Studio on port 3000 and the stub on
   port 3009:

   ```sh
   pnpm dev:bridge
   ```

   - **Check:** a `starting` log line, then `Server listening at http://127.0.0.1:3002`.

4. **The commands** (shell 4):

   ```sh
   API=http://localhost:3000/api/v1
   BRIDGE=http://localhost:3002
   KEY=access-key-1
   ```

   `access-key-1` is Olivia's legacy access key, which works as a bearer value
   ([Step 3](hosted-03.md#5-a-legacy-access-key-checklist-5)). The demo keeps its data in memory: stop it with Ctrl+C and
   start it again for a clean slate.

## 1. A page built for the old API loads a survey and posts (checklist 1)

1. Make a survey with a text question and an image that the old service stored. The seeded fixtures hold one editor file,
   `99999999-0000-4000-8000-a00000000001`; the survey's JSON points at it the way old surveys do, with a `files?name=`
   URL on the bridge:

   ```sh
   IMG="$BRIDGE/private/Surveys/files?name=99999999-0000-4000-8000-a00000000001"
   curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d "{\"name\":\"Bridge demo\",\"definition\":{\"title\":\"Bridge demo\",\"elements\":[{\"type\":\"text\",\"name\":\"q1\",\"title\":\"Your name\"},{\"type\":\"html\",\"name\":\"logo\",\"html\":\"<img src='$IMG' width='40' height='40' alt='legacy image'>\"}]}}" \
     "$API/surveys" > survey.json
   ID=$(jq -r .id < survey.json); POST=$(jq -r .postId < survey.json); RESULT=$(jq -r .resultId < survey.json)
   echo "$ID $POST $RESULT"
   ```

   - **Check:** three ids are printed. They are the survey's id, its **post id** and its **result id**, the keys the old
     API used.

2. The survey loads through the bridge as the old `getSurvey` served it:

   ```sh
   curl -s "$BRIDGE/public/v1/Survey/getSurvey?surveyId=$ID" | jq -c '{title, elements: .elements | length}'
   curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/PUBLIC/V1/SURVEY/GETSURVEY/?surveyId=$ID"
   ```

   - **Check:** `{"title":"Bridge demo","elements":2}`, then `200`: the route works in any letter case and with a
     trailing slash, as the old API's did.

3. Write a page that uses Form Library **v1** with `surveyId`, as pages built for the old service do, with the service URL
   pointed at the bridge (v1's default is `https://api.surveyjs.io/public/v1/Survey`, the bridge answers on the same path):

   ```sh
   cat > bridge-demo.html <<EOF
   <!doctype html>
   <meta charset="utf-8" />
   <title>Bridge demo</title>
   <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/survey-core@1.12.67/defaultV2.min.css" />
   <script src="https://cdn.jsdelivr.net/npm/survey-core@1.12.67/survey.core.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/survey-js-ui@1.12.67/survey-js-ui.min.js"></script>
   <div id="surveyElement"></div>
   <script>
     Survey.settings.web.surveyServiceUrl = "$BRIDGE/public/v1/Survey";
     const survey = new Survey.Model({ surveyId: "$ID", surveyPostId: "$POST" });
     survey.render(document.getElementById("surveyElement"));
   </script>
   EOF
   ```

   Open `bridge-demo.html` in a browser (double-click it, or `start bridge-demo.html` in Git Bash). It loads the library
   from a CDN, so it needs the internet.
   - **Check:** the page shows **Bridge demo** with the question **Your name** and a tiny image under it (a 1-pixel
     picture). In the browser's network tab, the calls go to `localhost:3002`: `getSurvey?surveyId=…` and
     `files?name=…`.

4. Type a name, for example `Ada`, and click **Complete**. The page posts through the bridge (`post/` with the post id).
   Look at the results in Studio:

   ```sh
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[] | {data}'
   ```

   - **Check:** one response, `{"data":{"q1":"Ada"}}`.

5. In the web app, open **View Results** for "Bridge demo" in the survey list (the "…" menu), on the **Table** tab.
   - **Check:** one row with `Ada`.

## 2. `getResult` matches the golden file (checklist 2)

The golden files of `legacy-compat-tests` hold what the old API answered, here for the seeded "Customer feedback" survey
(result id `44444444-0000-4000-8000-a00000000001`, question `satisfaction`).

```sh
curl -s "$BRIDGE/public/v1/Survey/getResult?resultId=44444444-0000-4000-8000-a00000000001&name=satisfaction" | jq -S . > got.json
jq -S .response.body.json legacy-compat-tests/golden/getResult/found.json > want.json
diff got.json want.json && echo "same as the golden file"
curl -s -i "$BRIDGE/public/v1/Survey/getResult?resultId=44444444-0000-4000-8000-a00000000001&name=satisfaction" | grep -i -E '^(HTTP|content-type|cache-control)'
rm got.json want.json
```

- **Check:** `same as the golden file`, with counts `1`, `3`, `4`, `5` for the ratings and `ResultCount` 4. The headers are
  `200`, `application/json; charset=utf-8` and `Cache-Control: private, max-age=3600, must-revalidate`, as the golden
  file says. (Studio counts completed responses only, so the fixture's partial save is not in the counts: a
  [listed difference](../api/legacy-compat.md#which-responses-are-counted), recorded in the file.)

The same for the survey you made, after the page's response:

```sh
curl -s "$BRIDGE/public/v1/Survey/getResult?resultId=$RESULT&name=q1" | jq -c .
```

- **Check:** `{"AnswersCount":1,"QuestionResult":{"Ada":1},…,"ResultCount":1}`.

## 3. A legacy `files?name=` image is served (checklist 3)

The survey's JSON holds `…/private/Surveys/files?name=99999999-…`. The page showed it in section 1. Ask for it directly:

```sh
curl -s -D - -o image.png "$BRIDGE/private/Surveys/files?name=99999999-0000-4000-8000-a00000000001" | grep -i -E '^(HTTP|content-type|content-disposition)'
head -c 4 image.png | tail -c 3; echo
rm image.png
```

- **Check:** `200`, `Content-Type: application/octet-stream` and a `Content-Disposition: attachment; filename=…` with the
  name, as the old API answered; the file starts with `PNG`. A name with a path is refused without a lookup:

```sh
curl -s -o /dev/null -w "%{http_code}\n" "$BRIDGE/private/Surveys/files?name=..%2Fx"
```

- **Check:** `404`.

## 4. A site path reaches the old service (checklist 4)

Paths the bridge has no route for go to the old service unchanged. Here the old service is the stub of shell 2:

```sh
curl -s "$BRIDGE/private/Surveys/getTempFile?name=a.png"
curl -s -X POST -H "X-Demo: yes" -d 'hello' "$BRIDGE/private/Surveys/uploadTempFiles"
curl -s -X POST "$BRIDGE/public/Survey/post/page-number"
```

- **Check:** the stub reports what it received: `old service: GET /private/Surveys/getTempFile?name=a.png …`, then
  `old service: POST /private/Surveys/uploadTempFiles x-demo=yes body=hello` (method, path, header and body unchanged), then
  `old service: POST /public/Survey/post/page-number …`: an unknown path is forwarded too, so it answers as the old service
  does.
- **Check:** if you stop the stub (Ctrl+C in shell 2) and repeat the first command, the answer is an empty `500`, and
  `getSurvey` still works: the actions Studio serves do not depend on the old service.

## 5. The three differences, and the old `post`

1. The old `post` stores a response through the bridge, and `isCompleted` reads the state:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
     -d "{\"postId\":\"$POST\",\"surveyResult\":\"{\\\"q1\\\":\\\"Bo & <b>Bo</b>\\\"}\",\"clientId\":\"demo-1\"}" \
     "$BRIDGE/public/v1/Survey/post"
   curl -s "$BRIDGE/public/v1/Survey/isCompleted?resultId=$RESULT&clientId=demo-1"; echo
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[-1] | {data, clientId}'
   ```

   - **Check:** `200`, then `"completed"` (the old API answered a JSON string), then `{"data":{"q1":"Bo & <b>Bo</b>"},"clientId":"demo-1"}`: the answers are
     stored **as sent** (the old API HTML-encoded them).

2. `isCompleted` without a `clientId` never tells another respondent's state:

   ```sh
   curl -s "$BRIDGE/public/v1/Survey/isCompleted?resultId=$RESULT"; echo
   ```

   - **Check:** `"no"`.

3. `getSurveyPublicResults` never lists a respondent's client id or address. "Customer feedback" has Grant Access on:

   ```sh
   curl -s "$BRIDGE/private/Surveys/getSurveyPublicResults/22222222-0000-4000-8000-a00000000001" | jq -c '.Data[0] | keys'
   ```

   - **Check:** the keys are the answers, `HappendAt` and `InstanceId`; no `ClientId` and no `IPAddress`.

## Stop everything

Stop the shells with Ctrl+C (the bridge, the stub and Studio), and remove the files you made:

```sh
rm -f survey.json bridge-demo.html
```

The conformance-style check of all of this is the compatibility suite: `pnpm test:compat`
([Testing](../testing.md#the-compatibility-suite)).

## Nothing private

Run `pnpm scan:secrets`.

- **Check:** no leaks found. The docs hold only sample values.
