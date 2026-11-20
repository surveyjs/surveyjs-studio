import { Writable } from "node:stream";
import type { FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accessKeyOf } from "./key.js";
import {
  send,
  startBridge,
  startStub,
  type RawResponse,
  type RunningBridge,
  type Stub,
} from "./testing/http.js";
import { startFakeStudio, type FakeStudio } from "./testing/studio-stub.js";

const JSON_UTF8 = "application/json; charset=utf-8";
const HTML_UTF8 = "text/html; charset=utf-8";

const TOKEN = "sjs_test-token-of-ann";
const LEGACY_KEY = "legacy-key-of-ann";
const SCRIPT_KEY = "<script>x</script>";

/** The headers of an answer as one text, names and values, to look for the key in. */
const headerText = (answer: RawResponse) => answer.rawHeaders.join("\n");

function expectEmpty401(answer: RawResponse, key: string): void {
  expect(answer.status).toBe(401);
  expect(answer.body.length).toBe(0);
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.headers.location).toBeUndefined();
  expect(answer.headers["www-authenticate"]).toBeUndefined();
  if (key !== "") expect(headerText(answer)).not.toContain(key);
}

describe("accessKeyOf", () => {
  const of = (url: string) => accessKeyOf({ raw: { url } } as unknown as FastifyRequest);

  it("reads the query parameter in any letter case, its first value, decoded", () => {
    expect(of("/x?accessKey=abc")).toBe("abc");
    expect(of("/x?ACCESSKEY=abc")).toBe("abc");
    expect(of("/x?accesskey=a&accessKey=b")).toBe("a");
    expect(of("/x?accessKey=a%2Bb+c")).toBe("a+b c");
    expect(of("/x?other=1&AccessKey=k")).toBe("k");
  });

  it("is undefined when the key is missing or empty", () => {
    expect(of("/x")).toBeUndefined();
    expect(of("/x?accessKey=")).toBeUndefined();
    expect(of("/x?accessKey")).toBeUndefined();
    expect(of("/x?access=abc")).toBeUndefined();
  });
});

