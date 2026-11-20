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

const JSON_UTF8 = "application/json; charset=utf-8";
const FORM = "application/x-www-form-urlencoded";
const ZERO = "00000000-0000-0000-0000-000000000000";

const ANN = DEFAULT_USER_ID;
const BOB = "b0b00000-0000-4000-8000-000000000002";
const KEY = "key-of-ann";
const BOB_KEY = "key-of-bob";
const PROJECT = "56ddd87e-e091-47cd-8edb-4843ee17829c";
const SURVEY = "f6f1c966-8d49-46d0-94d3-975c53b6577d";
const UNKNOWN = "99999999-0000-4000-8000-000000000009";

const DEFINITION = {
  pages: [
    {
      name: "page1",
      elements: [
        { type: "text", name: "q1", title: { default: "Name", de: "Name (de)" } },
        { type: "text", name: "q2", title: { default: "Age", de: "Alter" } },
      ],
    },
  ],
};

/** A stored response; `data` as JSON text. */
function response(
  n: number,
  submittedAt: string,
  data: string,
  extra: { clientId?: string; respondentIp?: string } = {},
): StoredResponse {
  const tail = Object.entries(extra)
    .map(([name, value]) => `,${JSON.stringify(name)}:${JSON.stringify(value)}`)
    .join("");
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { text: `{"id":"${id}","submittedAt":"${submittedAt}","data":${data}${tail}}` };
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

/** The answer of a layout read: the text as a JSON string. */
const layoutAnswer = (text: string) => JSON.stringify(text);

const modify = (surveyId: string) =>
  JSON.stringify(`You are not authorized to modify the survey ${surveyId}`);
const getResults = (surveyId: string) =>
  JSON.stringify(`You are not authorized to get results of the survey ${surveyId}`);
const summaryState = (surveyId: string) =>
  JSON.stringify(`You are not authorized to get summary state of the survey ${surveyId}`);

/** A column as the old answer wrote it. */
const column = (
  Name: string,
  DisplayName: string | null,
  fields: { DataType?: number; Visibility?: number; Location?: number } = {},
) => ({
  Name,
  DisplayName,
  DataType: fields.DataType ?? 0,
  Visibility: fields.Visibility ?? 0,
  Location: fields.Location ?? 0,
  Id: ZERO,
});

describe("the results layout actions", () => {
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
      name: "NPS",
      definition: JSON.stringify(DEFINITION),
      ...fields,
    });
    studio.store.surveys.set(survey.id, survey);
    return survey;
  }

  /** A request to `private/Surveys/<path>` with Ann's key (or `key`; `null`: none), `query` appended. */
  function call(
    method: string,
    path: string,
    query = "",
    options: {
      key?: string | null;
      headers?: [string, string][];
      body?: string;
      prefix?: string;
    } = {},
  ): Promise<RawResponse> {
    const key = options.key === undefined ? KEY : options.key;
    const keyPart = key === null ? "" : `accessKey=${encodeURIComponent(key)}`;
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

  /** A `PUT` with a JSON body (or `contentType`). */
  const put = (path: string, body: string, contentType = "application/json", key?: string) =>
    call("PUT", path, "", {
      ...(key !== undefined && { key }),
      headers: [["content-type", contentType]],
      body,
    });

  const state = (id: string, json: string | null) =>
    JSON.stringify({ Id: id, ...(json !== null && { Json: json }) });

  const writes = () =>
    studio.requests.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.url}`);

  describe.each([
    ["getResultTableState", "table"],
    ["getResultSummaryState", "summary"],
  ] as const)("%s", (action, kind) => {
    it("answers JSON null without a layout", async () => {
      add();
      expectJson(await call("GET", `${action}/${SURVEY}`), 200, "null");
    });

    it("answers the stored text verbatim, as a JSON string, with no private question", async () => {
      const text =
        '{ "pageSize" : 25,\n "elements":[{"name":"q1","at":"2026-01-01T10:00:00.000Z"}] }';
      add({ layouts: { [kind]: text } });
      expectJson(await call("GET", `${action}/${SURVEY}`), 200, layoutAnswer(text));
    });

    it("rewrites the old visibility numbers as text, and only their exact forms", async () => {
      add({
        layouts: {
          [kind]:
            '{"elements":[{"name":"a","visibility":0},{"name":"b","visibility":"1"},' +
            '{"name":"c","visibility":2},{"name":"d","visibility": 2}]}',
        },
      });
      expectJson(
        await call("GET", `${action}/${SURVEY}`),
        200,
        layoutAnswer(
          '{"elements":[{"name":"a","isVisible":true,"isPublic":true},' +
            '{"name":"b","isVisible":false,"isPublic":true},' +
            '{"name":"c","isVisible":true,"isPublic":false},{"name":"d","visibility": 2}]}',
        ),
      );
    });

    it("marks each element private or public by the private questions, compact, dates as stored", async () => {
      add({
        privateResultQuestions: ["q1"],
        layouts: {
          [kind]:
            '{ "pageSize": 25, "elements": [ {"name":"q1","isPublic":true,"w":1.0},' +
            ' {"name":"q2","at":"2026-01-01T10:00:00.000Z"}, {"name":"q3","isPublic":false} ] }',
        },
      });
      expectJson(
        await call("GET", `${action}/${SURVEY}`),
        200,
        layoutAnswer(
          '{"pageSize":25,"elements":[{"name":"q1","isPublic":false,"w":1.0},' +
            '{"name":"q2","at":"2026-01-01T10:00:00.000Z","isPublic":true},' +
            '{"name":"q3","isPublic":true}]}',
        ),
      );
    });

    it("answers an empty 400 for a layout the old code could not combine with private questions", async () => {
      for (const text of [
        '{"elements":[{"name":"q1"},{"title":"no name"}]}',
        '{"pageSize":25}',
        '{"elements":{"name":"q1"}}',
        '{"elements":[1]}',
        "[1,2]",
        "not json",
      ]) {
        add({ privateResultQuestions: ["q1"], layouts: { [kind]: text } });
        expectEmpty(await call("GET", `${action}/${SURVEY}`), 400);
      }
    });

    it("takes the ID from the route or the query, under both prefixes", async () => {
      add({ layouts: { [kind]: '{"pageSize":25}' } });
      for (const [path, query, prefix] of [
        [`${action}/${SURVEY}`, "", "/private/Surveys"],
        [action, `id=${SURVEY}`, "/private/v1/Surveys"],
        [`${action}/${SURVEY.toUpperCase()}/`, "", "/PRIVATE/SURVEYS"],
      ] as const) {
        expectJson(
          await call("GET", path, query, { prefix }),
          200,
          layoutAnswer('{"pageSize":25}'),
        );
      }
    });

    it("lets a project member who cannot change the survey read it", async () => {
      add({ projectId: PROJECT, layouts: { [kind]: '{"pageSize":25}' } });
      expectJson(
        await call("GET", `${action}/${SURVEY}`, "", { key: BOB_KEY }),
        200,
        layoutAnswer('{"pageSize":25}'),
      );
    });

    it("answers an unknown, foreign or malformed survey with the old modify refusal", async () => {
      add({ ownerUserId: BOB, creatorId: BOB, layouts: { [kind]: "{}" } });
      expectJson(await call("GET", `${action}/${SURVEY}`), 400, modify(SURVEY));
      expectJson(await call("GET", `${action}/${UNKNOWN}`), 400, modify(UNKNOWN));
      expectJson(await call("GET", `${action}/nps`), 400, modify(ZERO));
    });

    it("answers a missing or wrong key with an empty 401", async () => {
      add();
      expectEmpty(await call("GET", `${action}/${SURVEY}`, "", { key: null }), 401);
      expectEmpty(await call("GET", `${action}/${SURVEY}`, "", { key: "wrong" }), 401);
    });
  });

  describe("getResultTableState's fallback", () => {
    it("reads the columns layout's columns as the elements when there is no table layout", async () => {
      add({
        layouts: {
          columns:
            '{"columns":[{"name":"q1","visibility":2},{"name":"q2"}],"newcolumnsvisibility":0}',
        },
      });
      expectJson(
        await call("GET", `getResultTableState/${SURVEY}`),
        200,
        layoutAnswer(
          '{"elements":[{"name":"q1","isVisible":true,"isPublic":false},{"name":"q2"}]}',
        ),
      );
    });

    it("marks the fallback's elements by the private questions too", async () => {
      add({
        privateResultQuestions: ["q2"],
        layouts: { columns: '{"columns":[{"name":"q1"},{"name":"q2"}]}' },
      });
      expectJson(
        await call("GET", `getResultTableState/${SURVEY}`),
        200,
        layoutAnswer('{"elements":[{"name":"q1","isPublic":true},{"name":"q2","isPublic":false}]}'),
      );
    });

    it("gives null elements for a columns layout without columns", async () => {
      add({ layouts: { columns: '{"newcolumnsvisibility":1}' } });
      expectJson(
        await call("GET", `getResultTableState/${SURVEY}`),
        200,
        layoutAnswer('{"elements":null}'),
      );
    });

    it("answers an empty 400 for a columns layout the old code could not read", async () => {
      for (const text of ['{"columns":{"name":"q1"}}', '{"columns":null}', "[]", "nope"]) {
        add({ layouts: { columns: text } });
        expectEmpty(await call("GET", `getResultTableState/${SURVEY}`), 400);
      }
    });

    it("is not the summary's: no summary layout answers null", async () => {
      add({ layouts: { columns: '{"columns":[{"name":"q1"}]}' } });
      expectJson(await call("GET", `getResultSummaryState/${SURVEY}`), 200, "null");
    });
  });

  describe.each([
    ["setResultTableState", "getResultTableState", "table"],
    ["setResultSummaryState", "getResultSummaryState", "summary"],
  ] as const)("%s", (action, read, kind) => {
    it("saves the text verbatim; a get answers it as it was given", async () => {
      const survey = add();
      const text =
        '{ "pageSize" : 25, "elements":[{"name":"q1","at":"2026-01-01T10:00:00.000Z"}] }';
      expectEmpty(await put(action, state(SURVEY, text)), 200);
      expect(survey.layouts[kind]).toBe(text);
      expect(survey.updatedAt).toBe("2026-11-19T10:00:00.127Z");
      expectJson(await call("GET", `${read}/${SURVEY}`), 200, layoutAnswer(text));
    });

    it("takes a form body, its field names in any letter case", async () => {
      const survey = add();
      const body = `id=${SURVEY}&JSON=${encodeURIComponent('{"pageSize":5}')}`;
      expectEmpty(await put(action, body, FORM), 200);
      expect(survey.layouts[kind]).toBe('{"pageSize":5}');
    });

    it("reads a body of any other content type as JSON", async () => {
      const survey = add();
      expectEmpty(await put(action, state(SURVEY, '{"pageSize":6}'), "text/plain"), 200);
      expect(survey.layouts[kind]).toBe('{"pageSize":6}');
    });

    it("deletes the layout for a missing or empty Json", async () => {
      for (const json of [null, ""]) {
        const survey = add({ layouts: { [kind]: '{"pageSize":5}' } });
        expectEmpty(await put(action, state(SURVEY, json)), 200);
        expect(survey.layouts[kind]).toBeUndefined();
      }
    });

    it("answers an empty 400 for an empty or unreadable body, asking Studio nothing", async () => {
      add();
      for (const body of [
        "",
        "   ",
        "{",
        "null",
        '{"Id":"zz","Json":"{}"}',
        `${state(SURVEY, "{}")} x`,
      ]) {
        expectEmpty(await put(action, body), 400);
      }
      expectEmpty(await put(action, `id=zz&json=x`, FORM), 400);
      expectEmpty(await put(action, `id=${SURVEY}&json=a&json=b`, FORM), 400);
      expect(studio.requests).toEqual([]);
    });

    it("answers a survey the caller cannot change with the old modify refusal", async () => {
      add({ projectId: PROJECT });
      expectJson(
        await put(action, state(SURVEY, "{}"), "application/json", BOB_KEY),
        400,
        modify(SURVEY),
      );
      expectJson(
        await put(action, state(SURVEY, ""), "application/json", BOB_KEY),
        400,
        modify(SURVEY),
      );
      expectJson(await put(action, state(UNKNOWN, "{}")), 400, modify(UNKNOWN));
      expectJson(await put(action, JSON.stringify({ Json: "{}" })), 400, modify(ZERO));
    });
  });

  describe("setResultColumns", () => {
    it("saves the columns layout verbatim", async () => {
      const survey = add();
      const text = '{"columns":[{"name":"q1","visibility":1}]}';
      expectEmpty(await put("setResultColumns", state(SURVEY, text)), 200);
      expect(survey.layouts.columns).toBe(text);
    });

    it("keeps the layout for an empty Json", async () => {
      const survey = add({ layouts: { columns: '{"columns":[]}' } });
      expectEmpty(await put("setResultColumns", state(SURVEY, "")), 200);
      expect(survey.layouts.columns).toBe('{"columns":[]}');
      expect(writes()).toEqual([]);
    });

    it("takes JSON only: any other content type is an empty 415", async () => {
      add();
      expectEmpty(await put("setResultColumns", state(SURVEY, "{}"), FORM), 415);
      expectEmpty(await put("setResultColumns", state(SURVEY, "{}"), "text/plain"), 415);
    });

    it("answers an empty 400 for an empty or unreadable body", async () => {
      add();
      for (const body of ["", "{", "null"]) expectEmpty(await put("setResultColumns", body), 400);
    });

    it("answers a survey the caller cannot change with the old modify refusal", async () => {
      add({ projectId: PROJECT });
      for (const json of ["{}", ""]) {
        expectJson(
          await put("setResultColumns", state(SURVEY, json), "application/json", BOB_KEY),
          400,
          modify(SURVEY),
        );
      }
    });
  });

  describe("setResultPermissions", () => {
    const permissions = JSON.stringify([
      { name: "q1", isPublic: false },
      { name: "q2", isPublic: true },
      { name: "q3", isPublic: false },
      { name: "q1", isPublic: false },
    ]);

    it("makes the names it marks not public the survey's private questions", async () => {
      const survey = add({ privateResultQuestions: ["old"] });
      expectEmpty(await put("setResultPermissions", state(SURVEY, permissions)), 200);
      expect(survey.privateResultQuestions).toEqual(["q1", "q3"]);
    });

    it("takes a form body", async () => {
      const survey = add();
      const body = `Id=${SURVEY}&Json=${encodeURIComponent(permissions)}`;
      expectEmpty(await put("setResultPermissions", body, FORM), 200);
      expect(survey.privateResultQuestions).toEqual(["q1", "q3"]);
    });

    it("is what the layout reads mark", async () => {
      add({ layouts: { table: '{"elements":[{"name":"q1"},{"name":"q2"}]}' } });
      await put("setResultPermissions", state(SURVEY, permissions));
      expectJson(
        await call("GET", `getResultTableState/${SURVEY}`),
        200,
        layoutAnswer('{"elements":[{"name":"q1","isPublic":false},{"name":"q2","isPublic":true}]}'),
      );
    });

    it("changes nothing for an empty Json", async () => {
      const survey = add({ privateResultQuestions: ["q9"] });
      for (const json of ["", null]) {
        expectEmpty(await put("setResultPermissions", state(SURVEY, json)), 200);
      }
      expect(survey.privateResultQuestions).toEqual(["q9"]);
      expect(writes()).toEqual([]);
    });

    it("answers an empty 400 for permissions the old code could not read, changing nothing", async () => {
      const survey = add({ privateResultQuestions: ["q9"] });
      for (const json of ['[{"isPublic":false}]', '{"name":"q1"}', "[1]", "nope"]) {
        expectEmpty(await put("setResultPermissions", state(SURVEY, json)), 400);
      }
      expect(survey.privateResultQuestions).toEqual(["q9"]);
    });

    it("answers a survey the caller cannot change with the old modify refusal", async () => {
      add({ projectId: PROJECT });
      for (const json of [permissions, "", "nope"]) {
        expectJson(
          await put("setResultPermissions", state(SURVEY, json), "application/json", BOB_KEY),
          400,
          modify(SURVEY),
        );
      }
      expectJson(
        await put("setResultPermissions", state(UNKNOWN, permissions)),
        400,
        modify(UNKNOWN),
      );
    });
  });

  describe("getResultColumns", () => {
    const responses = [
      response(1, "2026-10-05T06:48:57.517Z", '{"q2":30,"q1":"Ann"}', {
        clientId: "client-1",
        respondentIp: "203.0.113.7",
      }),
      response(2, "2026-10-06T08:00:00Z", '{"q1":"Bob","extra":true}'),
    ];

    it("computes the columns from the definition and every response, titles in the first language", async () => {
      add({ responses, storeRespondentIp: true });
      studio.store.resultPageSize = 1;
      const answer = await call("GET", `getResultColumns/${SURVEY}`, "", {
        headers: [["accept-language", "de-DE,en;q=0.8"]],
      });
      expectJson(
        answer,
        200,
        JSON.stringify({
          Columns: [
            column("HappendAt", "Submitted"),
            column("IPAddress", "IPAddress", { Visibility: 2 }),
            column("extra", "extra"),
            column("ClientId", "Client Id", { Visibility: 2 }),
            column("q1", "Name (de)"),
            column("q2", "Alter"),
          ],
          Id: ZERO,
        }),
      );
    });

    it("takes the default titles without Accept-Language", async () => {
      add({ responses });
      const body = JSON.parse(
        (await call("GET", `getResultColumns/${SURVEY}`)).body.toString(),
      ) as {
        Columns: { Name: string; DisplayName: string }[];
      };
      expect(body.Columns.map((c) => c.DisplayName)).toEqual([
        "Submitted",
        "extra",
        "Client Id",
        "Name",
        "Age",
      ]);
    });

    it("merges the columns layout, the private questions hidden from public reads", async () => {
      add({
        responses,
        privateResultQuestions: ["q2"],
        layouts: { columns: '{"columns":[{"name":"q2"},{"name":"q1","displayname":"Who"}]}' },
      });
      const body = JSON.parse(
        (await call("GET", `getResultColumns/${SURVEY}`)).body.toString(),
      ) as {
        Columns: { Name: string; DisplayName: string; Visibility: number }[];
      };
      expect(body.Columns.slice(0, 2)).toEqual([
        column("q2", "Age", { Visibility: 2 }),
        column("q1", "Who"),
      ]);
    });

    it("answers an empty 400 for a first Accept-Language entry that is no culture name", async () => {
      add({ responses });
      const answer = await call("GET", `getResultColumns/${SURVEY}`, "", {
        headers: [["accept-language", "en;q=0.9,de"]],
      });
      expectEmpty(answer, 400);
    });

    it("answers an empty 400 for a columns layout the old calculation failed on", async () => {
      add({ responses, layouts: { columns: '{"columns":"text"}' } });
      expectEmpty(await call("GET", `getResultColumns/${SURVEY}`), 400);
    });

    it("answers an unknown or foreign survey with the old modify refusal, before the language", async () => {
      add({ ownerUserId: BOB, creatorId: BOB });
      const headers: [string, string][] = [["accept-language", "*"]];
      expectJson(
        await call("GET", `getResultColumns/${SURVEY}`, "", { headers }),
        400,
        modify(SURVEY),
      );
      expectJson(await call("GET", `getResultColumns`, `id=${UNKNOWN}`), 400, modify(UNKNOWN));
    });

    it("answers a missing key with an empty 401", async () => {
      add();
      expectEmpty(await call("GET", `getResultColumns/${SURVEY}`, "", { key: null }), 401);
    });
  });

  describe("getResultPublicColumns", () => {
    function addPublic(fields: Partial<StoredSurvey> = {}): StoredSurvey {
      const survey = add({ publicResults: true, ...fields });
      studio.definitions.set(SURVEY, { definition: DEFINITION, etag: undefined });
      studio.publicResults.set(SURVEY, {
        items: [
          '{"submittedAt":"2026-10-05T06:48:57.517Z","data":{"q2":30,"q1":"Ann"}}',
          '{"submittedAt":"2026-10-06T08:00:00Z","data":{"q1":"Bob"}}',
        ],
      });
      return survey;
    }

    it("computes the columns from the public results, with no key", async () => {
      addPublic({ layouts: { columns: '{"columns":[{"name":"q2"}]}' } });
      studio.pageSize = 1;
      const answer = await call("GET", `getResultPublicColumns/${SURVEY}`, "", {
        key: null,
        headers: [["accept-language", "de"]],
      });
      expectJson(
        answer,
        200,
        JSON.stringify({
          Columns: [
            column("q2", "Alter"),
            column("HappendAt", "Submitted"),
            column("q1", "Name (de)"),
          ],
          Id: ZERO,
        }),
      );
      expect(studio.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
    });

    it("has no column for a private question, whose answers public results leave out", async () => {
      addPublic({
        layouts: { columns: '{"columns":[{"name":"q2"}]}' },
        privateResultQuestions: ["q2"],
      });
      studio.publicResults.set(SURVEY, {
        items: ['{"submittedAt":"2026-10-05T06:48:57.517Z","data":{"q1":"Ann"}}'],
        privateQuestions: ["q2"],
      });
      const answer = await call("GET", `getResultPublicColumns/${SURVEY}`, "", { key: null });
      expectJson(
        answer,
        200,
        JSON.stringify({
          Columns: [column("HappendAt", "Submitted"), column("q1", "Name")],
          Id: ZERO,
        }),
      );
    });

    it("answers the old refusal while results are not public, for an unknown or malformed survey", async () => {
      add();
      expectJson(
        await call("GET", `getResultPublicColumns/${SURVEY}`, "", { key: null }),
        400,
        getResults(SURVEY),
      );
      expectJson(
        await call("GET", "getResultPublicColumns", `id=${UNKNOWN}`, { key: null }),
        400,
        getResults(UNKNOWN),
      );
      expectJson(
        await call("GET", "getResultPublicColumns/nps", "", { key: null }),
        400,
        getResults(ZERO),
      );
    });

    it("answers an empty 400 for a first Accept-Language entry that is no culture name", async () => {
      addPublic();
      const answer = await call("GET", `getResultPublicColumns/${SURVEY}`, "", {
        key: null,
        headers: [["accept-language", "*"]],
      });
      expectEmpty(answer, 400);
    });
  });

  describe.each([
    ["getPublicResultTableState", "table"],
    ["getPublicResultSummaryState", "summary"],
  ] as const)("%s", (action, kind) => {
    it("drops the elements that are not public, with no key", async () => {
      add({
        publicResults: true,
        layouts: {
          [kind]:
            '{"pageSize":5,"elements":[{"name":"q1","isPublic":true},{"name":"q2","isPublic":false},' +
            '{"name":"q3","visibility":2},{"name":"q4","visibility":1}]}',
        },
      });
      expectJson(
        await call("GET", `${action}/${SURVEY}`, "", { key: null }),
        200,
        layoutAnswer(
          '{"pageSize":5,"elements":[{"name":"q1","isPublic":true},' +
            '{"name":"q4","isVisible":false,"isPublic":true}]}',
        ),
      );
    });

    it("drops the private questions' elements", async () => {
      add({
        publicResults: true,
        privateResultQuestions: ["q1"],
        layouts: { [kind]: '{"elements":[{"name":"q1"},{"name":"q2"}]}' },
      });
      expectJson(
        await call("GET", `${action}/${SURVEY}`, "", { key: null }),
        200,
        layoutAnswer('{"elements":[{"name":"q2","isPublic":true}]}'),
      );
    });

    it("answers JSON null without a layout", async () => {
      add({ publicResults: true });
      expectJson(await call("GET", `${action}/${SURVEY}`, "", { key: null }), 200, "null");
    });

    it("answers an empty 400 for an element without isPublic, or a layout without elements", async () => {
      for (const text of [
        '{"elements":[{"name":"q1"}]}',
        '{"pageSize":5}',
        '{"elements":[{"isPublic":"maybe"}]}',
      ]) {
        add({ publicResults: true, layouts: { [kind]: text } });
        expectEmpty(await call("GET", `${action}/${SURVEY}`, "", { key: null }), 400);
      }
    });

    it("answers the old summary-state refusal while results are not public", async () => {
      add({ layouts: { [kind]: "{}" } });
      expectJson(
        await call("GET", `${action}/${SURVEY}`, "", { key: null }),
        400,
        summaryState(SURVEY),
      );
      expectJson(
        await call("GET", action, `id=${UNKNOWN}`, { key: null }),
        400,
        summaryState(UNKNOWN),
      );
      expectJson(await call("GET", `${action}/x`, "", { key: null }), 400, summaryState(ZERO));
    });
  });

  it("getPublicResultTableState falls back to the columns layout", async () => {
    add({
      publicResults: true,
      layouts: {
        columns: '{"columns":[{"name":"q1","visibility":2},{"name":"q2","visibility":0}]}',
      },
    });
    expectJson(
      await call("GET", `getPublicResultTableState/${SURVEY}`, "", { key: null }),
      200,
      layoutAnswer('{"elements":[{"name":"q2","isVisible":true,"isPublic":true}]}'),
    );
  });
});
