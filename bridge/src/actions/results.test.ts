import { get } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "../testing/http.js";
import { retryDelayMs } from "./results.js";
import { startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";

const RESULT = "9b7d3c1e-2f4a-4b6c-8d0e-1f2a3b4c5d6e";
const SURVEY = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const ZERO = "00000000-0000-0000-0000-000000000000";
const JSON_UTF8 = "application/json; charset=utf-8";
const PROBLEM_UTF8 = "application/problem+json; charset=utf-8";
const CACHE = "private, max-age=3600, must-revalidate";

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
});

const studioPaths = () => studio.requests.map((request) => `${request.method} ${request.url}`);

type Answer = Awaited<ReturnType<typeof send>>;

function expectEmpty(answer: Answer, status: number): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-length"]).toBe("0");
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.headers["cache-control"]).toBeUndefined();
}

describe("getResult", () => {
  const url = (query: string, prefix = "public/Survey") =>
    `${bridge.url}/${prefix}/getResult?${query}`;

  beforeEach(() => {
    studio.summaries.set(RESULT, {
      responseCount: 3,
      firstSubmittedAt: "2026-10-05T06:48:57.517Z",
      lastSubmittedAt: "2026-10-06T08:00:01.120Z",
      questions: {
        q: {
          answered: 2,
          values: '[{"value":"a","count":1},{"value":"b","count":1},{"value":null,"count":1}]',
        },
        matrix: { answered: 1, values: '[{"value":["r1","c1"],"count":1}]' },
        flag: { answered: 2, values: '[{"value":true,"count":2}]' },
        same: {
          answered: 3,
          values: '[{"value":1,"count":1},{"value":"1","count":2}]',
        },
      },
    });
  });

  it("answers the old aggregate, with the old key and time formats", async () => {
    const answer = await send(url(`resultId=${RESULT}&name=q`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.headers["cache-control"]).toBe(CACHE);
    expect(answer.body.toString()).toBe(
      '{"AnswersCount":2,"QuestionResult":{"a":1,"b":1},' +
        '"FirstResultAt":"2026-10-05T06:48:57.517","LastResultAt":"2026-10-06T08:00:01.12","ResultCount":3}',
    );
    expect(studioPaths()).toEqual([`GET /api/v1/public/results/${RESULT}/questions/q`]);
    expect(legacy.requests).toEqual([]);
  });

  it("writes object pairs and booleans as the old keys", async () => {
    const matrix = JSON.parse((await send(url(`resultId=${RESULT}&name=matrix`))).body.toString());
    expect(matrix.QuestionResult).toEqual({ "[r1, c1]": 1 });
    const flag = JSON.parse((await send(url(`resultId=${RESULT}&name=flag`))).body.toString());
    expect(flag.QuestionResult).toEqual({ True: 2 });
  });

  it('keeps 1 and "1" apart, as duplicate keys', async () => {
    const answer = await send(url(`resultId=${RESULT}&name=same`));
    expect(answer.body.toString()).toContain('"QuestionResult":{"1":1,"1":2}');
  });

  it("answers a question without answers with zero counts and the survey's totals", async () => {
    const answer = await send(url(`resultId=${RESULT}&name=unknown`));
    expect(JSON.parse(answer.body.toString())).toEqual({
      AnswersCount: 0,
      QuestionResult: {},
      FirstResultAt: "2026-10-05T06:48:57.517",
      LastResultAt: "2026-10-06T08:00:01.12",
      ResultCount: 3,
    });
  });

  it("answers a survey without responses with the old minimum times", async () => {
    studio.summaries.set(RESULT, {
      responseCount: 0,
      firstSubmittedAt: null,
      lastSubmittedAt: null,
      questions: {},
    });
    const answer = await send(url(`resultId=${RESULT}&name=q`));
    expect(answer.body.toString()).toBe(
      '{"AnswersCount":0,"QuestionResult":{},"FirstResultAt":"0001-01-01T00:00:00",' +
        '"LastResultAt":"0001-01-01T00:00:00","ResultCount":0}',
    );
  });

  it.each([
    ["longer than Studio takes", "x".repeat(257)],
    ["a dot segment", "."],
    ["two dots", ".."],
  ])("answers a name %s as a question without answers, without sending it", async (_case, name) => {
    const answer = await send(url(`resultId=${RESULT}&name=${encodeURIComponent(name)}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["cache-control"]).toBe(CACHE);
    expect(JSON.parse(answer.body.toString())).toMatchObject({
      AnswersCount: 0,
      QuestionResult: {},
      ResultCount: 3,
    });
    expect(studio.requests).toHaveLength(1);
    expect(studio.requests[0]!.url).not.toContain(encodeURIComponent(name));
  });

  it("sends a name of 256 characters and one with a slash as they are", async () => {
    const long = "é".repeat(256);
    await send(url(`resultId=${RESULT}&name=${encodeURIComponent(long)}`));
    await send(url(`resultId=${RESULT}&name=a%2Fb`));
    expect(studioPaths()).toEqual([
      `GET /api/v1/public/results/${RESULT}/questions/${encodeURIComponent(long)}`,
      `GET /api/v1/public/results/${RESULT}/questions/a%2Fb`,
    ]);
  });

  it('answers an unknown result ID with "Check parameter values."', async () => {
    const other = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc";
    const answer = await send(url(`resultId=${other}&name=q`, "PUBLIC/V1/SURVEY"));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.headers["cache-control"]).toBe(CACHE);
    expect(answer.body.toString()).toBe('"Check parameter values."');
    expect(studioPaths()).toEqual([`GET /api/v1/public/results/${other}/questions/q`]);
  });

  it('answers a missing result ID with "Check parameter values." without asking Studio', async () => {
    const answer = await send(url("name=q"));
    expect(answer.status).toBe(400);
    expect(answer.body.toString()).toBe('"Check parameter values."');
    expect(answer.headers["cache-control"]).toBe(CACHE);
    expect(studio.requests).toEqual([]);
  });

  it.each([
    ["missing", `resultId=${RESULT}`],
    ["empty", `resultId=${RESULT}&name=`],
    ["missing, with no result ID either", ""],
  ])("answers a name %s with the ProblemDetails 400", async (_case, query) => {
    const answer = await send(url(query));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
    expect(answer.headers["cache-control"]).toBe(CACHE);
    expect(JSON.parse(answer.body.toString())).toMatchObject({
      type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
      title: "Bad Request",
      status: 400,
    });
    expect(studio.requests).toEqual([]);
  });

  it("answers a malformed result ID with the validation 400, without Cache-Control", async () => {
    const answer = await send(url("resultId=bad&name=q"));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
    expect(answer.headers["cache-control"]).toBeUndefined();
    expect(JSON.parse(answer.body.toString())).toMatchObject({
      errors: { resultId: ["The value 'bad' is not valid."] },
    });
    expect(studio.requests).toEqual([]);
  });

  it("answers Studio's 429 as an empty 429 and a failure as an empty 500, without Cache-Control", async () => {
    studio.override = (_request, res) => {
      res.writeHead(429).end();
      return true;
    };
    expectEmpty(await send(url(`resultId=${RESULT}&name=q`)), 429);
    studio.override = (_request, res) => {
      res.writeHead(503).end();
      return true;
    };
    expectEmpty(await send(url(`resultId=${RESULT}&name=q`)), 500);
    studio.override = (_request, res) => {
      res.writeHead(200, { "content-type": "application/json" }).end("{not json");
      return true;
    };
    expectEmpty(await send(url(`resultId=${RESULT}&name=q`)), 500);
  });
});

/** An item of Studio's public results. */
const item = (submittedAt: string, data: Record<string, unknown>): string =>
  JSON.stringify({ submittedAt, data });

describe("getSurveyPublicResults", () => {
  const url = (path: string, prefix = "private/Surveys") =>
    `${bridge.url}/${prefix}/getSurveyPublicResults${path}`;

  beforeEach(() => {
    studio.publicResults.set(SURVEY, {
      items: [
        item("2026-10-05T06:48:57.517Z", { satisfaction: 4 }),
        item("2026-10-06T08:00:00.000Z", { satisfaction: 5, comment: "a & b" }),
      ],
    });
  });

  it("answers { Data, ResultCount } with HappendAt and a null InstanceId", async () => {
    const answer = await send(url(`/${SURVEY}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.body.toString()).toBe(
      '{"Data":[' +
        '{"satisfaction":4,"HappendAt":"2026-10-05T06:48:57.517Z","InstanceId":null},' +
        '{"satisfaction":5,"comment":"a & b","HappendAt":"2026-10-06T08:00:00Z","InstanceId":null}' +
        '],"ResultCount":2}',
    );
    expect(answer.body.toString()).not.toMatch(/ClientId|IPAddress/);
    expect(studioPaths()).toEqual([`GET /api/v1/public/surveys/${SURVEY}/results?limit=1000`]);
    expect(legacy.requests).toEqual([]);
  });

  it("takes the ID from the query, and the route's ID over the query's, under both prefixes", async () => {
    for (const address of [
      url(`?id=${SURVEY}`),
      url(`/${SURVEY}/?id=${ZERO}`, "private/v1/Surveys"),
      url(`/${SURVEY.toUpperCase()}`, "PRIVATE/SURVEYS"),
    ]) {
      const answer = await send(address);
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body.toString()).ResultCount).toBe(2);
    }
  });

  it("pages Studio's results to the end", async () => {
    studio.pageSize = 2;
    studio.publicResults.set(SURVEY, {
      items: Array.from({ length: 5 }, (_, i) => item(`2026-10-0${i + 1}T00:00:00Z`, { n: i + 1 })),
    });
    const answer = await send(url(`/${SURVEY}`));
    const body = JSON.parse(answer.body.toString()) as {
      Data: { n: number }[];
      ResultCount: number;
    };
    expect(body.Data.map((row) => row.n)).toEqual([1, 2, 3, 4, 5]);
    expect(body.ResultCount).toBe(5);
    expect(studioPaths()).toEqual([
      `GET /api/v1/public/surveys/${SURVEY}/results?limit=1000`,
      `GET /api/v1/public/surveys/${SURVEY}/results?limit=1000&cursor=2`,
      `GET /api/v1/public/surveys/${SURVEY}/results?limit=1000&cursor=4`,
    ]);
  });

  it("sends from and till to Studio as UTC times, and drops malformed ones", async () => {
    const answer = await send(url(`/${SURVEY}?from=2026-10-05T07:00:00%2B02:00&till=2026-10-07`));
    expect(JSON.parse(answer.body.toString()).ResultCount).toBe(2);
    await send(url(`/${SURVEY}?from=2026-10-05T06:48:58&till=yesterday`));
    expect(studioPaths()).toEqual([
      `GET /api/v1/public/surveys/${SURVEY}/results?limit=1000&from=2026-10-05T05%3A00%3A00Z&till=2026-10-07T00%3A00%3A00Z`,
      `GET /api/v1/public/surveys/${SURVEY}/results?limit=1000&from=2026-10-05T06%3A48%3A58Z`,
    ]);
    const last = await send(url(`/${SURVEY}?from=2026-10-05T06:48:58`));
    expect(JSON.parse(last.body.toString()).ResultCount).toBe(1);
  });

  it("writes values as the old serializer did", async () => {
    studio.publicResults.set(SURVEY, {
      items: [
        '{"submittedAt":"2026-10-05T06:48:57Z","data":{"n":1.0,"big":1e21,"when":"2026-05-01T10:00:00.000Z","list":[1,"x"]}}',
      ],
    });
    const answer = await send(url(`/${SURVEY}`));
    expect(answer.body.toString()).toBe(
      '{"Data":[{"n":1.0,"big":1E+21,"when":"2026-05-01T10:00:00Z","list":[1,"x"],' +
        '"HappendAt":"2026-10-05T06:48:57Z","InstanceId":null}],"ResultCount":1}',
    );
  });

  it("puts its own HappendAt and InstanceId over answers of those names, in place", async () => {
    studio.publicResults.set(SURVEY, {
      items: [item("2026-10-05T06:48:57Z", { HappendAt: "x", a: 1, InstanceId: "y" })],
    });
    const answer = await send(url(`/${SURVEY}`));
    expect(answer.body.toString()).toBe(
      '{"Data":[{"HappendAt":"2026-10-05T06:48:57Z","a":1,"InstanceId":null}],"ResultCount":1}',
    );
  });

  it("leaves out HappendAt and InstanceId when the survey's private questions name them", async () => {
    studio.publicResults.set(SURVEY, {
      items: [item("2026-10-05T06:48:57Z", { a: 1 })],
      privateQuestions: ["HappendAt", "InstanceId"],
    });
    const answer = await send(url(`/${SURVEY}`));
    expect(answer.body.toString()).toBe('{"Data":[{"a":1}],"ResultCount":1}');
  });

  it("answers a survey without results with an empty list", async () => {
    studio.publicResults.set(SURVEY, { items: [] });
    const answer = await send(url(`/${SURVEY}`));
    expect(answer.body.toString()).toBe('{"Data":[],"ResultCount":0}');
  });

  it("answers an unknown survey, or one without public results, with the old refusal", async () => {
    const other = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc";
    const answer = await send(url(`/${other}`));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(answer.body.toString()).toBe(
      `"You are not authorized to get results of the survey ${other}"`,
    );
  });

  it.each([
    ["no ID", ""],
    ["a malformed query ID", "?id=bad"],
    ["a route segment that is no GUID", "/nps"],
    ["a malformed route ID over a good query ID", `/bad?id=${SURVEY}`],
  ])("answers %s for the zero GUID without asking Studio", async (_case, path) => {
    const answer = await send(url(path));
    expect(answer.status).toBe(400);
    expect(answer.body.toString()).toBe(
      `"You are not authorized to get results of the survey ${ZERO}"`,
    );
    expect(studio.requests).toEqual([]);
  });

  it("answers Studio's 429 on the first page as an empty 429", async () => {
    studio.override = (_request, res) => {
      res.writeHead(429).end();
      return true;
    };
    expectEmpty(await send(url(`/${SURVEY}`)), 429);
  });

  it("streams: the first page goes out before the next one is read", async () => {
    studio.pageSize = 1;
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    // Studio holds the second page until the caller has the first.
    studio.override = (request, res) => {
      if (!request.url.includes("cursor=")) return false;
      void held.then(() => {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            `{"survey":{"id":"${SURVEY}","name":"","definition":{}},"items":[${item("2026-10-06T08:00:00Z", { satisfaction: 5 })}],"nextCursor":null}`,
          );
      });
      return true;
    };
    const answer = await new Promise<{ body: string; complete: boolean }>((resolve, reject) => {
      get(`${bridge.url}/private/Surveys/getSurveyPublicResults/${SURVEY}`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
          if (body.includes('"satisfaction":4')) release?.();
        });
        res.on("error", () => undefined);
        res.on("close", () => resolve({ body, complete: res.complete }));
      }).on("error", reject);
    });
    expect(answer.complete).toBe(true);
    expect(JSON.parse(answer.body).ResultCount).toBe(2);
  });

  it("cuts the answer off when a later page fails", async () => {
    studio.pageSize = 1;
    studio.override = (request, res) => {
      if (!request.url.includes("cursor=")) return false;
      res.writeHead(500).end();
      return true;
    };
    const answer = await new Promise<{ status: number; body: string; complete: boolean }>(
      (resolve, reject) => {
        get(`${bridge.url}/private/Surveys/getSurveyPublicResults/${SURVEY}`, (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => (body += chunk.toString()));
          res.on("error", () => undefined);
          res.on("close", () =>
            resolve({ status: res.statusCode ?? 0, body, complete: res.complete }),
          );
        }).on("error", reject);
      },
    );
    expect(answer.status).toBe(200);
    expect(answer.complete).toBe(false);
    expect(answer.body).toContain('{"Data":[{"satisfaction":4');
  });
});

