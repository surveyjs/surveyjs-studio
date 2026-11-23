import { describe, expect, it } from "vitest";
import { compareAnswers, type Answer } from "./compare.js";

const json = (body: string, headers: Record<string, string> = {}, status = 200): Answer => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", ...headers },
  body: Buffer.from(body),
});

describe("compareAnswers", () => {
  it("ignores the value of the top-level traceId, not its presence or any other traceId", () => {
    const problem = (trace: string) =>
      json(`{"title":"x","traceId":"${trace}","errors":{"traceId":"${trace}"}}`, {}, 400);
    expect(compareAnswers(problem("00-a"), problem("00-a"), "x")).toEqual([]);
    expect(compareAnswers(problem("00-a"), problem("00-b"), "x")).toEqual([
      { at: "body.json.errors.traceId", expected: "00-a", actual: "00-b" },
    ]);
    expect(
      compareAnswers(
        json('{"title":"x","traceId":"00-a"}', {}, 400),
        json('{"title":"x","traceId":"00-b"}', {}, 400),
        "x",
      ),
    ).toEqual([]);
    expect(
      compareAnswers(
        json('{"title":"x","traceId":"00-a"}', {}, 400),
        json('{"title":"x"}', {}, 400),
        "x",
      ),
    ).toEqual([{ at: "body.json", expected: ["title", "traceId"], actual: ["title"] }]);
  });

  it("finds nothing in equal answers", () => {
    expect(compareAnswers(json('{"a":1}'), json('{"a":1}'), "getSurvey")).toEqual([]);
  });

  it("finds a property order swap: one difference at body.json", () => {
    expect(compareAnswers(json('{"a":1,"b":2}'), json('{"b":2,"a":1}'), "getSurvey")).toEqual([
      { at: "body.json", expected: ["a", "b"], actual: ["b", "a"] },
    ]);
  });

  it("ignores whitespace between JSON tokens", () => {
    expect(compareAnswers(json('{"a":[1,2]}'), json('{ "a": [ 1, 2 ] }\n'), "x")).toEqual([]);
  });

  it("finds a value, a type and a missing property by their paths", () => {
    expect(
      compareAnswers(
        json('{"a":{"b":[1,{"c":"x"}]},"d":null,"e":1}'),
        json('{"a":{"b":[1,{"c":"y"}]},"d":0}'),
        "x",
      ),
    ).toEqual([
      { at: "body.json", expected: ["a", "d", "e"], actual: ["a", "d"] },
      { at: "body.json.a.b[1].c", expected: "x", actual: "y" },
      { at: "body.json.d", expected: null, actual: 0 },
    ]);
  });

  it("keeps array order, and finds a length difference", () => {
    expect(compareAnswers(json("[1,2]"), json("[2,1]"), "x")).toEqual([
      { at: "body.json[0]", expected: 1, actual: 2 },
      { at: "body.json[1]", expected: 2, actual: 1 },
    ]);
    expect(compareAnswers(json("[1,2]"), json("[1]"), "x")).toEqual([
      { at: "body.json.length", expected: 2, actual: 1 },
    ]);
  });

  it("compares the arrays listed for an action in any order", () => {
    const unordered = { someAction: ["body.json.items", "body.json.groups[].ids"] };
    const old = json('{"items":[{"id":1},{"id":2}],"groups":[{"ids":[1,2]}]}');
    const bridge = json('{"items":[{"id":2},{"id":1}],"groups":[{"ids":[2,1]}]}');
    expect(compareAnswers(old, bridge, "someAction", unordered)).toEqual([]);
    expect(compareAnswers(old, bridge, "otherAction", unordered)).toHaveLength(4);
    expect(
      compareAnswers(old, json('{"items":[{"id":2}],"groups":[{"ids":[1,2]}]}'), "someAction", {
        someAction: ["body.json.items"],
      }),
    ).toEqual([{ at: "body.json.items", expected: [{ id: 1 }, { id: 2 }], actual: [{ id: 2 }] }]);
  });

  it("ignores date, server, trace and platform headers, and content-length of equal bodies", () => {
    const old = json("{}", {
      date: "Mon, 23 Nov 2026 10:00:00 GMT",
      server: "one",
      "x-request-id": "a",
      "request-context": "appId=x",
      "x-powered-by": "p",
      "set-cookie": "affinity=1",
      "transfer-encoding": "chunked",
    });
    const bridge = json("{}", { date: "Mon, 23 Nov 2026 10:00:05 GMT", "content-length": "2" });
    expect(compareAnswers(old, bridge, "x")).toEqual([]);
  });

  it("finds a different etag, and a header only one side has", () => {
    expect(compareAnswers(json("{}", { etag: '"1"' }), json("{}", { etag: '"2"' }), "x")).toEqual([
      { at: "headers.etag", expected: '"1"', actual: '"2"' },
    ]);
    expect(compareAnswers(json("{}", { "cache-control": "no-store" }), json("{}"), "x")).toEqual([
      { at: "headers.cache-control", expected: "no-store", actual: null },
    ]);
  });

  it("compares the headers callers read", () => {
    const names = [
      "content-type",
      "content-disposition",
      "location",
      "access-control-allow-origin",
      "access-control-expose-headers",
      "cache-control",
      "etag",
    ];
    for (const name of names) {
      const old: Answer = { status: 200, headers: { [name]: "a" }, body: Buffer.alloc(0) };
      const bridge: Answer = { status: 200, headers: { [name]: "b" }, body: Buffer.alloc(0) };
      expect(compareAnswers(old, bridge, "x"), name).toEqual([
        { at: `headers.${name}`, expected: "a", actual: "b" },
      ]);
    }
  });

  it("finds a different status", () => {
    expect(compareAnswers(json("{}", {}, 200), json("{}", {}, 404), "x")).toEqual([
      { at: "status", expected: 200, actual: 404 },
    ]);
  });

  it("compares other bodies byte for byte, showing where they start to differ", () => {
    const text = (body: string): Answer => ({
      status: 200,
      headers: { "content-type": "text/csv" },
      body: Buffer.from(body),
    });
    expect(compareAnswers(text("a,b\n1,2\n"), text("a,b\n1,2\n"), "x")).toEqual([]);
    expect(compareAnswers(text("a,b\n1,2\n"), text("a,b\r\n1,2\r\n"), "x")).toEqual([
      { at: "body.text[3]", expected: "a,b\n1,2\n", actual: "a,b\r\n1,2\r\n" },
    ]);
    const bytes = (body: number[]): Answer => ({
      status: 200,
      headers: { "content-type": "image/png" },
      body: Buffer.from(body),
    });
    expect(compareAnswers(bytes([1, 2, 3]), bytes([1, 2, 4]), "x")).toEqual([
      { at: "body.bytes[2]", expected: "AQID", actual: "AQIE" },
    ]);
  });

  it("keeps a long text body to a window around its first difference", () => {
    const head = "x".repeat(1000);
    const old: Answer = { status: 200, headers: {}, body: Buffer.from(`${head}A${head}`) };
    const bridge: Answer = { status: 200, headers: {}, body: Buffer.from(`${head}B${head}`) };
    const [difference] = compareAnswers(old, bridge, "x");
    expect(difference?.at).toBe("body.text[1000]");
    expect(String(difference?.expected)).toMatch(/^…x+Ax+…$/);
    expect(String(difference?.expected).length).toBeLessThan(400);
  });

  it("reads a JSON body the bridge cannot parse as text", () => {
    expect(compareAnswers(json('{"a":1}'), json("{oops"), "x")).toEqual([
      { at: "body.json", expected: { a: 1 }, actual: "{oops" },
    ]);
  });

  it("compares bodies as bytes when the old service's JSON does not parse", () => {
    expect(compareAnswers(json("{oops"), json("{oops!"), "x")).toEqual([
      { at: "body.text[5]", expected: "{oops", actual: "{oops!" },
    ]);
  });
});