describe("keyed actions", () => {
  let legacy: Stub;
  let studio: FakeStudio;
  let bridge: RunningBridge;
  let logs: string;

  beforeAll(async () => {
    legacy = await startStub((request, res) =>
      res
        .writeHead(200, { "content-type": "application/json; charset=utf-8", "x-old": "1" })
        .end(/generateaccesskey/i.test(request.url) ? '"3f2c0000000000000000000000000000"' : "old"),
    );
    studio = await startFakeStudio();
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    });
    bridge = await startBridge(
      { studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url },
      undefined,
      { logger: { level: "trace", stream } },
    );
  });

  afterAll(async () => {
    await bridge.close();
    await studio.close();
    await legacy.close();
  });

  beforeEach(() => {
    studio.reset();
    legacy.requests.length = 0;
    logs = "";
    studio.credentials.set(TOKEN, "token");
    studio.credentials.set(LEGACY_KEY, "legacy");
  });

  const generate = (query: string, prefix = "/private/Surveys") =>
    send(`${bridge.url}${prefix}/generateAccessKey${query}`);
  const setType = (query: string, prefix = "/private/Surveys") =>
    send(`${bridge.url}${prefix}/setGenerationJSONType${query}`, {
      method: "PUT",
      headers: [["Content-Type", "application/x-www-form-urlencoded"]],
      body: "generateValidJSON=true",
    });

  describe("generateAccessKey", () => {
    it("rotates an API token and answers the new value as a JSON string", async () => {
      const answer = await generate(`?accessKey=${TOKEN}`, "/private/v1/Surveys");
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(JSON_UTF8);
      expect(answer.body.toString()).toBe('"sjs_rotated"');
      expect(answer.headers["cache-control"]).toBe("no-store");
      expect(studio.requests).toHaveLength(1);
      const call = studio.requests[0]!;
      expect(`${call.method} ${call.url}`).toBe("POST /api/v1/me/credential");
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.headers["x-forwarded-for"]).toBe("127.0.0.1");
      // Sent only as the bearer credential.
      expect(call.url).not.toContain(TOKEN);
      expect(studio.credentials.has(TOKEN)).toBe(false);
      expect(legacy.requests).toEqual([]);
    });

    it("forwards a legacy key's request to the old service unchanged", async () => {
      const answer = await send(
        `${bridge.url}/private/Surveys/GenerateAccessKey/?AccessKey=${LEGACY_KEY}&x=%2B1`,
        { headers: [["X-Custom", "kept"]] },
      );
      expect(answer.status).toBe(200);
      expect(answer.headers["x-old"]).toBe("1");
      expect(answer.body.toString()).toBe('"3f2c0000000000000000000000000000"');
      expect(legacy.requests).toHaveLength(1);
      const forwarded = legacy.requests[0]!;
      expect(forwarded.method).toBe("GET");
      expect(forwarded.url).toBe(
        `/private/Surveys/GenerateAccessKey/?AccessKey=${LEGACY_KEY}&x=%2B1`,
      );
      expect(forwarded.headers["x-custom"]).toBe("kept");
      expect(studio.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
        "POST /api/v1/me/credential",
      ]);
    });

    it("answers the text with the key HTML-encoded when Studio refuses it (Review Focus 2)", async () => {
      const answer = await generate(`?accessKey=${encodeURIComponent(SCRIPT_KEY)}`);
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(HTML_UTF8);
      expect(answer.body.toString()).toBe(
        "The accessKey '&lt;script&gt;x&lt;/script&gt;' is incorrect.",
      );
      expect(headerText(answer)).not.toContain("script");
      expect(studio.requests).toHaveLength(1);
    });

    it("encodes every HTML-special character of the key", async () => {
      const answer = await generate(`?accessKey=${encodeURIComponent(`a&b"c'd<e>`)}`);
      expect(answer.body.toString()).toBe(
        "The accessKey 'a&amp;b&quot;c&#39;d&lt;e&gt;' is incorrect.",
      );
    });

    it("answers a revoked token's text", async () => {
      studio.credentials.delete(TOKEN);
      const answer = await generate(`?accessKey=${TOKEN}`);
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe(HTML_UTF8);
      expect(answer.body.toString()).toBe(`The accessKey '${TOKEN}' is incorrect.`);
      expect(legacy.requests).toEqual([]);
    });

    it("answers a key no credential can be without asking Studio", async () => {
      for (const key of ["a b", "ключ", "a\tb"]) {
        const answer = await generate(`?accessKey=${encodeURIComponent(key)}`);
        expect(answer.status).toBe(200);
        expect(answer.body.toString()).toBe(`The accessKey '${key}' is incorrect.`);
      }
      expect(studio.requests).toEqual([]);
    });

    it("answers another conflict as an unexpected status", async () => {
      studio.override = (request, res) => {
        if (!request.url.endsWith("/me/credential")) return false;
        res
          .writeHead(409, { "content-type": "application/problem+json" })
          .end('{"type":"about:blank","title":"x","status":409,"code":"already-member"}');
        return true;
      };
      const answer = await generate(`?accessKey=${TOKEN}`);
      expect(answer.status).toBe(500);
      expect(answer.body.length).toBe(0);
      expect(legacy.requests).toEqual([]);
    });

    it("passes Studio's 429 on empty", async () => {
      studio.override = (_request, res) => {
        res.writeHead(429).end();
        return true;
      };
      const answer = await generate(`?accessKey=${TOKEN}`);
      expect(answer.status).toBe(429);
      expect(answer.body.length).toBe(0);
    });
  });

  describe("setGenerationJSONType", () => {
    it("checks the key with Studio and answers an empty 200, storing nothing", async () => {
      const answer = await setType(`?accessKey=${LEGACY_KEY}`, "/private/v1/Surveys");
      expect(answer.status).toBe(200);
      expect(answer.body.length).toBe(0);
      expect(answer.headers["content-type"]).toBeUndefined();
      expect(studio.requests.map((r) => `${r.method} ${r.url}`)).toEqual(["GET /api/v1/me"]);
      expect(studio.requests[0]!.headers.authorization).toBe(`Bearer ${LEGACY_KEY}`);
      expect(legacy.requests).toEqual([]);
    });

    it("answers a wrong or revoked key with an empty 401 without Location (Review Focus 2)", async () => {
      expectEmpty401(await setType(`?accessKey=${encodeURIComponent(SCRIPT_KEY)}`), "script");
      studio.credentials.delete(TOKEN);
      expectEmpty401(await setType(`?accessKey=${TOKEN}`), TOKEN);
      expect(studio.requests).toHaveLength(2);
    });

    it("answers a missing key without asking Studio", async () => {
      expectEmpty401(await setType(""), "");
      expectEmpty401(await setType("?accessKey="), "");
      expect(studio.requests).toEqual([]);
    });

    it("is forwarded for a method it does not take", async () => {
      const answer = await send(
        `${bridge.url}/private/Surveys/setGenerationJSONType?accessKey=${TOKEN}`,
      );
      expect(answer.body.toString()).toBe("old");
      expect(studio.requests).toEqual([]);
    });
  });

  it("never logs the key", async () => {
    await generate(`?accessKey=${TOKEN}`);
    await generate(`?ACCESSKEY=${LEGACY_KEY}&accessKey=${LEGACY_KEY}`);
    await setType(`?x=1&accessKey=${encodeURIComponent(SCRIPT_KEY)}`);
    await send(`${bridge.url}/private/Surveys/getActive?accessKey=${TOKEN}`);
    expect(logs).toContain("generateAccessKey");
    expect(logs).toContain("accessKey=[redacted]");
    for (const key of [TOKEN, LEGACY_KEY, "script", "sjs_rotated"]) {
      expect(logs).not.toContain(key);
    }
  });

  describe("the bare root path", () => {
    it("answers an empty 500 for any method, under both prefixes", async () => {
      for (const path of ["/private/Surveys", "/private/v1/Surveys", "/PRIVATE/surveys/"]) {
        for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
          const answer = await send(`${bridge.url}${path}?accessKey=${TOKEN}`, { method });
          expect(answer.status, `${method} ${path}`).toBe(500);
          expect(answer.body.length).toBe(0);
          expect(answer.headers["content-type"]).toBeUndefined();
        }
      }
      expect(studio.requests).toEqual([]);
      expect(legacy.requests).toEqual([]);
    });
  });
});
