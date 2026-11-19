import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  sendEmpty,
  sendJson,
  sendJsonNull,
  sendJsonString,
  sendProblem,
  sendValidationProblem,
} from "./answers.js";
import { buildBridge } from "./app.js";
import { oldRoute } from "./routes.js";
import { TEST_SETTINGS } from "./testing/http.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = buildBridge({
    ...TEST_SETTINGS,
    studioUrl: "http://127.0.0.1:9/api/v1",
    legacyUrl: "http://127.0.0.1:9",
  });
  oldRoute(app, ["GET"], ["string"], async (_request, reply) =>
    sendJsonString(reply, 400, 'Check "parameter" values.\n<b>&</b>'),
  );
  oldRoute(app, ["GET"], ["null"], async (_request, reply) => sendJsonNull(reply));
  oldRoute(app, ["GET"], ["json"], async (_request, reply) =>
    sendJson(reply, 200, { Data: [{ A: 1 }], ResultCount: 1 }),
  );
  for (const status of [200, 400, 404, 500] as const) {
    oldRoute(app, ["GET"], [`empty${status}`], async (_request, reply) => sendEmpty(reply, status));
  }
  for (const status of [400, 404, 415] as const) {
    oldRoute(app, ["GET"], [`problem${status}`], async (_request, reply) =>
      sendProblem(reply, status),
    );
  }
  oldRoute(app, ["GET"], ["validation"], async (_request, reply) =>
    sendValidationProblem(reply, { surveyId: ["The value 'bad' is not valid."] }),
  );
  await app.ready();
});

afterAll(() => app.close());

const JSON_UTF8 = "application/json; charset=utf-8";
const PROBLEM_UTF8 = "application/problem+json; charset=utf-8";

describe("the old answer building blocks", () => {
  it("JSON string: the text as a JSON string literal", async () => {
    const response = await app.inject("/public/Survey/string");
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toBe(JSON_UTF8);
    expect(response.body).toBe('"Check \\"parameter\\" values.\\n<b>&</b>"');
  });

  it("JSON null", async () => {
    const response = await app.inject("/public/Survey/null");
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(JSON_UTF8);
    expect(response.body).toBe("null");
  });

  it("JSON value, property names as given", async () => {
    const response = await app.inject("/public/Survey/json");
    expect(response.headers["content-type"]).toBe(JSON_UTF8);
    expect(JSON.parse(response.body)).toEqual({ Data: [{ A: 1 }], ResultCount: 1 });
  });

  it.each([200, 400, 404, 500])(
    "empty %i: Content-Length 0 and no Content-Type",
    async (status) => {
      const response = await app.inject(`/public/Survey/empty${status}`);
      expect(response.statusCode).toBe(status);
      expect(response.headers["content-length"]).toBe("0");
      expect(response.headers["content-type"]).toBeUndefined();
      expect(response.body).toBe("");
    },
  );

  it.each([
    [400, "https://tools.ietf.org/html/rfc9110#section-15.5.1", "Bad Request"],
    [404, "https://tools.ietf.org/html/rfc9110#section-15.5.5", "Not Found"],
    [415, "https://tools.ietf.org/html/rfc9110#section-15.5.16", "Unsupported Media Type"],
  ])("ProblemDetails %i", async (status, type, title) => {
    const response = await app.inject(`/public/Survey/problem${status}`);
    expect(response.statusCode).toBe(status);
    expect(response.headers["content-type"]).toBe(PROBLEM_UTF8);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["type", "title", "status", "traceId"]);
    expect(body).toMatchObject({ type, title, status });
    expect(body.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
  });

  it("ProblemDetails validation 400: errors first", async () => {
    const response = await app.inject("/public/Survey/validation");
    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toBe(PROBLEM_UTF8);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["errors", "type", "title", "status", "traceId"]);
    expect(body).toMatchObject({
      errors: { surveyId: ["The value 'bad' is not valid."] },
      type: "https://tools.ietf.org/html/rfc9110#section-15.5.1",
      title: "One or more validation errors occurred.",
      status: 400,
    });
  });

  it("trace IDs differ per request", async () => {
    const one = JSON.parse((await app.inject("/public/Survey/problem404")).body) as {
      traceId: string;
    };
    const two = JSON.parse((await app.inject("/public/Survey/problem404")).body) as {
      traceId: string;
    };
    expect(one.traceId).not.toBe(two.traceId);
  });

  // The old API's content negotiation: `*/*` (what nearly every client sends) or no Accept gives
  // application/json; an Accept naming text/json and no */* gives text/json.
  it.each([
    [undefined, JSON_UTF8],
    ["*/*", JSON_UTF8],
    ["application/json, text/plain, */*", JSON_UTF8],
    ["text/json", "text/json; charset=utf-8"],
    ["text/json, */*", JSON_UTF8],
    ["text/plain;q=1, text/json;q=0.5", "text/json; charset=utf-8"],
    ["application/json;q=0.4, text/json;q=0.9", "text/json; charset=utf-8"],
    ["text/*", "text/json; charset=utf-8"],
    ["application/*", JSON_UTF8],
    ["text/html", JSON_UTF8],
    ["text/json;q=0", JSON_UTF8],
  ])("Accept %s → %s", async (accept, contentType) => {
    const headers = accept === undefined ? {} : { accept };
    for (const path of ["string", "null", "json"]) {
      const response = await app.inject({ url: `/public/Survey/${path}`, headers });
      expect(response.headers["content-type"]).toBe(contentType);
    }
  });

  it("ProblemDetails keep their content type whatever the Accept", async () => {
    const response = await app.inject({
      url: "/public/Survey/problem404",
      headers: { accept: "text/json" },
    });
    expect(response.headers["content-type"]).toBe(PROBLEM_UTF8);
  });
});
