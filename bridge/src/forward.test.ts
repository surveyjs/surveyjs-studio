import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { endToEndHeaders, originTarget, requestFraming } from "./forward.js";
import {
  closedUrl,
  headerNames,
  send,
  sendRaw,
  startBridge,
  startStub,
  type RunningBridge,
  type Stub,
} from "./testing/http.js";

const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

let legacy: Stub;
let bridge: RunningBridge;
/** What the old-service stub answers next. */
let answer: (res: ServerResponse) => void;

beforeAll(async () => {
  legacy = await startStub((_request, res) => answer(res));
  bridge = await startBridge({ studioUrl: "http://127.0.0.1:9/api/v1", legacyUrl: legacy.url });
});

afterAll(async () => {
  await bridge.close();
  await legacy.close();
});

beforeEach(() => {
  legacy.requests.length = 0;
  answer = (res) => res.writeHead(200, { "content-type": "text/plain" }).end("old service");
});

describe("forwarding to the old service", () => {
  // The site's paths (legacy-api-usage.md › Forwarded to the old service), its scheduled jobs, the
  // start page and paths no action has.
  it.each([
    ["GET", "/private/Surveys/getTempFile?name=a1.png"],
    ["GET", "/private/v1/Surveys/getTempFile?name=a1.png"],
    ["GET", "/private/Surveys/tempFiles"],
    ["POST", "/private/v1/Surveys/tempFiles"],
    ["DELETE", "/private/Surveys/tempFiles"],
    ["POST", "/private/Surveys/uploadTempFiles"],
    ["DELETE", "/private/v1/Surveys/deleteTempFile?name=a1.png"],
    ["GET", "/private/Surveys/nps"],
    ["GET", "/private/v1/Surveys/nps/"],
    ["GET", "/private/Surveys/getSurveyNPCResults/"],
    ["GET", "/private/v1/Surveys/getSurveyNPSResults"],
    ["GET", "/private/Surveys/getSurveyPublicDemoResults"],
    ["GET", "/private/v1/Surveys/getSurveyPublicDemoResults/0f5c2a8e-1b2c-4d3e-8f90-123456789abc"],
    ["GET", "/private/Service/checkPQueue?key=k"],
    ["GET", "/private/Service/emailMonitoring?key=k"],
    ["GET", "/private/Service/checkRenewals?key=k"],
    ["GET", "/private/Service/deleteTempFiles?key=k"],
    ["GET", "/"],
    ["GET", "/robots.txt"],
    ["GET", "/private/Surveys/nps/data.json"],
    ["PUT", "/no/such/path"],
    ["PATCH", "/public/Survey/anything"],
  ])("%s %s reaches the old service unchanged and its answer comes back", async (method, path) => {
    const body = method === "GET" || method === "DELETE" ? undefined : `body of ${path}`;
    answer = (res) =>
      res
        .writeHead(207, {
          "content-type": "application/json; charset=utf-8",
          "x-old": "yes",
        })
        .end(`{"path":${JSON.stringify(path)}}`);
    const response = await send(`${bridge.url}${path}`, {
      method,
      headers: [
        ["Accept", "*/*"],
        ["X-Custom", "one"],
        ["Cookie", "a=1; b=2"],
        ...(body === undefined
          ? []
          : ([["Content-Type", "application/octet-stream"]] as [string, string][])),
      ],
      body,
    });

    expect(legacy.requests).toHaveLength(1);
    const forwarded = legacy.requests[0]!;
    expect(forwarded.method).toBe(method);
    expect(forwarded.url).toBe(path);
    expect(forwarded.headers.host).toBe(new URL(legacy.url).host);
    expect(forwarded.headers.accept).toBe("*/*");
    expect(forwarded.headers["x-custom"]).toBe("one");
    expect(forwarded.headers.cookie).toBe("a=1; b=2");
    expect(forwarded.body.toString()).toBe(body ?? "");

    expect(response.status).toBe(207);
    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.headers["x-old"]).toBe("yes");
    expect(response.body.toString()).toBe(`{"path":${JSON.stringify(path)}}`);
  });

  it("keeps the query string byte for byte", async () => {
    const path = "/private/Surveys/getTempFile?b=%2f&a=1&a=2&c=%E2%82%AC&d=+x&e&%7E=~";
    await send(`${bridge.url}${path}`);
    expect(legacy.requests[0]!.url).toBe(path);
  });

  it("drops hop-by-hop request headers and those Connection names", async () => {
    await send(`${bridge.url}/private/Surveys/nps`, {
      headers: [
        ["Connection", "keep-alive, X-Hop"],
        ["X-Hop", "secret"],
        ["Keep-Alive", "timeout=5"],
        ["TE", "trailers"],
        ["Upgrade", "h2c"],
        ["Proxy-Authorization", "Basic eDp5"],
        ["Proxy-Connection", "keep-alive"],
        ["X-Kept", "kept"],
      ],
    });
    const names = headerNames(legacy.requests[0]!.rawHeaders);
    // Node itself refuses to send Trailer here; endToEndHeaders' test covers it.
    for (const name of [...HOP_BY_HOP.filter((n) => n !== "connection"), "x-hop"]) {
      expect(names).not.toContain(name);
    }
    expect(legacy.requests[0]!.headers["x-kept"]).toBe("kept");
  });

  it("sends a body of known length with its Content-Length, unchanged", async () => {
    const body = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
    await send(`${bridge.url}/private/Surveys/uploadTempFiles`, {
      method: "POST",
      headers: [["Content-Type", "multipart/form-data; boundary=x"]],
      body,
    });
    const forwarded = legacy.requests[0]!;
    expect(forwarded.headers["content-length"]).toBe(String(body.length));
    expect(forwarded.headers["transfer-encoding"]).toBeUndefined();
    expect(forwarded.headers["content-type"]).toBe("multipart/form-data; boundary=x");
    expect(forwarded.body.equals(body)).toBe(true);
  });

  it.each(["POST", "DELETE"])("forwards a %s body sent in chunks, whole", async (method) => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${bridge.url}/private/Surveys/tempFiles`,
        { method, agent: false, headers: { "transfer-encoding": "chunked" } },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.write("first,");
      setTimeout(() => req.end("second"), 20);
    });
    expect(status).toBe(200);
    expect(legacy.requests[0]!.method).toBe(method);
    expect(legacy.requests[0]!.body.toString()).toBe("first,second");
  });

  it("drops hop-by-hop answer headers and keeps the rest, repeated ones included", async () => {
    answer = (res) => {
      res.writeHead(
        200,
        [
          ["Content-Type", "text/html; charset=utf-8"],
          // A known length, so neither hop chunks the answer.
          ["Content-Length", "13"],
          ["Content-Disposition", 'attachment; filename="a b.png"'],
          ["Cache-Control", "no-store"],
          ["ETag", '"abc"'],
          ["Set-Cookie", "a=1; Path=/"],
          ["Set-Cookie", "b=2; Path=/"],
          ["Access-Control-Allow-Origin", "*"],
          ["Connection", "X-Hop"],
          ["X-Hop", "secret"],
          ["Keep-Alive", "timeout=5"],
          ["Proxy-Authenticate", "Basic"],
          ["Upgrade", "h2c"],
        ].flat(),
      );
      res.end("<html></html>");
    };
    const response = await send(`${bridge.url}/`, {
      headers: [["Origin", "https://site.example"]],
    });
    expect(response.status).toBe(200);
    const names = headerNames(response.rawHeaders);
    // Node itself refuses to send Trailer here; endToEndHeaders' test covers it.
    for (const name of [...HOP_BY_HOP.filter((n) => n !== "connection"), "x-hop"]) {
      expect(names).not.toContain(name);
    }
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["content-disposition"]).toBe('attachment; filename="a b.png"');
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.etag).toBe('"abc"');
    expect(response.headers["set-cookie"]).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    // The old service's own CORS answer, once.
    expect(names.filter((name) => name === "access-control-allow-origin")).toHaveLength(1);
    expect(response.body.toString()).toBe("<html></html>");
  });

  it("passes an encoded body through as it is", async () => {
    const gz = gzipSync(Buffer.from("x".repeat(10_000)));
    answer = (res) =>
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" }).end(gz);
    const response = await send(`${bridge.url}/robots.txt`, {
      headers: [["Accept-Encoding", "gzip"]],
    });
    expect(legacy.requests[0]!.headers["accept-encoding"]).toBe("gzip");
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(response.body.equals(gz)).toBe(true);
  });

  it.each([
    [405, { allow: "GET, HEAD" }, ""],
    [404, {}, ""],
    [500, {}, ""],
    [302, { location: "https://surveyjs.io/" }, ""],
  ])("passes status %i through", async (status, headers, body) => {
    answer = (res) => res.writeHead(status, headers).end(body);
    const response = await send(`${bridge.url}/public/Survey/unknown`, { method: "POST" });
    expect(response.status).toBe(status);
    for (const [name, value] of Object.entries(headers)) expect(response.headers[name]).toBe(value);
  });

  it("answers HEAD without a body, with the old service's headers", async () => {
    answer = (res) =>
      res.writeHead(200, { "content-type": "text/html", "content-length": "1234" }).end();
    const response = await send(`${bridge.url}/`, { method: "HEAD" });
    expect(legacy.requests[0]!.method).toBe("HEAD");
    expect(response.headers["content-length"]).toBe("1234");
    expect(response.body.length).toBe(0);
  });

  it("adds the caller's address to X-Forwarded-For", async () => {
    await send(`${bridge.url}/private/Surveys/nps`);
    expect(legacy.requests[0]!.headers["x-forwarded-for"]).toBe("127.0.0.1");
    await send(`${bridge.url}/private/Surveys/nps`, {
      headers: [
        ["X-Forwarded-For", "203.0.113.7"],
        ["X-Forwarded-For", "198.51.100.1"],
      ],
    });
    expect(legacy.requests[1]!.headers["x-forwarded-for"]).toBe(
      "203.0.113.7, 198.51.100.1, 127.0.0.1",
    );
  });
});

describe("endToEndHeaders", () => {
  it("drops the hop-by-hop headers, those Connection names and the given ones, in any letter case", () => {
    expect(
      endToEndHeaders(
        [
          "Host",
          "a",
          "connection",
          "close, X-One",
          "x-one",
          "1",
          "TE",
          "trailers",
          "Trailer",
          "X-Sum",
          "Transfer-Encoding",
          "chunked",
          "Upgrade",
          "h2c",
          "Keep-Alive",
          "timeout=5",
          "Proxy-Authenticate",
          "Basic",
          "Proxy-Authorization",
          "x",
          "Proxy-Connection",
          "keep-alive",
          "Set-Cookie",
          "a=1",
          "set-cookie",
          "b=2",
          "X-Two",
          "2",
        ],
        ["host"],
      ),
    ).toEqual(["Set-Cookie", "a=1", "set-cookie", "b=2", "X-Two", "2"]);
  });

  it("never lets Connection remove the framing or the bridge's own headers", () => {
    expect(
      endToEndHeaders([
        "Connection",
        "Content-Length, Transfer-Encoding, Host, X-Forwarded-For, X-Gone",
        "Content-Length",
        "5",
        "Host",
        "h",
        "X-Forwarded-For",
        "192.0.2.1",
        "X-Gone",
        "1",
      ]),
    ).toEqual(["Content-Length", "5", "Host", "h", "X-Forwarded-For", "192.0.2.1"]);
  });
});

describe("originTarget", () => {
  it.each([
    ["/a/b?c=%2F+d", "/a/b?c=%2F+d"],
    ["/", "/"],
    ["http://a/b%2F?c=%41", "/b%2F?c=%41"],
    ["HTTP://a", "/"],
    ["https://a.example:8443?x=1", "/?x=1"],
    ["*", undefined],
    ["http://", undefined],
    ["http:///x", undefined],
    ["a/b", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%s → %s", (url, target) => {
    expect(originTarget(url)).toBe(target);
  });
});

describe("hostile and malformed requests", () => {
  const SMUGGLED =
    "GET /private/Service/checkPQueue?key=k HTTP/1.1\r\nHost: old\r\nX-Forwarded-For: 6.6.6.6\r\n\r\n";

  it.each(["GET", "DELETE", "POST"])(
    "%s naming Content-Length in Connection reaches the old service as one request, its body framed",
    async (method) => {
      const { data } = await sendRaw(
        bridge.url,
        `${method} /x HTTP/1.1\r\nHost: b\r\nConnection: close, content-length\r\n` +
          `Content-Length: ${Buffer.byteLength(SMUGGLED)}\r\n\r\n${SMUGGLED}`,
      );
      expect(data.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
      // Let a smuggled second request arrive, if there were one.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(legacy.requests).toHaveLength(1);
      const forwarded = legacy.requests[0]!;
      expect(forwarded.method).toBe(method);
      expect(forwarded.url).toBe("/x");
      expect(forwarded.headers["content-length"]).toBe(String(Buffer.byteLength(SMUGGLED)));
      expect(forwarded.body.toString()).toBe(SMUGGLED);
      expect(forwarded.headers["x-forwarded-for"]).toBe("127.0.0.1");
      expect(forwarded.headers.host).toBe(new URL(legacy.url).host);
    },
  );

  it.each(["GET http:// HTTP/1.1", "OPTIONS * HTTP/1.1", "GET http:///x HTTP/1.1"])(
    "%s: an empty 400 at once, and the bridge keeps serving",
    async (line) => {
      const { data, timedOut } = await sendRaw(
        bridge.url,
        `${line}\r\nHost: x\r\nConnection: close\r\n\r\n`,
      );
      expect(timedOut).toBe(false);
      expect(data.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
      expect(data).toMatch(/content-length: 0/i);
      expect(legacy.requests).toEqual([]);
      const next = await send(`${bridge.url}/private/Surveys/nps`);
      expect(next.status).toBe(200);
      expect(legacy.requests).toHaveLength(1);
    },
  );

  it("forwards an absolute-form target as its path and query bytes", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "GET http://a.example/b%2F?c=%41&d=+ HTTP/1.1\r\nHost: a.example\r\nConnection: close\r\n\r\n",
    );
    expect(data.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
    expect(legacy.requests[0]!.url).toBe("/b%2F?c=%41&d=+");
  });

  it("forwards 20 KB of cookies", async () => {
    const cookie = `big=${"c".repeat(20 * 1024)}`;
    const response = await send(`${bridge.url}/private/Surveys/nps`, {
      headers: [["Cookie", cookie]],
    });
    expect(response.status).toBe(200);
    expect(legacy.requests[0]!.headers.cookie).toBe(cookie);
  });

  it("forwards a plain HTTP/1.0 request with the peer's address", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "GET /private/Surveys/nps HTTP/1.0\r\nX-Forwarded-For: 203.0.113.7\r\n\r\n",
    );
    expect(data.split("\r\n")[0]).toMatch(/^HTTP\/1\.[01] 200 OK$/);
    expect(legacy.requests[0]!.headers["x-forwarded-for"]).toBe("203.0.113.7, 127.0.0.1");
  });

  // A request whose connection fails before it is forwarded (here: a second request Node's parser
  // refuses) must never reach the old service with only the caller's own X-Forwarded-For.
  it.each([
    [
      "POST HTTP/1.0 without a length, then a request",
      `POST /pay HTTP/1.0\r\nHost: b\r\nX-Forwarded-For: 6.6.6.6\r\n\r\n${"GET /private/Service/checkPQueue?key=k HTTP/1.1\r\nHost: old\r\nX-Forwarded-For: 6.6.6.6\r\n\r\n"}`,
    ],
    [
      "GET HTTP/1.1 Connection: close, then a request",
      "GET /pay HTTP/1.1\r\nHost: b\r\nConnection: close\r\nX-Forwarded-For: 6.6.6.6\r\n\r\nGET /y HTTP/1.1\r\nHost: old\r\n\r\n",
    ],
    [
      "GET HTTP/1.1, then a malformed request",
      "GET /pay HTTP/1.1\r\nHost: b\r\nX-Forwarded-For: 6.6.6.6\r\n\r\nG\x01T / HTTP/1.1\r\n\r\n",
    ],
  ])("%s: no request reaches the old service without the peer's address", async (_, text) => {
    for (let round = 0; round < 5; round++) {
      // A warm connection to the old service, as in production.
      await send(`${bridge.url}/private/Surveys/nps`);
      await sendRaw(bridge.url, text);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(legacy.requests.length).toBeGreaterThanOrEqual(5);
    for (const request of legacy.requests) {
      expect(request.headers["x-forwarded-for"]).toMatch(/(^|, )127\.0\.0\.1$/);
    }
  });

  it.each([
    ["a malformed request line", "G\x01T / HTTP/1.1\r\nHost: b\r\n\r\n", "400 Bad Request"],
    [
      "headers over 32 KB",
      `GET / HTTP/1.1\r\nHost: b\r\nCookie: ${"c".repeat(40 * 1024)}\r\n\r\n`,
      "431 Request Header Fields Too Large",
    ],
  ])("answers %s Node refuses with an empty answer and closes", async (_, text, status) => {
    const { data, timedOut } = await sendRaw(bridge.url, text);
    expect(timedOut).toBe(false);
    expect(data).toBe(`HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    expect(legacy.requests).toEqual([]);
  });

  it("answers a transfer coding other than chunked with an empty 400", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "POST /private/Surveys/tempFiles HTTP/1.1\r\nHost: b\r\nTransfer-Encoding: gzip, chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n0\r\n\r\n",
    );
    expect(data.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request");
    expect(data).toMatch(/content-length: 0/i);
    expect(legacy.requests).toEqual([]);
  });

  it("forwards the length as a plain number", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "POST /private/Surveys/tempFiles HTTP/1.1\r\nHost: b\r\nContent-Length: 005\r\nConnection: close\r\n\r\nhello",
    );
    expect(data.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
    expect(legacy.requests[0]!.headers["content-length"]).toBe("5");
    expect(legacy.requests[0]!.body.toString()).toBe("hello");
  });
});

