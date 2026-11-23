import { describe, expect, it } from "vitest";
import { keyHashPrefix } from "../../bridge/src/callers.js";
import type { RateLimitClass } from "../../server/src/rate-limit-classes.js";
import { replay, type CaseResult, type ReplayOptions } from "./run.js";
import type { SampleRow } from "./sample.js";

const OLD = "https://old.example";
const BRIDGE = "https://bridge.example/";
const KEY = "Secret0Key0Value";

const sampleRow = (path: string, query = "", method = "GET"): SampleRow => ({
  time: "2026-11-20T10:00:00Z",
  method,
  path,
  query,
  status: 200,
});

type Reply = { status?: number; headers?: Record<string, string>; body?: string } | Error;

/** A fetch that answers each origin from its own queue of replies and records every call. */
function fakeFetch(replies: { old: Reply[]; bridge: Reply[] }) {
  const calls: { url: string; method: string; redirect: string | undefined; side: string }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const side = url.startsWith(OLD) ? "old" : "bridge";
    calls.push({ url, method: init?.method ?? "GET", redirect: init?.redirect, side });
    const reply = replies[side].shift();
    if (reply === undefined) throw new Error(`no reply left for ${side}`);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? "", {
      status: reply.status ?? 200,
      headers: reply.headers ?? { "content-type": "application/json" },
    });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

async function collect(
  rows: SampleRow[],
  replies: { old: Reply[]; bridge: Reply[] },
  extra: Partial<ReplayOptions> = {},
) {
  const fake = fakeFetch(replies);
  const paced: (RateLimitClass | null)[] = [];
  const sleeps: number[] = [];
  const results: CaseResult[] = [];
  for await (const result of replay(rows, {
    oldUrl: OLD,
    bridgeUrl: BRIDGE,
    pacer: async (limit) => void paced.push(limit),
    fetch: fake.fetch,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  })) {
    results.push(result);
  }
  return { results, calls: fake.calls, paced, sleeps };
}