describe("getSurveyPublicResults under Studio's rate limit", () => {
  const address = () => `${bridge.url}/private/Surveys/getSurveyPublicResults/${SURVEY}`;

  beforeEach(() => {
    studio.pageSize = 1;
    studio.publicResults.set(SURVEY, {
      items: Array.from({ length: 4 }, (_, i) => item(`2026-10-0${i + 1}T00:00:00Z`, { n: i + 1 })),
    });
  });

  it("waits as a later page's 429 asks and completes the same answer", async () => {
    let limited = 0;
    studio.override = (request, res) => {
      // Page 3 is limited once.
      if (!request.url.includes("cursor=2") || limited > 0) return false;
      limited += 1;
      res.writeHead(429, { "retry-after": "1" }).end();
      return true;
    };
    const started = Date.now();
    const answer = await send(address());
    expect(answer.status).toBe(200);
    const body = JSON.parse(answer.body.toString()) as {
      Data: { n: number }[];
      ResultCount: number;
    };
    expect(body.Data.map((row) => row.n)).toEqual([1, 2, 3, 4]);
    expect(body.ResultCount).toBe(4);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(studio.requests.filter((request) => request.url.includes("cursor=2"))).toHaveLength(2);
  });

  it("stops reading pages when the caller leaves during the wait", async () => {
    studio.override = (request, res) => {
      if (!request.url.includes("cursor=")) return false;
      res.writeHead(429, { "retry-after": "1" }).end();
      return true;
    };
    await new Promise<void>((resolve) => {
      const request = get(address(), { agent: false }, (res) => {
        res.once("data", () => {
          // Leave once Studio has refused the second page and the bridge waits.
          const check = setInterval(() => {
            if (studio.requests.length >= 2) {
              clearInterval(check);
              request.destroy();
              resolve();
            }
          }, 10);
        });
      });
      request.on("error", () => undefined);
    });
    const seen = studio.requests.length;
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    expect(studio.requests).toHaveLength(seen);
  });

  it("passes a 429 on the first page on as an empty 429, without waiting", async () => {
    studio.override = (_request, res) => {
      res.writeHead(429, { "retry-after": "30" }).end();
      return true;
    };
    const started = Date.now();
    expectEmpty(await send(address()), 429);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(studio.requests).toHaveLength(1);
  });
});

describe("retryDelayMs", () => {
  it.each([
    ["5", 5_000],
    ["0", 1_000],
    [" 0 ", 1_000],
    [null, 60_000],
    ["", 60_000],
    ["soon", 60_000],
    ["1.5", 60_000],
    ["-3", 60_000],
    ["2026-04-01T10:00:30Z", 60_000],
    ["600", 120_000],
    ["Wed, 01 Apr 2026 10:00:30 GMT", 30_000],
    ["Wednesday, 01-Apr-26 10:00:20 GMT", 20_000],
    ["Wed Apr  1 10:00:10 2026", 10_000],
    ["Wed, 01 Apr 2026 09:00:00 GMT", 1_000],
  ])("Retry-After %j → %d ms", (header, ms) => {
    expect(retryDelayMs(header, Date.parse("2026-04-01T10:00:00Z"))).toBe(ms);
  });
});
