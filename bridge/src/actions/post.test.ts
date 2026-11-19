import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  send,
  sendRaw,
  startBridge,
  startStub,
  type RunningBridge,
  type Stub,
} from "../testing/http.js";
import { startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";

const POST = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const SURVEY = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc";
const OTHER = "9b7d3c1e-2f4a-4b6c-8d0e-1f2a3b4c5d6e";

const JSON_UTF8 = "application/json; charset=utf-8";
const PROBLEM_UTF8 = "application/problem+json; charset=utf-8";
const PROBLEM_TYPES = {
  400: ["https://tools.ietf.org/html/rfc9110#section-15.5.1", "Bad Request"],
  404: ["https://tools.ietf.org/html/rfc9110#section-15.5.5", "Not Found"],
  415: ["https://tools.ietf.org/html/rfc9110#section-15.5.16", "Unsupported Media Type"],
} as const;

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
  studio.postIds.set(POST, SURVEY);
});

type Answer = Awaited<ReturnType<typeof send>>;

function expectProblem(answer: Answer, status: 400 | 404 | 415): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
  const body = JSON.parse(answer.body.toString()) as Record<string, unknown>;
  const [type, title] = PROBLEM_TYPES[status];
  expect(body).toMatchObject({ type, title, status });
  expect(Object.keys(body).sort()).toEqual(["status", "title", "traceId", "type"]);
}

function expectValidation(answer: Answer, errors: Record<string, string[]>): void {
  expect(answer.status).toBe(400);
  expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
  const body = JSON.parse(answer.body.toString()) as Record<string, unknown>;
  expect(Object.keys(body)[0]).toBe("errors");
  expect(body).toMatchObject({
    type: PROBLEM_TYPES[400][0],
    title: "One or more validation errors occurred.",
    status: 400,
  });
  expect(body.errors).toEqual(errors);
}

function expectEmpty(answer: Answer, status: number): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.headers["content-length"]).toBe("0");
  expect(answer.body.length).toBe(0);
}

function expectJsonString(answer: Answer, status: number, text: string): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-type"]).toBe(JSON_UTF8);
  expect(JSON.parse(answer.body.toString())).toBe(text);
}

/** What the fake Studio received for a post. */
function posted(): { url: string; headers: Record<string, unknown>; body: unknown }[] {
  return studio.requests
    .filter((request) => request.url.endsWith("/responses"))
    .map((request) => ({
      url: request.url,
      headers: request.headers,
      body: JSON.parse(request.body.toString()) as unknown,
    }));
}

