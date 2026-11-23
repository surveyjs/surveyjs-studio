import { request as httpRequest, type ServerResponse } from "node:http";
import { Writable } from "node:stream";
import { createRegistry, type Registry } from "@surveyjs-studio/metrics";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialKind, hashCredential } from "../../server/src/credentials/format.js";
import type { BridgeDeps } from "./app.js";
import { createBridgeMetrics } from "./metrics.js";
import type { BridgeSettings } from "./settings.js";
import {
  closedUrl,
  send,
  startBridge,
  startStub,
  type RunningBridge,
  type Stub,
} from "./testing/http.js";
import { startFakeStudio, type FakeStudio } from "./testing/studio-stub.js";

const SURVEY = "5af48e08-a0a5-44a5-83f4-1c90e8e98de1";
const POST = "0f5c2a8e-1b2c-4d3e-8f90-123456789abc";
const DEFINITION_CALL = 'operation="GET /public/surveys/{surveyId}/definition"';

interface RequestLine {
  msg: string;
  action: string;
  method: string;
  status: string;
  ms: number;
  cache?: string;
  key?: string;
  path?: string;
}

let legacy: Stub;
let studio: FakeStudio;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  legacy = await startStub((_request, res) => res.writeHead(418).end("old"));
  studio = await startFakeStudio();
});

afterAll(async () => {
  await studio.close();
  await legacy.close();
});

beforeEach(() => {
  studio.reset();
  legacy.requests.length = 0;
  studio.definitions.set(SURVEY, { definition: { title: "T" }, etag: '"v1"' });
  studio.postIds.set(POST, SURVEY);
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A bridge with its own registry, its log lines captured. */
async function setup(
  settings: Partial<BridgeSettings> = {},
  deps: BridgeDeps = {},
): Promise<{
  bridge: RunningBridge;
  registry: Registry;
  logs: () => string;
  requestLines: () => RequestLine[];
}> {
  const registry = createRegistry({ prefix: "surveyjs_bridge_", processMetrics: false });
  let logs = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString();
      done();
    },
  });
  const bridge = await startBridge(
    { studioUrl: `${studio.url}/api/v1`, legacyUrl: legacy.url, ...settings },
    undefined,
    { metrics: createBridgeMetrics(registry), logger: { level: "info", stream }, ...deps },
  );
  cleanups.push(() => bridge.close());
  const requestLines = () =>
    logs
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as RequestLine)
      .filter((entry) => entry.msg === "request");
  return { bridge, registry, logs: () => logs, requestLines };
}

/** Waits until the registry's text holds `sample`, counted at the reply's close. */
async function expectSample(registry: Registry, sample: string): Promise<void> {
  await expect.poll(() => registry.metrics()).toContain(sample);
}