describe("requestFraming", () => {
  const framing = (headers: Record<string, string>) =>
    requestFraming({ headers } as unknown as IncomingMessage);

  it.each([
    [{}, "none"],
    [{ "content-length": "0" }, "0"],
    [{ "content-length": "088" }, "88"],
    [{ "content-length": "12345678901234567890" }, "12345678901234567890"],
    [{ "content-length": "1, 1" }, "invalid"],
    [{ "transfer-encoding": "chunked" }, "chunked"],
    [{ "transfer-encoding": "Chunked" }, "chunked"],
    [{ "transfer-encoding": "identity, chunked" }, "chunked"],
    [{ "transfer-encoding": "gzip, chunked" }, "invalid"],
    [{ "transfer-encoding": "chunked, chunked" }, "invalid"],
    [{ "transfer-encoding": "gzip" }, "invalid"],
  ])("%j → %s", (headers, expected) => {
    expect(framing(headers)).toBe(expected);
  });
});

describe("when the old service fails", () => {
  let other: RunningBridge | undefined;
  afterEach(async () => {
    await other?.close();
    other = undefined;
  });

  it("answers an empty 500 when it cannot be reached", async () => {
    other = await startBridge({
      studioUrl: "http://127.0.0.1:9/api/v1",
      legacyUrl: await closedUrl(),
    });
    const response = await send(`${other.url}/private/Surveys/nps`);
    expect(response.status).toBe(500);
    expect(response.headers["content-length"]).toBe("0");
    expect(response.headers["content-type"]).toBeUndefined();
    expect(response.body.length).toBe(0);
  });

  it("answers an empty 500 when it does not answer in time", async () => {
    const silent = await startStub(() => undefined);
    try {
      other = await startBridge(
        { studioUrl: "http://127.0.0.1:9/api/v1", legacyUrl: silent.url },
        undefined,
        { forwardTimeoutMs: 200 },
      );
      const started = Date.now();
      const response = await send(`${other.url}/private/Surveys/nps`);
      expect(response.status).toBe(500);
      expect(response.body.length).toBe(0);
      expect(Date.now() - started).toBeLessThan(2_000);
    } finally {
      await other?.close();
      other = undefined;
      await silent.close();
    }
  });
});
