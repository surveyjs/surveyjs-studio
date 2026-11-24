import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendJsonString } from "./answers.js";
import { oldRoute, queryValue } from "./routes.js";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "./testing/http.js";

let legacy: Stub;
let bridge: RunningBridge;

beforeAll(async () => {
  legacy = await startStub((request, res) => {
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end(`old ${request.method} ${request.url}`);
  });
  bridge = await startBridge(
    { studioUrl: "http://127.0.0.1:9/api/v1", legacyUrl: legacy.url },
    (app) => {
      oldRoute(app, ["GET"], ["getSurvey"], async (request, reply) =>
        sendJsonString(reply, 200, `survey ${queryValue(request, "surveyId") ?? "(none)"}`),
      );
      oldRoute(app, ["POST"], ["post"], async (_request, reply) =>
        sendJsonString(reply, 200, "posted"),
      );
      oldRoute(
        app,
        ["GET"],
        ["getSurveyPublicResults", "getSurveyPublicResults/:id"],
        async (request, reply) => {
          const { id } = request.params as { id?: string };
          return sendJsonString(reply, 200, `results ${id ?? "(no id)"}`);
        },
        { controller: "private" },
      );
    },
  );
});

afterAll(async () => {
  await bridge.close();
  await legacy.close();
});

beforeEach(() => {
  legacy.requests.length = 0;
});

describe("the route table", () => {
  // Review Focus 1.
  it("answers /PUBLIC/V1/Survey/GetSurvey/?surveyId=… exactly as /public/Survey/getSurvey?surveyId=…", async () => {
    const id = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
    const canonical = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=${id}`);
    const variant = await send(`${bridge.url}/PUBLIC/V1/Survey/GetSurvey/?surveyId=${id}`);
    expect(canonical.status).toBe(200);
    expect(canonical.body.toString()).toBe(`"survey ${id}"`);
    expect(variant.status).toBe(canonical.status);
    expect(variant.headers["content-type"]).toBe(canonical.headers["content-type"]);
    expect(variant.body.equals(canonical.body)).toBe(true);
    expect(legacy.requests).toEqual([]);
  });

  it.each([
    "/public/Survey/getSurvey",
    "/public/Survey/getSurvey/",
    "/public/v1/Survey/getSurvey",
    "/public/v1/Survey/getSurvey/",
    "/Public/survey/GETSURVEY",
    "/PUBLIC/V1/SURVEY/getsurvey/",
  ])("handles %s itself", async (path) => {
    const answer = await send(`${bridge.url}${path}?surveyId=x`);
    expect(answer.body.toString()).toBe('"survey x"');
    expect(legacy.requests).toEqual([]);
  });

  it("reads query parameter names in any letter case, the first value of a repeated one", async () => {
    const answer = await send(
      `${bridge.url}/public/Survey/getSurvey?SURVEYID=a%20b+c&surveyid=second`,
    );
    expect(answer.body.toString()).toBe('"survey a b c"');
  });

  it("answers without the parameter", async () => {
    const answer = await send(`${bridge.url}/public/Survey/getSurvey`);
    expect(answer.body.toString()).toBe('"survey (none)"');
  });

  it("registers the private pair and the {id} forms, keeping the id's letter case", async () => {
    const withId = await send(`${bridge.url}/Private/V1/Surveys/GETSURVEYPUBLICRESULTS/AbC-1/`);
    expect(withId.body.toString()).toBe('"results AbC-1"');
    const without = await send(`${bridge.url}/private/Surveys/getSurveyPublicResults`);
    expect(without.body.toString()).toBe('"results (no id)"');
    expect(legacy.requests).toEqual([]);
  });

  it("does not register the public pair for a private action, nor the private pair for a public one", async () => {
    await send(`${bridge.url}/public/Survey/getSurveyPublicResults`);
    await send(`${bridge.url}/private/Surveys/getSurvey?surveyId=x`);
    expect(legacy.requests.map((request) => request.url)).toEqual([
      "/public/Survey/getSurveyPublicResults",
      "/private/Surveys/getSurvey?surveyId=x",
    ]);
  });

  it.each([
    ["HEAD", "/public/Survey/getSurvey?surveyId=x"],
    ["POST", "/public/Survey/getSurvey?surveyId=x"],
    ["GET", "/public/Survey/post"],
    ["GET", "/public/Survey/getSurvey//?surveyId=x"],
    ["GET", "/public/Survey/getSurvey/x"],
    ["GET", "/public/v2/Survey/getSurvey?surveyId=x"],
    ["GET", "/public/Survey/getSurvey.json"],
    ["POST", "/public/Survey/post/page-number"],
    // The router refuses these before matching: a malformed escape, a segment over its limit.
    ["GET", "/private/Surveys/getSurveyPublicResults/%E0%A4%A"],
    ["GET", `/private/Surveys/getSurveyPublicResults/${"a".repeat(1025)}`],
  ])("forwards %s %s, which no route of the table matches", async (method, path) => {
    const answer = await send(`${bridge.url}${path}`, { method });
    expect(answer.status).toBe(200);
    expect(legacy.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      `${method} ${path}`,
    ]);
  });
});
