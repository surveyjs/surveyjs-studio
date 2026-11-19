import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendJsonString } from "./answers.js";
import { oldRoute, queryValue } from "./routes.js";
import { studioClient, unexpectedStatus } from "./studio.js";
import {
  closedUrl,
  send,
  startBridge,
  startStub,
  TEST_SETTINGS,
  type RunningBridge,
  type Stub,
} from "./testing/http.js";

/** A test action: reads one published survey from Studio and answers its name. */
function registerTitle(app: FastifyInstance): void {
  oldRoute(app, ["GET"], ["getSurvey"], async (request, reply) => {
    const surveyId = queryValue(request, "surveyId") ?? "";
    const { data, response } = await request.studio.GET("/public/surveys/{surveyId}", {
      params: { path: { surveyId } },
    });
    if (data === undefined) return unexpectedStatus(response);
    return sendJsonString(reply, 200, data.name);
  });
}

const SURVEY = {
  id: "s1",
  name: "Hello",
  definition: {},
  theme: null,
  completed: false,
};

let legacy: Stub;
let studio: Stub;
/** What the Studio stub answers next. */
let answer: (res: ServerResponse) => void;

beforeAll(async () => {
  legacy = await startStub((_request, res) =>
    res.writeHead(200, { "content-type": "text/plain" }).end("old service"),
  );
  studio = await startStub((_request, res) => answer(res));
});

afterAll(async () => {
  await legacy.close();
  await studio.close();
});

beforeEach(() => {
  legacy.requests.length = 0;
  studio.requests.length = 0;
  answer = (res) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(SURVEY));
});

describe("calls to Studio", () => {
  let bridge: RunningBridge;
  beforeAll(async () => {
    bridge = await startBridge(
      { studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url },
      registerTitle,
    );
  });
  afterAll(() => bridge.close());

  it("go to Studio's API base with the caller's address in X-Forwarded-For", async () => {
    const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`, {
      // Not trusted (BRIDGE_TRUST_PROXY is empty): the socket's peer counts.
      headers: [["X-Forwarded-For", "203.0.113.7"]],
    });
    expect(response.status).toBe(200);
    expect(response.body.toString()).toBe('"Hello"');
    expect(studio.requests).toHaveLength(1);
    expect(studio.requests[0]!.url).toBe("/api/v1/public/surveys/s1");
    expect(studio.requests[0]!.headers["x-forwarded-for"]).toBe("127.0.0.1");
    expect(legacy.requests).toEqual([]);
  });

  it("pass Studio's 429 on as an empty 429", async () => {
    answer = (res) =>
      res
        .writeHead(429, { "content-type": "application/problem+json", "retry-after": "60" })
        .end(
          '{"type":"about:blank","title":"Too Many Requests","status":429,"code":"rate-limited"}',
        );
    const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`);
    expect(response.status).toBe(429);
    expect(response.headers["content-length"]).toBe("0");
    expect(response.headers["content-type"]).toBeUndefined();
    expect(response.headers["retry-after"]).toBeUndefined();
    expect(response.body.length).toBe(0);
  });

  it.each([500, 502, 503])("answer an empty 500 for Studio's %i", async (status) => {
    answer = (res) => res.writeHead(status).end();
    const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`);
    expect(response.status).toBe(500);
    expect(response.headers["content-length"]).toBe("0");
    expect(response.body.length).toBe(0);
  });

  it("answer an empty 500 for a status the action does not expect", async () => {
    answer = (res) => res.writeHead(404, { "content-type": "application/problem+json" }).end("{}");
    const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`);
    expect(response.status).toBe(500);
    expect(response.body.length).toBe(0);
  });
});

describe("behind a trusted proxy (BRIDGE_TRUST_PROXY)", () => {
  let bridge: RunningBridge;
  beforeAll(async () => {
    bridge = await startBridge(
      { studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url, trustProxy: ["127.0.0.1"] },
      registerTitle,
    );
  });
  afterAll(() => bridge.close());

  it("sends the address the proxy names", async () => {
    await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`, {
      headers: [["X-Forwarded-For", "198.51.100.9"]],
    });
    expect(studio.requests[0]!.headers["x-forwarded-for"]).toBe("198.51.100.9");
  });

  it("forwards to the old service with the proxy's address appended", async () => {
    await send(`${bridge.url}/private/Surveys/nps`, {
      headers: [["X-Forwarded-For", "198.51.100.9"]],
    });
    expect(legacy.requests[0]!.headers["x-forwarded-for"]).toBe("198.51.100.9, 127.0.0.1");
  });
});

// Review Focus 2.
describe("when Studio is down or slow", () => {
  let bridge: RunningBridge | undefined;
  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it("answers an empty 500 within BRIDGE_STUDIO_TIMEOUT_MS, and forwarded paths still answer", async () => {
    const silent = await startStub(() => undefined);
    try {
      bridge = await startBridge(
        { studioUrl: `${silent.url}/api/v1`, legacyUrl: legacy.url, studioTimeoutMs: 300 },
        registerTitle,
      );
      const started = Date.now();
      const [action, forwarded] = await Promise.all([
        send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`).then((response) => ({
          response,
          ms: Date.now() - started,
        })),
        send(`${bridge.url}/private/Surveys/nps`),
      ]);
      expect(action.response.status).toBe(500);
      expect(action.response.headers["content-length"]).toBe("0");
      expect(action.response.body.length).toBe(0);
      expect(action.ms).toBeGreaterThanOrEqual(250);
      expect(action.ms).toBeLessThan(2_000);
      expect(forwarded.status).toBe(200);
      expect(forwarded.body.toString()).toBe("old service");
    } finally {
      await bridge?.close();
      bridge = undefined;
      await silent.close();
    }
  });

  it("answers an empty 500 when Studio cannot be reached", async () => {
    bridge = await startBridge(
      { studioUrl: `${await closedUrl()}/api/v1`, legacyUrl: legacy.url },
      registerTitle,
    );
    const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`);
    expect(response.status).toBe(500);
    expect(response.body.length).toBe(0);
  });

  it("answers an empty 500 when Studio's answer stalls after its headers", async () => {
    const stalling = await startStub((_request, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write('{"id":"s1",');
    });
    try {
      bridge = await startBridge(
        { studioUrl: `${stalling.url}/api/v1`, legacyUrl: legacy.url, studioTimeoutMs: 300 },
        registerTitle,
      );
      const started = Date.now();
      const response = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=s1`);
      expect(response.status).toBe(500);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await bridge?.close();
      bridge = undefined;
      await stalling.close();
    }
  });
});

describe("studioClient", () => {
  it("uses the given fetch and sends X-Forwarded-For", async () => {
    const seen: Request[] = [];
    const client = studioClient(
      { ...TEST_SETTINGS, studioUrl: "http://studio.test/api/v1/" },
      "192.0.2.4",
      async (request) => {
        seen.push(request);
        return new Response(JSON.stringify(SURVEY), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const { data } = await client.GET("/public/surveys/{surveyId}", {
      params: { path: { surveyId: "a b" } },
    });
    expect(data?.name).toBe("Hello");
    expect(seen[0]!.url).toBe("http://studio.test/api/v1/public/surveys/a%20b");
    expect(seen[0]!.headers.get("x-forwarded-for")).toBe("192.0.2.4");
  });
});