describe("post", () => {
  /** Posts `body`; a `null` content type sends none. */
  const post = (body: string | Buffer, contentType: string | null = "application/json") =>
    send(`${bridge.url}/public/v1/Survey/post/`, {
      method: "POST",
      headers: contentType === null ? [] : [["Content-Type", contentType]],
      body,
    });
  const answers = { q1: "<b>Tom & Jerry</b>", q2: [1, 2] };

  it("submits the answers by post ID and answers an empty 200", async () => {
    const answer = await post(
      JSON.stringify({ postId: POST.toUpperCase(), surveyResult: JSON.stringify(answers) }),
    );
    expectEmpty(answer, 200);
    const [request] = posted();
    expect(request?.url).toBe(`/api/v1/public/posts/${POST}/responses`);
    // ADR 0039: stored as sent (no HTML encoding), and no Idempotency-Key.
    expect(request?.body).toEqual({ data: answers, partial: false });
    expect(request?.headers["idempotency-key"]).toBeUndefined();
    expect(request?.headers["x-forwarded-for"]).toBe("127.0.0.1");
    expect(request?.headers["content-type"]).toMatch(/^application\/json/);
  });

  it("answers at the other prefix and without the trailing slash", async () => {
    const answer = await send(`${bridge.url}/PUBLIC/Survey/POST`, {
      method: "POST",
      headers: [["Content-Type", "application/json"]],
      body: JSON.stringify({ postId: POST, surveyResult: "{}" }),
    });
    expectEmpty(answer, 200);
    expect(posted()).toHaveLength(1);
  });

  it.each([
    [true, true],
    ["true", true],
    [" True ", true],
    [1, true],
    [2, true],
    [false, false],
    ["false", false],
    [0, false],
    [null, false],
    ["", false],
    [undefined, false],
  ])("reads isPartialCompleted %j as partial %j with a client ID", async (flag, partial) => {
    const answer = await post(
      JSON.stringify({
        postId: POST,
        surveyResult: '{"q":1}',
        clientId: "c 1",
        isPartialCompleted: flag,
      }),
    );
    expectEmpty(answer, 200);
    expect(posted()[0]?.body).toEqual({
      data: { q: 1 },
      clientId: "c 1",
      partial,
    });
  });

  it("sends no partial flag and no client ID without a client ID", async () => {
    await post(
      JSON.stringify({ postId: POST, surveyResult: "{}", clientId: "", isPartialCompleted: true }),
    );
    await post(JSON.stringify({ postId: POST, surveyResult: "{}", isPartialCompleted: true }));
    expect(posted().map((request) => request.body)).toEqual([
      { data: {}, partial: false },
      { data: {}, partial: false },
    ]);
  });

  it("reads property names in any letter case and ignores unknown properties", async () => {
    const answer = await post(
      JSON.stringify({
        POSTID: POST,
        SurveyResult: '{"q":1}',
        clientid: "c1",
        IsPartialCompleted: "TRUE",
        extra: { nested: [1, { deep: true }] },
      }),
    );
    expectEmpty(answer, 200);
    expect(posted()[0]?.body).toEqual({ data: { q: 1 }, clientId: "c1", partial: true });
  });

  it("reads the old reader's lenient JSON: comments, single quotes, bare names, trailing commas", async () => {
    const body = `/* c */ {postId: '${POST}', // x\n 'surveyResult': "{\\"q\\":2}", clientId: 12,}`;
    const answer = await post(body);
    expectEmpty(answer, 200);
    expect(posted()[0]?.body).toEqual({ data: { q: 2 }, clientId: "12", partial: false });
  });

  it.each([
    "text/json",
    "application/json; charset=utf-8",
    "application/vnd.api+json",
    "Application/JSON",
  ])("accepts the content type %s", async (contentType) => {
    const answer = await post(JSON.stringify({ postId: POST, surveyResult: "{}" }), contentType);
    expectEmpty(answer, 200);
  });

  it.each([
    ["text/plain", JSON.stringify({ postId: POST, surveyResult: "{}" })],
    ["application/x-www-form-urlencoded", `postId=${POST}&surveyResult=%7B%7D`],
    ["multipart/form-data; boundary=x", "--x--"],
    [null, JSON.stringify({ postId: POST, surveyResult: "{}" })],
    [null, ""],
  ])("answers 415 for the content type %s", async (contentType, body) => {
    const answer = await post(body, contentType);
    expectProblem(answer, 415);
    expect(studio.requests).toEqual([]);
  });

  it.each(["", "   ", "null", "/* only a comment */"])(
    "answers the validation problem for the body %j",
    async (body) => {
      const answer = await post(body);
      expectValidation(answer, { "": ["A non-empty request body is required."] });
    },
  );

  it("answers the old text for a postId that is not a GUID", async () => {
    const answer = await post(`{"postId":"zz","surveyResult":"{}"}`);
    expectValidation(answer, {
      postId: [
        `Error converting value "zz" to type 'System.Guid'. Path 'postId', line 1, position 14.`,
      ],
    });
  });

  it("counts lines and positions as the old reader did", async () => {
    const answer = await post(`{\r\n  "postId": 5,\n  "isPartialCompleted": "maybe"\n}`);
    expectValidation(answer, {
      postId: [
        "Error converting value 5 to type 'System.Guid'. Path 'postId', line 2, position 13.",
      ],
      isPartialCompleted: [
        "Could not convert string to boolean: maybe. Path 'isPartialCompleted', line 3, position 31.",
      ],
    });
  });

  it("answers the old two texts for an object as surveyResult", async () => {
    const answer = await post(`{"postId":"${POST}","surveyResult":{"a":1}}`);
    expectValidation(answer, {
      surveyResult: [
        "Unexpected character encountered while parsing value: {. Path 'surveyResult', line 1, position 65.",
        "After parsing a value an unexpected character was encountered: :. Path 'surveyResult', line 1, position 68.",
      ],
    });
  });

  it("answers the old text for a truncated body", async () => {
    const answer = await post(`{"postId":"${POST}","surveyResult":"ab"`);
    expectValidation(answer, {
      surveyResult: [
        "Unexpected end when deserializing object. Path 'surveyResult', line 1, position 68.",
      ],
    });
  });

  it.each([
    [
      `{"postId" "x"}`,
      "",
      [
        `Invalid character after parsing property name. Expected ':' but got: ". Path '', line 1, position 10.`,
      ],
    ],
    [
      `{"a":1 "b":2}`,
      "a",
      [
        `After parsing a value an unexpected character was encountered: ". Path 'a', line 1, position 7.`,
      ],
    ],
    // The old reader recovers from a property's error and then meets the end of the body.
    [
      `{"postId":"x`,
      "postId",
      [
        `Unterminated string. Expected delimiter: ". Path 'postId', line 1, position 12.`,
        "Unexpected end when deserializing object. Path 'postId', line 1, position 12.",
      ],
    ],
    [
      `{"surveyResult":`,
      "surveyResult",
      [
        "Unexpected end when setting surveyResult's value. Path 'surveyResult', line 1, position 16.",
        "Unexpected end when deserializing object. Path 'surveyResult', line 1, position 16.",
      ],
    ],
    [`{`, "", ["Unexpected end when reading JSON. Path '', line 1, position 1."]],
  ])("answers the old reader's texts for %s", async (body, key, messages) => {
    const answer = await post(body);
    expectValidation(answer, { [key]: messages });
    expect(studio.requests).toEqual([]);
  });

  it("answers the generic text for a body that is not an object", async () => {
    const answer = await post(`[1]`);
    expectValidation(answer, { "": ["The input was not valid."] });
  });

  it.each([
    ["missing", {}],
    ["null", { surveyResult: null }],
    ["empty", { surveyResult: "" }],
  ])("answers the 400 problem for a %s surveyResult", async (_case, extra) => {
    const answer = await post(JSON.stringify({ postId: POST, ...extra }));
    expectProblem(answer, 400);
    expect(studio.requests).toEqual([]);
  });

  it('answers 400 "Check parameter values." without a postId, asking Studio nothing', async () => {
    const answer = await post(JSON.stringify({ surveyResult: "{}" }));
    expectJsonString(answer, 400, "Check parameter values.");
    expect(studio.requests).toEqual([]);
  });

  it('answers 400 "Check parameter values." for a post ID Studio does not have', async () => {
    const answer = await post(JSON.stringify({ postId: OTHER, surveyResult: "{}" }));
    expectJsonString(answer, 400, "Check parameter values.");
    expect(posted()).toHaveLength(1);
  });

  it.each([
    ["not JSON", "{q:"],
    ["JSON with content after it", '{"q":1} x'],
    ["an array", "[1]"],
    ["a number", "5"],
  ])(
    "answers an empty 200 for a surveyResult that is %s, storing nothing",
    async (_case, result) => {
      const answer = await post(
        JSON.stringify({ postId: POST, surveyResult: result, clientId: "c1" }),
      );
      expectEmpty(answer, 200);
      expect(studio.requests).toEqual([]);
    },
  );

  it("answers the old storage refusal for an answer set Studio finds too large", async () => {
    studio.override = (_request, res) => (res.writeHead(413).end(), true);
    const answer = await post(JSON.stringify({ postId: POST, surveyResult: "{}" }));
    expect(answer.status).toBe(400);
    expect(answer.headers["content-type"]).toBe(JSON_UTF8);
    expect(JSON.parse(answer.body.toString())).toMatch(
      /^The property value exceeds the maximum allowed size \(64KB\)\..*\nPropertyValueTooLarge: /s,
    );
  });

  it.each([400, 422])(
    "answers the old storage refusal for Studio's %i (a client ID it refuses)",
    async (status) => {
      studio.override = (_request, res) => (res.writeHead(status).end(), true);
      const answer = await post(
        JSON.stringify({ postId: POST, surveyResult: "{}", clientId: "a/b" }),
      );
      expectJsonString(
        answer,
        400,
        "One of the request inputs is not valid.\nInvalidInput: One of the request inputs is not valid.",
      );
    },
  );

  it.each([429, 500, 503])("answers Studio's %i as an empty 429 or 500", async (status) => {
    studio.override = (_request, res) => (res.writeHead(status).end(), true);
    const answer = await post(JSON.stringify({ postId: POST, surveyResult: "{}" }));
    expectEmpty(answer, status === 429 ? 429 : 500);
  });

  it("stores answers the old readers read leniently, as JSON", async () => {
    const answer = await post(
      JSON.stringify({ postId: POST, surveyResult: "{q: 1, 'a': 'b', /* c */ arr: [1, 2,],}" }),
    );
    expectEmpty(answer, 200);
    expect(posted()[0]?.body).toEqual({ data: { q: 1, a: "b", arr: [1, 2] }, partial: false });
  });

  it("stores an answer named __proto__ as an ordinary answer", async () => {
    await post(JSON.stringify({ postId: POST, surveyResult: '{"__proto__":{"x":1},"q":2}' }));
    expect(studio.requests[0]?.body.toString()).toBe(
      '{"data":{"__proto__":{"x":1},"q":2},"partial":false}',
    );
  });

  it.each(["__proto__", "constructor", "toString"])(
    "lists a validation error under the path %s",
    async (name) => {
      const answer = await post(`{"${name}":1 x}`);
      expect(answer.status).toBe(400);
      const body = JSON.parse(answer.body.toString()) as { errors: Record<string, unknown> };
      expect(Object.keys(body.errors)).toEqual([name]);
    },
  );

  it("answers an empty 413 for a body over 4 MiB", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "POST /public/Survey/post HTTP/1.1\r\nHost: b\r\nContent-Type: application/json\r\n" +
        "Content-Length: 4194305\r\n\r\n{",
    );
    expect(data).toMatch(/^HTTP\/1\.1 413 /);
    expect(studio.requests).toEqual([]);
  });

  it("reads a body of 4 MiB", async () => {
    const answers = JSON.stringify({ q: "x".repeat(4 * 1024 * 1024 - 200) });
    const body = JSON.stringify({ postId: POST, surveyResult: answers });
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(4 * 1024 * 1024);
    expectEmpty(await post(body), 200);
  });

  it("answers an empty 413 for a body over the old host's 30,000,000 bytes", async () => {
    const { data } = await sendRaw(
      bridge.url,
      "POST /public/Survey/post HTTP/1.1\r\nHost: b\r\nContent-Type: application/json\r\n" +
        "Content-Length: 30000001\r\n\r\n{",
    );
    const [head = "", body] = data.split("\r\n\r\n");
    expect(head).toMatch(/^HTTP\/1\.1 413 /);
    expect(head.toLowerCase()).toContain("content-length: 0");
    expect(head.toLowerCase()).not.toContain("content-type");
    expect(body).toBe("");
    expect(studio.requests).toEqual([]);
  });
});