describe("replay", () => {
  it("asks the old service, then the bridge, then the old service again, with GET only", async () => {
    const row = sampleRow("/public/Survey/getSurvey", "surveyId=abc");
    const { results, calls, paced } = await collect([row], {
      old: [{ body: '{"a":1}' }, { body: '{"a":1}' }],
      bridge: [{ body: '{ "a": 1 }' }],
    });
    expect(calls).toEqual([
      {
        url: `${OLD}/public/Survey/getSurvey?surveyId=abc`,
        method: "GET",
        redirect: "manual",
        side: "old",
      },
      {
        url: "https://bridge.example/public/Survey/getSurvey?surveyId=abc",
        method: "GET",
        redirect: "manual",
        side: "bridge",
      },
      {
        url: `${OLD}/public/Survey/getSurvey?surveyId=abc`,
        method: "GET",
        redirect: "manual",
        side: "old",
      },
    ]);
    expect(paced).toEqual(["public"]);
    expect(results).toEqual([{ row, action: "getSurvey", outcome: "same", differences: [] }]);
  });

  it("reports the differences of the bridge's answer", async () => {
    const { results } = await collect([sampleRow("/public/Survey/getSurvey")], {
      old: [{ body: '{"a":1}' }, { body: '{"a":1}' }],
      bridge: [{ body: '{"a":2}' }],
    });
    expect(results[0]).toMatchObject({
      outcome: "different",
      differences: [{ at: "body.json.a", expected: 1, actual: 2 }],
    });
  });

  it("counts an old answer that changes between its two calls as changed, not a difference", async () => {
    const { results } = await collect([sampleRow("/private/Surveys/getSurveyPublicResults")], {
      old: [{ body: '{"data":[1]}' }, { body: '{"data":[1,2]}' }],
      bridge: [{ body: '{"data":[1,2]}' }],
    });
    expect(results[0]).toMatchObject({ outcome: "changed", differences: [] });
  });

  it("retries a bridge 429 once after its Retry-After, then counts it as rate-limited", async () => {
    const { results, calls, sleeps, paced } = await collect(
      [sampleRow("/public/Survey/getResult")],
      {
        old: [{ body: "{}" }],
        bridge: [
          { status: 429, headers: { "retry-after": "7" } },
          { status: 429, headers: { "retry-after": "7" } },
        ],
      },
    );
    expect(results[0]).toMatchObject({ outcome: "rate-limited", differences: [] });
    expect(sleeps).toEqual([7000]);
    expect(paced).toEqual(["summary", "summary"]);
    expect(calls.map((call) => call.side)).toEqual(["old", "bridge", "bridge"]);
  });

  it("waits 60 s for a 429 without a Retry-After in seconds, and goes on when the retry answers", async () => {
    const { results, sleeps } = await collect([sampleRow("/public/Survey/getSurvey")], {
      old: [{ body: "{}" }, { body: "{}" }],
      bridge: [{ status: 429, headers: { "retry-after": "soon" } }, { body: "{}" }],
    });
    expect(sleeps).toEqual([60_000]);
    expect(results[0]).toMatchObject({ outcome: "same" });
  });

  it("never sends a write, a forwarded path or another method", async () => {
    const { results, calls } = await collect(
      [
        sampleRow("/public/Survey/post", "", "POST"),
        sampleRow("/private/Surveys/generateAccessKey", `accessKey=${KEY}`),
        sampleRow("/elsewhere/page"),
        sampleRow("/public/Survey/getSurvey", "", "HEAD"),
      ],
      { old: [], bridge: [] },
    );
    expect(calls).toEqual([]);
    expect(results).toEqual([]);
  });

  it("never sends a read whose path fetch would turn into another action", async () => {
    const keyed = "/private/Surveys/getSurveyResults";
    const { results, calls } = await collect(
      [
        sampleRow(`${keyed}/..\\generateAccessKey`, `accessKey=${KEY}`),
        sampleRow(`${keyed}/%2E%2E\\publish`, `accessKey=${KEY}`),
        sampleRow(`${keyed}/..`, `accessKey=${KEY}`),
      ],
      { old: [], bridge: [] },
    );
    expect(calls).toEqual([]);
    expect(results).toEqual([]);
  });

  it("sends the path as fetch normalises it, when it stays on the same action", async () => {
    const { calls } = await collect(
      [sampleRow("/private/Surveys/getSurveyResults/.", `accessKey=${KEY}`)],
      { old: [{ body: "{}" }, { body: "{}" }], bridge: [{ body: "{}" }] },
    );
    expect(calls.map((call) => call.url)).toEqual([
      `${OLD}/private/Surveys/getSurveyResults/?accessKey=${KEY}`,
      `https://bridge.example/private/Surveys/getSurveyResults/?accessKey=${KEY}`,
      `${OLD}/private/Surveys/getSurveyResults/?accessKey=${KEY}`,
    ]);
  });

  it("scrubs the key from both bodies before cutting a window around their difference", async () => {
    const pieces = (text: string) =>
      Array.from({ length: KEY.length - 7 }, (_, i) => text.slice(i, i + 8).toLowerCase());
    // The first difference is at 1000: the window runs from 960 to 1160.
    const atEnd = `${"x".repeat(1000)}A${"y".repeat(150)}${KEY}${"z".repeat(100)}`;
    const atStart = `${"x".repeat(955)}${KEY}${"x".repeat(29)}A${"y".repeat(200)}`;
    for (const body of [atEnd, atStart]) {
      const { results } = await collect(
        [sampleRow("/private/Surveys/getActive", `accessKey=${KEY}`)],
        {
          old: [
            { body, headers: { "content-type": "text/plain" } },
            { body, headers: { "content-type": "text/plain" } },
          ],
          bridge: [{ body: body.replace("A", "B"), headers: { "content-type": "text/plain" } }],
        },
      );
      expect(results[0]?.outcome).toBe("different");
      const text = JSON.stringify(results).toLowerCase();
      for (const piece of pieces(KEY)) expect(text).not.toContain(piece);
    }
  });

  it("scrubs the key as it was recorded, before decoding", async () => {
    const recorded = "Secret0Key0%56alue"; // %56 is "V": the key, decoded.
    const { results } = await collect(
      [sampleRow("/private/Surveys/getActive", `accessKey=${recorded}`)],
      {
        old: [new Error(`Failed to parse URL from ${OLD}/x?accessKey=${recorded}`)],
        bridge: [],
      },
    );
    expect(results[0]?.keyPrefix).toBe(keyHashPrefix(KEY));
    expect(results[0]?.error).toBe(
      `Error: Failed to parse URL from ${OLD}/x?accessKey=${keyHashPrefix(KEY)}…`,
    );
  });

  it("keeps the key out of the result: only its hash prefix, in differences and errors too", async () => {
    const lower = KEY.toLowerCase();
    const { results } = await collect(
      [
        sampleRow("/private/Surveys/getActive", `ACCESSKEY=${KEY}&accessKey=other`),
        sampleRow("/private/Surveys/getActive", `accessKey=${encodeURIComponent(KEY)}`),
      ],
      {
        old: [
          {
            status: 302,
            headers: { location: `/elsewhere?next=%3FaccessKey%3D${KEY}` },
            body: `The accessKey '${lower}' is incorrect.`,
          },
          {
            status: 302,
            headers: { location: `/elsewhere?next=%3FaccessKey%3D${KEY}` },
            body: `The accessKey '${lower}' is incorrect.`,
          },
          new Error(`connect failed for ${OLD}/private/Surveys/getActive?accessKey=${KEY}`),
        ],
        bridge: [{ status: 401, body: `{"key":"${KEY}"}` }],
      },
    );
    const prefix = keyHashPrefix(KEY);
    expect(results.map((result) => [result.outcome, result.keyPrefix])).toEqual([
      ["different", prefix],
      ["error", prefix],
    ]);
    const text = JSON.stringify(results, (_name, value: unknown) =>
      typeof value === "bigint" ? String(value) : value,
    );
    expect(text).not.toMatch(new RegExp(KEY, "i"));
    expect(text).toContain(`${prefix}…`);
    expect(results[1]?.error).toBe(
      `Error: connect failed for ${OLD}/private/Surveys/getActive?accessKey=${prefix}…`,
    );
  });

  it("has no key prefix when the first accessKey is empty, as the bridge reads it", async () => {
    const { results } = await collect(
      [sampleRow("/private/Surveys/getActive", `accessKey=&AccessKey=${KEY}`)],
      { old: [{ body: "{}" }, { body: "{}" }], bridge: [{ body: "{}" }] },
    );
    expect(results[0]?.keyPrefix).toBeUndefined();
    expect(results[0]?.row.query).toBe(`accessKey=&AccessKey=${keyHashPrefix(KEY)}…`);
  });

  it("counts a request that fails as an error and goes on", async () => {
    const { results } = await collect(
      [sampleRow("/public/Survey/getSurvey"), sampleRow("/public/Survey/getSurvey")],
      {
        old: [{ body: "{}" }, new Error("socket hang up"), { body: "{}" }, { body: "{}" }],
        bridge: [{ body: "{}" }, { body: "{}" }],
      },
    );
    expect(results.map((result) => result.outcome)).toEqual(["error", "same"]);
    expect(results[0]?.error).toBe("Error: socket hang up");
    expect(results[0]?.keyPrefix).toBeUndefined();
  });
});
