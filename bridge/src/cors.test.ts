import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendEmpty, sendJsonString } from "./answers.js";
import { oldRoute } from "./routes.js";
import {
  headerNames,
  send,
  startBridge,
  startStub,
  type RunningBridge,
  type Stub,
} from "./testing/http.js";

let legacy: Stub;
let bridge: RunningBridge;

beforeAll(async () => {
  legacy = await startStub((_request, res) => res.writeHead(405, { allow: "GET, HEAD" }).end());
  bridge = await startBridge(
    { studioUrl: "http://127.0.0.1:9/api/v1", legacyUrl: legacy.url },
    (app) => {
      oldRoute(app, ["GET"], ["getSurvey"], async (_request, reply) =>
        sendJsonString(reply, 200, "ok"),
      );
      oldRoute(app, ["GET"], ["isCompleted"], async () => {
        throw new Error("boom");
      });
      oldRoute(app, ["POST"], ["post"], async (_request, reply) => sendEmpty(reply, 200));
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

describe("CORS, as the old API's policy (any origin, method and header)", () => {
  it.each([
    "/public/Survey/post",
    "/public/v1/Survey/getSurvey",
    "/private/Surveys/tempFiles",
    "/no/such/path",
  ])(
    "answers a preflight to %s itself: 204, the requested method and headers echoed",
    async (path) => {
      const response = await send(`${bridge.url}${path}`, {
        method: "OPTIONS",
        headers: [
          ["Origin", "https://site.example"],
          ["Access-Control-Request-Method", "POST"],
          ["Access-Control-Request-Headers", "content-type, x-requested-with"],
        ],
      });
      expect(response.status).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      expect(response.headers["access-control-allow-methods"]).toBe("POST");
      expect(response.headers["access-control-allow-headers"]).toBe(
        "content-type,x-requested-with",
      );
      const names = headerNames(response.rawHeaders);
      expect(names).not.toContain("access-control-max-age");
      expect(names).not.toContain("access-control-allow-credentials");
      expect(names).not.toContain("vary");
      expect(response.body.length).toBe(0);
      expect(legacy.requests).toEqual([]);
    },
  );

  it("sends no Access-Control-Allow-Headers when none are requested", async () => {
    const response = await send(`${bridge.url}/public/Survey/getSurvey`, {
      method: "OPTIONS",
      headers: [
        ["Origin", "https://site.example"],
        ["Access-Control-Request-Method", "GET"],
      ],
    });
    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toBe("GET");
    expect(headerNames(response.rawHeaders)).not.toContain("access-control-allow-headers");
  });

  it.each([
    ["no Origin", [["Access-Control-Request-Method", "POST"]]],
    ["no Access-Control-Request-Method", [["Origin", "https://site.example"]]],
  ] as [string, [string, string][]][])(
    "forwards an OPTIONS request with %s",
    async (_, headers) => {
      const response = await send(`${bridge.url}/public/Survey/post`, {
        method: "OPTIONS",
        headers,
      });
      expect(response.status).toBe(405);
      expect(legacy.requests.map((request) => request.method)).toEqual(["OPTIONS"]);
    },
  );

  it.each([
    ["an answer", "/public/Survey/getSurvey", 200],
    ["an empty answer", "/public/Survey/post", 200],
    ["an error", "/public/Survey/isCompleted", 500],
  ])(
    "adds Access-Control-Allow-Origin: * to %s when the request has an Origin",
    async (_, path, status) => {
      const method = path.endsWith("post") ? "POST" : "GET";
      const response = await send(`${bridge.url}${path}`, {
        method,
        headers: [["Origin", "https://site.example"]],
      });
      expect(response.status).toBe(status);
      expect(response.headers["access-control-allow-origin"]).toBe("*");
      const names = headerNames(response.rawHeaders);
      expect(names).not.toContain("vary");
      expect(names).not.toContain("access-control-expose-headers");
      expect(names).not.toContain("access-control-allow-credentials");
    },
  );

  it("adds no CORS header without an Origin", async () => {
    const response = await send(`${bridge.url}/public/Survey/getSurvey`);
    expect(
      headerNames(response.rawHeaders).filter((name) => name.startsWith("access-control-")),
    ).toEqual([]);
  });

  it("leaves forwarded answers as the old service sent them", async () => {
    const response = await send(`${bridge.url}/no/such/path`, {
      method: "POST",
      headers: [["Origin", "https://site.example"]],
    });
    expect(response.status).toBe(405);
    expect(legacy.requests[0]!.headers.origin).toBe("https://site.example");
    // The stub adds none; the old service adds its own.
    expect(headerNames(response.rawHeaders)).not.toContain("access-control-allow-origin");
  });
});