describe("upload", () => {
  const boundary = "----bridge-test";

  interface Part {
    name: string;
    value: string | Buffer;
    filename?: string;
    type?: string;
  }

  function multipart(parts: Part[]): Buffer {
    const chunks: Buffer[] = [];
    for (const part of parts) {
      let head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
      if (part.filename !== undefined) head += `; filename="${part.filename}"`;
      head += "\r\n";
      if (part.type !== undefined) head += `Content-Type: ${part.type}\r\n`;
      chunks.push(Buffer.from(`${head}\r\n`), Buffer.from(part.value), Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return Buffer.concat(chunks);
  }

  const upload = (
    body: Buffer | string,
    contentType = `multipart/form-data; boundary=${boundary}`,
  ) =>
    send(`${bridge.url}/public/v1/Survey/upload/`, {
      method: "POST",
      headers: [["Content-Type", contentType]],
      body,
    });

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it("uploads the first file of any field name by post ID and answers dxsimage: with the ID and extension", async () => {
    const answer = await upload(
      multipart([
        { name: "anything", value: PNG, filename: "Photo.PNG", type: "image/png" },
        { name: "postId", value: POST.toUpperCase() },
        { name: "second", value: "x", filename: "other.pdf" },
      ]),
    );
    expectJsonString(answer, 200, `dxsimage:${studio.storedFile.id}.PNG`);
    const [request] = studio.requests;
    expect(request?.url).toBe(`/api/v1/public/posts/${POST}/files`);
    expect(request?.headers["x-forwarded-for"]).toBe("127.0.0.1");
    expect(request?.headers["idempotency-key"]).toBeUndefined();
    const form = await new Response(new Uint8Array(request!.body), {
      headers: { "content-type": String(request!.headers["content-type"]) },
    }).formData();
    expect([...form.keys()]).toEqual(["file"]);
    const file = form.get("file") as File;
    expect(file.name).toBe("Photo.PNG");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it.each([
    ["a.jpeg", "dxsimage:", ".jpeg"],
    ["a.JPG", "dxsimage:", ".JPG"],
    ["a.png", "dxsimage:", ".png"],
    ["a.bmp", "dxsimage:", ".bmp"],
    ["a.svg", "dxsimage:", ".svg"],
    ["a.gif", "dxsimage:", ".gif"],
    ["a.webp", "dxsfile:", ".webp"],
    ["report.final.pdf", "dxsfile:", ".pdf"],
    ["README", "dxsfile:", ""],
    ["trailing.", "dxsfile:", ""],
    ["dir.png/name", "dxsfile:", ""],
    [".gif", "dxsimage:", ".gif"],
  ])("answers %s as %s with the extension %j", async (filename, prefix, extension) => {
    const answer = await upload(
      multipart([
        { name: "postId", value: POST },
        { name: "file", value: "bytes", filename },
      ]),
    );
    expectJsonString(answer, 200, `${prefix}${studio.storedFile.id}${extension}`);
  });

  it("takes a file over 4 MiB, the post limit", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 7);
    const answer = await upload(
      multipart([
        { name: "postId", value: POST },
        { name: "file", value: big, filename: "big.bin" },
      ]),
    );
    expectJsonString(answer, 200, `dxsfile:${studio.storedFile.id}.bin`);
    expect(studio.requests[0]!.body.length).toBeGreaterThan(big.length);
  });

  it("reads the postId field in any letter case", async () => {
    const answer = await upload(
      multipart([
        { name: "POSTID", value: POST },
        { name: "file", value: "x", filename: "a.txt" },
      ]),
    );
    expect(answer.status).toBe(200);
  });

  it.each([
    ["application/json", "{}"],
    ["text/plain", "x"],
  ])("answers 415 for the content type %s", async (contentType, body) => {
    expectProblem(await upload(body, contentType), 415);
    expect(studio.requests).toEqual([]);
  });

  it("answers 415 without a content type", async () => {
    const answer = await send(`${bridge.url}/public/Survey/upload`, { method: "POST", body: "x" });
    expectProblem(answer, 415);
  });

  it.each([
    ["no file", [{ name: "postId", value: POST }]],
    [
      "a file part without a name",
      [
        { name: "postId", value: POST },
        { name: "file", value: "", filename: "" },
      ],
    ],
    ["no postId", [{ name: "file", value: "x", filename: "a.png" }]],
  ])("answers 415 for a form with %s", async (_case, parts) => {
    expectProblem(await upload(multipart(parts)), 415);
    expect(studio.requests).toEqual([]);
  });

  it("answers 415 for a form-urlencoded form, which holds no file", async () => {
    const answer = await upload(`postId=${POST}`, "application/x-www-form-urlencoded");
    expectProblem(answer, 415);
  });

  it.each(["GUID", ""])("answers 404 for the postId %j", async (postId) => {
    const answer = await upload(
      multipart([
        { name: "postId", value: postId },
        { name: "file", value: "x", filename: "a.png" },
      ]),
    );
    expectProblem(answer, 404);
    expect(studio.requests).toEqual([]);
  });

  it("answers 404 for a post ID Studio does not have", async () => {
    const answer = await upload(
      multipart([
        { name: "postId", value: OTHER },
        { name: "file", value: "x", filename: "a.png" },
      ]),
    );
    expectProblem(answer, 404);
  });

  it("answers 415 for an empty file Studio refuses", async () => {
    studio.override = (_request, res) => (res.writeHead(422).end(), true);
    const answer = await upload(
      multipart([
        { name: "postId", value: POST },
        { name: "file", value: "", filename: "a.png" },
      ]),
    );
    expectProblem(answer, 415);
  });

  it.each([
    [413, 413],
    [429, 429],
    [500, 500],
    [503, 500],
  ])("answers Studio's %i as an empty %i", async (status, expected) => {
    studio.override = (_request, res) => (res.writeHead(status).end(), true);
    const answer = await upload(
      multipart([
        { name: "postId", value: POST },
        { name: "file", value: "x", filename: "a.png" },
      ]),
    );
    expectEmpty(answer, expected);
  });

  it("answers an empty 500 for a form it cannot read", async () => {
    const answer = await upload("not a multipart body", "multipart/form-data");
    expectEmpty(answer, 500);
  });
});
