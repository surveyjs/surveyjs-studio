# Demo: hosted Step 4, partial responses

This page lets you check hosted Step 4 without reading code. It takes about twenty minutes. Commands are for Git Bash
(or any POSIX shell), from the repository root; the answers are shown with `jq`.

What Step 4 delivers: **a form that saves progress is stored and reported as the old service did.** A post with
`partial: true` and a `clientId` is a partial save. The saves of one client read as **one response** in the results,
marked `partial` until the client completes, and the statistics, the Summary and public results count completed
responses only. The design is [ADR 0038](../adr/0038-partial-responses.md); the guides are the
[API guide](../api/public-endpoints.md#partial-saves) and [Viewing results](../user-guide/viewing-results.md#partial-responses).
Studio's own run page still sends complete responses only, so nothing changes for respondents who use it.

## Before you start

You need what [the self-hosted Step 1 demo](self-hosted-01.md#before-you-start) lists, and `jq`. Ports 3000 and 5173
must be free. Start the demo, with the legacy fixture users, from the repository root:

```sh
pnpm demo
```

Open <http://localhost:5173> and sign in as **Olivia Owner**. In a second shell:

```sh
API=http://localhost:3000/api/v1
KEY=access-key-1
```

`access-key-1` is Olivia's legacy access key, which works as a bearer value
([Step 3](hosted-03.md#5-a-legacy-access-key-checklist-5)). Sections 1 and 6 each start a survey of their own. Sections 2 to 5 share
one survey and one shell: section 2 starts it and sets `$ID`, `$A`, `$B` and the `post` helper, and sections 3, 4 and 5
use them and the responses stored before. Run those four in order in the same shell. Section 6 starts another survey
and redefines `post` to print status codes. The demo keeps its data in memory: stop it with Ctrl+C and start it again for a
clean slate.

## 1. A partial save, then the complete response (checklist 1 and 2)

1. Make a survey with one question, and a client id:

   ```sh
   ID=$(curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"name":"Partial demo","definition":{"elements":[{"type":"text","name":"color"},{"type":"text","name":"score"}]}}' \
     "$API/surveys" | jq -r .id)
   CLIENT=demo-$RANDOM
   echo "$ID $CLIENT"
   ```

   - **Check:** a survey id and a client id are printed.

2. Save the first page as a partial response:

   ```sh
   curl -s -X POST -H "Content-Type: application/json" \
     -d "{\"data\":{\"color\":\"Red\"},\"clientId\":\"$CLIENT\",\"partial\":true,\"lastPageIndex\":0}" \
     "$API/public/surveys/$ID/responses"
   ```

   - **Check:** `201` with `{"id":"…"}`.

3. Look at the results and the numbers:

   ```sh
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[] | {id, data, partial}'
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/stats"
   curl -s "$API/public/surveys/$ID?clientId=$CLIENT" | jq .completed
   ```

   - **Check:** one response, `{"color":"Red"}`, with `"partial":true`. The statistics say `"count":0`.
     `completed` is `false`.

4. In the browser open **View Results** for "Partial demo" in the survey list (the "…" menu), on the **Table** tab.
   - **Check:** one row with `Red`, and a **Partial** column at the end (after **Submitted**, and after **IPAddress** when there is one) with **Yes**. The Summary tab
     charts nothing, and **Details** says **Total responses:** 0 (the page counts completed responses).

5. Save the second page, still partial, and look at the list again:

   ```sh
   curl -s -X POST -H "Content-Type: application/json" \
     -d "{\"data\":{\"color\":\"Red\",\"score\":3},\"clientId\":\"$CLIENT\",\"partial\":true,\"lastPageIndex\":1}" \
     "$API/public/surveys/$ID/responses"
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[] | {id, data, partial}'
   ```

   - **Check:** still **one** response, with the same `id` as before, now `{"color":"Red","score":3}`: two saves
     of one client read as one response.

6. Complete it:

   ```sh
   curl -s -X POST -H "Content-Type: application/json" \
     -d "{\"data\":{\"color\":\"Blue\",\"score\":4},\"clientId\":\"$CLIENT\"}" \
     "$API/public/surveys/$ID/responses"
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[] | {id, data, partial}'
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/stats"
   curl -s "$API/public/surveys/$ID?clientId=$CLIENT" | jq .completed
   ```

   - **Check:** still one response with the first `id`, the later answers winning (`Blue`, `4`) and no `partial`
     field. The statistics say `"count":1`; `completed` is `true`.

7. Reload the **Table** tab.
   - **Check:** one row, and no **Partial** column: the column is there only while a response is partial. **Details**
     says **Total responses:** 1.

## 2. A run split over two pages (`limit=1`)

1. A fresh survey, and two clients. Client A saves partially, client B completes, then client A completes:

   ```sh
   ID=$(curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"name":"Partial demo pages","definition":{"elements":[{"type":"text","name":"color"},{"type":"text","name":"score"}]}}' \
     "$API/surveys" | jq -r .id)
   A=demo-a-$RANDOM
   B=demo-b-$RANDOM
   post() { curl -s -X POST -H "Content-Type: application/json" -d "$1" "$API/public/surveys/$ID/responses" > /dev/null; }
   post "{\"data\":{\"color\":\"Red\"},\"clientId\":\"$A\",\"partial\":true}"
   post "{\"data\":{\"color\":\"Green\",\"score\":1},\"clientId\":\"$B\"}"
   post "{\"data\":{\"score\":5},\"clientId\":\"$A\"}"
   ```

2. Read the first page of one response:

   ```sh
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results?limit=1" | tee page1.json | jq -c '.items[] | {data, partial}'
   ```

   - **Check:** one response, `{"color":"Red","score":5}`, complete (no `partial`): the partial save and client A's
     completing post are one response, and it comes first because its first save came first. It is not repeated on the
     next page.

3. Read the second page:

   ```sh
   curl -s -G -H "Authorization: Bearer $KEY" --data-urlencode "cursor=$(jq -r .nextCursor page1.json)" \
     "$API/surveys/$ID/results?limit=1" | jq -c '.items[] | {data, partial}'
   rm page1.json
   ```

   - **Check:** one response, client B's `{"color":"Green","score":1}`. Nothing else, and no repeat of client A.

## 3. Complete answers stay separate

Continue with the survey of section 2.

1. Client A answers again completely, and then saves partially once more:

   ```sh
   post "{\"data\":{\"color\":\"Blue\",\"score\":2},\"clientId\":\"$A\"}"
   post "{\"data\":{\"color\":\"Yellow\"},\"clientId\":\"$A\",\"partial\":true}"
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[] | {data, partial}'
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/stats" | jq -c '{count}'
   ```

   - **Check:** four responses:

   | Response                 | `data`                        | `partial` |
   | ------------------------ | ----------------------------- | --------- |
   | Client A's first run     | `{"color":"Red","score":5}`   | none      |
   | Client B                 | `{"color":"Green","score":1}` | none      |
   | Client A's second answer | `{"color":"Blue","score":2}`  | none      |
   | Client A's partial save  | `{"color":"Yellow"}`          | `true`    |

   The statistics say `"count":3`. Two complete answers from one client stay two responses, and a partial save after
   completing starts a new response.

## 4. The CSV and JSON files

1. Download both while the last response is still partial:

   ```sh
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/export?format=csv" | tr -d '\r'
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/export?format=json" | jq -c '.[] | {data, partial}'
   ```

   - **Check:** the CSV header ends with `ClientId,Partial`, and the partial response has `true` in the last column
     (the others leave it empty). In the JSON the partial response has `"partial":true`; the others have no field.

2. Complete the partial one and export again:

   ```sh
   post "{\"data\":{\"color\":\"Yellow\",\"score\":9},\"clientId\":\"$A\"}"
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results/export?format=csv" | tr -d '\r' | head -1
   ```

   - **Check:** the header ends with `ClientId`: with no partial response there is no `Partial` column.

## 5. Posts the server refuses or stores as complete

1. A page index that is not a whole number of at least 0:

   ```sh
   curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" \
     -d "{\"data\":{},\"clientId\":\"$A\",\"partial\":true,\"lastPageIndex\":-1}" "$API/public/surveys/$ID/responses"
   ```

   - **Check:** `422`.

2. A partial post without a client id has nobody to resume, so it is stored as a complete response:

   ```sh
   curl -s -X POST -H "Content-Type: application/json" -d '{"data":{"color":"Grey"},"partial":true}' \
     "$API/public/surveys/$ID/responses"
   curl -s -H "Authorization: Bearer $KEY" "$API/surveys/$ID/results" | jq -c '.items[-1] | {data, partial}'
   ```

   - **Check:** `{"data":{"color":"Grey"}}`, no `partial`.

## 6. Limit to one response

1. A survey with the limit on (`cookieName`), and a client that saves partially twice and then completes:

   ```sh
   ID=$(curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
     -d '{"name":"Partial demo limit","definition":{"cookieName":"partial-demo","elements":[{"type":"text","name":"color"}]}}' \
     "$API/surveys" | jq -r .id)
   C=demo-c-$RANDOM
   post() { curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Content-Type: application/json" -d "$1" "$API/public/surveys/$ID/responses"; }
   post "{\"data\":{\"color\":\"Red\"},\"clientId\":\"$C\",\"partial\":true}"
   post "{\"data\":{\"color\":\"Red\"},\"clientId\":\"$C\",\"partial\":true}"
   post "{\"data\":{\"color\":\"Blue\"},\"clientId\":\"$C\"}"
   post "{\"data\":{\"color\":\"Green\"},\"clientId\":\"$C\",\"partial\":true}"
   ```

   - **Check:** `201`, `201`, `201`, then `409`. A partial marker does not stop the client; a complete one does,
     also for a partial post.

The conformance suite and the provider suite ([Testing](../testing.md)) check these rules against every provider.

## Nothing private

Run `pnpm scan:secrets`.

- **Check:** no leaks found. The docs hold only sample values.
