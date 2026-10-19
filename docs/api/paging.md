# Paging

The list operations (`listSurveys`, `listProjects`, `listSurveyHistory` and `listResults`) return one page
at a time. They use opaque cursors, not page numbers.

## Request and response

| Query parameter | Meaning                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limit`         | The most items in one page. Surveys, projects and history: 1 to 200, default 50. `listResults`: 1 to 1000, default 500. Out of range: `400 bad-request` |
| `cursor`        | The `nextCursor` of the previous page. Leave it out for the first page                                                                                  |

```json
{
  "items": [ ... ],
  "nextCursor": "eyJ2IjoxLCJrIjoic3VydmV5cyIs..."
}
```

- `nextCursor` is `null` on the last page. Stop there.
- Pass `nextCursor` back unchanged as `cursor` to get the next page.
- A page can be **shorter than `limit` while more items follow**. A server may skip records it cannot
  represent (for example a legacy row with missing data), and the page then has fewer items. Only a
  `null` `nextCursor` means the end; never stop because a page is short.
- An item is never repeated across pages. Records that the server cannot represent are left out of
  every page, not only of one.

## A cursor belongs to one list

A `listSurveys` cursor is only valid for the same `project` and `archived` values as the request that
returned it. Using it with another project, or with the other archived state, is
`400 bad-request` with the detail "Invalid cursor.". Start again without a cursor when you change
the list.

A cursor that is damaged, too long (over 1024 characters), or made by hand is `400 bad-request`
too. So is a `limit` outside the range of the operation.

## Stable while the list changes

A cursor marks a **place** in the list, not a number of items to skip. The lists are ordered by
`updatedAt`, newest first, then by `id`. Creating a survey while someone pages through the list
therefore does not move the pages after the cursor: the new survey sits at the top and shows up on
the next walk from the start, and no item is shown twice. A survey that is **changed** during the
walk moves to the top, so a client that has already passed its old place does not see it again until
it starts over.

`listProjects` orders by project name ignoring case, then by id, and its cursors work the same way.

## Results: oldest first, one survey

`listResults` (`GET /surveys/{surveyId}/results`) pages through the responses of one survey.

- **Oldest first.** Items are ordered by `submittedAt` ascending, then by `id`. The order does not change
  when responses arrive: **new responses land at the end**. A walk that is under way sees a response that
  arrives later at the end of the walk, exactly once. A response that is older than the cursor's place
  (a clock that is behind) shows up only on the next walk from the start.
- **A cursor belongs to one survey.** Using a results cursor with another survey is `400 bad-request`
  ("Invalid cursor."). Start without a cursor for each survey.
- **One stored row is one item.** The server does not merge the rows of one client into one response, and
  `getResultStats` counts rows the same way. Nothing is dropped except a row the server cannot represent
  (see the note about short pages above).
- `limit` is 1 to 1000, default 500. The results page of the web app asks for 1000 at a time and walks to
  the end. There is no cap on the total (the old page stopped at 1,000 responses).

**Cost on the old site's stores.** The `azure-legacy` provider cannot ask Azure Tables for submission
order: the row keys are random GUIDs. Each page therefore reads the survey's rows from the cursor's time
on (a filter on the stored time), sorts them in memory and keeps the first `limit`. A page costs about as
much as the rows that are **not yet paged**, so a walk over a very large survey reads a rising number of
rows page by page (the first page reads them all). A larger `limit` means fewer pages and less total work.
An index that avoids this later can replace it behind the same operation
([legacy data layout, gap 8](../architecture/legacy-data-layout.md#11-gaps-and-open-questions)). The memory
provider keeps its rows sorted and has no such cost.

## Example

Sign in first (see [Authentication](authentication.md); the cookie jar `cookies.txt` holds `msid`).
Reads need no CSRF header. This walks the owner's active personal surveys two at a time:

```sh
BASE=http://localhost:3000/api/v1
curl -s -b cookies.txt "$BASE/surveys?limit=2"
# {"items":[{...API created...},{...Customer feedback...}],"nextCursor":"eyJ2Ijox..."}
```

Pass the `nextCursor` back as `cursor`:

```sh
curl -s -b cookies.txt "$BASE/surveys?limit=2&cursor=eyJ2Ijox..."
# {"items":[{...Draft idea...}],"nextCursor":null}
```

`nextCursor` is `null`, so that was the last page. A loop in the shell, using `jq`:

```sh
cursor=""
while : ; do
  page=$(curl -s -b cookies.txt "$BASE/surveys?limit=50${cursor:+&cursor=$cursor}")
  echo "$page" | jq -r '.items[].name'
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done
```

For a project or the archived list, add `project=<project id>` or `archived=true` to every request
of the walk, including the first.

### Walk the results of a large survey

The demo data holds a survey "API created" with 1,500 generated responses
(`22222222-0000-4000-8000-a00000000008`, Olivia Owner's). Signed in as Olivia, count them page by page,
1000 at a time:

```sh
SURVEY=22222222-0000-4000-8000-a00000000008
total=0
cursor=""
while : ; do
  page=$(curl -s -b cookies.txt "$BASE/surveys/$SURVEY/results?limit=1000${cursor:+&cursor=$cursor}")
  n=$(echo "$page" | jq '.items | length')
  echo "page of $n"
  total=$((total + n))
  cursor=$(echo "$page" | jq -r '.nextCursor // empty')
  [ -z "$cursor" ] && break
