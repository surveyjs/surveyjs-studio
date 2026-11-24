import { get } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { send, startBridge, startStub, type RunningBridge, type Stub } from "../testing/http.js";
import { startFakeStudio, type FakeStudio } from "../testing/studio-stub.js";

const FILE_ID = "5af48e08a0a544a583f41c90e8e98de10123456789abcdef0123456789abcdef";
const LEGACY = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc.png";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 0, 0, 0]);
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
  studio.files.set(FILE_ID, { contentType: "image/png", body: PNG });
  studio.legacyFiles.set(`response/${LEGACY}`, { contentType: "image/png", body: PNG });
  studio.legacyFiles.set("response/report.pdf", {
    contentType: "application/pdf",
    body: Buffer.from("%PDF-1.4"),
  });
  studio.legacyFiles.set(`asset/${LEGACY}`, { contentType: "image/png", body: PNG });
});

const studioPaths = () => studio.requests.map((request) => `${request.method} ${request.url}`);

type Answer = Awaited<ReturnType<typeof send>>;

function expectEmpty(answer: Answer, status: number): void {
  expect(answer.status).toBe(status);
  expect(answer.headers["content-length"]).toBe("0");
  expect(answer.headers["content-type"]).toBeUndefined();
  expect(answer.body.length).toBe(0);
}

function expectProblem404(answer: Answer): void {
  expect(answer.status).toBe(404);
  expect(answer.headers["content-type"]).toBe(PROBLEM_UTF8);
  expect(JSON.parse(answer.body.toString())).toMatchObject({
    type: "https://tools.ietf.org/html/rfc9110#section-15.5.5",
    title: "Not Found",
    status: 404,
  });
}

/** Names with a path, a dot segment or characters no legacy name has. */
const PATH_NAMES = ["../x", "a/b", "a%2Fb", "..", ".", "a\\b", "a b.png", `${"a".repeat(101)}.png`];

