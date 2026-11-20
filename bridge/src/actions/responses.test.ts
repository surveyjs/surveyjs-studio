import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  send,
  startBridge,
  startStub,
  type RawResponse,
  type RunningBridge,
  type Stub,
} from "../testing/http.js";
import { DEFAULT_USER_ID, startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";
import { storedSurvey, type StoredResponse, type StoredSurvey } from "../testing/studio-surveys.js";
import { decodeToken, encodeToken } from "../tokens.js";

const JSON_UTF8 = "application/json; charset=utf-8";
const HTML_UTF8 = "text/html; charset=utf-8";
const OCTETS = "application/octet-stream";
const ZERO = "00000000-0000-0000-0000-000000000000";
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const ANN = DEFAULT_USER_ID;
const BOB = "b0b00000-0000-4000-8000-000000000002";
const KEY = "key-of-ann";
const BOB_KEY = "key-of-bob";
const PROJECT = "56ddd87e-e091-47cd-8edb-4843ee17829c";
const SURVEY = "f6f1c966-8d49-46d0-94d3-975c53b6577d";
const POST = "13f2e886-9c38-42f2-b814-d0900cf06a19";
const RESULT = "929d229c-9f78-40ec-aa47-0eea718a53b2";
const UNKNOWN = "99999999-0000-4000-8000-000000000009";

/** Response IDs: `id(1)` … */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** A stored response; `data` as JSON text so a test can send `1.0`. */
function response(
  n: number,
  submittedAt: string,
  data: string,
  extra: {
    clientId?: string;
    respondentIp?: string;
    partial?: boolean;
    laterSaveIds?: string[];
  } = {},
): StoredResponse {
  const { laterSaveIds, ...fields } = extra;
  const tail = Object.entries(fields)
    .map(([name, value]) => `,${JSON.stringify(name)}:${JSON.stringify(value)}`)
    .join("");
  return {
    text: `{"id":"${id(n)}","submittedAt":"${submittedAt}","data":${data}${tail}}`,
    ...(laterSaveIds !== undefined && { laterSaveIds }),
  };
}

/** `count` responses a day apart from 2026-01-01, `{"n":<i>}` each. */
function numbered(count: number): StoredResponse[] {
  return Array.from({ length: count }, (_, i) =>
    response(i + 1, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(), `{"n":${i}}`),
  );
}

function expectEmpty(answer: RawResponse, status: number): void {
  expect(answer.status).toBe(status);
  expect(answer.body.length).toBe(0);
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.headers.location).toBeUndefined();
}

function expectJson(answer: RawResponse, status: number, body: string): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBe(JSON_UTF8);
  expect(answer.body.toString()).toBe(body);
}

const getResults = (surveyId: string) =>
  JSON.stringify(`You are not authorized to get results of the survey ${surveyId}`);
const modify = (surveyId: string) =>
  JSON.stringify(`You are not authorized to modify the survey ${surveyId}`);