done
echo "total $total"
# page of 1000
# page of 500
# total 1500
```

The first page has `1000` items and a `nextCursor`; the second has `500` and `"nextCursor": null`. Each item
is `{ id, submittedAt, data, clientId?, respondentIp? }`, oldest first. The cursor works only for this
survey. Without `limit`, a page holds 500.

## For ports: the reference cursor format

This section is for people who write another back end. **Clients must not parse cursors**: the
format is not part of the contract, and any server may use another. A port is free to choose its
own, as long as it keeps the behaviour above. The reference server (`server/src/paging/cursor.ts`)
builds a cursor as the **base64url encoding, without padding, of a UTF-8 JSON object**:

| List     | JSON payload                                                                      |
| -------- | --------------------------------------------------------------------------------- |
| Surveys  | `{"v":1,"k":"surveys","p":"<scope>","a":<archived>,"u":"<updatedAt>","i":"<id>"}` |
| Projects | `{"v":1,"k":"projects","n":"<lower-cased name>","i":"<id>"}`                      |
| History  | `{"v":1,"k":"history","u":"<at>","i":"<entry id>"}`                               |
| Results  | `{"v":1,"k":"results","s":"<survey id>","u":"<submittedAt>","i":"<id>"}`          |

| Member | Meaning                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `v`    | Format version, `1`                                                                                                                   |
| `k`    | The kind of list: `surveys`, `projects`, `history` or `results`                                                                       |
| `p`    | Surveys: `personal`, or the lower-case project id                                                                                     |
| `a`    | Surveys: the `archived` flag of the request, `true` or `false`                                                                        |
| `s`    | Results: the lower-case id of the survey the cursor belongs to                                                                        |
| `u`    | Surveys: `updatedAt`; history: `at`; results: `submittedAt` of the last item of the page (ISO 8601 UTC, as `Date#toISOString` writes) |
| `i`    | The id of the last item of the page (for history, the entry id), lower case, 1 to 64 characters                                       |
| `n`    | Projects: the name of the last item, lower-cased                                                                                      |

A decoder also rejects a timestamp `u` whose year is not four digits between 1753 and 9999 (the range of
SQL `datetime`), so the answer is `400` and not a database error.

Members are written in the order shown, with no spaces. Example (the owner's active personal list,
after "Customer feedback"):

```text
{"v":1,"k":"surveys","p":"personal","a":false,"u":"2026-04-14T15:30:00.000Z","i":"22222222-0000-4000-8000-a00000000001"}
eyJ2IjoxLCJrIjoic3VydmV5cyIsInAiOiJwZXJzb25hbCIsImEiOmZhbHNlLCJ1IjoiMjAyNi0wNC0xNFQxNTozMDowMC4wMDBaIiwiaSI6IjIyMjIyMjIyLTAwMDAtNDAwMC04MDAwLWEwMDAwMDAwMDAwMSJ9
```

The reference server rejects a cursor with `400 bad-request` ("Invalid cursor.") when it:

- is longer than 1024 characters, is not base64url, or is not a JSON object;
- has another `v` or `k`, or a missing or wrongly typed member;
- has a `u` that is not an ISO 8601 UTC timestamp written as `Date#toISOString` writes it;
- has an empty `i`, or an `i` longer than 64 characters;
- belongs to another list: `p` or `a` differ from the request's `project` and `archived`, or `s` is not the
  survey of the request;
- is not the **canonical** encoding: a value that does not encode back to itself (padding, extra
  members, spaces, upper-case ids, loose timestamps) is invalid.

After the position, the next page holds the items that come later in list order. For surveys that
means `updatedAt` older than `u`, or equal to `u` with an `id` greater than `i` (code-point order). For
results it means `submittedAt` later than `u`, or equal to `u` with an `id` greater than `i`.
The store itself keeps no state between requests.
