import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "../testing/http.js";
import { startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";

const SURVEY = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const OTHER = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc";
const RESULT = "9b7d3c1e-2f4a-4b6c-8d0e-1f2a3b4c5d6e";
const DEFINITION = {
  title: "Feedback",
  pages: [{ name: "p1", elements: [{ type: "text", name: "q" }] }],
};

const JSON_UTF8 = "application/json; charset=utf-8";
const PROBLEM_UTF8 = "application/problem+json; charset=utf-8";

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
  studio.definitions.set(SURVEY, { definition: DEFINITION, etag: '"v1"' });
});

const studioPaths = () => studio.requests.map((request) => `${request.method} ${request.url}`);

/** The old validation answer for one query parameter. */
function expectValidation(
  answer: { status: number; headers: Record<string, unknown>; body: Buffer },
  name: string,
  message: string,
): void {
  expect(answer.status).toBe(400);
  expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
  const body = JSON.parse(answer.body.toString()) as Record<string, unknown>;
  expect(Object.keys(body)[0]).toBe("errors");
  expect(body).toMatchObject({
    errors: { [name]: [message] },
    type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
    title: "One or more validation errors occurred.",
    status: 400,
  });
}

describe("getSurvey", () => {
  const url = (query: string) => `${bridge.url}/public/Survey/getSurvey?${query}`;

  it("answers the definition as JSON, application/json without a charset", async () => {
    const answer = await send(url(`surveyId=${SURVEY}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(answer.body.toString())).toEqual(DEFINITION);
    expect(answer.headers["cache-control"]).toBeUndefined();
    expect(answer.headers.etag).toBeUndefined();
    expect(studioPaths()).toEqual([`GET /api/v1/public/surveys/${SURVEY}/definition`]);
    expect(legacy.requests).toEqual([]);
  });

  it.each([
    ["upper case", SURVEY.toUpperCase()],
    ["N form", SURVEY.replaceAll("-", "")],
    ["B form", `{${SURVEY}}`],
    ["P form", `(${SURVEY})`],
    ["X form", "{0x5af48e08,0xa0a5,0x44a5,{0x83,0xf4,0x1c,0x90,0xe8,0xe9,0x8d,0xe1}}"],
    ["surrounding spaces", `%20${SURVEY}%20`],
  ])("reads the survey ID in the %s, as the old API parsed it", async (_form, id) => {
    const answer = await send(url(`surveyId=${encodeURIComponent(decodeURIComponent(id))}`));
    expect(answer.status).toBe(200);
    expect(studioPaths()).toEqual([`GET /api/v1/public/surveys/${SURVEY}/definition`]);
  });

  it('answers 400 "Check parameter values." for a survey Studio does not have', async () => {
    const answer = await send(url(`surveyId=${OTHER}`));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.body.toString()).toBe('"Check parameter values."');
  });

  it('answers 400 "Check parameter values." without a surveyId, asking Studio nothing', async () => {
    const answer = await send(`${bridge.url}/public/Survey/getSurvey`);
    expect(answer.status).toBe(400);
    expect(answer.body.toString()).toBe('"Check parameter values."');
    expect(studio.requests).toEqual([]);
  });

  it.each([
    ["surveyId=GUID", "The value 'GUID' is not valid."],
    ["surveyId=bad&surveyId=x", "The value 'bad,x' is not valid."],
    ["SURVEYID=", "The value '' is invalid."],
    ["surveyId=%20%20", "The value '  ' is invalid."],
  ])("answers the validation problem for %s", async (query, message) => {
    const answer = await send(url(query));
    expectValidation(answer, "surveyId", message);
    expect(studio.requests).toEqual([]);
  });

  it.each([429, 500, 503])("answers Studio's %i as an empty 429 or 500", async (status) => {
    studio.override = (_request, res) => (res.writeHead(status).end("x"), true);
    const answer = await send(url(`surveyId=${SURVEY}`));
    expect(answer.status).toBe(status === 429 ? 429 : 500);
    expect(answer.body.length).toBe(0);
    expect(answer.headers["content-type"]).toBeUndefined();
  });

  // Review Focus 3.
  describe("the cache", () => {
    // A bridge of its own for each test, its cache empty.
    let fresh: RunningBridge;
    beforeEach(async () => {
      fresh = await startBridge({ studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url });
    });
    afterEach(() => fresh.close());
    const url = (query: string) => `${fresh.url}/public/Survey/getSurvey?${query}`;

    it("revalidates with If-None-Match and serves its copy on 304", async () => {
      await send(url(`surveyId=${SURVEY}`));
      const second = await send(url(`surveyId=${SURVEY.toUpperCase()}`));
      expect(second.status).toBe(200);
      expect(second.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(second.body.toString())).toEqual(DEFINITION);
      expect(studio.requests.map((request) => request.headers["if-none-match"])).toEqual([
        undefined,
        '"v1"',
      ]);
    });

    it("shows an edit on the next request and keeps the new copy", async () => {
      await send(url(`surveyId=${SURVEY}`));
      const edited = { ...DEFINITION, title: "Edited" };
      studio.definitions.set(SURVEY, { definition: edited, etag: '"v2"' });
      const second = await send(url(`surveyId=${SURVEY}`));
      expect(JSON.parse(second.body.toString())).toEqual(edited);
      const third = await send(url(`surveyId=${SURVEY}`));
      expect(JSON.parse(third.body.toString())).toEqual(edited);
      expect(studio.requests.map((request) => request.headers["if-none-match"])).toEqual([
        undefined,
        '"v1"',
        '"v2"',
      ]);
    });

    it("forgets a survey Studio no longer has", async () => {
      await send(url(`surveyId=${SURVEY}`));
      studio.definitions.delete(SURVEY);
      const gone = await send(url(`surveyId=${SURVEY}`));
      expect(gone.status).toBe(400);
      expect(gone.body.toString()).toBe('"Check parameter values."');
      studio.definitions.set(SURVEY, { definition: DEFINITION, etag: '"v1"' });
      await send(url(`surveyId=${SURVEY}`));
      expect(studio.requests.map((request) => request.headers["if-none-match"])).toEqual([
        undefined,
        '"v1"',
        undefined,
      ]);
    });

    it("keeps no copy of an answer without an ETag", async () => {
      studio.definitions.set(SURVEY, { definition: DEFINITION, etag: undefined });
      await send(url(`surveyId=${SURVEY}`));
      await send(url(`surveyId=${SURVEY}`));
      expect(studio.requests.map((request) => request.headers["if-none-match"])).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("keeps at most cacheEntries surveys, the least recently used going first", async () => {
      const small = await startBridge({
        studioUrl: `${studio.url}/api/v1`,
        legacyUrl: legacy.url,
        cacheEntries: 2,
      });
      try {
        const ids = [SURVEY, OTHER, RESULT];
        ids.forEach((id, n) => studio.definitions.set(id, { definition: { n }, etag: `"e${n}"` }));
        const get = (id: string) => send(`${small.url}/public/Survey/getSurvey?surveyId=${id}`);
        await get(SURVEY);
        await get(OTHER);
        await get(SURVEY); // SURVEY is now the most recently used
        await get(RESULT); // OTHER goes
        studio.requests.length = 0;
        await get(SURVEY);
        await get(OTHER);
        expect(studio.requests.map((request) => request.headers["if-none-match"])).toEqual([
          '"e0"',
          undefined,
        ]);
      } finally {
        await small.close();
      }
    });
  });
});

describe("getSurveyAndIsCompleted", () => {
  const url = (query: string) => `${bridge.url}/public/v1/Survey/getSurveyAndIsCompleted?${query}`;

  it.each([
    ["none", "no"],
    ["partial", "partial"],
    ["completed", "completed"],
  ] as const)("answers the survey with Studio's state %s as %s", async (state, old) => {
    studio.states.set(`${SURVEY}/client 1`, state);
    const answer = await send(url(`surveyId=${SURVEY}&clientId=client+1`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(JSON.parse(answer.body.toString())).toEqual({ survey: DEFINITION, isCompleted: old });
    expect(answer.body.toString().startsWith('{"survey":{')).toBe(true);
    // The two reads run in parallel.
    expect(studioPaths().sort()).toEqual([
      `GET /api/v1/public/surveys/${SURVEY}/definition`,
      `GET /api/v1/public/surveys/${SURVEY}/respondents/client%201`,
    ]);
  });

  it.each(["", "&clientId=", "&CLIENTID="])(
    "answers 400 \"Check 'clientId' parameter\" for clientId %j",
    async (query) => {
      const answer = await send(url(`surveyId=${SURVEY}${query}`));
      expect(answer.status).toBe(400);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      expect(answer.body.toString()).toBe(`"Check 'clientId' parameter"`);
      expect(studio.requests).toEqual([]);
    },
  );

  it("answers the validation problem for a malformed surveyId before checking clientId", async () => {
    const answer = await send(url("surveyId=GUID"));
    expectValidation(answer, "surveyId", "The value 'GUID' is not valid.");
    expect(studio.requests).toEqual([]);
  });

  it('answers 400 "Check parameter values." for a survey Studio does not have', async () => {
    const answer = await send(url(`surveyId=${OTHER}&clientId=c1`));
    expect(answer.status).toBe(400);
    expect(answer.body.toString()).toBe('"Check parameter values."');
  });

  it('answers 400 "Check parameter values." without a surveyId', async () => {
    const answer = await send(url("clientId=c1"));
    expect(answer.status).toBe(400);
    expect(answer.body.toString()).toBe('"Check parameter values."');
    expect(studio.requests).toEqual([]);
  });

  it('answers "no" for a client ID Studio cannot hold, without asking for its state', async () => {
    const answer = await send(url(`surveyId=${SURVEY}&clientId=a%2Fb`));
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body.toString())).toEqual({ survey: DEFINITION, isCompleted: "no" });
    expect(studioPaths()).toEqual([`GET /api/v1/public/surveys/${SURVEY}/definition`]);
  });

  it("answers an empty 500 when the definition is not a JSON object, as the old parser failed", async () => {
    studio.definitions.set(SURVEY, { definition: [1, 2], etag: '"array"' });
    const answer = await send(url(`surveyId=${SURVEY}&clientId=c1`));
    expect(answer.status).toBe(500);
    expect(answer.body.length).toBe(0);
  });

  it.each([
    [429, 500, 429],
    [500, 429, 500],
  ])(
    "answers the state read's failure when both reads fail (state %i, definition %i → %i)",
    async (stateStatus, definitionStatus, expected) => {
      studio.override = (request, res) => {
        const status = request.url.endsWith("/definition") ? definitionStatus : stateStatus;
        res.writeHead(status).end();
        return true;
      };
      const answer = await send(url(`surveyId=${SURVEY}&clientId=c1`));
      expect(answer.status).toBe(expected);
      expect(answer.body.length).toBe(0);
    },
  );

  it("answers Studio's 429 as an empty 429", async () => {
    studio.override = (_request, res) => (res.writeHead(429).end(), true);
    const answer = await send(url(`surveyId=${SURVEY}&clientId=c1`));
    expect(answer.status).toBe(429);
    expect(answer.body.length).toBe(0);
  });
});

describe("isCompleted", () => {
  const url = (query: string) => `${bridge.url}/public/Survey/isCompleted?${query}`;

  beforeEach(() => {
    studio.resultIds.set(RESULT, SURVEY);
  });

  it.each([
    ["none", "no"],
    ["partial", "partial"],
    ["completed", "completed"],
  ] as const)("answers Studio's state %s as %j", async (state, old) => {
    studio.states.set(`${SURVEY}/a b%c`, state);
    const answer = await send(url(`resultId=${RESULT}&clientId=a+b%25c`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.body.toString()).toBe(JSON.stringify(old));
    expect(studioPaths()).toEqual([`GET /api/v1/public/results/${RESULT}/respondents/a%20b%25c`]);
  });

  // ADR 0039 point 1: the old API answered some other respondent's state.
  it.each(["", "&clientId="])(
    'answers "no" without a client ID (%j), asking Studio nothing',
    async (query) => {
      studio.states.set(`${SURVEY}/c1`, "completed");
      const answer = await send(url(`resultId=${RESULT}${query}`));
      expect(answer.status).toBe(200);
      expect(answer.body.toString()).toBe('"no"');
      expect(studio.requests).toEqual([]);
    },
  );

  it('answers "no" for a result ID Studio does not have', async () => {
    const answer = await send(url(`resultId=${OTHER}&clientId=c1`));
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe('"no"');
  });

  it('answers "no" without a result ID, asking Studio nothing', async () => {
    const answer = await send(url("clientId=c1"));
    expect(answer.body.toString()).toBe('"no"');
    expect(studio.requests).toEqual([]);
  });

  it('answers "no" for a client ID Studio cannot hold, asking Studio nothing', async () => {
    const answer = await send(url(`resultId=${RESULT}&clientId=${"x".repeat(257)}`));
    expect(answer.body.toString()).toBe('"no"');
    expect(studio.requests).toEqual([]);
  });

  it("answers the validation problem for a malformed resultId", async () => {
    const answer = await send(url("resultId=GUID&clientId=client-123"));
    expectValidation(answer, "resultId", "The value 'GUID' is not valid.");
  });

  it.each([429, 500])("answers Studio's %i as an empty answer", async (status) => {
    studio.override = (_request, res) => (res.writeHead(status).end(), true);
    const answer = await send(url(`resultId=${RESULT}&clientId=c1`));
    expect(answer.status).toBe(status);
    expect(answer.body.length).toBe(0);
  });

  it.each([".", ".."])(
    'answers "no" for the client ID %j, which a URL cannot carry, asking Studio nothing',
    async (clientId) => {
      studio.states.set(`${SURVEY}/${clientId}`, "completed");
      const answer = await send(url(`resultId=${RESULT}&clientId=${clientId}`));
      expect(answer.body.toString()).toBe('"no"');
      expect(studio.requests).toEqual([]);
    },
  );

  it("answers in a route of any letter case under both prefixes", async () => {
    studio.states.set(`${SURVEY}/c1`, "completed");
    const answer = await send(
      `${bridge.url}/PUBLIC/V1/SURVEY/ISCOMPLETED/?resultId=${RESULT}&clientId=c1`,
    );
    expect(answer.body.toString()).toBe('"completed"');
  });
});