describe("the bridge's metrics", () => {
  it("counts a getSurvey Studio confirms unchanged (304) as a 200 and a cache hit", async () => {
    const { bridge, registry, requestLines } = await setup();
    const url = `${bridge.url}/public/Survey/getSurvey?surveyId=${SURVEY}`;
    expect((await send(url)).status).toBe(200);
    expect((await send(url)).status).toBe(200);
    await expectSample(
      registry,
      'surveyjs_bridge_requests_total{action="getSurvey",method="GET",status="200"} 2',
    );
    const text = await registry.metrics();
    expect(text).toContain('surveyjs_bridge_survey_cache_total{result="miss"} 1');
    expect(text).toContain('surveyjs_bridge_survey_cache_total{result="hit"} 1');
    expect(text).toContain(`surveyjs_bridge_studio_calls_total{${DEFINITION_CALL},status="200"} 1`);
    expect(text).toContain(`surveyjs_bridge_studio_calls_total{${DEFINITION_CALL},status="304"} 1`);
    expect(text).toContain(
      `surveyjs_bridge_studio_call_duration_seconds_count{${DEFINITION_CALL}} 2`,
    );
    expect(text).toContain(
      'surveyjs_bridge_request_duration_seconds_count{action="getSurvey",method="GET"} 2',
    );
    const lines = requestLines();
    expect(lines.map((line) => line.cache)).toEqual(["miss", "hit"]);
    expect(lines[1]).toMatchObject({ action: "getSurvey", method: "GET", status: "200" });
    expect(lines[1]!.key).toBeUndefined();
    expect(lines[1]!.path).toBeUndefined();
    expect(typeof lines[1]!.ms).toBe("number");
  });

  it("counts a forwarded path as action forwarded with the old service's status", async () => {
    const { bridge, registry } = await setup();
    expect((await send(`${bridge.url}/unknown/path?x=1`)).status).toBe(418);
    await expectSample(
      registry,
      'surveyjs_bridge_requests_total{action="forwarded",method="GET",status="418"} 1',
    );
  });

  it("counts a path the router refuses before routing as forwarded", async () => {
    const { bridge, registry, requestLines } = await setup();
    const path = "/private/Surveys/getSurveyPublicResults/%E0%A4%A";
    expect((await send(`${bridge.url}${path}`)).status).toBe(418);
    await expectSample(
      registry,
      'surveyjs_bridge_requests_total{action="forwarded",method="GET",status="418"} 1',
    );
    await expect.poll(() => requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({ action: "forwarded", path, status: "418" });
  });

  it("never answers /metrics on the main port: the path is forwarded", async () => {
    const { bridge } = await setup();
    const answer = await send(`${bridge.url}/metrics`);
    expect(answer.status).toBe(418);
    expect(legacy.requests.map((request) => request.url)).toEqual(["/metrics"]);
  });

  it("counts a forward the old service cannot take as a network failure", async () => {
    const { bridge, registry } = await setup({ legacyUrl: await closedUrl() });
    expect((await send(`${bridge.url}/unknown/path`)).status).toBe(500);
    await expectSample(registry, 'surveyjs_bridge_forward_failures_total{reason="network"} 1');
    expect(await registry.metrics()).toContain(
      'surveyjs_bridge_requests_total{action="forwarded",method="GET",status="500"} 1',
    );
  });

  it("counts a forward the old service does not answer in time as a timeout", async () => {
    const silent = await startStub(() => undefined);
    cleanups.push(() => silent.close());
    const { bridge, registry } = await setup({ legacyUrl: silent.url }, { forwardTimeoutMs: 200 });
    expect((await send(`${bridge.url}/unknown/path`)).status).toBe(500);
    await expectSample(registry, 'surveyjs_bridge_forward_failures_total{reason="timeout"} 1');
    expect(await registry.metrics()).not.toContain('reason="network"');
  });

  it("counts a forward whose caller goes away first as aborted, its status none", async () => {
    const silent = await startStub(() => undefined);
    cleanups.push(() => silent.close());
    const { bridge, registry } = await setup({ legacyUrl: silent.url });
    const req = httpRequest(`${bridge.url}/unknown/path`, { agent: false });
    req.on("error", () => undefined);
    req.end();
    await expect.poll(() => silent.requests.length).toBe(1);
    req.destroy();
    await expectSample(registry, 'surveyjs_bridge_forward_failures_total{reason="aborted"} 1');
    expect(await registry.metrics()).toContain(
      'surveyjs_bridge_requests_total{action="forwarded",method="GET",status="none"} 1',
    );
  });

  it("counts a Studio call that times out with status timeout", async () => {
    const held: ServerResponse[] = [];
    studio.override = (_request, res) => {
      held.push(res);
      return true;
    };
    cleanups.push(async () => held.forEach((res) => res.destroy()));
    const { bridge, registry } = await setup({ studioTimeoutMs: 200 });
    const answer = await send(`${bridge.url}/public/Survey/getSurvey?surveyId=${SURVEY}`);
    expect(answer.status).toBe(500);
    await expectSample(
      registry,
      `surveyjs_bridge_studio_calls_total{${DEFINITION_CALL},status="timeout"} 1`,
    );
    expect(await registry.metrics()).toContain(
      'surveyjs_bridge_requests_total{action="getSurvey",method="GET",status="500"} 1',
    );
  });

  it("holds an upload in the uploads gauge until it is answered", async () => {
    const held: ServerResponse[] = [];
    studio.override = (request, res) => {
      if (request.method !== "POST" || !request.url.endsWith("/files")) return false;
      held.push(res);
      return true;
    };
    const { bridge, registry } = await setup();
    await expectSample(registry, "surveyjs_bridge_uploads_in_progress 0");
    const boundary = "metrics-test";
    const body =
      `--${boundary}\r\nContent-Disposition: form-data; name="postId"\r\n\r\n${POST}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="f"; filename="a.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n--${boundary}--\r\n`;
    const answer = send(`${bridge.url}/public/Survey/upload`, {
      method: "POST",
      headers: [["Content-Type", `multipart/form-data; boundary=${boundary}`]],
      body,
    });
    await expect.poll(() => held.length).toBe(1);
    expect(await registry.metrics()).toContain("surveyjs_bridge_uploads_in_progress 1");
    held[0]!
      .writeHead(201, { "content-type": "application/json" })
      .end(JSON.stringify(studio.storedFile));
    expect((await answer).status).toBe(200);
    await expectSample(registry, "surveyjs_bridge_uploads_in_progress 0");
    expect(await registry.metrics()).toContain(
      'surveyjs_bridge_requests_total{action="upload",method="POST",status="200"} 1',
    );
  });

  it("has no label holding a key, an ID or a path", async () => {
    const { bridge, registry } = await setup();
    await send(`${bridge.url}/public/Survey/getSurvey?surveyId=${SURVEY}&accessKey=Secret1`);
    await send(`${bridge.url}/zz-unlisted/path?accessKey=Secret1`);
    await expectSample(registry, 'action="forwarded"');
    const text = await registry.metrics();
    for (const value of [SURVEY, "Secret1", "zz-unlisted"]) expect(text).not.toContain(value);
  });
});

describe("the request log line", () => {
  it.each([
    ["a legacy key in mixed case", "Legacy-Key-Of-Ann"],
    ["an sjs_ API token", "sjs_Test-Token-Of-Ann"],
  ])("carries %s as Studio's hash prefix, never the key", async (_what, key) => {
    const { bridge, logs, requestLines } = await setup();
    await send(`${bridge.url}/private/Surveys/getActive?accessKey=${key}`);
    await expect.poll(() => requestLines()).toHaveLength(1);
    expect(requestLines()[0]).toMatchObject({
      action: "getActive",
      key: hashCredential(key, credentialKind(key)).slice(0, 16),
    });
    expect(logs()).not.toContain(key);
    expect(logs().toLowerCase()).not.toContain(key.toLowerCase());
  });

  it("gives a forwarded request's path without the query, and its key only hashed", async () => {
    const { bridge, logs, requestLines } = await setup();
    await send(`${bridge.url}/unknown/path?accessKey=OldKey123&x=secret-query`);
    await expect.poll(() => requestLines()).toHaveLength(1);
    const [line] = requestLines();
    expect(line).toMatchObject({
      action: "forwarded",
      method: "GET",
      status: "418",
      path: "/unknown/path",
      key: hashCredential("OldKey123", "legacy-key").slice(0, 16),
    });
    for (const text of ["OldKey123", "oldkey123", "secret-query", "accessKey"]) {
      expect(logs()).not.toContain(text);
    }
  });

  it("is the only line Fastify writes for a request", async () => {
    const { bridge, logs } = await setup();
    await send(`${bridge.url}/public/Survey/getSurvey?surveyId=${SURVEY}`);
    await expect.poll(() => logs()).toContain('"msg":"request"');
    expect(logs()).not.toContain("incoming request");
    expect(logs()).not.toContain("request completed");
  });
});