describe("image", () => {
  const url = (query: string, prefix = "public/Survey") =>
    `${bridge.url}/${prefix}/image${query === "" ? "" : `?${query}`}`;

  it("answers a legacy respondent file's bytes inline with its type", async () => {
    const answer = await send(url(`filePath=${LEGACY}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/png");
    expect(answer.headers["content-length"]).toBe(String(PNG.length));
    expect(answer.headers["content-disposition"]).toBeUndefined();
    expect(answer.headers["cache-control"]).toBeUndefined();
    expect(answer.headers["x-content-type-options"]).toBe("nosniff");
    expect(answer.body).toEqual(PNG);
    expect(studioPaths()).toEqual([`GET /api/v1/public/legacy-files/response/${LEGACY}`]);
    expect(legacy.requests).toEqual([]);
  });

  it("reads the parameter name in any case, under both prefixes and any route case", async () => {
    for (const address of [
      url(`filepath=${LEGACY}`),
      url(`FILEPATH=${LEGACY}`, "PUBLIC/V1/Survey"),
      `${bridge.url}/public/v1/survey/IMAGE/?filePath=${LEGACY}`,
    ]) {
      const answer = await send(address);
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual(PNG);
    }
  });

  it.each([
    ["a Studio file ID with its extension", `${FILE_ID}.png`],
    ["the name upload answered", `dxsimage:${FILE_ID}.png`],
    ["a Studio file ID without an extension", FILE_ID],
  ])("answers %s through downloadFile", async (_case, name) => {
    const answer = await send(url(`filePath=${encodeURIComponent(name)}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/png");
    expect(answer.body).toEqual(PNG);
    expect(studioPaths()).toEqual([`GET /api/v1/public/files/${FILE_ID}`]);
  });

  it("answers 404 for a file Studio does not have", async () => {
    expectProblem404(await send(url("filePath=missing.png")));
    expect(studioPaths()).toEqual(["GET /api/v1/public/legacy-files/response/missing.png"]);
    studio.requests.length = 0;
    expectProblem404(await send(url(`filePath=${"0".repeat(64)}.png`)));
    expect(studioPaths()).toEqual([`GET /api/v1/public/files/${"0".repeat(64)}`]);
  });

  it.each(PATH_NAMES)("answers 404 for %j without asking Studio", async (name) => {
    expectProblem404(await send(url(`filePath=${encodeURIComponent(decodeURIComponent(name))}`)));
    expect(studio.requests).toEqual([]);
  });

  it.each([
    ["no filePath", ""],
    ["an empty filePath", "filePath="],
    ["a name the old store refused (a colon)", "filePath=dxsimage%3Ax.png"],
  ])("answers an empty 500 for %s, without asking Studio", async (_case, query) => {
    expectEmpty(await send(url(query)), 500);
    expect(studio.requests).toEqual([]);
  });

  it("passes Studio's 429 on and answers an unexpected status with an empty 500", async () => {
    studio.override = (_request, res) => {
      res.writeHead(429, { "retry-after": "5" }).end("{}");
      return true;
    };
    expectEmpty(await send(url(`filePath=${LEGACY}`)), 429);
    studio.override = (_request, res) => {
      res.writeHead(403).end();
      return true;
    };
    expectEmpty(await send(url(`filePath=${LEGACY}`)), 500);
  });
});

describe("file", () => {
  const url = (query: string, prefix = "public/v1/Survey") =>
    `${bridge.url}/${prefix}/file${query === "" ? "" : `?${query}`}`;

  it("answers a legacy respondent file as an attachment named after filePath", async () => {
    const answer = await send(url("filePath=report.pdf"));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/octet-stream");
    expect(answer.headers["content-disposition"]).toBe(
      "attachment; filename=report.pdf; filename*=UTF-8''report.pdf",
    );
    expect(answer.headers["cache-control"]).toBeUndefined();
    expect(answer.body.toString()).toBe("%PDF-1.4");
    expect(studioPaths()).toEqual(["GET /api/v1/public/legacy-files/response/report.pdf"]);
  });

  it("answers a Studio file through downloadFile, named without the upload prefix", async () => {
    const answer = await send(url(`filePath=${encodeURIComponent(`dxsfile:${FILE_ID}.png`)}`));
    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/octet-stream");
    expect(answer.headers["content-disposition"]).toBe(
      `attachment; filename=${FILE_ID}.png; filename*=UTF-8''${FILE_ID}.png`,
    );
    expect(answer.body).toEqual(PNG);
    expect(studioPaths()).toEqual([`GET /api/v1/public/files/${FILE_ID}`]);
  });

  it("answers 404 for an unknown file and for a name with a path", async () => {
    expectProblem404(await send(url("filePath=missing.pdf")));
    studio.requests.length = 0;
    for (const name of PATH_NAMES) {
      expectProblem404(await send(url(`filePath=${encodeURIComponent(decodeURIComponent(name))}`)));
    }
    expect(studio.requests).toEqual([]);
  });

  it("answers an empty 500 without filePath, under the public prefix too", async () => {
    expectEmpty(await send(url("", "public/Survey")), 500);
    expectEmpty(await send(url("filePath=a%3Ab.pdf")), 500);
    expect(studio.requests).toEqual([]);
  });
});

describe("files?name=", () => {
  const url = (query: string, prefix = "private/Surveys") =>
    `${bridge.url}/${prefix}/files${query === "" ? "" : `?${query}`}`;

  it("answers an editor image as application/octet-stream, under both prefixes", async () => {
    for (const prefix of ["private/Surveys", "private/v1/Surveys", "PRIVATE/V1/SURVEYS"]) {
      studio.requests.length = 0;
      const answer = await send(url(`name=${LEGACY}`, prefix));
      expect(answer.status).toBe(200);
      expect(answer.headers["content-type"]).toBe("application/octet-stream");
      expect(answer.headers["content-disposition"]).toBe(
        `attachment; filename=${LEGACY}; filename*=UTF-8''${LEGACY}`,
      );
      expect(answer.headers["content-length"]).toBe(String(PNG.length));
      expect(answer.body).toEqual(PNG);
      expect(studioPaths()).toEqual([`GET /api/v1/public/legacy-files/asset/${LEGACY}`]);
    }
  });

  it("looks a name of 64 hex digits up as a legacy name, not as a Studio file", async () => {
    studio.legacyFiles.set(`asset/${FILE_ID}.png`, { contentType: "image/png", body: PNG });
    const answer = await send(url(`name=${FILE_ID}.png`));
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(PNG);
    expect(studioPaths()).toEqual([`GET /api/v1/public/legacy-files/asset/${FILE_ID}.png`]);
  });

  it("answers an empty 404 for an unknown name", async () => {
    expectEmpty(await send(url("name=missing.png")), 404);
    expect(studioPaths()).toEqual(["GET /api/v1/public/legacy-files/asset/missing.png"]);
  });

  it.each(PATH_NAMES)(
    "answers an empty 404 for %j without asking Studio (Review Focus 4)",
    async (name) => {
      expectEmpty(await send(url(`name=${encodeURIComponent(decodeURIComponent(name))}`)), 404);
      expect(studio.requests).toEqual([]);
    },
  );

  it("answers a raw %2F in the name with an empty 404 without asking Studio", async () => {
    expectEmpty(await send(url("name=..%2Fx")), 404);
    expectEmpty(await send(url("name=a%2fb.png")), 404);
    expect(studio.requests).toEqual([]);
  });

  it.each([
    ["no name", ""],
    ["an empty name", "name="],
    ["the logo's name", "name=00000000-0000-0000-0000-000000000000"],
    ["a name the old store refused (a colon)", "name=a%3Ab.png"],
  ])("answers an empty 400 for %s, without asking Studio", async (_case, query) => {
    expectEmpty(await send(url(query)), 400);
    expect(studio.requests).toEqual([]);
  });
});

/** Reads an answer; `complete` is false when the connection closed before its end. */
function receive(
  url: string,
  onFirstChunk?: () => void,
): Promise<{ status: number; body: Buffer; complete: boolean }> {
  return new Promise((resolve, reject) => {
    get(url, { agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => {
        if (chunks.length === 0) onFirstChunk?.();
        chunks.push(chunk);
      });
      res.on("error", () => undefined);
      res.on("close", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks),
          complete: res.complete,
        }),
      );
    }).on("error", reject);
  });
}