describe("the response actions", () => {
  let legacy: Stub;
  let studio: FakeStudio;
  let bridge: RunningBridge;

  beforeAll(async () => {
    legacy = await startStub((_request, res) => res.writeHead(200).end("old"));
    studio = await startFakeStudio();
    bridge = await startBridge({ studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url });
  });

  afterAll(async () => {
    await bridge.close();
    await studio.close();
    await legacy.close();
  });

  beforeEach(() => {
    studio.reset();
    legacy.requests.length = 0;
    studio.credentials.set(KEY, "legacy");
    studio.credentials.set(BOB_KEY, "token");
    studio.users.set(BOB_KEY, BOB);
    studio.store.memberships.set(ANN, new Map([[PROJECT, "admin"]]));
    studio.store.memberships.set(BOB, new Map([[PROJECT, "user"]]));
  });

  function add(fields: Partial<StoredSurvey> = {}): StoredSurvey {
    const survey = storedSurvey({
      ownerUserId: ANN,
      id: SURVEY,
      postId: POST,
      resultId: RESULT,
      name: "NPS",
      ...fields,
    });
    studio.store.surveys.set(survey.id, survey);
    return survey;
  }

  /** A request to `private/Surveys/<path>` with Ann's key (or `key`), `query` appended. */
  function call(
    method: string,
    path: string,
    query = "",
    options: { key?: string; headers?: [string, string][]; body?: string; prefix?: string } = {},
  ): Promise<RawResponse> {
    const key = options.key ?? KEY;
    const keyPart = key === "" ? "" : `accessKey=${encodeURIComponent(key)}`;
    const search = [keyPart, query].filter((part) => part !== "").join("&");
    return send(
      `${bridge.url}${options.prefix ?? "/private/Surveys"}/${path}${search === "" ? "" : `?${search}`}`,
      {
        method,
        ...(options.headers !== undefined && { headers: options.headers }),
        ...(options.body !== undefined && { body: options.body }),
      },
    );
  }

  const resultCalls = () =>
    studio.requests.filter((r) => r.url.includes("/results")).map((r) => `${r.method} ${r.url}`);

  describe("getSurveyResults without paging", () => {
    it("streams { Data, ResultCount } with every answer, the client, the IP and the run's ID", async () => {
      add({
        privateResultQuestions: ["secret"],
        responses: [
          response(1, "2026-10-05T06:48:57.517Z", '{"satisfaction":4,"secret":"x","score":1.0}', {
            clientId: "client-0001",
            respondentIp: "203.0.113.7",
            partial: true,
          }),
          response(2, "2026-10-06T08:00:01.12Z", '{"when":"2026-01-01T10:00:00.000Z"}'),
        ],
      });
      const answer = await call("GET", `getSurveyResults/${SURVEY}`);
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      expect(answer.body.toString()).toBe(
        '{"Data":[' +
          '{"satisfaction":4,"secret":"x","score":1.0,"HappendAt":"2026-10-05T06:48:57.517Z",' +
          `"IPAddress":"203.0.113.7","ClientId":"client-0001","InstanceId":"${id(1)}"},` +
          '{"when":"2026-01-01T10:00:00Z","HappendAt":"2026-10-06T08:00:01.12Z",' +
          `"InstanceId":"${id(2)}"}` +
          '],"ResultCount":2}',
      );
    });

    it("takes the ID from the route or the query, under both prefixes", async () => {
      add({ responses: numbered(1) });
      for (const [path, query, prefix] of [
        [`getSurveyResults/${SURVEY}`, "", "/private/Surveys"],
        ["getSurveyResults", `id=${SURVEY}`, "/private/v1/Surveys"],
        [`getSurveyResults/${SURVEY.toUpperCase()}/`, "", "/PRIVATE/SURVEYS"],
      ] as const) {
        const answer = await call("GET", path, query, { prefix });
        expect(answer.status, path).toBe(200);
        expect(JSON.parse(answer.body.toString()).ResultCount, path).toBe(1);
      }
    });

    it("reads every page Studio has", async () => {
      add({ responses: numbered(5) });
      studio.store.resultPageSize = 2;
      const answer = await call("GET", `getSurveyResults/${SURVEY}`);
      const body = JSON.parse(answer.body.toString()) as {
        Data: { n: number }[];
        ResultCount: number;
      };
      expect(body.Data.map((row) => row.n)).toEqual([0, 1, 2, 3, 4]);
      expect(body.ResultCount).toBe(5);
      expect(resultCalls()).toHaveLength(3);
    });

    it("sends from and till to Studio as UTC times, and drops malformed ones", async () => {
      add({ responses: numbered(3) });
      await call(
        "GET",
        `getSurveyResults/${SURVEY}`,
        "from=2026-01-01T00:00:30%2B00:00&till=nonsense",
      );
      const url = new URL(studio.requests.at(-1)!.url, "http://studio");
      expect(url.searchParams.get("from")).toBe("2026-01-01T00:00:30Z");
      expect(url.searchParams.has("till")).toBe(false);
    });

    it("answers a survey the caller cannot see, or an unknown or malformed ID, with the old refusal", async () => {
      add({ ownerUserId: BOB, creatorId: BOB });
      expectJson(await call("GET", `getSurveyResults/${SURVEY}`), 400, getResults(SURVEY));
      expectJson(await call("GET", `getSurveyResults/${UNKNOWN}`), 400, getResults(UNKNOWN));
      expectJson(await call("GET", "getSurveyResults/nps"), 400, getResults(ZERO));
    });

    it("answers a wrong or revoked key with an empty 401", async () => {
      add();
      expectEmpty(await call("GET", `getSurveyResults/${SURVEY}`, "", { key: "wrong" }), 401);
      expectEmpty(await call("GET", `getSurveyResults/${SURVEY}`, "", { key: "" }), 401);
    });

    it("waits out Studio's 429 on a later page within the same answer", async () => {
      add({ responses: numbered(3) });
      studio.store.resultPageSize = 1;
      let limited = 0;
      studio.override = (request, res) => {
        if (!request.url.includes("cursor=") || limited > 0) return false;
        limited += 1;
        res.writeHead(429, { "retry-after": "1" }).end();
        return true;
      };
      const answer = await call("GET", `getSurveyResults/${SURVEY}`);
      expect(JSON.parse(answer.body.toString()).ResultCount).toBe(3);
      expect(limited).toBe(1);
    });

    it("passes Studio's 429 on the first page on as an empty 429", async () => {
      add({ responses: numbered(3) });
      studio.override = (request, res) => {
        if (!request.url.includes("/results")) return false;
        res.writeHead(429, { "retry-after": "30" }).end();
        return true;
      };
      expectEmpty(await call("GET", `getSurveyResults/${SURVEY}`), 429);
    });
  });

  describe("getSurveyResults with paging", () => {
    type Paged = { ContinuationToken: string | null; ResultCount: number; Data: { n: number }[] };
    const paged = async (query: string): Promise<Paged> => {
      const answer = await call("GET", `getSurveyResults/${SURVEY}`, query);
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      return JSON.parse(answer.body.toString()) as Paged;
    };

    it("answers { ContinuationToken, ResultCount, Data } in that order, and pages to the end", async () => {
      add({ responses: numbered(5) });
      const answer = await call("GET", `getSurveyResults/${SURVEY}`, "take=2");
      expect(answer.body.toString()).toMatch(
        /^\{"ContinuationToken":"[^"]+","ResultCount":2,"Data":\[/,
      );
      const first = JSON.parse(answer.body.toString()) as Paged;
      expect(first.Data.map((row) => row.n)).toEqual([0, 1]);
      const second = await paged(
        `take=2&continuationToken=${encodeURIComponent(first.ContinuationToken!)}`,
      );
      expect(second.Data.map((row) => row.n)).toEqual([2, 3]);
      const third = await paged(
        `take=2&continuationToken=${encodeURIComponent(second.ContinuationToken!)}`,
      );
      expect(third).toEqual({
        ContinuationToken: null,
        ResultCount: 1,
        Data: [expect.objectContaining({ n: 4 })],
      });
    });

    it("answers the last full page with no token", async () => {
      add({ responses: numbered(4) });
      const first = await paged("take=2");
      const last = await paged(
        `take=2&continuationToken=${encodeURIComponent(first.ContinuationToken!)}`,
      );
      expect(last.ContinuationToken).toBeNull();
      expect(last.ResultCount).toBe(2);
    });

    it("gives rows with the run's ID, as without paging", async () => {
      add({ responses: [response(7, "2026-10-05T06:48:57.517Z", '{"a":1}', { clientId: "c" })] });
      const answer = await call("GET", `getSurveyResults/${SURVEY}`, "take=1");
      expect(answer.body.toString()).toBe(
        '{"ContinuationToken":null,"ResultCount":1,"Data":[{"a":1,"HappendAt":"2026-10-05T06:48:57.517Z",' +
          `"ClientId":"c","InstanceId":"${id(7)}"}]}`,
      );
    });

    it("takes a page of 1 to 1,000: take=0 or below is 1, more than 1,000 is 1,000, a token alone 1,000", async () => {
      add({ responses: numbered(3) });
      expect((await paged("take=0")).ResultCount).toBe(1);
      expect((await paged("take=-4")).ResultCount).toBe(1);
      expect((await paged("take=+2")).ResultCount).toBe(2);
      studio.requests.length = 0;
      expect((await paged("take=5000")).ResultCount).toBe(3);
      expect(new URL(studio.requests.at(-1)!.url, "http://s").searchParams.get("limit")).toBe(
        "1000",
      );
      expect((await paged("continuationToken=0")).ResultCount).toBe(3);
    });

    it("streams the whole survey for a take that is no number and no token", async () => {
      add({ responses: numbered(2) });
      for (const query of ["take=abc", "take=", "continuationToken=", "take=99999999999"]) {
        const answer = await call("GET", `getSurveyResults/${SURVEY}`, query);
        expect(answer.body.toString(), query).toMatch(/^\{"Data":\[/);
      }
    });

    it("continues an old offset token where it points (Review Focus 1)", async () => {
      add({ responses: numbered(1003) });
      const page = await paged("take=2&continuationToken=1000");
      expect(page.Data.map((row) => row.n)).toEqual([1000, 1001]);
      expect(page.ContinuationToken).not.toBeNull();
      const next = await paged(
        `take=2&continuationToken=${encodeURIComponent(page.ContinuationToken!)}`,
      );
      expect(next).toEqual({
        ContinuationToken: null,
        ResultCount: 1,
        Data: [expect.objectContaining({ n: 1002 })],
      });
    });

    it("starts again at the first page for an old storage token, without a 400 (Review Focus 1)", async () => {
      add({ responses: numbered(3) });
      const page = await paged(
        `take=2&continuationToken=${encodeURIComponent("1!4!Kg-- 1!48!MDA5MTEy")}`,
      );
      expect(page.Data.map((row) => row.n)).toEqual([0, 1]);
    });

    it("starts again at the first page for a token of another survey", async () => {
      add({ responses: numbered(3) });
      const foreign = encodeToken(`${UNKNOWN}~1`, 0);
      const page = await paged(`take=2&continuationToken=${encodeURIComponent(foreign)}`);
      expect(page.Data.map((row) => row.n)).toEqual([0, 1]);
    });

    it("keeps its place inside one of Studio's pages", async () => {
      add({ responses: numbered(5) });
      studio.store.resultPageSize = 3;
      const first = await paged("take=2");
      expect(decodeToken(first.ContinuationToken!).offset).toBe(2);
      const second = await paged(
        `take=2&continuationToken=${encodeURIComponent(first.ContinuationToken!)}`,
      );
      expect(second.Data.map((row) => row.n)).toEqual([2, 3]);
      const third = await paged(
        `take=2&continuationToken=${encodeURIComponent(second.ContinuationToken!)}`,
      );
      expect(third.Data.map((row) => row.n)).toEqual([4]);
      expect(third.ContinuationToken).toBeNull();
    });

    it("applies from and till and counts the offset within them", async () => {
      add({ responses: numbered(6) });
      const page = await paged("take=2&continuationToken=1&from=2026-01-01T00:01:30Z");
      expect(page.Data.map((row) => row.n)).toEqual([3, 4]);
    });

    it("waits out Studio's 429 while it walks to the offset", async () => {
      add({ responses: numbered(4) });
      studio.store.resultPageSize = 1;
      let limited = 0;
      studio.override = (request, res) => {
        if (!request.url.includes("cursor=") || limited > 0) return false;
        limited += 1;
        res.writeHead(429, { "retry-after": "1" }).end();
        return true;
      };
      const page = await paged("take=1&continuationToken=2");
      expect(page.Data.map((row) => row.n)).toEqual([2]);
      expect(limited).toBe(1);
    });

    it("answers an unknown survey with the old refusal", async () => {
      expectJson(
        await call("GET", `getSurveyResults/${UNKNOWN}`, "take=5"),
        400,
        getResults(UNKNOWN),
      );
    });
  });

  describe("getSurveyDemoResults", () => {
    it("answers { ResultCount, Data } of the first 1,000 responses, with full rows", async () => {
      add({ responses: numbered(1001) });
      const answer = await call("GET", `getSurveyDemoResults/${SURVEY}`);
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      const text = answer.body.toString();
      expect(text).toMatch(
        /^\{"ResultCount":1000,"Data":\[\{"n":0,"HappendAt":"2026-01-01T00:00:00Z","InstanceId":"/,
      );
      expect((JSON.parse(text) as { Data: unknown[] }).Data).toHaveLength(1000);
      expect(resultCalls()).toHaveLength(1);
    });

    it("applies from and till to those 1,000 only, as the old API did", async () => {
      add({ responses: numbered(1003) });
      const answer = await call(
        "GET",
        `getSurveyDemoResults/${SURVEY}`,
        "from=2026-01-01T16:37:00Z",
      );
      const body = JSON.parse(answer.body.toString()) as {
        ResultCount: number;
        Data: { n: number }[];
      };
      // Rows 998 and 999 are after the bound within the first 1,000; 1000 to 1002 are never read.
      expect(body.Data.map((row) => row.n)).toEqual([998, 999]);
      const url = new URL(studio.requests.at(-1)!.url, "http://s");
      expect(url.searchParams.has("from")).toBe(false);
    });

    it("answers a bad key with the old text, the key HTML-encoded", async () => {
      add();
      const answer = await call("GET", `getSurveyDemoResults/${SURVEY}`, "", { key: "<b>" });
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(HTML_UTF8);
      expect(answer.body.toString()).toBe("The accessKey '&lt;b&gt;' is incorrect.");
    });

    it("answers a survey the caller cannot see with the old refusal", async () => {
      expectJson(
        await call("GET", "getSurveyDemoResults", `id=${UNKNOWN}`),
        400,
        getResults(UNKNOWN),
      );
    });
  });

  describe("exportSurveyResults", () => {
    const DEFINITION = JSON.stringify({
      pages: [
        {
          name: "page1",
          elements: [
            {
              type: "text",
              name: "q1",
              title: { default: "Your name", de: "Ihr Name" },
              hasComment: true,
            },
            { type: "text", name: "secret", title: "Secret", valueName: "hidden" },
            { type: "boolean", name: "ok" },
          ],
        },
      ],
    });

    function addExportSurvey(fields: Partial<StoredSurvey> = {}): StoredSurvey {
      return add({
        definition: DEFINITION,
        storeRespondentIp: true,
        privateResultQuestions: ["secret", "q1"],
        responses: [
          response(
            1,
            "2026-10-05T06:48:57.517Z",
            '{"q1":"Ann, \\"A\\"","q1-Comment":"note","ok":true}',
            {
              clientId: "client-1",
              respondentIp: "203.0.113.7",
            },
          ),
          response(2, "2026-10-06T18:00:01.12Z", '{"hidden":"x","ok":false,"extra":[1,2]}'),
        ],
        ...fields,
      });
    }

    const exportOf = (query: string) => call("GET", `exportSurveyResults/${SURVEY}`, query);

    it("writes CSV for format=csv: every column, newest first, en-US texts, quoted where needed", async () => {
      addExportSurvey();
      const answer = await exportOf("format=csv");
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(OCTETS);
      expect(answer.headers["content-disposition"]).toBe(
        "attachment; filename=NPS.csv; filename*=UTF-8''NPS.csv",
      );
      expect(answer.headers["content-length"]).toBe(String(answer.body.length));
      expect(answer.body.subarray(0, 3)).toEqual(BOM);
      expect(answer.body.subarray(3).toString("utf8")).toBe(
        // Unknown names first (the answer of "secret" is stored as "hidden"), in the order the
        // newest responses gave them; then each by its question's place.
        'Submitted,IPAddress,hidden,extra,Client Id,Your name,"-Comment\nYour name",ok\r\n' +
          '10/6/2026 6:00:01 PM +00:00,,x,"[1,2]",,,,False\r\n' +
          '10/5/2026 6:48:57 AM +00:00,203.0.113.7,,,client-1,"Ann, ""A""",note,True\r\n',
      );
    });

    it("takes the titles in the localeName's language", async () => {
      addExportSurvey();
      const header = async (query: string) =>
        (await exportOf(query)).body.subarray(3).toString("utf8").split("\r\n")[0];
      expect(await header("format=csv&localeName=de")).toContain(",Ihr Name,");
      expect(await header("format=csv&localeName=")).toContain(",Your name,");
    });

    it("orders the CSV's columns as the shared columns layout has them", async () => {
      addExportSurvey({
        layouts: {
          columns: '{"columns":[{"name":"ok","displayname":"Fine?"},{"name":"HappendAt"}]}',
        },
      });
      const lines = (await exportOf("format=csv")).body.subarray(3).toString("utf8").split("\r\n");
      expect(lines[0]).toBe(
        'Fine?,Submitted,IPAddress,hidden,extra,Client Id,Your name,"-Comment\nYour name"',
      );
    });

    it("is the BOM alone for a survey without responses", async () => {
      addExportSurvey({ responses: [] });
      const answer = await exportOf("format=csv");
      expect(answer.body).toEqual(BOM);
      expect(answer.headers["content-length"]).toBe("3");
    });

    it("answers a layout the old calculation could not read with an empty 400", async () => {
      addExportSurvey({ layouts: { columns: "[1]" } });
      expectEmpty(await exportOf("format=csv"), 400);
    });

    it("writes JSON for any other format: public columns, no instance IDs, oldest first, no BOM", async () => {
      addExportSurvey();
      for (const query of ["format=json", "format=CSV", "format=xlsx", ""]) {
        const answer = await exportOf(query);
        expect(answer.status, query).toBe(200);
        expect(answer.headers["content-type"], query).toBe(OCTETS);
        expect(answer.headers["content-disposition"], query).toBe(
          "attachment; filename=NPS.json; filename*=UTF-8''NPS.json",
        );
        expect(answer.body.toString("utf8"), query).toBe(
          '{"ResultCount":2,"Data":[' +
            '{"ok":true,"HappendAt":"2026-10-05T06:48:57.517Z","IPAddress":"203.0.113.7",' +
            '"ClientId":"client-1","InstanceId":null},' +
            '{"ok":false,"extra":[1,2],"HappendAt":"2026-10-06T18:00:01.12Z","InstanceId":null}]}',
        );
      }
    });

    it("ignores from and till", async () => {
      addExportSurvey();
      const answer = await exportOf("format=json&from=2026-10-06T00:00:00Z");
      expect(JSON.parse(answer.body.toString()).ResultCount).toBe(2);
    });

    it("names the file after the survey, non-ASCII as _ in the plain name", async () => {
      addExportSurvey({ name: "Опрос 1" });
      expect((await exportOf("format=csv")).headers["content-disposition"]).toBe(
        "attachment; filename=\"_____ 1.csv\"; filename*=UTF-8''%D0%9E%D0%BF%D1%80%D0%BE%D1%81%201.csv",
      );
    });

    it("answers a bad key with the old text and an unknown survey with the old refusal", async () => {
      addExportSurvey();
      const bad = await call("GET", `exportSurveyResults/${SURVEY}`, "format=csv", {
        key: "wrong",
      });
      expect(bad.headers["content-type"]).toBe(HTML_UTF8);
      expect(bad.body.toString()).toBe("The accessKey 'wrong' is incorrect.");
      expectJson(
        await call("GET", "exportSurveyResults", `id=${UNKNOWN}&format=csv`),
        400,
        getResults(UNKNOWN),
      );
    });
  });

  describe("deleteResult", () => {
    it("deletes the whole run named by a later save's InstanceId; the client is no longer completed (Review Focus 5)", async () => {
      const survey = add({
        responses: [
          response(1, "2026-10-05T06:48:57.517Z", '{"a":1}', {
            clientId: "client-1",
            laterSaveIds: [id(11), id(12)],
          }),
          response(2, "2026-10-06T06:48:57.517Z", '{"b":2}'),
        ],
      });
      studio.resultIds.set(RESULT, SURVEY);
      studio.states.set(`${SURVEY}/client-1`, "completed");
      const isCompleted = async () =>
        JSON.parse(
          (
            await send(
              `${bridge.url}/public/Survey/isCompleted?resultId=${RESULT}&clientId=client-1`,
            )
          ).body.toString(),
        ) as string;
      expect(await isCompleted()).toBe("completed");
      studio.requests.length = 0;

      const answer = await call("DELETE", "deleteResult", `postId=${POST}&instanceId=${id(12)}`);
      expect(answer.status).toBe(200);
      expect(answer.body.length).toBe(0);
      expect(answer.headers["content-type"]).toBeUndefined();
      expect(resultCalls()).toEqual([`DELETE /api/v1/surveys/${SURVEY}/results/${id(12)}`]);
      expect(survey.responses.map((r) => JSON.parse(r.text).id)).toEqual([id(2)]);
      expect(await isCompleted()).toBe("no");
    });

    it("answers an unknown InstanceId with an empty 200, as the old API", async () => {
      add({ responses: numbered(1) });
      expectEmpty(
        await call("DELETE", "deleteResult", `postId=${POST}&instanceId=${UNKNOWN}`),
        200,
      );
      expectEmpty(await call("DELETE", "deleteResult", `postId=${POST}`), 200);
    });

    it("takes postId and instanceId from a form body", async () => {
      const survey = add({ responses: numbered(2) });
      const body = `postId=${POST}&instanceId=${id(1)}`;
      // Node sends a DELETE body unframed unless it is given a length.
      const answer = await call("DELETE", "deleteResult", "", {
        headers: [
          ["Content-Type", "application/x-www-form-urlencoded"],
          ["Content-Length", String(body.length)],
        ],
        body,
      });
      expectEmpty(answer, 200);
      expect(survey.responses).toHaveLength(1);
    });

    it("answers an unknown post ID, or a survey the caller may not change, with the old refusal naming the post ID", async () => {
      expectJson(
        await call("DELETE", "deleteResult", `postId=${UNKNOWN}&instanceId=${id(1)}`),
        400,
        modify(UNKNOWN),
      );
      expectJson(await call("DELETE", "deleteResult", "instanceId=x"), 400, modify(ZERO));
      const survey = add({ projectId: PROJECT, creatorId: ANN, responses: numbered(1) });
      expectJson(
        await call("DELETE", "deleteResult", `postId=${POST}&instanceId=${id(1)}`, {
          key: BOB_KEY,
        }),
        400,
        modify(POST),
      );
      expect(survey.responses).toHaveLength(1);
    });

    it("answers a wrong key with an empty 401 and no route with an id", async () => {
      add();
      expectEmpty(await call("DELETE", "deleteResult", `postId=${POST}`, { key: "wrong" }), 401);
      const routed = await call("DELETE", `deleteResult/${POST}`);
      expect(routed.body.toString()).toBe("old");
    });
  });

  describe("deleteAllResults", () => {
    it("deletes every response and answers an empty 200, the ID from the route or the query", async () => {
      const survey = add({ responses: numbered(3) });
      expectEmpty(await call("DELETE", `deleteAllResults/${SURVEY}`), 200);
      expect(survey.responses).toEqual([]);
      survey.responses = numbered(1);
      expectEmpty(
        await call("DELETE", "deleteAllResults", `id=${SURVEY}`, { prefix: "/private/v1/Surveys" }),
        200,
      );
      expect(survey.responses).toEqual([]);
    });

    it("answers a survey the caller may not change, or an unknown one, with the old refusal", async () => {
      const survey = add({ projectId: PROJECT, creatorId: ANN, responses: numbered(1) });
      expectJson(
        await call("DELETE", `deleteAllResults/${SURVEY}`, "", { key: BOB_KEY }),
        400,
        modify(SURVEY),
      );
      expect(survey.responses).toHaveLength(1);
      expectJson(await call("DELETE", `deleteAllResults/${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("answers a wrong key with an empty 401", async () => {
      expectEmpty(await call("DELETE", `deleteAllResults/${SURVEY}`, "", { key: "wrong" }), 401);
    });
  });
});