describe("file reads stream with their own time limit (BRIDGE_FILE_TIMEOUT_MS)", () => {
  let slow: RunningBridge;
  let release: (() => void) | undefined;

  beforeAll(async () => {
    slow = await startBridge({
      studioUrl: `${studio.url}/api/v1`,
      legacyUrl: legacy.url,
      studioTimeoutMs: 300,
      fileTimeoutMs: 1_500,
    });
  });

  afterAll(async () => {
    release?.();
    await slow.close();
  });

  /** Studio sends the headers and the first half, then the rest after `pauseMs` (or on release). */
  function slowFile(pauseMs: number | "release"): void {
    studio.override = (_request, res) => {
      res.writeHead(200, { "content-type": "image/png", "content-length": "8" }).write("1234");
      const finish = () => res.end("5678");
      if (pauseMs === "release") release = finish;
      else setTimeout(finish, pauseMs);
      return true;
    };
  }

  it("passes bytes on as they come, without waiting for the whole file", async () => {
    slowFile("release");
    const answer = await receive(`${slow.url}/public/Survey/image?filePath=${LEGACY}`, () =>
      release?.(),
    );
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe("12345678");
    expect(answer.complete).toBe(true);
  });

  it("lets a file body take longer than BRIDGE_STUDIO_TIMEOUT_MS", async () => {
    slowFile(800);
    const answer = await receive(`${slow.url}/private/Surveys/files?name=${LEGACY}`);
    expect(answer.status).toBe(200);
    expect(answer.body.toString()).toBe("12345678");
    expect(answer.complete).toBe(true);
  });

  it("cuts a file body off after BRIDGE_FILE_TIMEOUT_MS", async () => {
    slowFile(4_000);
    const started = Date.now();
    const answer = await receive(`${slow.url}/public/Survey/file?filePath=${LEGACY}`);
    expect(answer.status).toBe(200);
    expect(answer.complete).toBe(false);
    expect(answer.body.toString()).toBe("1234");
    expect(Date.now() - started).toBeLessThan(3_500);
  });

  it("still answers an empty 500 when Studio sends no headers within BRIDGE_STUDIO_TIMEOUT_MS", async () => {
    studio.override = () => true;
    const started = Date.now();
    const answer = await send(`${slow.url}/public/Survey/image?filePath=${LEGACY}`);
    expectEmpty(answer, 500);
    expect(Date.now() - started).toBeLessThan(1_400);
  });
});

describe("file names and headers that cannot be sent", () => {
  it.each([
    ["a control character", `${FILE_ID}.a\r\nb`],
    ["a space", `${FILE_ID}.a b`],
    ["a further dot", `dxsfile:${FILE_ID}.tar.gz`],
    ["a quote", `${FILE_ID}.p"ng`],
  ])(
    "answers a Studio file name whose extension has %s with an empty 500, without asking Studio",
    async (_case, name) => {
      for (const action of ["image", "file"]) {
        const answer = await send(
          `${bridge.url}/public/Survey/${action}?filePath=${encodeURIComponent(name)}`,
        );
        expectEmpty(answer, 500);
      }
      expect(studio.requests).toEqual([]);
    },
  );

  it("answers a header Node refuses with an empty 500 and closes Studio's answer", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => undefined),
      cancel: () => {
        cancelled = true;
      },
    });
    const odd = await startBridge(
      { studioUrl: "http://studio.test/api/v1", legacyUrl: legacy.url },
      undefined,
      {
        fetch: () =>
          Promise.resolve(new Response(body, { headers: { "content-type": "image/\u0001png" } })),
      },
    );
    try {
      const answer = await send(`${odd.url}/public/Survey/image?filePath=${LEGACY}`);
      expectEmpty(answer, 500);
      expect(cancelled).toBe(true);
    } finally {
      await odd.close();
    }
  });

  it("closes Studio's answer when the caller leaves in the middle of a file", async () => {
    let closed = false;
    studio.override = (_request, res) => {
      res.on("close", () => (closed = true));
      res.writeHead(200, { "content-type": "image/png", "content-length": "100000" }).write("1234");
      return true;
    };
    await new Promise<void>((resolve, reject) => {
      const request = get(
        `${bridge.url}/public/Survey/image?filePath=${LEGACY}`,
        { agent: false },
        (res) => {
          res.once("data", () => {
            request.destroy();
            resolve();
          });
        },
      );
      request.on("error", () => undefined);
      request.on("timeout", reject);
    });
    const deadline = Date.now() + 2_000;
    while (!closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(closed).toBe(true);
  });
});
